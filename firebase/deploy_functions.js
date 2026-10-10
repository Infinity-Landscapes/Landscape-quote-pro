#!/usr/bin/env node
// Deploys the website payment functions (functions/) to Cloud Functions (2nd gen, europe-west2)
// through the REST APIs — the same result as `firebase deploy --only functions`, for where the
// firebase CLI can't sign in through a proxy.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node deploy_functions.js [prepare|deploy|setup|status]
//     prepare  enable the APIs and create the STRIPE_SECRET_KEY secret (placeholder until the
//              real key is added in Secret Manager)
//     deploy   upload functions/ and create/update the four functions; make checkout, portal and
//              webhook public (admin stays private)
//     setup    call the private admin function: products, prices, VAT rate, portal, webhook
//     status   show what's deployed and the Stripe set-up stored in Firestore
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');
function req(name){ try { return require(name); } catch(e) {} return require(path.join(execSync('npm root -g').toString().trim(), 'firebase-tools', 'node_modules', name)); }
const { GoogleAuth } = req('google-auth-library');

const ROOT = __dirname;
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const REGION = 'europe-west2';
const SECRET = 'STRIPE_SECRET_KEY';
const FUNCS = [
  { id: 'stripe-checkout', entry: 'checkout', public: true },
  { id: 'stripe-portal',   entry: 'portal',   public: true },
  { id: 'stripe-webhook',  entry: 'webhook',  public: true },
  { id: 'stripe-admin',    entry: 'admin',    public: false },
];
const SITE = 'https://landscape-quote-pro.web.app';
// Runs as the Firebase admin account, which has Firestore access (new Google Cloud organisations
// no longer give the default compute account any).
const RUNTIME_SA = `firebase-adminsdk-fbsvc@${PROJECT}.iam.gserviceaccount.com`;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let client;
async function call(method, url, data, opts){
  client = client || await auth.getClient();
  try { return (await client.request(Object.assign({ method, url, data }, opts || {}))).data; }
  catch (e) { const d = e.response && e.response.data; const err = new Error(`${method} ${url.replace(/\?.*/, '')} → ${e.response ? e.response.status : ''} ${JSON.stringify((d && d.error && d.error.message) || d || e.message)}`); err.status = e.response && e.response.status; throw err; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitOp(name, base){
  for (let i = 0; i < 240; i++) {
    const op = await call('GET', `${base}/${name}`);
    if (op.done) { if (op.error) throw new Error(`${name}: ${JSON.stringify(op.error)}`); return op.response; }
    await sleep(5000);
  }
  throw new Error('timed out waiting for ' + name);
}
async function projectNumber(){ return (await call('GET', `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`)).projectNumber; }

async function prepare(){
  const apis = ['cloudfunctions', 'cloudbuild', 'artifactregistry', 'run', 'secretmanager', 'logging', 'pubsub'].map(a => `${a}.googleapis.com`);
  console.log('enabling APIs…');
  const op = await call('POST', `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services:batchEnable`, { serviceIds: apis });
  if (op.name && !op.done) await waitOp(op.name, 'https://serviceusage.googleapis.com/v1');
  const SM = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets`;
  let exists = true;
  try { await call('GET', `${SM}/${SECRET}`); } catch (e) { if (e.status === 404) exists = false; else throw e; }
  if (!exists) {
    await call('POST', `${SM}?secretId=${SECRET}`, { replication: { automatic: {} }, labels: { app: 'quote-pro' } });
    // A placeholder so the functions can deploy; they say "not set up yet" until the real key is added.
    await call('POST', `${SM}/${SECRET}:addVersion`, { payload: { data: Buffer.from('not-set').toString('base64') } });
    console.log('created secret', SECRET, '(placeholder)');
  } else console.log('secret', SECRET, 'already exists');
  // The functions run as the Firebase admin service account (it can already use Firestore): let it read the key.
  const runtimeSA = `serviceAccount:${RUNTIME_SA}`;
  const pol = await call('GET', `${SM}/${SECRET}:getIamPolicy`);
  pol.bindings = pol.bindings || [];
  let b = pol.bindings.find(x => x.role === 'roles/secretmanager.secretAccessor');
  if (!b) { b = { role: 'roles/secretmanager.secretAccessor', members: [] }; pol.bindings.push(b); }
  if (!b.members.includes(runtimeSA)) { b.members.push(runtimeSA); await call('POST', `${SM}/${SECRET}:setIamPolicy`, { policy: pol }); console.log('functions can read the key'); }
  const v = await call('GET', `${SM}/${SECRET}/versions`);
  const latest = (v.versions || []).filter(x => x.state === 'ENABLED').length;
  console.log(`secret versions enabled: ${latest}`);
}

async function upload(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fnsrc-'));
  const zip = path.join(tmp, 'src.zip');
  execSync(`zip -q -j ${zip} index.js package.json package-lock.json`, { cwd: path.join(ROOT, 'functions') });
  const u = await call('POST', `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions:generateUploadUrl`, {});
  await call('PUT', u.uploadUrl, fs.readFileSync(zip), { headers: { 'Content-Type': 'application/zip' } });
  return u.storageSource;
}
async function deploy(){
  const src = await upload();
  const base = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions`;
  const ops = [];
  for (const f of FUNCS) {
    const body = {
      name: `projects/${PROJECT}/locations/${REGION}/functions/${f.id}`,
      buildConfig: { runtime: 'nodejs22', entryPoint: f.entry, source: { storageSource: src } },
      serviceConfig: {
        serviceAccountEmail: RUNTIME_SA,
        availableMemory: '256M', timeoutSeconds: 60, maxInstanceCount: 5, minInstanceCount: 0, ingressSettings: 'ALLOW_ALL',
        allTrafficOnLatestRevision: true,
        secretEnvironmentVariables: [{ key: SECRET, projectId: PROJECT, secret: SECRET, version: 'latest' }],
      },
      environment: 'GEN_2',
      labels: { app: 'quote-pro' },
    };
    let exists = true;
    try { await call('GET', `${base}/${f.id}`); } catch (e) { if (e.status === 404) exists = false; else throw e; }
    const op = exists
      ? await call('PATCH', `${base}/${f.id}?updateMask=buildConfig,serviceConfig,labels`, body)
      : await call('POST', `${base}?functionId=${f.id}`, body);
    console.log(`${exists ? 'updating' : 'creating'} ${f.id}…`);
    ops.push([f, op]);
  }
  for (const [f, op] of ops) {
    const fn = await waitOp(op.name, 'https://cloudfunctions.googleapis.com/v2');
    console.log(`${f.id} ready: ${fn.serviceConfig && fn.serviceConfig.uri}`);
    // Public functions: anyone may call them (each checks the signed-in user, or fetches the event
    // back from Stripe). The organisation doesn't allow "allUsers" in IAM, so the Cloud Run
    // invoker check is switched off on these services instead; the admin one keeps it.
    await setPublic(f.id, f.public);
  }
}
async function setPublic(id, on){
  const u = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${id}`;
  const svc = await call('GET', u);
  if (!!svc.invokerIamDisabled === !!on) { console.log(`${id}: ${on ? 'public' : 'private'}`); return; }
  delete svc.template.revision; // a fresh revision name, or Cloud Run refuses the change
  await call('PATCH', `${u}?updateMask=invokerIamDisabled,template`, { invokerIamDisabled: !!on, template: svc.template });
  for (let i = 0; i < 60; i++) { await sleep(4000); const s = await call('GET', u); if (!s.reconciling) { console.log(`${id}: ${on ? 'public' : 'private'} (${s.terminalCondition && s.terminalCondition.state})`); return; } }
  throw new Error('timed out making ' + id + (on ? ' public' : ' private'));
}
async function adminCall(body){
  const fn = await call('GET', `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/stripe-admin`);
  const url = fn.serviceConfig.uri;
  const idc = await new GoogleAuth().getIdTokenClient(url); // ID tokens can't carry scopes
  const r = await idc.request({ url, method: 'POST', data: body });
  return r.data;
}
async function status(){
  for (const f of FUNCS) {
    try { const fn = await call('GET', `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${f.id}`); console.log(f.id, fn.state, fn.serviceConfig && fn.serviceConfig.uri, fn.updateTime); }
    catch (e) { console.log(f.id, 'not deployed'); }
  }
  try { console.log(JSON.stringify(await adminCall({ action: 'status' }), null, 1)); } catch (e) { console.log('admin status:', e.message); }
}
(async () => {
  const what = process.argv[2] || 'status';
  if (what === 'prepare') await prepare();
  else if (what === 'deploy') await deploy();
  else if (what === 'setup') console.log(JSON.stringify(await adminCall({ action: 'setup', webhookUrl: SITE + '/api/stripe-webhook' }), null, 1));
  else await status();
})().catch(e => { console.error(e.message || e); process.exit(1); });

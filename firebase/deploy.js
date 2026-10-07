#!/usr/bin/env node
// Publishes the website (public/) and the Firestore security rules to Firebase using the REST
// APIs directly — the same steps `firebase deploy --only hosting,firestore:rules` performs.
// Used where the firebase CLI can't fetch its sign-in through a proxy.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node deploy.js [--rules] [--hosting]
//   (no flags = both). Run `python3 build.py` first so public/ is current.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execSync } = require('child_process');

function req(name){
  try{ return require(name); }catch(e){}
  const root = execSync('npm root -g').toString().trim();
  return require(path.join(root, 'firebase-tools', 'node_modules', name));
}
const { GoogleAuth } = req('google-auth-library');

const ROOT = __dirname;
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const FB = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const SITE = PROJECT;
const args = process.argv.slice(2);
const doRules = !args.length || args.includes('--rules');
const doHosting = !args.length || args.includes('--hosting');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'] });
let client;
async function call(method, url, data, extra = {}){
  try{
    const r = await client.request(Object.assign({ method, url, data, responseType: 'json' }, extra));
    return r.data;
  }catch(e){
    const d = e.response && e.response.data;
    const msg = (d && d.error && (d.error.message || JSON.stringify(d.error))) || e.message;
    const err = new Error(`${method} ${url.replace(/\?.*/, '')} -> ${e.response ? e.response.status : ''} ${msg}`);
    err.status = e.response && e.response.status;
    throw err;
  }
}

async function deployRules(){
  const base = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
  const content = fs.readFileSync(path.join(ROOT, FB.firestore.rules), 'utf8');
  const rs = await call('POST', `${base}/rulesets`, { source: { files: [{ name: 'firestore.rules', content }] } });
  const releaseName = `projects/${PROJECT}/releases/cloud.firestore`;
  try{
    await call('PATCH', `${base}/releases/cloud.firestore`, { release: { name: releaseName, rulesetName: rs.name } });
  }catch(e){
    if(e.status !== 404) throw e;
    await call('POST', `${base}/releases`, { name: releaseName, rulesetName: rs.name });
  }
  console.log('rules: released', rs.name);
}

function listFiles(dir, base = dir){
  const out = [];
  for(const name of fs.readdirSync(dir)){
    if(name.startsWith('.')) continue; // hosting.ignore "**/.*"
    const p = path.join(dir, name);
    if(fs.statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else if(name !== 'firebase.json') out.push('/' + path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function deployHosting(){
  const pub = path.join(ROOT, FB.hosting.public);
  const base = `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}`;
  const config = {};
  if(FB.hosting.cleanUrls) config.cleanUrls = true;
  const version = await call('POST', `${base}/versions`, { config });
  const files = {}, gz = {};
  for(const f of listFiles(pub)){
    const z = zlib.gzipSync(fs.readFileSync(path.join(pub, f)), { level: 9 });
    const h = crypto.createHash('sha256').update(z).digest('hex');
    files[f] = h; gz[h] = z;
  }
  const pop = await call('POST', `https://firebasehosting.googleapis.com/v1beta1/${version.name}:populateFiles`, { files });
  const need = pop.uploadRequiredHashes || [];
  for(const h of need){
    await call('POST', `${pop.uploadUrl}/${h}`, gz[h], { headers: { 'Content-Type': 'application/octet-stream' }, responseType: 'text' });
  }
  await call('PATCH', `https://firebasehosting.googleapis.com/v1beta1/${version.name}?update_mask=status`, { status: 'FINALIZED' });
  const rel = await call('POST', `${base}/releases?versionName=${encodeURIComponent(version.name)}`, {});
  console.log(`hosting: ${Object.keys(files).length} files (${need.length} uploaded), released ${rel.name}`);
  console.log(`live at https://${SITE}.web.app`);
}

(async () => {
  client = await auth.getClient();
  if(doRules) await deployRules();
  if(doHosting) await deployHosting();
})().catch(e => { console.error('DEPLOY FAILED:', e.message); process.exit(1); });

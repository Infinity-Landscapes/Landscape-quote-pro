// Gives one account a longer free trial (admin only — the app can't set this itself).
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node grant_trial.js friend@example.com 30
// The trial runs for that many days from when they signed up (so "30" = one month from sign-up).
// Pass --from-today to count the days from today instead. Run with no days to see their status.
const path = require('path'), { execSync } = require('child_process');
const { GoogleAuth } = require(path.join(execSync('npm root -g').toString().trim(), 'firebase-tools/node_modules/google-auth-library'));
const PROJECT = 'landscape-quote-pro';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/identitytoolkit'] });
async function req(method, url, data){
  const c = await auth.getClient();
  try { return (await c.request({ method, url, data })).data; }
  catch(e){ const d = e.response && e.response.data; throw new Error((e.response ? e.response.status + ' ' : '') + JSON.stringify(d && d.error || e.message)); }
}
(async () => {
  const [email, daysArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const fromToday = process.argv.includes('--from-today');
  if (!email) { console.log('usage: node grant_trial.js <email> [days] [--from-today]'); process.exit(1); }
  const look = await req('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { email: [email] });
  const u = look.users && look.users[0];
  if (!u) { console.log(`No account for ${email} yet — they need to sign up on the website first.`); process.exit(2); }
  const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/accounts/${u.localId}`;
  let doc; try { doc = await req('GET', docUrl); } catch(e) { doc = null; }
  const f = (doc && doc.fields) || {};
  const created = f.createdAt ? new Date(f.createdAt.timestampValue) : new Date(Number(u.createdAt));
  const show = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  console.log(`${email}: signed up ${show(created)}${f.trialUntil ? `, trial until ${show(new Date(f.trialUntil.timestampValue))}` : ''}${f.freeForever && f.freeForever.booleanValue ? ', free forever' : ''}`);
  if (!daysArg) return;
  const days = Number(daysArg);
  if (!(days > 0 && days <= 365)) { console.log('days must be between 1 and 365'); process.exit(1); }
  const until = new Date((fromToday ? Date.now() : created.getTime()) + days * 86400000);
  await req('PATCH', `${docUrl}?updateMask.fieldPaths=trialUntil`, { fields: { trialUntil: { timestampValue: until.toISOString() } } });
  console.log(`Free trial now runs until ${show(until)}.`);
})().catch(e => { console.error(e.message); process.exit(1); });

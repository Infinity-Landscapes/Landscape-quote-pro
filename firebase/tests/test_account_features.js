// Own-website (Firebase) build: trial, plans, device limit, swap limit, read-only when lapsed,
// account panel (export / delete), offline saving. Runs against the Auth + Firestore emulators:
//   firebase emulators:exec --only auth,firestore "node tests/test_account_features.js"
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PROJECT = 'landscape-quote-pro';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

function serve(){
  return new Promise(res=>{
    const srv = http.createServer((req,resp)=>{
      let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
      const f = path.join(PUB, p);
      if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); return resp.end('nf'); }
      resp.writeHead(200, {'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html'}); fs.createReadStream(f).pipe(resp);
    }).listen(5057, '127.0.0.1', ()=>res(srv));
  });
}
async function rest(method, url, token, body){
  const r = await fetch(url, {method, headers: Object.assign({'Content-Type':'application/json'}, token?{Authorization:'Bearer '+token}:{}), body: body?JSON.stringify(body):undefined});
  let j = null; try{ j = await r.json(); }catch(e){}
  return {status:r.status, json:j};
}
async function signIn(email, pass){
  return (await rest('POST', `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, null, {email, password:pass, returnSecureToken:true})).json;
}
// Server-side ("admin") write — the emulator lets the owner token bypass the rules.
function fsValue(v){
  if (v instanceof Date) return {timestampValue: v.toISOString()};
  if (typeof v === 'boolean') return {booleanValue: v};
  if (typeof v === 'number') return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (v === null) return {nullValue: null};
  return {stringValue: String(v)};
}
async function adminPatch(docPath, fields){
  const mask = Object.keys(fields).map(k=>'updateMask.fieldPaths='+encodeURIComponent(k)).join('&');
  const body = {fields:{}}; Object.entries(fields).forEach(([k,v])=>{ body.fields[k] = fsValue(v); });
  return rest('PATCH', `${FS}/${docPath}?${mask}`, 'owner', body);
}
async function adminGet(docPath){ return rest('GET', `${FS}/${docPath}`, 'owner'); }

(async()=>{
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const errors = [];
  const URL0 = 'http://127.0.0.1:5057/?emulator=1';
  async function device(){
    const ctx = await browser.newContext({ viewport:{width:1200,height:1000}, acceptDownloads:true });
    const page = await ctx.newPage(); await page.addInitScript('window.__NO_AUTO_TOUR__ = true;');
    page.on('pageerror', e=>errors.push('PAGEERROR: '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !/favicon|fonts\.g|Failed to load resource|offline|Could not reach Cloud Firestore/i.test(m.text())) errors.push('CONSOLE: '+m.text()); });
    page.on('dialog', d=>{ page._lastDialog = d.message(); d.accept(); });
    return {ctx, page};
  }
  const settle = (p, ms=350) => p.waitForTimeout(ms);
  const click = async (p, sel) => { await (await p.waitForSelector(sel, {timeout:10000})).click(); await settle(p); };
  const text = p => p.textContent('body');
  async function signInUI(p, email, pw){
    await p.goto(URL0); await p.waitForSelector('#agEmail', {timeout:10000});
    await p.fill('#agEmail', email); await p.fill('#agPass', pw); await p.click('#authGate .ag-btn'); await settle(p, 2500);
  }
  async function setupBusiness(p){
    await p.fill('#f_name','Infinity Landscapes and Design');
    for (let i=0;i<3;i++) await click(p, 'button[data-action="setupNext"]');
    await p.fill('#f_pin','1234'); await p.fill('#f_pin2','1234');
    await click(p, 'button[data-action="setupNext"]'); await settle(p, 800);
  }
  async function unlock(p){ if (await p.$('#loginPin')) { await p.fill('#loginPin','1234'); await click(p, 'button[data-action="login"]'); } }
  async function makeQuote(p, name){
    await click(p, 'button[data-nav="newquote"]');
    await p.fill('#q_creator','Matt'); await p.fill('#q_cname', name);
    await click(p, 'button[data-action="wizNext"]');
    await click(p, '[data-action="toggleQuoteService"][data-key="turf"]');
    await click(p, 'button[data-action="wizNext"]');
    await p.fill('[data-row="0"] input[data-mf="width"]','5'); await p.fill('[data-row="0"] input[data-mf="length"]','4'); await settle(p);
    for (let i=0;i<6 && !(await p.$('button[data-action="saveSentQuote"]')); i++) await click(p, 'button[data-action="wizNext"]');
    await click(p, 'button[data-action="saveSentQuote"]'); await settle(p, 1200);
  }

  // ---------- 1. sign up: trial starts, first device registered ----------
  const A = await device();
  await A.page.goto(URL0); await A.page.waitForSelector('#agEmail');
  await A.page.click('[data-auth="signup"]'); await settle(A.page);
  check('sign-up mentions the 7-day trial and links the terms', /free 7-day trial/.test(await A.page.textContent('#authGate')) && !!(await A.page.$('#authGate a[href="/terms"]')));
  await A.page.fill('#agEmail','matt@test.co.uk'); await A.page.fill('#agPass','password123'); await A.page.fill('#agPass2','password123');
  await A.page.click('#authGate .ag-btn'); await settle(A.page, 3000);
  await setupBusiness(A.page);
  check('trial banner: 7 days left', /Free trial: 7 days left/.test(await text(A.page)));
  const tok = await signIn('matt@test.co.uk','password123'); const uid = tok.localId;
  let r = await adminGet(`accounts/${uid}`);
  check('account doc created with a server-time trial start', r.status===200 && !!r.json.fields.createdAt.timestampValue);
  r = await adminGet(`accounts/${uid}/private/devices`);
  check('this device registered (1 of 2)', r.status===200 && Object.keys(r.json.fields.devices.mapValue.fields||{}).length===1);
  await makeQuote(A.page, 'Trial Customer');
  check('quote saves during the trial', /Trial Customer/.test(await text(A.page)) || (await rest('GET', `${FS}/businesses/${uid}/quotes`, tok.idToken)).json.documents.length===1);

  // ---------- 2. rules: users can't give themselves a plan or extra devices ----------
  r = await rest('PATCH', `${FS}/accounts/${uid}?updateMask.fieldPaths=tier&updateMask.fieldPaths=periodEnd`, tok.idToken, {fields:{tier:{stringValue:'business'}, periodEnd:{timestampValue:'2099-01-01T00:00:00Z'}}});
  check('rules: a user cannot set their own plan', r.status===403);
  r = await rest('DELETE', `${FS}/accounts/${uid}`, tok.idToken);
  check('rules: a user cannot delete the account doc (no trial reset)', r.status===403);

  // ---------- 3. device limit (trial = 2) ----------
  const B = await device(); await signInUI(B.page, 'matt@test.co.uk', 'password123');
  check('second device signs in fine (2 of 2)', !(await B.page.isVisible('#pfDevices').catch(()=>false)) && !!(await B.page.$('#loginPin')));
  const C = await device(); await signInUI(C.page, 'matt@test.co.uk', 'password123');
  check('third device gets "Too many devices" with the 2 current ones listed', /Too many devices/.test(await text(C.page)) && (await C.page.$$('#pfDevices [data-pf="kick"]')).length===2);
  check('picker shows swaps left this month', /2 swaps left this month/.test(await text(C.page)));
  // rules: can't sneak a 3rd device in directly
  r = await adminGet(`accounts/${uid}/private/devices`);
  const devFields = r.json.fields.devices.mapValue.fields; const swapMonth = r.json.fields.swapMonth.integerValue;
  const three = Object.assign({}, devFields, { dX: {mapValue:{fields:{name:{stringValue:'Sneaky'}}}} });
  r = await rest('PATCH', `${FS}/accounts/${uid}/private/devices`, tok.idToken, {fields:{devices:{mapValue:{fields:three}}, swapMonth:{integerValue:swapMonth}, swapsUsed:{integerValue:'0'}}});
  check('rules: a 3rd device is refused on a 2-device plan', r.status===403);
  // rules: can't remove a device without counting the swap
  const ids = Object.keys(devFields); const swapped = {}; swapped[ids[0]] = devFields[ids[0]]; swapped.dY = {mapValue:{fields:{name:{stringValue:'Swap'}}}};
  r = await rest('PATCH', `${FS}/accounts/${uid}/private/devices`, tok.idToken, {fields:{devices:{mapValue:{fields:swapped}}, swapMonth:{integerValue:swapMonth}, swapsUsed:{integerValue:'0'}}});
  check('rules: swapping a device without counting it is refused', r.status===403);
  // sign A out from C
  const aId = await A.page.evaluate(()=>localStorage.getItem('lqp_device_id'));
  await C.page.click(`#pfDevices [data-pf="kick"][data-id="${aId}"]`); await settle(C.page, 2500);
  check('after signing one out, the new device gets in', !(await C.page.isVisible('#pfDevices')) && !!(await C.page.$('#loginPin')));
  await settle(A.page, 2500);
  check('the removed device is signed out, with an explanation', await A.page.isVisible('#authGate') && /signed out from another device/.test(await A.page.textContent('#authGate')));
  r = await adminGet(`accounts/${uid}/private/devices`);
  check('swap counted (1 used)', r.json.fields.swapsUsed.integerValue==='1');

  // ---------- 4. swap limit reached ----------
  await adminPatch(`accounts/${uid}/private/devices`, { swapsUsed: 2 });
  const D = await device(); await signInUI(D.page, 'matt@test.co.uk', 'password123');
  const dt = await text(D.page);
  check('no swaps left: no sign-out buttons, says when it resets, offers support', /used both device swaps this month/.test(dt) && /swap again on 1 /.test(dt) && (await D.page.$$('#pfDevices [data-pf="kick"]')).length===0 && /support@landscapequotepro\.co\.uk/.test(dt));
  await D.ctx.close();

  // ---------- 5. trial over -> read-only ----------
  await adminPatch(`accounts/${uid}`, { createdAt: new Date(Date.now() - 10*86400000) });
  await B.page.reload(); await settle(B.page, 2500); await unlock(B.page);
  check('lapsed: banner says the trial has ended', /free trial has ended/.test(await B.page.evaluate(()=>document.getElementById('pfBanner').innerText)));
  B.page._lastDialog = null;
  await B.page.click('button[data-nav="newquote"]'); await settle(B.page, 600);
  check('lapsed: New quote is blocked with an explanation', /read-only/.test(B.page._lastDialog||'') && !(await B.page.$('#q_cname')));
  if (await B.page.isVisible('#pfPlans')) await B.page.click('#pfPlans [data-pf="close"]');
  const navs = await B.page.$$eval('[data-nav]', els=>els.map(e=>e.getAttribute('data-nav')));
  const qNav = navs.find(n=>/quotes|jobs/.test(n)) || 'quotes';
  await click(B.page, `button[data-nav="${qNav}"]`);
  check('lapsed: existing quotes still viewable', /Trial Customer/.test(await text(B.page)));
  r = await rest('PATCH', `${FS}/businesses/${uid}?updateMask.fieldPaths=x`, (await signIn('matt@test.co.uk','password123')).idToken, {fields:{x:{stringValue:'y'}}});
  check('rules: writes refused once the trial has ended', r.status===403);
  r = await rest('PATCH', `${FS}/accounts/${uid}?updateMask.fieldPaths=trialUntil`, (await signIn('matt@test.co.uk','password123')).idToken, {fields:{trialUntil:{timestampValue:new Date(Date.now()+90*86400000).toISOString()}}});
  check('rules: a user cannot give themselves a longer trial', r.status===403);

  // ---------- 5b. one-off longer trial (admin sets trialUntil) -> editable again ----------
  await adminPatch(`accounts/${uid}`, { trialUntil: new Date(Date.now() + 20.5*86400000) });
  await B.page.reload(); await settle(B.page, 2500); await unlock(B.page);
  check('extended trial: banner shows the new days left (21)', /Free trial: 21 days left/.test(await B.page.evaluate(()=>{ const b=document.getElementById('pfBanner'); return b?b.innerText:''; })));
  r = await rest('PATCH', `${FS}/businesses/${uid}?updateMask.fieldPaths=x`, (await signIn('matt@test.co.uk','password123')).idToken, {fields:{x:{stringValue:'y'}}});
  check('rules: writes allowed again during the extended trial', r.status===200);
  await adminPatch(`accounts/${uid}`, { trialUntil: new Date(Date.now() - 86400000) });
  await B.page.reload(); await settle(B.page, 2500); await unlock(B.page);
  check('extended trial over: read-only again', /free trial has ended/.test(await B.page.evaluate(()=>document.getElementById('pfBanner').innerText)));

  // ---------- 6. plan bought (server sets it) -> editable, Team = 5 devices ----------
  await adminPatch(`accounts/${uid}`, { tier: 'team', periodEnd: new Date(Date.now() + 30*86400000), store: 'play_store', billingPeriod: 'monthly' });
  await settle(B.page, 2000);
  check('plan active: read-only banner gone', !/has ended/.test(await B.page.evaluate(()=>{ const b=document.getElementById('pfBanner'); return b?b.innerText:''; })));
  await click(B.page, 'button[data-action="account"]');
  const acc = await B.page.textContent('#pfAccount');
  check('account panel: email, Team plan renewal, devices out of 5', /matt@test\.co\.uk/.test(acc) && /Team plan \(monthly\) — renews/.test(acc) && /Devices \(2 of 5\)/.test(acc));
  check('account panel: this device marked, download / delete / sign out offered', /This device/.test(acc) && /Download all my data/.test(acc) && /Delete my account/.test(acc) && /Sign out of this device/.test(acc));

  check('account panel on the website, Google Play plan: says where it is billed instead of offering a web plan change', /billed through Google Play/.test(acc) && !(await B.page.$('#pfAccount [data-pf="plans"]')));
  // ---------- 7. plans screen ----------
  await click(B.page, '#pfAccount [data-pf="close"]');
  await B.page.evaluate(()=>window.__platform.openPlans()); await settle(B.page, 300);
  let pl = await B.page.textContent('#pfPlans');
  check('plans: Solo / Team / Business with device counts and prices', /Solo/.test(pl) && /Team/.test(pl) && /Business/.test(pl) && /£30/.test(pl) && /£45/.test(pl) && /£70/.test(pl) && /up to 10 devices/.test(pl.replace(/\s+/g,' ')));
  check('plans: current plan marked; on the website a Google Play plan is acknowledged, nothing to buy', /Your plan/.test(pl) && /billed through Google Play, so there's nothing to pay here/.test(pl) && !(await B.page.$('#pfPlans [data-pf="buy"]')));
  await click(B.page, '#pfPlans [data-pf="period"][data-period="yearly"]');
  pl = await B.page.textContent('#pfPlans');
  check('plans: yearly shows £300 / £450 / £700 and 2 months free', /£300/.test(pl) && /£450/.test(pl) && /£700/.test(pl) && /2 months free/.test(pl));
  // a phone app's purchase provider is used when present
  await B.page.evaluate(()=>{ window.__purchases = { storeName:'Google Play', priceFor:(t,p)=>({solo:'£35.99',team:'£54.99',business:'£83.99'})[t], purchase:(t,p)=>{ window.__bought = t+'/'+p; return Promise.resolve({}); }, restore:()=>Promise.resolve() }; });
  await click(B.page, '#pfPlans [data-pf="period"][data-period="monthly"]');
  pl = await B.page.textContent('#pfPlans');
  check('plans in the phone app: store prices + restore purchases', /£83\.99/.test(pl) && /Restore purchases/.test(pl) && /Google Play/.test(pl));
  await click(B.page, '#pfPlans [data-pf="buy"][data-plan="business"]');
  check('choosing Business hands the purchase to the store', (await B.page.evaluate(()=>window.__bought))==='business/monthly');
  await click(B.page, '#pfPlans [data-pf="close"]');

  // ---------- 7b. one subscription, any platform — never sold twice, no web link in the phone apps ----------
  const plansText = async () => { await B.page.evaluate(()=>{ const o=document.getElementById('pfPlans'); if(o) o.remove(); }); await B.page.evaluate(()=>window.__platform.openPlans()); await settle(B.page, 300); return B.page.textContent('#pfPlans'); };
  const iosApp = () => B.page.evaluate(()=>{ window.__bought = null; window.__purchases = { store:'app_store', storeName:'the App Store', priceFor:(t)=>({solo:'£35.99',team:'£54.99',business:'£83.99'})[t], purchase:(t,p)=>{ window.__bought = t+'/'+p; return Promise.resolve({}); }, restore:()=>Promise.resolve(), manage:()=>{ window.__managed = true; } }; });
  await iosApp();
  pl = await plansText();
  check('Google Play plan opened in the iPhone app: full access, no buy buttons, says where it is billed', !(await B.page.$('#pfPlans [data-pf="buy"]')) && /billed through Google Play/.test(pl));
  await B.page.evaluate(()=>window.__platform.openPlans()); 
  await adminPatch(`accounts/${uid}`, { store: 'stripe' }); await settle(B.page, 2000);
  pl = await plansText();
  check('web-paid plan in the iPhone app: acknowledged, no buy buttons', /already active on this account — there's nothing to pay here/.test(pl) && !(await B.page.$('#pfPlans [data-pf="buy"]')));
  check('…and never names or links to the website or Stripe', !/website|stripe|web\b/i.test(pl) && !(await B.page.$$eval('#pfPlans a', as=>as.some(a=>!/\/(terms|privacy)$/.test(a.getAttribute('href')||'')))));
  await B.page.evaluate(()=>{ const o=document.getElementById('pfPlans'); if(o) o.remove(); });
  await click(B.page, 'button[data-action="account"]');
  let acc2 = await B.page.textContent('#pfAccount');
  check('…account panel: plan shown, no Manage/Change buttons, no website mention', /Team plan/.test(acc2) && !(await B.page.$('#pfAccount [data-pf="manage"]')) && !(await B.page.$('#pfAccount [data-pf="plans"]')) && !/website|stripe/i.test(acc2));
  await click(B.page, '#pfAccount [data-pf="close"]');
  await adminPatch(`accounts/${uid}`, { periodEnd: new Date(Date.now() - 86400000), graceUntil: new Date(Date.now() + 5*86400000) }); await settle(B.page, 2000);
  const ban = await B.page.evaluate(()=>{ const b=document.getElementById('pfBanner'); return b?b.innerHTML:''; });
  check('…payment problem banner in the iPhone app: no button, no website mention, still usable', /needs sorting/.test(ban) && !/data-pf=/.test(ban) && !/website|stripe/i.test(ban));
  await B.page.evaluate(()=>{ window.__managed=false; }); await B.page.evaluate(()=>window.__platform.openPlans());
  r = await rest('PATCH', `${FS}/businesses/${uid}?updateMask.fieldPaths=x`, (await signIn('matt@test.co.uk','password123')).idToken, {fields:{x:{stringValue:'grace'}}});
  check('…grace still counts as subscribed in the rules', r.status===200);
  // Apple plan on the website: acknowledged with where to manage it, nothing to buy
  await adminPatch(`accounts/${uid}`, { store: 'app_store', periodEnd: new Date(Date.now() + 30*86400000), graceUntil: null }); await settle(B.page, 2000);
  await B.page.evaluate(()=>{ delete window.__purchases; });
  pl = await plansText();
  check('Apple plan seen on the website: billed through the App Store, nothing to buy', /billed through the App Store \(Apple\)/.test(pl) && !(await B.page.$('#pfPlans [data-pf="buy"]')));
  // Apple plan in the iPhone app (same store): Manage goes to the store, switching plans allowed
  await iosApp();
  pl = await plansText();
  check('Apple plan in the iPhone app: can switch plan through Apple', !!(await B.page.$('#pfPlans [data-pf="buy"]')));
  await B.page.evaluate(()=>window.__platform.openAccount ? window.__platform.openAccount() : null); await settle(B.page, 300);
  await B.page.evaluate(()=>{ const o=document.getElementById('pfPlans'); if(o) o.remove(); });
  // free account: nothing to buy anywhere
  await adminPatch(`accounts/${uid}`, { freeForever: true }); await settle(B.page, 2000);
  pl = await plansText();
  check('free account: nothing to buy', /This account is free/.test(pl) && !(await B.page.$('#pfPlans [data-pf="buy"]')));
  await adminPatch(`accounts/${uid}`, { freeForever: false, store: 'play_store' }); await settle(B.page, 1500);
  await B.page.evaluate(()=>{ delete window.__purchases; const o=document.getElementById('pfPlans'); if(o) o.remove(); const a=document.getElementById('pfAccount'); if(a) a.remove(); });

  // ---------- 8. offline ----------
  if (await B.page.isVisible('#pfAccount')) await B.page.click('#pfAccount [data-pf="close"]');
  await B.ctx.setOffline(true); await B.page.evaluate(()=>window.dispatchEvent(new Event('offline'))); await settle(B.page, 500);
  check('offline banner shown', /You're offline/.test(await text(B.page)));
  const t0 = Date.now();
  await makeQuote(B.page, 'Offline Customer');
  check('a quote can be finished and saved with no signal (no hang)', Date.now()-t0 < 25000 && !/couldn't be saved/i.test(await B.page.evaluate(()=>document.getElementById('pfBanner').innerText)));
  await B.ctx.setOffline(false); await B.page.evaluate(()=>window.dispatchEvent(new Event('online'))); await settle(B.page, 4000);
  const tokB = await signIn('matt@test.co.uk','password123');
  r = await rest('GET', `${FS}/businesses/${uid}/quotes`, tokB.idToken);
  check('back online: the offline quote synced to the database', (r.json.documents||[]).some(d=>JSON.stringify(d).includes('Offline Customer')));

  // ---------- 9. download my data ----------
  await click(B.page, 'button[data-action="account"]');
  const [dl] = await Promise.all([ B.page.waitForEvent('download', {timeout:10000}), B.page.click('#pfAccount [data-pf="export"]') ]);
  const dlPath = await dl.path(); const data = JSON.parse(fs.readFileSync(dlPath,'utf8'));
  check('download my data: JSON with settings and both quotes', data.business && data.business.company && (data.quotes||[]).length===2 && data.account.email==='matt@test.co.uk');

  // ---------- 10. delete account ----------
  await click(B.page, '#pfAccount [data-pf="delete"]');
  await B.page.fill('#pfDelConfirm','delete'); await click(B.page, '#pfDelete [data-pf="confirm"]');
  check('delete needs DELETE typed exactly', /Type DELETE/.test(await B.page.textContent('#pfDelete')));
  await B.page.fill('#pfDelConfirm','DELETE'); await B.page.fill('#pfDelPass','password123');
  await B.page.click('#pfDelete [data-pf="confirm"]'); await settle(B.page, 4000);
  check('after deleting: back at sign-in with a confirmation', await B.page.isVisible('#authGate') && /have been deleted/.test(await B.page.textContent('#authGate')));
  r = await adminGet(`businesses/${uid}`);
  const q = await rest('GET', `${FS}/businesses/${uid}/quotes`, 'owner');
  check('business data deleted from the database', r.status===404 && !(q.json.documents||[]).length);
  const gone = await signIn('matt@test.co.uk','password123');
  check('login deleted', !gone.localId);

  console.log('ERRORS:', errors.length?errors:'none');
  await browser.close(); srv.close();
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });

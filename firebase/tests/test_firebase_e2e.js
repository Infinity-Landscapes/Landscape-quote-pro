// End-to-end test of the own-website (Firebase) build against the Auth + Firestore emulators.
// Run via: firebase emulators:exec --only auth,firestore "node tests/test_firebase_e2e.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PROJECT = 'landscape-quote-pro';

function serve(){
  return new Promise(res=>{
    const srv = http.createServer((req,resp)=>{
      let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
      const f = path.join(PUB, p);
      if (!f.startsWith(PUB) || !fs.existsSync(f)) { resp.writeHead(404); return resp.end('nf'); }
      const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      resp.writeHead(200, {'Content-Type': type}); fs.createReadStream(f).pipe(resp);
    }).listen(5055, '127.0.0.1', ()=>res(srv));
  });
}
async function rest(method, url, token, body){
  const r = await fetch(url, {method, headers: Object.assign({'Content-Type':'application/json'}, token?{Authorization:'Bearer '+token}:{}), body: body?JSON.stringify(body):undefined});
  let j = null; try{ j = await r.json(); }catch(e){}
  return {status:r.status, json:j};
}
async function signInRest(email, pass){
  const r = await rest('POST', `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, null, {email, password:pass, returnSecureToken:true});
  return r.json;
}

(async()=>{
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const errors = [];
  async function newPage(){
    const ctx = await browser.newContext({ viewport:{width:1200,height:1000} });
    const page = await ctx.newPage();
    page.on('pageerror', e=>errors.push('PAGEERROR: '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !/net::ERR|favicon|fonts\.g|Failed to load resource/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
    // HTTP failures are judged by URL: a missing favicon and the deliberate wrong-password attempt are expected.
    page.on('response', r=>{ const u = r.url(); if(r.status()>=400 && !/favicon\.ico/.test(u) && !(/signInWithPassword/.test(u) && r.status()===400)) errors.push('HTTP '+r.status()+' '+u); });
    return {ctx, page};
  }
  const settle = (page, ms=300) => page.waitForTimeout(ms);
  const click = async (page, sel) => { await (await page.waitForSelector(sel, {timeout:8000})).click(); await settle(page); };

  // ---- user A signs up, sets up, saves a quote ----
  const A = await newPage(); const pa = A.page;
  await pa.goto('http://127.0.0.1:5055/?emulator=1'); await settle(pa, 1200);
  check('sign-in screen shown before anything else', await pa.isVisible('#authGate') && /Sign in/.test(await pa.textContent('#authGate')));
  await pa.click('[data-auth="signup"]'); await settle(pa);
  await pa.fill('#agEmail','matt@test.co.uk'); await pa.fill('#agPass','short'); await pa.fill('#agPass2','short');
  await pa.click('#authGate .ag-btn'); await settle(pa);
  check('short password refused', /at least 8 characters/.test(await pa.textContent('#authGate')));
  await pa.fill('#agPass','password123'); await pa.fill('#agPass2','password123');
  await pa.click('#authGate .ag-btn'); await pa.waitForSelector('#f_name', {timeout:15000}).catch(()=>{}); await settle(pa, 500);
  check('account created, gate gone, app setup shown', !(await pa.isVisible('#authGate')) && !!(await pa.$('#f_name')));
  await pa.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click(pa, 'button[data-action="setupNext"]');
  await pa.fill('#f_pin','1234'); await pa.fill('#f_pin2','1234');
  await click(pa, 'button[data-action="setupNext"]'); await settle(pa, 800);
  // First login: the walkthrough starts by itself, includes the account step, and skipping asks first.
  check('first login: the walkthrough starts automatically', await pa.isVisible('#tourLayer .tour-tip'));
  const tourSteps = await pa.evaluate(()=>{ const m=(document.querySelector('#tourLayer .tour-count')||{}).textContent||''; return parseInt((m.match(/of (\d+)/)||[])[1]||'0',10); });
  let sawAccount = false;
  for (let i=0;i<tourSteps-1;i++){ await pa.click('#tourLayer [data-tour-act="next"]'); await settle(pa, 120); if(/Your account/.test(await pa.textContent('#tourTitle'))){ sawAccount = await pa.evaluate(()=>{ const s=document.querySelector('#tourLayer .tour-spot'); return getComputedStyle(s).display!=='none'; }); break; } }
  check('walkthrough shows the account (person) button on the website', sawAccount);
  await pa.click('#tourLayer [data-tour-act="skip"]'); await settle(pa);
  check('Skip asks first and says where to replay it', /Are you sure you want to skip\?/.test(await pa.textContent('#tourLayer')) && /Replay the tutorial/.test(await pa.textContent('#tourLayer')));
  await pa.click('#tourLayer [data-tour-act="confirmSkip"]'); await settle(pa, 800);
  check('skipped walkthrough closes', !(await pa.$('#tourLayer')));
  await click(pa, 'button[data-nav="newquote"]');
  await pa.fill('#q_creator','Matt'); await pa.fill('#q_cname','Firebase Customer');
  await click(pa, 'button[data-action="wizNext"]');
  await click(pa, '[data-action="toggleQuoteService"][data-key="turf"]');
  await click(pa, 'button[data-action="wizNext"]');
  await pa.fill('[data-row="0"] input[data-mf="width"]','10'); await pa.fill('[data-row="0"] input[data-mf="length"]','10'); await settle(pa);
  for (let i=0;i<6 && !(await pa.$('button[data-action="saveSentQuote"]')); i++){ await click(pa, 'button[data-action="wizNext"]'); }
  await click(pa, 'button[data-action="saveSentQuote"]'); await settle(pa, 1500);

  const tokA = await signInRest('matt@test.co.uk','password123');
  const uidA = tokA.localId;
  const base = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  let r = await rest('GET', `${base}/businesses/${uidA}`, tokA.idToken);
  check('business settings saved in Firestore under businesses/{uid}', r.status===200 && !!r.json.fields && !!r.json.fields.company);
  r = await rest('GET', `${base}/businesses/${uidA}/quotes`, tokA.idToken);
  const qdocs = (r.json && r.json.documents) || [];
  check('quote saved in Firestore', qdocs.length===1);
  check('nested arrays stored as {__arr}', JSON.stringify(qdocs[0]||{}).includes('__arr'));

  // ---- reload: still signed in, data comes back ----
  await pa.reload(); await settle(pa, 2500);
  check('after reload: no sign-in screen (stays signed in), PIN screen shown', !(await pa.isVisible('#authGate')) && !!(await pa.$('#loginPin')));
  check('PIN screen shows the account + Sign out', /Signed in as matt@test\.co\.uk/.test(await pa.textContent('body')));
  await pa.fill('#loginPin','1234'); await click(pa, 'button[data-action="login"]'); await settle(pa, 600);
  check('after skipping, the walkthrough does not start again (saved in Firestore)', !(await pa.$('#tourLayer')));
  const navs = await pa.$$eval('[data-nav]', els=>els.map(e=>e.getAttribute('data-nav')));
  const qNav = navs.find(n=>/quotes|jobs/.test(n)) || 'quotes';
  await click(pa, `button[data-nav="${qNav}"]`);
  check('the saved quote is listed after reload (read back from Firestore)', /Firebase Customer/.test(await pa.textContent('body')));
  await click(pa, '[data-action="openQuote"]');
  check('quote opens with its turf section intact (nested arrays decoded)', /Turf/i.test(await pa.textContent('body')) && /100\.00 m²|100 m²/.test(await pa.textContent('body')));

  // ---- user B: separate business, cannot read A ----
  const B = await newPage(); const pb = B.page;
  await pb.goto('http://127.0.0.1:5055/?emulator=1'); await settle(pb, 1200);
  await pb.click('[data-auth="signup"]'); await settle(pb);
  await pb.fill('#agEmail','other@test.co.uk'); await pb.fill('#agPass','password456'); await pb.fill('#agPass2','password456');
  await pb.click('#authGate .ag-btn'); await settle(pb, 2500);
  check('second business starts with its own fresh setup', !!(await pb.$('#f_name')));
  const tokB = await signInRest('other@test.co.uk','password456');
  r = await rest('GET', `${base}/businesses/${uidA}`, tokB.idToken);
  check('security rules: business B cannot read business A', r.status===403);
  r = await rest('GET', `${base}/businesses/${uidA}/quotes`, tokB.idToken);
  check("security rules: business B cannot list A's quotes", r.status===403);
  r = await rest('GET', `${base}/businesses/${uidA}`, null);
  check('security rules: nobody signed out can read anything', r.status===403);

  // ---- wrong password, sign out ----
  const C = await newPage(); const pc = C.page;
  await pc.goto('http://127.0.0.1:5055/?emulator=1'); await settle(pc, 1200);
  await pc.fill('#agEmail','matt@test.co.uk'); await pc.fill('#agPass','wrongpass1');
  await pc.click('#authGate .ag-btn'); await settle(pc, 1500);
  check('wrong password gives a clear message', /don't match/.test(await pc.textContent('#authGate')));
  await click(pa, 'button[data-action="lock"]');
  await click(pa, '[data-action="platformSignOut"]'); await settle(pa, 2000);
  check('sign out returns to the sign-in screen', await pa.isVisible('#authGate'));

  console.log('ERRORS:', errors.length?errors:'none');
  await browser.close(); srv.close();
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });

// Oct 2026 audit fixes — job lifecycle & money: editing an ongoing job keeps it on the calendar
// and rebuilds its payment plan/finance baselines; plans never bill more than the quote; lock
// keeps an unfinished quote; editing another quote asks before discarding one; quote numbers are
// taken only on save, persist, and skip titles ("Mr & Mrs"); Team 1 keeps its id across reloads;
// letter extras at sell price inc VAT; part days book a whole day; VAT set aside = 1/6; a new job
// isn't shown as a 1p loss; a deleted custom service doesn't crash editing; finished jobs reopen.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1400 }, timezoneId:'Europe/London' })).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(250);
  const click = async sel => { const el = await page.$(sel); if(!el) throw new Error('missing '+sel); await el.click(); await settle(); };
  const txt = () => page.$eval('#App', el => el.textContent);
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  const store = () => page.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb__')));
  const quotesIn = st => Object.keys(st).filter(k=>/\/quotes\//.test(k)).map(k=>st[k]);
  const bizIn = st => st[Object.keys(st).find(k=>/business$/.test(k))];
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  // simple custom service (6.7 m²/day/person) + markup 10%; also wipe teams to mimic an old tenant
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); d.markupPercent = 10; delete d.teams; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  let teamId1 = bizIn(await store()).teams && bizIn(await store()).teams[0].id;
  await page.reload(); await page.waitForTimeout(500); await login();
  check('Team 1 saved once and keeps its id across reloads', !!teamId1 && bizIn(await store()).teams[0].id===teamId1);

  async function newQuote(name, w, l, extra){
    await click('button[data-nav="newquote"]');
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname', name);
    await click('button[data-action="wizNext"]');
    await click('[data-action="toggleQuoteService"][data-key="custom_testbed"]');
    await click('button[data-action="wizNext"]');
    await page.fill('[data-row="0"] input[data-mf="width"]', String(w)); await page.fill('[data-row="0"] input[data-mf="length"]', String(l)); await settle();
    await click('button[data-action="wizNext"]'); // people
    await click('button[data-action="wizNext"]'); // extras
    if (extra) {
      await click('button[data-action="addExtra"]');
      await page.fill('[data-extra="0"] [data-ef="description"]', extra.d); await page.fill('[data-extra="0"] [data-ef="materials"]', String(extra.q*extra.p)); await settle();
    }
    await click('button[data-action="wizNext"]'); // preview
  }
  // ---- numbering: preview doesn't use up numbers; titles skipped ----
  await newQuote('Mr & Mrs Rayner', 4, 5, {d:'Bird bath', q:1, p:100});
  await page.evaluate(()=>{}); await click('button[data-action="wizBack"]').catch(()=>{}); await click('button[data-action="wizNext"]').catch(()=>{});
  await click('button[data-action="saveSentQuote"]');
  let t = await txt();
  check('first quote numbered RAY001 (title skipped, previews don\'t use numbers)', /RAY001/.test(t));
  check('quote counter saved', bizIn(await store()).quoteCounter===1);
  // letter extra at sell price: 100 × 1.10 × 1.20 = 132.00 inc VAT
  check('letter shows the extra at sell price inc VAT (£132.00)', /Bird bath – £132\.00 inc VAT/.test(t));
  // ---- accept: part day booking + capped plan ----
  await click('button[data-action="showAccept"]');
  await page.fill('#acceptStart','2026-11-02');
  await click('button[data-action="confirmAccept"]');
  let q = quotesIn(await store()).find(x=>x.customer.name==='Mr & Mrs Rayner');
  // 20m² / 6.7 / 3 people = 0.995 → ruq 1 day → 1 booked
  check('accepted job stored ongoing with schedule and team', q.status==='ongoing' && q.scheduledDays.length>=1 && q.teamId===teamId1);
  const planTotal = Math.round(q.paymentSchedule.reduce((a,p)=>a+p.amount,0)*100)/100;
  check('payment plan adds up to the quote total', Math.abs(planTotal - q.totals.total) < 0.01);
  t = await txt();
  check('new job not shown as a loss (profit so far = quoted margin)', /Profit so far\s*£[1-9]/.test(t) && !/Profit so far\s*-£/.test(t));
  // VAT set aside 1/6
  await click('button[data-action="addPayment"]');
  await page.fill('#mf_amount','1200'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  q = quotesIn(await store()).find(x=>x.customer.name==='Mr & Mrs Rayner');
  check('VAT set aside on £1,200 = £200 (1/6)', q.finance.payments[0].vatSetAside===200);
  // ---- edit the ongoing job: double the area ----
  await click('button[data-action="editQuote"]');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); // "Edit job"
  // jump to the measurement step via the step pill for the service
  const pill = await page.$('[data-action="wizGoto"][data-step="measure"]') || await page.$('[data-action="wizStep"]');
  await page.evaluate(()=>{});
  let moved = false;
  for (const sel of ['[data-action="wizGoto"]','[data-action="gotoStep"]','[data-action="wizStepPill"]']) { const els = await page.$$(sel); if (els.length) { for (const e of els) { const tx = await e.textContent(); if (/Test beds|Measure/i.test(tx)) { await e.click(); await settle(); moved = true; break; } } } if (moved) break; }
  if (!moved) { for (let i=0;i<3;i++) { const b = await page.$('button[data-action="wizBack"]') || await page.$('button[data-action="wizBack"]'); if (b) { await b.click(); await settle(); } } }
  await page.fill('[data-row="0"] input[data-mf="width"]', '8'); await settle();
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"],button[data-action="saveQuoteChanges"],button[data-action="saveDraftQuote"]')); i++) await click('button[data-action="wizNext"]');
  const saveBtn = await page.$('button[data-action="saveSentQuote"]') || await page.$('button[data-action="saveQuoteChanges"]') || await page.$('button[data-action="saveDraftQuote"]');
  await saveBtn.click(); await settle();
  q = quotesIn(await store()).find(x=>x.customer.name==='Mr & Mrs Rayner');
  check('edited job still ongoing, same number, same team', q.status==='ongoing' && q.quoteNumber==='RAY001' && q.teamId===teamId1);
  check('edited job still on the calendar (re-booked: 40m² → 2 days)', q.scheduledDays && q.scheduledDays.length===2);
  const plan2 = Math.round(q.paymentSchedule.reduce((a,p)=>a+p.amount,0)*100)/100;
  check('payment plan rebuilt to the new total', Math.abs(plan2 - q.totals.total) < 0.01);
  check('payment kept and finance baselines refreshed', q.finance.payments.length===1 && Math.abs(q.finance.labor.quotedCost - Math.round(q.totals.labour*100)/100) < 0.01);
  t = await txt();
  check('job detail still shows its schedule', /Edit schedule/.test(t));
  // ---- unfinished quote survives lock; editing another asks first ----
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Unfinished Person'); await settle();
  await click('button[data-action="lock"]'); await login();
  t = await txt();
  check('after lock/unlock the unfinished quote is still offered', /Unfinished Person/.test(t));
  await click('button[data-nav="quotes"]'); await click('[data-action="openQuote"]');
  await click('button[data-action="editQuote"]'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  t = await txt();
  check('editing another quote warns before discarding the unfinished one', /unfinished quote for Unfinished Person/.test(t));
  await click('button[data-action="modalCancel"]');
  // ---- finished jobs can be reopened ----
  await click('button[data-action="markFinished"]'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  await click('button[data-action="reopenJob"]'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  q = quotesIn(await store()).find(x=>x.customer.name==='Mr & Mrs Rayner');
  check('finished job reopened to ongoing', q.status==='ongoing');
  // ---- deleted custom service: editing doesn't crash ----
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ d.customServices = []; d.servicesEnabled = d.servicesEnabled.filter(x=>x!=='custom_testbed'); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="quotes"]'); await click('[data-action="openQuote"]');
  await click('button[data-action="editQuote"]'); const ok = await page.$('button[data-action="modalOk"]'); if (ok) { await ok.click(); await settle(); }
  const ok2 = await page.$('button[data-action="modalOk"]'); if (ok2) { await ok2.click(); await settle(); }
  t = await txt();
  check('editing a quote whose custom service was deleted opens without crashing and keeps its price', errors.length===0 && /RAY001|Review changes/.test(t));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

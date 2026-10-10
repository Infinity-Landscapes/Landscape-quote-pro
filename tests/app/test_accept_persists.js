// Bug report (Oct 2026): "Ongoing jobs keep resetting to awaiting approval." Accepting a quote
// stored Date objects in its payment schedule, which the real store rejects — the save failed
// silently, so after a reload the job was back to pending. Checks the accepted job (status,
// schedule, finance tracker, logged payment) survives a reload, and a failed save is reported.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1200 } })).newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(250);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  const txt = () => page.$eval('#App', el => el.textContent);
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Persist Test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="custom_testbed"]');
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','4'); await page.fill('[data-row="0"] input[data-mf="length"]','5'); await settle();
  for (let i=0;i<3;i++) await click('button[data-action="wizNext"]');
  await click('button[data-action="saveSentQuote"]');
  await click('button[data-action="showAccept"]');
  await page.fill('#acceptStart','2026-11-02');
  await click('button[data-action="confirmAccept"]');
  check('ongoing in this session', /ongoing/.test(await txt()));
  await click('button[data-action="openJobFinances"]');
  await click('button[data-action="addPayment"]');
  const amt = await page.$('#mf_amount'); if (amt) { await amt.fill('500'); const dt = await page.$('#mf_date'); if (dt) await dt.fill('2026-11-01'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  const stored = await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); const k = Object.keys(st).find(k=>/\/quotes\//.test(k) && st[k].customer && st[k].customer.name==='Persist Test'); return st[k]; });
  check('stored as ongoing', stored && stored.status==='ongoing');
  check('payment plan dates stored as plain YYYY-MM-DD', stored && Array.isArray(stored.paymentSchedule) && stored.paymentSchedule.length>0 && stored.paymentSchedule.every(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)));
  check('deposit due a week before the start (26/10/2026)', stored && stored.paymentSchedule[0].date==='2026-10-26');
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="quotes"]');
  const t = await txt();
  check('after reload the job is still ongoing, not awaiting approval', /Persist Test/.test(t) && /ongoing/.test(t));
  await click('[data-action="openQuote"]');
  check('payment plan shows its dates', /26\/10\/2026/.test(await txt()));
  await click('button[data-action="openJobFinances"]');
  const t2 = await txt();
  check('finance tracker and logged payment survive the reload', /Job finance tracker/.test(t2) && /Paid: £500\.00/.test(t2));
  // A failed save is reported, not swallowed
  await page.evaluate(()=>{ window.__failWrites = true; });
  await click('button[data-action="addPayment"]');
  const amt2 = await page.$('#mf_amount'); if (amt2) { await amt2.fill('100'); const dt = await page.$('#mf_date'); if (dt) await dt.fill('2026-11-03'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  check('a failed save shows a warning', /couldn't be saved/i.test(await txt()));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

// Waste removal: "skip instead of grab hire" per job, with a tenant skip list (price + capacity).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1200 } })).newPage();
  require(__dirname+'/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings has a Skips list', /Skips \(price per skip/.test(await txt()) && !!(await page.$('button[data-action="addPavingProduct"][data-libkey="wasteSkips"]')));

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Skip test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="turf"]');
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await settle();
  await click('button[data-action="wizNext"]'); // -> waste page
  let t = await txt();
  check('waste page: grab hire + "Add a skip?" question', /Grab hire/.test(t) && /Add a skip\?/.test(t) && !!(await page.$('button[data-action="setOpt"][data-opt="addSkip"][data-val="true"]')));
  // volume = 100 m² × 0.05 = 5 m³ → 1 grab load
  await click('button[data-action="setOpt"][data-opt="addSkip"][data-val="true"]');
  t = await txt();
  check('skip is added ON TOP: grab hire still there', /Grab hire\s*1/.test(t) && !!(await page.$('[data-opt="grabM3PerLoad"]')));
  check('how many defaults to 1', await page.$eval('[data-opt="skipQty"]', e=>e.value)==='1');
  check('blocker: pick a skip size', /Pick a skip size/.test(t));
  await page.selectOption('select[data-opt="skipProduct"]','__add_other__'); await settle();
  check('add-skip form asks name, price, supplier (no capacity)', !!(await page.$('#mf_price')) && !(await page.$('#mf_capacityM3')));
  await page.fill('#mf_name','8 yard skip'); await page.fill('#mf_price','240');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  t = await txt();
  check('1 skip at £200 net, plus grab hire', /Skip hire — 8 yard skip\s*1\s*£200\.00/.test(t) && /Grab hire\s*1/.test(t));
  await page.fill('[data-opt="skipQty"]','2'); await settle();
  check('2 skips = £400.00', /Skip hire — 8 yard skip\s*2\s*£400\.00/.test(await txt()));
  check('no blockers', !/Pick a skip size/.test(await txt()));
  for (let i=0;i<6 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  await click('button[data-action="saveSentQuote"]');
  const edit = await page.$('button[data-action="editQuote"]');
  if (edit){ await edit.click(); await settle(); const ok = await page.$('button[data-action="modalOk"]'); if(ok){ await ok.click(); await settle(); } }
  for (let i=0;i<8 && !(await page.$('button[data-action="setOpt"][data-opt="addSkip"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  if (await page.$('button[data-action="setOpt"][data-opt="addSkip"]')){
    check('re-editing keeps the skip and the count', await page.$eval('select[data-opt="skipProduct"]', e=>e.value)==='8 yard skip' && await page.$eval('[data-opt="skipQty"]', e=>e.value)==='2');
    await click('button[data-action="setOpt"][data-opt="addSkip"][data-val="false"]');
    check('No removes the skip line, grab stays', !/Skip hire — /.test(await txt()) && /Grab hire\s*1/.test(await txt()));
  } else check('could reach the waste page when re-editing', false);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

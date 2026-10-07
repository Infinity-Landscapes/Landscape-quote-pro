// Custom services: a new material needs a price above £0 and a supplier; a material whose price
// later drops to £0 still blocks the quote like Fencing, and removing a builder option that materials or
// letter lines depend on shows a warning listing them (and resets them to "Always" on confirm).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1600 } })).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Test Co');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','150'); await page.fill('#f_expenses','515'); } await click('button[data-action="setupNext"]'); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');

  await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="services"]');
  await click('button[data-action="startSvcBuilder"]');
  await page.fill('#svcName','Moss treatment');
  await click('button[data-action="addSvcOptionRow"]');
  await page.fill('[data-svcopt-label="0"]','Second coat?');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('[data-svcmat-name="0"]','Moss killer'); await page.fill('[data-svcmat-amount="0"]','1'); await page.fill('[data-svcmat-per="0"]','50');
  await page.check('[data-svcmat-roundup="0"]'); await page.fill('[data-svcmat-price="0"]','0');
  await click('button[data-action="addSvcMaterialRow"]');
  await page.fill('[data-svcmat-name="1"]','Extra moss killer'); await page.fill('[data-svcmat-amount="1"]','1'); await page.fill('[data-svcmat-per="1"]','50');
  await page.selectOption('[data-svcmat-onlyif="1"]', {label:'"Second coat?" ticked'}); await page.fill('[data-svcmat-price="1"]','12');
  await click('button[data-action="svcBuilderNext"]');
  check('builder refuses a new material at £0', !(await page.$('#svcProductivity')) && /Enter what "Moss killer" costs you/.test(await txt()));
  await page.fill('[data-svcmat-price="0"]','5');
  await click('button[data-action="svcBuilderNext"]');
  check('builder refuses a new material with no supplier', !(await page.$('#svcProductivity')) && /Enter the supplier for "Moss killer"/.test(await txt()));
  await page.fill('[data-svcmat-supplier="0"]','Agri supplies'); await page.fill('[data-svcmat-supplier="1"]','Agri supplies');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('#svcProductivity','100');
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="0"]','Second coat applied');
  await page.selectOption('[data-svcltr-onlyif="0"]', {label:'"Second coat?" ticked'});
  // go back to step 1 and remove the option
  await click('button[data-action="svcBuilderBack"]'); await click('button[data-action="svcBuilderBack"]');
  await click('button[data-action="removeSvcOptionRow"][data-idx="0"]');
  let t = await txt();
  check('warning pop-up appears', !!(await page.$('#modalConfirmBtn')) && /These depend on it/.test(t));
  check('warning lists the dependent material and letter line', /Material "Extra moss killer"/.test(t) && /Letter line "Second coat applied"/.test(t));
  await click('button[data-action="modalCancel"]').catch(()=>{});
  check('cancel keeps the option', (await page.$$('[data-svcoptrow]')).length===1);
  await click('button[data-action="removeSvcOptionRow"][data-idx="0"]');
  await click('#modalConfirmBtn');
  check('confirm removes the option', (await page.$$('[data-svcoptrow]')).length===0);
  await click('button[data-action="svcBuilderNext"]');
  check('dependent material reset to "Always"', await page.$eval('[data-svcmat-onlyif="1"]', e=>e.value)==='');
  await click('button[data-action="svcBuilderNext"]'); await click('button[data-action="svcBuilderNext"]');
  await click('button[data-action="saveServiceBuilder"]');
  const key = await page.$eval('.service-tile:has-text("Moss treatment")', el=>el.getAttribute('data-key'));
  // the price later drops to £0 on the Materials list (e.g. a typo) — the quote must still block
  await click('button[data-action="settingsTab"][data-tab="materials"]');
  await page.fill('input[data-mat="Moss killer"]','0');
  check('builder materials landed in the Materials list with their supplier', await page.$eval('input[data-matsup="Moss killer"]', e=>e.value) === 'Agri supplies');
  await click('button[data-action="saveMaterialsForm"]');

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Moss');
  await click('button[data-action="wizNext"]');
  await click(`[data-action="toggleQuoteService"][data-key="${key}"]`);
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await settle();
  t = await txt();
  check('custom service blocked on the £0 material, named', /"Moss killer" has no price/.test(t));
  for (let i=0;i<5 && !(await page.$('#quoteBlockers')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  check('review page blocks saving', !!(await page.$('#quoteBlockers')) && !(await page.$('button[data-action="saveSentQuote"]')));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

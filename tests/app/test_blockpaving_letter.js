// Block paving quote-letter wording is tied to the priced dig-out depth and Type 1 MOT depth.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  require('/tmp/mobiletest/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true;
  const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Letter test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="blockpaving"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','8');
  await page.selectOption('[data-row="0"] select[data-mf="blockType"]','__add_other__'); await page.waitForTimeout(200);
  await page.fill('#modalMatName','Test Block'); await page.fill('#modalMatPrice','50');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  await page.selectOption('select[data-opt="bedding"]','__add_other__'); await page.waitForTimeout(200);
  await page.fill('#mf_name','Granite dust'); await page.fill('#mf_price','60'); await page.fill('#mf_supplier','AWBS');
  await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  const go = async () => { for (let i=0;i<6;i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await page.waitForTimeout(300); if(/Area excavated/.test(await txt())) return true; } return /Area excavated/.test(await txt()); };
  // Uniform 250mm -> "250mm" dig-out and 150mm MOT (250 - 100 build-up)
  check('reached letter preview', await go());
  let t = await txt();
  check('letter: excavated to 250mm', /Area excavated to a depth of 250mm\./.test(t));
  check('letter: 150mm Type 1 MOT sub-base', /A 150mm compacted Type 1 MOT sub-base laid\./.test(t));
  check('letter: no edge restraint line without edging', !/Edge restraints installed/.test(t));
  check('letter: 50mm laying course in the chosen bedding', /A 50mm Granite dust laying course screeded level\./.test(t));
  // Go back, add a shallower row + edging -> varied depths, avg and edging line
  for (let i=0;i<6;i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await page.waitForTimeout(250); if(await page.$('[data-row="0"] input[data-mf="width"]')) break; }
  await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','5');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','150');
  await page.fill('[data-opt="edgingLength"]','25'); await page.waitForTimeout(200);
  check('letter reached again', await go());
  t = await txt();
  check('letter: depth range with 230mm average', /depths of 150–250mm \(230mm on average\)/.test(t));
  check('letter: 130mm average MOT (230 - 100)', /A 130mm average compacted Type 1 MOT sub-base laid\./.test(t));
  check('letter: edging line shows 25m', /Edge restraints installed along 25m/.test(t));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

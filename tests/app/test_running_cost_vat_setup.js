// Running cost calculator: per-line "Amount includes VAT" ticks (VAT stripped to a true ex-VAT
// total; the filled figure follows the rate field's own VAT tick), ticks hidden when not VAT
// registered, and the calculator on the first-time setup screen (lines saved when setup finishes).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(250);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  const val = sel => page.$eval(sel, e=>e.value);
  const txtOf = sel => page.$eval(sel, e=>e.textContent);
  const add = async (name, amount, freq) => {
    await click('button[data-action="rcAdd"]');
    const n = (await page.$$('[data-rc-field="name"]')).length - 1;
    await (await page.$$('[data-rc-field="name"]'))[n].fill(name);
    await (await page.$$('[data-rc-field="amount"]'))[n].fill(String(amount));
    await (await page.$$('select[data-rc-field="freq"]'))[n].selectOption(freq);
    await settle();
  };
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<2;i++) await click('button[data-action="setupNext"]');
  // ---- Setup step 3 ----
  check('setup: "Calculate here" prompt under running costs', /Not sure what your running costs are\? Calculate here\./.test(await txtOf('#f_expenses_calc')));
  await page.fill('#f_dayrate', '160');
  await click('#f_expenses_calc button[data-action="openRunningCostCalc"]');
  check('setup: calculator opens', !!(await page.$('.modal-box #rc_total')));
  await add('Van', 600, 'monthly');      // 30/day inc VAT → 25 ex
  await add('Accountant', 1200, 'annually'); // 4.80/day
  await (await page.$$('[data-rc-field="incVat"]'))[1].uncheck(); await settle(); // accountant not VAT-able
  check('each line has an "Amount includes VAT" tick, on by default', (await page.$$('[data-rc-field="incVat"]')).length===2);
  // net = 25 + 4.80 = 29.80; gross = 35.76; rate field defaults to "includes VAT" → fill 35.76
  check('setup: total ex VAT £29.80 · inc VAT £35.76', await txtOf('#rc_total')==='£29.80/day ex VAT · £35.76 inc VAT');
  check('setup: fill uses inc-VAT basis by default', /Use £35\.76\/day \(inc VAT\)/.test(await txtOf('#rc_fill')));
  await click('button[data-action="rcFill"]');
  check('setup: rate field filled, day rate edit kept', await val('#f_expenses')==='35.76' && await val('#f_dayrate')==='160');
  await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForTimeout(500);
  const pin = await page.$('#loginPin'); if (pin){ await pin.fill('1234'); await click('button[data-action="login"]'); }
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('setup figure saved (35.76)', await val('#st_expenses')==='35.76');
  await click('button[data-action="openRunningCostCalc"]');
  check('lines added during setup were saved', (await page.$$('[data-rc-field="name"]')).length===2 && await val('[data-rc-field="name"]')==='Van');
  check('VAT ticks saved (Van on, Accountant off)', JSON.stringify(await page.$$eval('[data-rc-field="incVat"]', els=>els.map(e=>e.checked)))==='[true,false]');
  // ---- Rate field set to ex VAT → fill ex-VAT total ----
  await click('.modal-box button[data-action="modalCancel"]');
  await page.uncheck('#st_expensesvat'); await settle();
  await click('button[data-action="openRunningCostCalc"]');
  check('rate field ex VAT → fill ex-VAT total', /Use £29\.80\/day \(ex VAT\)/.test(await txtOf('#rc_fill')));
  await click('button[data-action="rcFill"]');
  check('filled 29.80 and the unsaved VAT untick kept', await val('#st_expenses')==='29.80' && !(await page.$eval('#st_expensesvat', e=>e.checked)));
  // ---- Not VAT registered: no ticks, amounts as typed ----
  await page.uncheck('#st_vatregistered'); await settle();
  await click('button[data-action="openRunningCostCalc"]');
  check('not VAT registered: no VAT ticks', (await page.$$('[data-rc-field="incVat"]')).length===0);
  check('not VAT registered: total as typed (£34.80)', await txtOf('#rc_total')==='£34.80/day' && /Use £34\.80\/day as my/.test(await txtOf('#rc_fill')));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

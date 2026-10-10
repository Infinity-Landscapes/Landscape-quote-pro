// Running cost calculator (Settings → Pricing): saved cost lines with a frequency → £/day
// (daily as-is, weekly ÷5, monthly ÷ working days/month, annual ÷ working days/year), editable
// day counts, total + "Use" button that fills the rate field without wiping other unsaved edits.
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
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  const toPricing = async () => { await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]'); };
  await toPricing();
  check('prompt shown next to the running-cost field', /Not sure what your running costs are\? Calculate here\./.test(await txtOf('#st_expenses_calc')));
  // unsaved edit on the page behind the calculator must survive
  await page.fill('#st_dayrate', '175');
  const prodSel = 'input[data-prod]';
  const prod0 = await page.$eval(prodSel, e=>e.getAttribute('data-prod'));
  await page.fill(prodSel, '7.5');
  await click('button[data-action="openRunningCostCalc"]');
  check('calculator opens with no costs and defaults 20 / 250', /No costs added yet/.test(await txtOf('.modal-box')) && await val('[data-rc-setting="rcDaysPerMonth"]')==='20' && await val('[data-rc-setting="rcDaysPerYear"]')==='250');
  check('fill button disabled at £0', await page.$eval('#rc_fill', e=>e.disabled));
  const add = async (name, amount, freq) => {
    await click('button[data-action="rcAdd"]');
    const n = (await page.$$('[data-rc-field="name"]')).length - 1;
    await (await page.$$('[data-rc-field="name"]'))[n].fill(name);
    await (await page.$$('[data-rc-field="amount"]'))[n].fill(String(amount));
    await (await page.$$('select[data-rc-field="freq"]'))[n].selectOption(freq);
    await settle();
  };
  await add('Fuel', 30, 'daily');        // 30
  await add('Van lease', 400, 'weekly'); // 80
  await add('Phone', 60, 'monthly');     // 3
  await add('Insurance', 2500, 'annually'); // 10
  const dailies = await page.$$eval('[id^="rc_daily_"]', els=>els.map(e=>e.textContent));
  check('daily figures (ex VAT): 30, 400÷5, 60÷20, 2500÷250 ÷ 1.2', JSON.stringify(dailies)===JSON.stringify(['£25.00/day ex VAT','£66.67/day ex VAT','£2.50/day ex VAT','£8.33/day ex VAT']));
  check('total £123.00/day', (await txtOf('#rc_total')).endsWith('£123.00 inc VAT'));
  check('fill button shows the total', /Use £123\.00\/day/.test(await txtOf('#rc_fill')));
  await page.fill('[data-rc-setting="rcDaysPerMonth"]', '22');
  await page.fill('[data-rc-setting="rcDaysPerYear"]', '230'); await settle();
  // 30 + 80 + 60/22 (2.727…) + 2500/230 (10.869…) = 123.597 → 123.60
  check('editable day counts change the total (£123.60)', (await txtOf('#rc_total')).endsWith('£123.60 inc VAT'));
  await click('button[data-action="rcFill"]');
  check('calculator closes and fills the rate field', !(await page.$('.modal-box')) && await val('#st_expenses')==='123.60');
  check('other unsaved edits kept (day rate still 175)', await val('#st_dayrate')==='175');
  check('unsaved productivity edit (no id) kept too', await val(`input[data-prod="${prod0}"]`)==='7.5');
  check('note tells them to save', /press Save changes/.test(await page.$eval('#App', e=>e.textContent)));
  await page.fill('#st_expenses', '125'); // adjust by hand
  await click('button[data-action="saveSettingsForm"]');
  // persists across a reload
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForTimeout(500);
  const pin = await page.$('#loginPin'); if (pin){ await pin.fill('1234'); await click('button[data-action="login"]'); }
  await toPricing();
  check('hand-adjusted rate saved (125)', await val('#st_expenses')==='125');
  await click('button[data-action="openRunningCostCalc"]');
  check('cost lines persist after reload', (await page.$$('[data-rc-field="name"]')).length===4 && await val('[data-rc-field="name"]')==='Fuel');
  check('day counts persist (22 / 230)', await val('[data-rc-setting="rcDaysPerMonth"]')==='22' && await val('[data-rc-setting="rcDaysPerYear"]')==='230');
  // edit and delete
  await (await page.$$('[data-rc-field="amount"]'))[0].fill('40'); await settle();
  check('editing a line updates the total (£133.60)', (await txtOf('#rc_total')).endsWith('£133.60 inc VAT'));
  await (await page.$$('button[data-action="rcDelete"]'))[1].click(); await settle();
  check('deleting a line updates the total (£53.60)', (await txtOf('#rc_total')).endsWith('£53.60 inc VAT') && (await page.$$('[data-rc-field="name"]')).length===3);
  await (await page.$$('[data-rc-field="amount"]'))[0].fill('£1,200'); await page.selectOption('select[data-rc-field="freq"] >> nth=0', 'annually'); await settle();
  // 1200/230 = 5.217… + 2.727 + 10.869 = 18.81
  check('"£1,200" read as 1200', (await txtOf('#rc_total')).endsWith('£18.81 inc VAT'));
  await (await page.$$('[data-rc-field="amount"]'))[0].fill('-50'); await settle();
  check('negative amount flagged and not counted', /not counted/.test(await txtOf('[id^="rc_daily_"]')) && (await txtOf('#rc_total')).endsWith('£13.60 inc VAT'));
  await page.fill('[data-rc-setting="rcDaysPerMonth"]', '0'); await settle();
  check('zero working days warns', await page.$eval('#rc_days_warn', e=>e.style.display!=='none'));
  await page.fill('[data-rc-setting="rcDaysPerMonth"]', '22'); await settle();
  check('warning clears when fixed', await page.$eval('#rc_days_warn', e=>e.style.display==='none'));
  await (await page.$$('[data-rc-field="amount"]'))[0].fill('40'); await page.selectOption('select[data-rc-field="freq"] >> nth=0', 'daily'); await settle();
  await click('.modal-box button[data-action="modalCancel"]');
  check('closing without filling leaves the rate alone (125)', await val('#st_expenses')==='125');
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForTimeout(500);
  const pin2 = await page.$('#loginPin'); if (pin2){ await pin2.fill('1234'); await click('button[data-action="login"]'); }
  await toPricing(); await click('button[data-action="openRunningCostCalc"]');
  check('edits and deletes persist', (await page.$$('[data-rc-field="name"]')).length===3 && await val('[data-rc-field="amount"]')==='40' && (await txtOf('#rc_total')).endsWith('£53.60 inc VAT'));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

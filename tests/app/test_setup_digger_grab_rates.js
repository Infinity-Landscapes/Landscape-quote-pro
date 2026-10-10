// Verifies the October 2026 waste-removal rework (direct user request): every brand-new tenant
// must see and confirm/set Digger hire rate and Grab hire rate during first-time setup (Step 3),
// alongside the already-present Day rate and Running costs fields, so they're never accidentally
// quoting using another business's plant costs.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);

  // Step 3: Pricing basics.
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Step 3 is "Pricing & working week"', /Pricing & working week/.test(bodyText));
  const diggerField = await page.$('#f_diggerrate');
  const grabField = await page.$('#f_grabrate');
  check('"Digger hire rate" field is present on setup Step 3', !!diggerField);
  check('"Grab hire rate" field is present on setup Step 3', !!grabField);
  check('Digger hire rate is prefilled with Infinity\'s own starting default (£300)', diggerField ? (await diggerField.inputValue()) === '300' : false);
  check('Grab hire rate is prefilled with Infinity\'s own starting default (£360)', grabField ? (await grabField.inputValue()) === '360' : false);

  // Change both — a new tenant confirming/setting their own values.
  await diggerField.fill('275');
  await grabField.fill('400');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // Confirm the new rates landed in Materials & settings as the real "Digger hire"/"Grab hire"
  // material prices — the same ones calcWasteRemoval actually prices against.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(200);
  await page.fill('#matFilter', 'Digger hire'); await page.waitForTimeout(200);
  const diggerPriceInput = await page.$('input[data-mat="Digger hire"]');
  check('Digger hire\'s material price was updated to the tenant\'s own figure (£275)', diggerPriceInput ? (await diggerPriceInput.inputValue()) === '275' : false);
  await page.fill('#matFilter', 'Grab hire'); await page.waitForTimeout(200);
  const grabPriceInput = await page.$('input[data-mat="Grab hire"]');
  check('Grab hire\'s material price was updated to the tenant\'s own figure (£400)', grabPriceInput ? (await grabPriceInput.inputValue()) === '400' : false);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

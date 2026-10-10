const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  // Oct 2026: a new business must enter its own rates in setup; Infinity's are restored by name.
  { const n = await page.$('#f_name'); if (n) await n.fill('Infinity Landscapes and Design'); }
  for (let i = 0; i < 4; i++) {
    const pinInputs = await page.$$('input[type=password]');
    if (pinInputs.length >= 2) break;
    const btn = await page.$('button.btn-primary');
    if (!btn) break;
    await btn.click(); await page.waitForTimeout(250);
  }
  const pinInputs = await page.$$('input[type=password]');
  await pinInputs[0].fill('1234'); await pinInputs[1].fill('1234');
  await (await page.$('button.btn-primary')).click(); await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Plaintext Rate Test');
  await page.fill('#q_cemail', 'test@example.com');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(100);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // waste
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview
  await (await page.$('button[data-action="saveSentQuote"]')).click(); await page.waitForTimeout(300);
  await (await page.$('button[data-action="emailQuote"]')).click(); await page.waitForTimeout(300);
  const text = await page.$eval('textarea', el => el.value);
  console.log(text);
  console.log('\nERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

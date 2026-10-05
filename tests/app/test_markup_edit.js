const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  await page.addInitScript('window.__NO_AUTO_TOUR__ = true;');
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  // Oct 2026: a new business must enter its own rates in setup; Infinity's are restored by name.
  { const n = await page.$('#f_name'); if (n) await n.fill('Infinity Landscapes and Design'); }

  // Onboarding
  for (let i = 0; i < 4; i++) {
    const pinInputs = await page.$$('input[type=password]');
    if (pinInputs.length >= 2) break;
    const btn = await page.$('button.btn-primary');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  const pinInputs = await page.$$('input[type=password]');
  await pinInputs[0].fill('1234');
  await pinInputs[1].fill('1234');
  await (await page.$('button.btn-primary')).click();
  await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  // Set markup to 15% in Settings > Pricing
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
  await page.fill('#st_markup', '15');
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(300);
  const savedMarkup = await page.$eval('#st_markup', el => el.value);
  console.log('markup saved value on reload of tab:', savedMarkup);

  // Create a new quote: Turf 10x10 (simple, single material-heavy service)
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Test Customer');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);

  // services step - select Turf
  const turfTile = await page.$('[data-action="toggleQuoteService"][data-key="turf"]');
  if (turfTile) await turfTile.click(); else console.log('turf tile not found');
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);

  // measure step: fill width/length for the one row
  const widthInputs = await page.$$('[data-row] input, .meas-row input');
  console.log('measure inputs found:', widthInputs.length);
  // Try more targeted selectors
  const allMeasInputs = await page.$$('input[type=text][inputmode=decimal]');
  console.log('decimal text inputs on measure step:', allMeasInputs.length);
  await page.screenshot({ path: __dirname+'/markup_measure_step.png', fullPage: true });

  await browser.close();
  console.log('ERRORS:', errors.length ? errors : 'none');
})();

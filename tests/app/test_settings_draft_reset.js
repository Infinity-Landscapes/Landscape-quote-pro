const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  await page.addInitScript('window.__NO_AUTO_TOUR__ = true;');
  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  // Oct 2026: a new business must enter its own rates in setup; Infinity's are restored by name.
  { const n = await page.$('#f_name'); if (n) await n.fill('Infinity Landscapes and Design'); }

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

  // Start a new quote and advance to the "measure" step
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Test Customer');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); // -> services

  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); // -> measure

  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(700); // let draft autosave debounce fire

  let heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading before settings visit:', heading);

  // Now go to Settings via the persistent top nav tab (WITHOUT finishing the wizard)
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(300);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
  await page.fill('#st_markup', '12');
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(400);

  await page.screenshot({ path: '/tmp/mobiletest/settings_saved_state.png', fullPage: true });

  // Return to the quote via the top nav "New quote" tab
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(400);

  heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading after returning from settings:', heading);
  const widthVal = await page.$eval('[data-row="0"] input[data-mf="width"]', el => el.value).catch(()=>'FIELD NOT FOUND (wrong step!)');
  console.log('width value after returning (expect 10):', widthVal);

  await page.screenshot({ path: '/tmp/mobiletest/after_return_from_settings.png', fullPage: true });

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

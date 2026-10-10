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
  await page.waitForTimeout(800); // let draft autosave debounce fire (writes to db.doc("drafts/current"))

  console.log('localStorage after autosave:', await page.evaluate(()=>localStorage.getItem('__mockdb__')));

  // Simulate the app being reloaded/closed & reopened (common on mobile) BEFORE the user hits "Resume"
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin2 = await page.$('#loginPin');
  if (loginPin2) { await loginPin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await page.screenshot({ path: '/tmp/mobiletest/reload_menu.png', fullPage: true });

  // Go straight to Settings (skip the "Resume" banner button) and change something
  const settingsBtn = await page.$('button[data-nav="settings"]');
  console.log('settings nav button found:', !!settingsBtn);
  if (settingsBtn) {
    await settingsBtn.click(); await page.waitForTimeout(300);
    await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
    await page.fill('#st_markup', '12');
    await (await page.$('button[data-action="saveSettingsForm"]')).click();
    await page.waitForTimeout(400);
  }

  // Now click the top-nav "New quote" tab (not the menu's "Resume" button)
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(400);

  const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading after settings + New quote tab click (post-reload):', heading);
  const widthVal = await page.$eval('[data-row="0"] input[data-mf="width"]', el => el.value).catch(()=>'FIELD NOT FOUND (wrong step!)');
  console.log('width value (expect 10):', widthVal);
  await page.screenshot({ path: '/tmp/mobiletest/reload_after_settings_newquote.png', fullPage: true });

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

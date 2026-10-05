const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
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

  // SAME SESSION scenario (no reload): start a quote, get to measure, fill in values.
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Same Session Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]', '12');
  await page.fill('[data-row="0"] input[data-mf="length"]', '9');
  await page.waitForTimeout(200);

  // Go check Settings (still same session, S.draft stays live in memory)
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(150);
  await page.fill('#st_markup', '10');
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(200);

  // Instead of the top-nav "New quote" tab, go to Menu — the "unfinished quote" banner shows
  // (since S.draft is still truthy) — and click its "Resume ->" button, exactly as a user would.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(200);
  await page.screenshot({ path: __dirname+'/samesession_menu_banner.png', fullPage: true });
  const resumeBtn = await page.$('button[data-action="resumeDraft"]');
  console.log('Resume button visible on menu (same session, live draft):', !!resumeBtn);

  await resumeBtn.click();
  await page.waitForTimeout(300);

  const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading after clicking Resume (expect Turf/measure step, NOT the first wizard step):', heading);
  const widthVal = await page.$eval('[data-row="0"] input[data-mf="width"]', el => el.value).catch(()=>'FIELD NOT FOUND (wiped!)');
  console.log('width value after Resume click (expect 12):', widthVal);
  await page.screenshot({ path: __dirname+'/samesession_after_resume.png', fullPage: true });

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

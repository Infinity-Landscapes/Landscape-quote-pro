const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(500);

  // Onboarding: click through intro screens (btn-primary) until PIN screen
  for (let i = 0; i < 4; i++) {
    const btn = await page.$('button.btn-primary');
    if (!btn) break;
    const text = await btn.textContent();
    if (/pin/i.test(text || '') === false) {
      // check if PIN inputs are present; if so stop clicking through intro
      const pinInputs = await page.$$('input[type=password]');
      if (pinInputs.length >= 2) break;
    }
    await btn.click();
    await page.waitForTimeout(300);
  }

  const pinInputs = await page.$$('input[type=password]');
  console.log('pin inputs found:', pinInputs.length);
  if (pinInputs.length >= 2) {
    await pinInputs[0].fill('1234');
    await pinInputs[1].fill('1234');
    const finishBtn = await page.$('button.btn-primary');
    if (finishBtn) { await finishBtn.click(); await page.waitForTimeout(500); }
  }

  // Login screen
  const loginPin = await page.$('#loginPin');
  if (loginPin) {
    await loginPin.fill('1234');
    const unlockBtn = await page.$('button[data-action="login"]');
    if (unlockBtn) { await unlockBtn.click(); await page.waitForTimeout(500); }
  }

  await page.screenshot({ path: '/tmp/mobiletest/vat_home.png' });

  // Navigate to Settings
  const settingsNav = await page.$('button[data-nav="settings"]');
  if (settingsNav) { await settingsNav.click(); await page.waitForTimeout(300); }
  else { console.log('settings nav not found'); }

  await page.screenshot({ path: '/tmp/mobiletest/vat_settings_default.png' });

  // Go to Pricing tab
  const pricingTab = await page.$('button[data-action="settingsTab"][data-tab="pricing"]');
  if (pricingTab) { await pricingTab.click(); await page.waitForTimeout(300); }
  await page.screenshot({ path: '/tmp/mobiletest/vat_pricing_tab.png', fullPage: true });

  const expensesVatChecked = await page.$eval('#st_expensesvat', el => el.checked).catch(() => null);
  console.log('expensesIncludeVat checkbox checked by default:', expensesVatChecked);

  // Go to Materials tab
  const materialsTab = await page.$('button[data-action="settingsTab"][data-tab="materials"]');
  if (materialsTab) { await materialsTab.click(); await page.waitForTimeout(300); }
  await page.screenshot({ path: '/tmp/mobiletest/vat_materials_tab.png', fullPage: true });

  const matCheckboxes = await page.$$('[data-matvat]');
  console.log('material vat checkboxes found:', matCheckboxes.length);
  const firstChecked = matCheckboxes.length ? await matCheckboxes[0].isChecked() : null;
  console.log('first material vat checkbox checked by default:', firstChecked);

  // Toggle the first one off and save
  if (matCheckboxes.length) {
    await matCheckboxes[0].click();
    const saveBtn = await page.$('button[data-action="saveMaterialsForm"]');
    if (saveBtn) { await saveBtn.click(); await page.waitForTimeout(400); }
  }
  await page.screenshot({ path: '/tmp/mobiletest/vat_materials_after_save.png', fullPage: true });

  console.log('JS ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

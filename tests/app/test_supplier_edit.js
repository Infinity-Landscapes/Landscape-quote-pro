// Verifies the Materials & settings > Materials tab lets you edit a material's supplier,
// and that the edit persists after save + reload.
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
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  const tabBtn = await page.$('button[data-action="settingsTab"][data-tab="materials"]');
  if (tabBtn) { await tabBtn.click(); await page.waitForTimeout(250); }

  await page.fill('#matFilter', 'Underlay');
  await page.waitForTimeout(200);

  const supInput = await page.$('input[data-matsup="Underlay"]');
  check('supplier input exists for "Underlay"', !!supInput);
  const before = supInput ? await supInput.inputValue() : null;
  console.log('  supplier before edit:', before);

  await supInput.fill('New Test Supplier Ltd');
  await (await page.$('button[data-action="saveMaterialsForm"]')).click();
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  const tabBtn2 = await page.$('button[data-action="settingsTab"][data-tab="materials"]');
  if (tabBtn2) { await tabBtn2.click(); await page.waitForTimeout(250); }
  await page.fill('#matFilter', 'Underlay');
  await page.waitForTimeout(200);
  const supAfter = await page.$eval('input[data-matsup="Underlay"]', el => el.value).catch(()=>'FIELD NOT FOUND');
  check('supplier edit persists after save + reload (expect "New Test Supplier Ltd")', supAfter === 'New Test Supplier Ltd');

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

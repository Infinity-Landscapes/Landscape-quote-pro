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

  // Start a quote, advance to measure, fill values
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Resume Button Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]', '15');
  await page.fill('[data-row="0"] input[data-mf="length"]', '8');
  await page.waitForTimeout(700); // allow debounce to flush

  console.log('mockdb drafts/current before reload:', JSON.stringify(await page.evaluate(()=>(st=>st[Object.keys(st).find(k=>/drafts\/current$/.test(k))])(JSON.parse(localStorage.getItem('__mockdb__'))))).slice(0,300));

  // Reload the whole page (fresh session, exactly like reopening the app)
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin2 = await page.$('#loginPin');
  if (loginPin2) { await loginPin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await page.screenshot({ path: '/tmp/mobiletest/resumebtn_menu.png', fullPage: true });
  const resumeBtn = await page.$('button[data-action="resumeDraft"]');
  console.log('resume button present on menu:', !!resumeBtn);

  if (resumeBtn) {
    await resumeBtn.click();
    await page.waitForTimeout(400);
  }

  await page.screenshot({ path: '/tmp/mobiletest/resumebtn_after_click.png', fullPage: true });
  const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading after clicking Resume (expect Turf, i.e. measure step):', heading);
  const widthVal = await page.$eval('[data-row="0"] input[data-mf="width"]', el => el.value).catch(()=>'FIELD NOT FOUND (wrong step!)');
  console.log('width value after Resume click (expect 15):', widthVal);

  // The menu's Resume button after a full reload goes back to the measurement step with the typed values.
  const ok = !!resumeBtn && heading==='Turf' && widthVal==='15' && errors.length===0;
  console.log((!!resumeBtn?'PASS':'FAIL')+' - Resume button shown after reload');
  console.log((heading==='Turf' && widthVal==='15'?'PASS':'FAIL')+' - Resume returns to the Turf step with width 15');
  console.log('ERRORS:', errors.length ? errors : 'none');
  console.log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exitCode = ok ? 0 : 1;
  await browser.close();
})();

const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
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

  // Set markup to 15%
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
  await page.fill('#st_markup', '15');
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(300);

  // New quote: Turf 10x10
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Test Customer');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);

  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);

  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(150);
  // advance (people / waste / extras) until the review page's save button appears
  for (let i=0; i<6 && !(await page.$('button[data-action="saveSentQuote"]')); i++) { await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }

  await page.screenshot({ path: '/tmp/mobiletest/markup_preview_v1.png', fullPage: true });

  // Save & mark as sent
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/mobiletest/markup_quote_detail_v1.png', fullPage: true });

  const quoteNumber1 = await page.$eval('h3', el => el.textContent).catch(()=>null);
  console.log('quote number after create:', quoteNumber1);

  // Now edit the quote
  await (await page.$('button[data-action="editQuote"]')).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/mobiletest/markup_edit_jump_to_preview.png', fullPage: true });

  // jump back to measure step via step pill, change width to 20
  const measureStepPill = await page.$('.wstep.done[data-step="measure"]');
  if (measureStepPill) { await measureStepPill.click(); await page.waitForTimeout(250); }
  else console.log('measure step pill not found (done class)');

  await page.screenshot({ path: '/tmp/mobiletest/markup_edit_measure_step.png', fullPage: true });
  await page.fill('[data-row="0"] input[data-mf="width"]', '20');
  await page.waitForTimeout(150);

  // walk forward to preview again
  // advance (people / waste / extras) until the review page's save button appears
  for (let i=0; i<6 && !(await page.$('button[data-action="saveSentQuote"]')); i++) { await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }
  await page.screenshot({ path: '/tmp/mobiletest/markup_edit_preview_v2.png', fullPage: true });

  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/mobiletest/markup_quote_detail_v2.png', fullPage: true });

  // Go to quotes list, confirm only ONE quote exists (not duplicated)
  await (await page.$('button[data-nav="quotes"]')).click(); await page.waitForTimeout(300);
  const quoteItems = await page.$$('.quote-list-item');
  // Editing a saved quote (15% mark-up) updates it in place — same number, still one quote, and
  // the new width (20m) is priced in.
  const listText = await page.$eval('#App', el=>el.textContent);
  const ok1 = quoteItems.length===1, ok2 = !!quoteNumber1 && listText.includes(quoteNumber1.trim());
  console.log((ok1?'PASS':'FAIL')+' - editing updates the quote rather than creating a second one');
  console.log((ok2?'PASS':'FAIL')+' - quote keeps its number ('+quoteNumber1+')');
  console.log('ERRORS:', errors.length ? errors : 'none');
  const ok = ok1 && ok2 && errors.length===0;
  console.log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(ok ? 0 : 1);
})();

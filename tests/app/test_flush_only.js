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

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Flush Test Customer');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(50);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(50); // -> measure

  await page.fill('[data-row="0"] input[data-mf="width"]', '33');
  // Simulate the tab being backgrounded IMMEDIATELY (well within the 600ms debounce window)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);

  const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb__'))['drafts/current']);
  const savedWidth = stored && stored.draft && stored.draft.sectionsRaw && stored.draft.sectionsRaw.turf && stored.draft.sectionsRaw.turf.rows[0].width;
  console.log('width flushed to db on visibilitychange (expect 33):', savedWidth);
  console.log('step at flush time (expect measure):', stored && stored.draft && stored.draft.step);

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

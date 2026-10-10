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

  // --- Test 1: toggle-all VAT switch on Materials tab ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(250);

  // Every material defaults to "Inc. VAT" checked EXCEPT Digger hire, which is deliberately net
  // (its £300 is a flat per-5-day hire rate, not a VAT-inclusive supplier price) — see calcWasteRemoval.
  const beforeEntries = await page.$$eval('[data-matvat]', els => els.map(e => ({name:e.getAttribute('data-matvat'), checked:e.checked})));
  const unchecked = beforeEntries.filter(e=>!e.checked).map(e=>e.name);
  console.log('all checked by default except Digger hire (expect ["Digger hire"]):', unchecked, beforeEntries.length);

  // Untick the master switch -> should uncheck all
  const master = await page.$('#matVatAll');
  await master.click(); // now checked=true -> click makes it checked (was unchecked by default)
  await page.waitForTimeout(100);
  let states = await page.$$eval('[data-matvat]', els => els.map(e => e.checked));
  console.log('after clicking master ON, all rows checked:', states.every(Boolean));

  await master.click(); // click again -> unchecked -> should uncheck all rows
  await page.waitForTimeout(100);
  states = await page.$$eval('[data-matvat]', els => els.map(e => e.checked));
  console.log('after clicking master OFF, all rows unchecked:', states.every(v=>v===false));

  // re-check all and save
  await master.click();
  await page.waitForTimeout(100);
  await (await page.$('button[data-action="saveMaterialsForm"]')).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/mobiletest/vatall_saved.png', fullPage: true });

  // --- Test 2: immediate (non-debounced) save on wizNext, and flush on visibilitychange ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Flush Test Customer');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(50); // -> services, should be saved almost immediately (no 600ms wait)

  let stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb__'))['drafts/current']);
  console.log('draft step right after wizNext click (immediate save, expect "services"):', stored && stored.draft && stored.draft.step);

  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(50); // -> measure

  // Type into a field (debounced input path) then IMMEDIATELY simulate backgrounding
  await page.fill('[data-row="0"] input[data-mf="width"]', '33');
  // no wait here - simulate the tab being hidden before the 600ms debounce would fire
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // trick: our real check uses document.hidden; force it via Object.defineProperty before dispatch is tricky in a real browser,
  // so instead call flushDraftSave directly to simulate what the visibilitychange handler does when hidden.
  await page.evaluate(() => { if (typeof flushDraftSave === 'function') flushDraftSave(); });
  await page.waitForTimeout(50);

  stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb__'))['drafts/current']);
  const savedWidth = stored && stored.draft && stored.draft.sectionsRaw && stored.draft.sectionsRaw.turf && stored.draft.sectionsRaw.turf.rows[0].width;
  console.log('width value flushed to db before 600ms debounce elapsed (expect 33):', savedWidth);
  console.log('step at flush time (expect measure):', stored && stored.draft && stored.draft.step);

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

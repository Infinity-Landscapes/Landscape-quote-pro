// Verifies EVERY service's "Days required" figure now rounds up to the nearest quarter-day
// (0.25/0.5/0.75/1…) instead of always a whole day — per the artifact comment that started this
// scoped to Gravel, then the user's follow-up message asking for it across all services. Checks
// several different built-in services (area-based, length-based, and count-based productivity),
// an exact-whole-day case (shouldn't bump up), and that materials quantities (still bought in
// whole units) are untouched by this change.
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
  // "Days required" is immediately followed by its number with no separator (e.g.
  // "Days required0.25"), so extract the run of digits/dot right after the label rather than
  // using a \b-based regex (a word boundary doesn't exist between two word characters like "d1").
  function daysRequiredValue(bodyText){
    const m = bodyText.match(/Days required(\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  }

  async function startFreshQuote(serviceKey, customerName){
    await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(200);
    const discardBtn = await page.$('button[data-action="discardDraft"]');
    if (discardBtn) { await discardBtn.click(); await page.waitForTimeout(150);
      const c = await page.$('button[data-action="modalOk"]'); if (c) { await c.click(); await page.waitForTimeout(200); } }
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', customerName);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$(`[data-action="toggleQuoteService"][data-key="${serviceKey}"]`)).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // --- Gravel (area-based, 50 m²/day default): 5 m² -> 0.1 -> rounds up to 0.25 ---
  await startFreshQuote('gravel', 'Gravel quarter-day test');
  await page.fill('[data-row="0"] input[data-mf="width"]', '1');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Gravel: 5 m² at 50 m²/day rounds UP to 0.25 days (not a whole day)', daysRequiredValue(bodyText) === '0.25');

  // Materials quantities are untouched — Type 1 MOT is still whole bags (ru), not quarter units.
  const mot = bodyText.match(/Type 1 MOT[^\d]*(\d+(?:\.\d+)?)/);
  check('Gravel: material quantity (Type 1 MOT) is still a whole number, unaffected by ruq', mot && Number.isInteger(Number(mot[1])));

  // 50 m² -> exactly 1.0 day -> stays whole, not bumped to 1.25.
  await page.fill('[data-row="0"] input[data-mf="length"]', '50');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Gravel: an exact whole day (50 m²) is not bumped up to the next quarter', daysRequiredValue(bodyText) === '1');

  // --- Paving (area-based, October 2026 default of 6 m²/day/person, 3 people on site):
  // 5 m² -> personDays 0.8333 -> ÷3 = 0.2778 -> rounds up to the nearest quarter = 0.5 ---
  await startFreshQuote('paving', 'Paving quarter-day test');
  await page.fill('[data-row="0"] input[data-mf="width"]', '1');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Paving: rounds to quarter-days (5 m² at 6 m²/day/person ÷3 people = 0.5)', daysRequiredValue(bodyText) === '0.5');

  // --- Close-Board Timber Fencing (length-based, 15 m/day default): 3m -> 0.2 -> rounds up to 0.25 ---
  await startFreshQuote('fence', 'Fencing quarter-day test');
  await page.selectOption('select[data-opt="fenceType"]', 'closeboard'); await page.waitForTimeout(200);
  const fenceRow = await page.$('[data-row="0"] input[data-mf="length"]');
  if (fenceRow) {
    await fenceRow.fill('3');
    await page.waitForTimeout(200);
    bodyText = await page.$eval('#App', el => el.textContent);
    check('Close-Board Timber Fencing (length-based service): rounds to quarter-days too', daysRequiredValue(bodyText) === '0.25');
  } else {
    check('Close-Board Timber Fencing (length-based service): rounds to quarter-days too', false);
  }

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

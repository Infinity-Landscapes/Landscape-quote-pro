// Verifies the Paving service's edging labour-days logic, including the October 2026
// Paving rework's new productivity defaults (6 m²/day/person main, 12 m/day/person edging —
// previously 6.7/13.3). Edging <=5m adds nothing extra; over 5m, its person-days (edgingLen ÷
// edging productivity) are added straight into the job's total person-days before the single
// combined rounding to calendar days (see SERVICES.paving.calc) — there's no separate rounding
// of the edging portion on its own. The per-job "Edging productivity (m/day/person)" override
// box changes that calculation accordingly.
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

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }
  function daysRequiredValue(bodyText){
    const m = bodyText.match(/Days required(\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Paving edging days test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="paving"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);

  // 4 m² at the October 2026 default of 6 m²/day/person -> personDays 0.6667, ÷3 people on
  // site -> rounds up to 0.25 days baseline, with no edging yet.
  await page.fill('[data-row="0"] input[data-mf="width"]', '2');
  await page.fill('[data-row="0"] input[data-mf="length"]', '2');
  await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  const baseline = daysRequiredValue(bodyText);
  check('baseline (no edging): 4 m² at 6 m²/day/person ÷ 3 people = 0.25 days', baseline === '0.25');

  // Turn on edging with 5m exactly -> at/under the 5m threshold -> no extra days added.
  await (await page.$('[data-opt="edging"][data-val="true"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('[data-opt="edgingLength"]')).fill('5');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('edging of exactly 5m adds NO extra days (threshold is "over 5m")', daysRequiredValue(bodyText) === baseline);

  // 40m edging at the new 12 m/day/person default -> edging person-days 40/12 = 3.3333, plus the
  // main 0.6667 = exactly 4.0 person-days, ÷3 people = 1.3333, rounded up to the nearest quarter = 1.5.
  await (await page.$('[data-opt="edgingLength"]')).fill('40');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('40m edging at 12m/day/person -> 4.0 total person-days ÷3 -> 1.5', daysRequiredValue(bodyText) === '1.5');

  // 50m edging -> edging person-days 50/12 = 4.1667, plus main 0.6667 = 4.8333, ÷3 = 1.6111,
  // rounded up to the nearest quarter = 1.75.
  await (await page.$('[data-opt="edgingLength"]')).fill('50');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('50m edging at 12m/day/person -> 4.8333 total person-days ÷3 -> 1.75', daysRequiredValue(bodyText) === '1.75');

  // "Edging productivity (m/day/person)" override box: present, defaults to the new 12 (October
  // 2026: changed from 13.3, per the Paving rework — still per-person, still overridable here).
  const prodBox = await page.$('[data-opt="edgingProductivity"]');
  check('edging productivity override box is present', !!prodBox);
  check('edging productivity box defaults to 12', (await prodBox.inputValue()) === '12');

  // Override edging productivity to 25 m/day/person -> with 3 people on site (the wizard
  // default), total person-days = 4/6 (main) + 50/25 (edging) = 2.6667, split across 3 people
  // = 0.8889 calendar days, rounded up to the nearest quarter = 1.
  await prodBox.fill('25');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('overriding edging productivity to 25 m/day/person -> total person-days 2.6667 ÷ 3 people, rounded up -> 1', daysRequiredValue(bodyText) === '1');

  // Put edging productivity back to the default before checking the off-state below.
  await (await page.$('[data-opt="edgingProductivity"]')).fill('12');
  await page.waitForTimeout(200);

  // Turn edging back off -> should return to the no-edging baseline.
  await (await page.$('[data-opt="edging"][data-val="false"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('turning edging back off returns to the baseline (0.25 days)', daysRequiredValue(bodyText) === baseline);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

// Verifies the October 2026 waste-removal rework (direct user request): grab hire now pools by
// combined dig-out VOLUME (area × dig-out depth) across every waste-eligible service, instead of
// combined area — using a new editable "m³/load" setting (default 5) in place of the old
// 35 m²/load figure. Digger hire (and clearance labour) are explicitly unchanged: still pooled
// by combined area alone. A waste-eligible service with no dig-out-depth field of its own
// (everything except turf and paving) is assumed a 150mm dig-out for this pooling, matching the
// old 35 m²/load figure's implicit depth (35 × 0.15 ≈ 5.25m³, close to the new 5m³ default).
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // A single Turf service, 100 m², with a 200mm dig-out (double the 50mm baseline) — turf is
  // waste-eligible AND carries its own digOutDepth, so the pooled volume should be exactly
  // 100 m² × 0.2m = 20 m³, not the old area-only trigger of 100 m².
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Waste volume pooling test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(200);
  await (await page.$('[data-opt="digOutDepth"]')).fill('200');
  await page.waitForTimeout(200);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> waste step

  let bodyText = await page.$eval('#App', el => el.textContent);
  check('waste step shows combined area 100.00 m²', /100\.00 m²/.test(bodyText));
  check('waste step shows combined dig-out volume 20.00 m³ (100 m² × 0.2m)', /20\.00 m³/.test(bodyText));

  const grabField = await page.$('[data-opt="grabM3PerLoad"]');
  check('"Grab hire capacity (m³/load)" per-job override field is present', !!grabField);
  check('grab hire capacity defaults to 8 m³/load', (await grabField.inputValue()) === '8');
  const diggerField = await page.$('[data-opt="diggerProductivity"]');
  check('digger hire productivity field unchanged (still m²/day)', !!diggerField);
  check('digger hire productivity defaults to 50 m²/day', (await diggerField.inputValue()) === '50');

  // The waste step's own "Plant" preview table shows each item's live quantity — read it here,
  // before advancing (the customer-facing quote letter later only shows the £ totals, not the
  // plant item quantities by name).
  check('digger hire: 1 block (area-based, unchanged: ROUNDUP(ROUNDUP(100/50)/5)=1)', /Digger hire1/.test(bodyText));
  // Grab hire: volume-based. grabLoads = ROUNDUP(20/8) = 3 loads — NOT the old ROUNDUP(20/5)=4 or area-based figure, which
  // is what the old area-based formula would have given.
  check('grab hire: 3 loads (volume-based at the 8 m³ default: ROUNDUP(20m³/8)=3)', /Grab hire3/.test(bodyText));

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> people
  await page.fill('#q_people', '3');
  await page.waitForTimeout(200);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> preview

  bodyText = await page.$eval('#App', el => el.textContent);
  // Cross-check via the final quote's totals: digger (1 block × net £300 = £300) + grab (3 loads
  // × net £300 = £900) = £1,200 plant cost for the waste section — confirms both quantities
  // held through to the saved quote, not just the live wizard preview.
  check('waste section plant cost = £1,200.00 (1 digger block + 3 grab loads, at £300 net each)', /Plant hire£1,?200\.00/.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

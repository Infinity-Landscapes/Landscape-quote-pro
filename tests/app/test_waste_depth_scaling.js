// Verifies the October 2026 waste-removal rework (direct user request): digger-days and
// clearance-labour person-days are now scaled by (area-weighted average dig-out depth ÷ 150mm
// baseline), while grab hire's volume-based formula is explicitly untouched. Also verifies the
// digger hire block size is now an editable business setting (default 5, changed here to 2).
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
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

  // Set the digger hire block size to 2 days (from the default 5) so block math is easy to verify.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await page.fill('#st_diggerBlockDays', '2');
  await (await page.$('button[data-action="saveSettingsForm"]')).click(); await page.waitForTimeout(250);

  // Single Gravel section, 10m x 10m = 100 m², dig-out depth set to 300mm (2x the 150mm
  // baseline) — digger/labour productivity defaults are 50 m²/day and 20 m²/day/person.
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Depth scaling test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(200);
  await page.fill('[data-row="0"] input[data-mf="digOutDepth"]', '300'); // per-row since the Oct 2026 gravel rework
  await page.waitForTimeout(200);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> waste step

  let bodyText = await page.$eval('#App', el => el.textContent);
  check('waste step shows area 100.00 m²', /100\.00 m²/.test(bodyText));
  check('waste step shows avg dig-out depth 300 mm', /300 mm/.test(bodyText));

  // diggerDays = ROUNDUP((100/50) * (300/150)) = ROUNDUP(2 * 2) = 4; diggerBlocks =
  // ROUNDUP(4/2) = 2 (with the 2-day block size set above — would be 1 at the default 5-day size).
  check('digger hire billed as 2 blocks (depth-scaled 4 digger-days ÷ 2-day block size)', /Digger hire2/.test(bodyText));
  // grabLoads unaffected by depth scaling: volume = 100 x 0.3 = 30 m³, grabLoads =
  // ROUNDUP(30/5) = 6 — i.e. driven directly by volume, not by the depth-scaled digger-days path.
  check('grab hire still volume-based, unaffected by the depth scaling (ROUNDUP(30m³/5)=6)', /Grab hire6/.test(bodyText));

  // Clearance labour: labourPersonDays = (100/20) * (300/150) = 5 * 2 = 10 person-days, at the
  // default 3-person crew -> labourDays = ROUNDUP(10/3 to nearest 1/4) = 3.5 days.
  check('clearance labour section shows 10.00 person-days worth of labour cost (10 x £150 = £1,500.00)', /Labour£1,?500\.00/.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

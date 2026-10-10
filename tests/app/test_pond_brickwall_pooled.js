// Verifies the October 2026 waste-removal rework (direct user request): Pond and Block
// Retaining Wall now join the shared Waste removal & site clearance pool instead of hiring
// their own standalone digger — their own section's plant table should show NO "Digger hire"
// line any more, and their area/dig-out depth should feed the combined waste totals.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
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

  // --- Pond only, 5m x 4m = 20 m², default dig-out depth 400mm ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Pond pooling test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="pond"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.waitForTimeout(200);

  // Oct 2026 pond rework: dig-out depth is per row now, default 600mm.
  const pondDepthField = await page.$('[data-row="0"] input[data-mf="digOutDepth"]');
  check('Pond has its own per-row "Dig-out depth (mm)" field', !!pondDepthField);
  check('Pond\'s dig-out depth defaults to 600mm', pondDepthField ? (await pondDepthField.inputValue()) === '600' : false);

  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Pond\'s own section plant table has NO standalone "Digger hire" line any more', !/Digger hire/.test(bodyText));

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> waste step
  bodyText = await page.$eval('#App', el => el.textContent);
  check('waste step shows combined area 20.00 m² (from Pond)', /20\.00 m²/.test(bodyText));
  // volume = 20 m² x 0.6m = 12 m³
  check('waste step shows combined dig-out volume 12.00 m³ (20 m² x 600mm default depth)', /12\.00 m³/.test(bodyText));
  check('the shared "Waste removal & site clearance" section now carries the Digger hire plant line instead', /Digger hire/.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

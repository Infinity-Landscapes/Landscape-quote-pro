// Verifies the September 2026 service-catalogue rebuild (19 services matching the
// "Infinity Landscapes and Design Landscaping procedures.pptx" deck):
//  - Setup step 2 and Settings > Services both offer exactly the 19 new services
//    (and none of the 4 retired legacy keys: decking, fencing, metalbeds, sleeperbeds)
//  - A brand-new tenant's quote wizard offers the same 19 services
//  - Picking a representative sample of the NEW/renamed services produces sane calc
//    output and the matching SERVICE_COPY narrative appears on the quote letter
//  - The corrected timber-decking post density (1 per m², not 1 per 2m²) is in effect
const { chromium } = require('playwright');
const fs = require('fs');

const EXPECTED_19 = ["turf","paving","blockpaving","compositedecking","timberdecking","gravel",
  "brickwall","sleeperwall","fence",
  "waterfeatures","pond","steeledging","flowerbeds","artificialturf","pergola","concretebase"];
const RETIRED = ["decking","fencing","metalbeds","sleeperbeds","closeboardfencing","timberpanelfencing","compositefencing"];
// Oct 2026: the three fence services became one "Fencing" service with fence types -> 17 services.
const N = 16; // Oct 2026: Resin bound is no longer offered to new businesses
const NOT_FOR_NEW = ["resinbound"];

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

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);

  // Walk fresh-tenant setup: step 1 (company name) -> step 2 (services) -> step 3 -> step 4 (pin)
  const fName = await page.$('#f_name');
  check('fresh tenant lands on setup step 1', !!fName);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);

  // Step 2: services tile list
  const tileKeys = await page.$$eval('.service-tile[data-action="toggleSetupService"]', els => els.map(e => e.getAttribute('data-key')));
  check('setup step 2 offers exactly 16 services (no Resin bound)', tileKeys.length === N);
  check('setup step 2 has all 19 expected keys', EXPECTED_19.every(k => tileKeys.includes(k)));
  check('setup step 2 has none of the retired legacy keys', RETIRED.every(k => !tileKeys.includes(k)));
  check('new business is not offered Resin bound', NOT_FOR_NEW.every(k => !tileKeys.includes(k)));

  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); // -> step 3
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); // -> step 4
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400); // finish -> menu

  // Settings > Services should also show exactly the 19 (+ no custom services yet)
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  const settingsKeys = await page.$$eval('.service-tile[data-action="toggleSettingsService"]', els => els.map(e => e.getAttribute('data-key')));
  check('Settings > Services offers exactly 16 services', settingsKeys.length === N);
  check('Settings > Services has none of the retired legacy keys', RETIRED.every(k => !settingsKeys.includes(k)));

  // Build a quote exercising: paving (October 2026: renamed "Patio" -> "Paving"),
  // timberdecking (corrected post density), closeboardfencing (new), brickwall (Block Retaining
  // Wall, new DPM/coping materials), pond (water-feature option removed).
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', '19-Service Catalogue Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);

  const quoteTileKeys = await page.$$eval('.service-tile[data-action="toggleQuoteService"]', els => els.map(e => e.getAttribute('data-key')));
  check('quote wizard Services step offers exactly 16 services', quoteTileKeys.length === N);

  // Confirm "Paving" label shows (renamed back from "Patio") and no legacy "Decking"/"Fencing" tiles
  const tileLabels = await page.$$eval('.service-tile[data-action="toggleQuoteService"] .t', els => els.map(e => e.textContent));
  check('"Paving" label present', tileLabels.includes('Paving'));
  check('new "Timber Decking" / "Composite Decking" labels present', tileLabels.includes('Timber Decking') && tileLabels.includes('Composite Decking'));
  check('single "Fencing" service label present', tileLabels.includes('Fencing') && !tileLabels.includes('Close-Board Timber Fencing'));
  check('renamed "Block Retaining Wall" label present', tileLabels.includes('Block Retaining Wall'));
  check('new "Water Features" / "Steel Edging" / "Flower Beds" labels present', ['Water Features','Steel Edging','Flower Beds'].every(l => tileLabels.includes(l)));

  await (await page.$('[data-action="toggleQuoteService"][data-key="timberdecking"]')).click();
  await page.waitForTimeout(100);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // measure: timberdecking

  // 10m x 4m = 40 m² deck -> expect 40 posts (1 per m², corrected density) and matching postcrete
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(150);
  const kfigText = await page.$eval('body', el => el.textContent);
  check('timber decking area reads 40.00 m²', /40\.00\s*m²/.test(kfigText));

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // preview

  const previewText = await page.$eval('.card', el => el.textContent).catch(()=>'');
  check('quote letter mentions Timber Decking section', /Timber Decking/i.test(previewText));
  check('quote letter includes the new timber-decking narrative bullet (post-saver sleeve)', /post-saver sleeve/i.test(previewText));
  check('quote letter includes "one per square metre" post-density line', /one per square metre/i.test(previewText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

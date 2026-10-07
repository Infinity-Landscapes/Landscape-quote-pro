// Verifies the October 2026 waste-removal rework (direct user request): a per-service
// "generates spoil?" flag is settable for CUSTOM services too, not just built-in ones — toggling
// it on from the unified Settings → Pricing → "Waste & spoil eligibility" card adds a real
// "Dig-out depth (mm)" field to that custom service's own measurement step, and feeds its area +
// dig-out volume into the shared pool exactly like a built-in service — deliberately separate
// from (and compatible with) that custom service's own per-unit waste/disposal item, if it has one.
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

  // Build a custom service via the Service Builder wizard.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  const servicesTab = await page.$('button[data-action="settingsTab"][data-tab="services"]');
  if (servicesTab) { await servicesTab.click(); await page.waitForTimeout(200); }
  await (await page.$('button[data-action="startSvcBuilder"]')).click(); await page.waitForTimeout(200);
  await page.fill('#svcName', 'Patio excavation');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('[data-svcmat-name="0"]', 'Hardcore');
  await page.fill('[data-svcmat-amount="0"]', '1');
  await page.fill('[data-svcmat-per="0"]', '10');
  await page.fill('[data-svcmat-unit="0"]', 'tonne');
  await page.fill('[data-svcmat-price="0"]', '58'); await page.fill('[data-svcmat-supplier="0"]','Test supplier');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#svcProductivity', '20');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="saveServiceBuilder"]')).click(); await page.waitForTimeout(300);

  // The custom service's real key is "custom_"+uid(), not derived from its label — find it from
  // the newly-created service tile's own data-key attribute rather than guessing.
  const customKey = await page.$eval('.service-tile:has-text("Patio excavation")', el => el.getAttribute('data-key'));
  check('a real custom service key was created', !!customKey && customKey.startsWith('custom_'));

  // Now go to Pricing and switch "Generates spoil?" ON for this new custom service.
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const customToggle = await page.$(`button[data-action="toggleGeneratesSpoil"][data-key="${customKey}"]`);
  check('the new custom service appears in the "Waste & spoil eligibility" card', !!customToggle);
  if (customToggle) {
    await customToggle.click(); await page.waitForTimeout(200);
    const depthInput = await page.$(`input[data-digdepth="${customKey}"]`);
    await depthInput.fill('200');
    await (await page.$('button[data-action="saveSettingsForm"]')).click(); await page.waitForTimeout(250);
  }

  // Start a quote using just this custom service, 8m x 5m = 40 m².
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Custom service spoil test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  const tile = await page.$(`[data-action="toggleQuoteService"][data-key="${customKey}"]`);
  check('custom service "Patio excavation" is selectable in a new quote', !!tile);
  await tile.click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '8');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);

  const depthField = await page.$('[data-opt="digOutDepth"]');
  check('the custom service\'s own measurement step now shows a "Dig-out depth (mm)" field', !!depthField);
  check('that field defaults to the 200mm set in Settings', depthField ? (await depthField.inputValue()) === '200' : false);

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> waste step
  const bodyText = await page.$eval('#App', el => el.textContent);
  check('the shared waste step appears, fed by the custom service', /Waste removal.{0,3}site clearance/.test(bodyText));
  check('waste step shows combined area 40.00 m² (from the custom service)', /40\.00 m²/.test(bodyText));
  // volume = 40 x 0.2 = 8 m³
  check('waste step shows combined dig-out volume 8.00 m³ (40 m² x 200mm)', /8\.00 m³/.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
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

  // --- Build a new service ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="startSvcBuilder"]')).click(); await page.waitForTimeout(200);

  // Step 1: name + measurement type
  await page.fill('#svcName', 'Hedge cutting');
  await (await page.$('[data-action="setSvcMeasureType"][data-val="area_wl"]')).click();
  await page.waitForTimeout(100);
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_step2.png', fullPage: true });

  // Step 2: materials — use existing "Turf" material at 1 per 5 m2
  await page.fill('[data-svcmat-name="0"]', 'Turf');
  await page.fill('[data-svcmat-amount="0"]', '1');
  await page.fill('[data-svcmat-per="0"]', '5');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_step3.png', fullPage: true });

  // Step 3: waste yes, priced per unit like a material (green waste tip run — not the shared
  // digger/grab spoil pool), productivity 30
  await (await page.$('[data-action="setSvcWaste"][data-val="true"]')).click();
  await page.waitForTimeout(150);
  await page.fill('#svcWasteName', 'Green waste tip run');
  await page.fill('#svcWasteAmount', '1');
  await page.fill('#svcWastePer', '25');
  await page.fill('#svcWasteUnit', 'run');
  await page.fill('#svcWastePrice', '40');
  await page.fill('#svcProductivity', '30');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_step4.png', fullPage: true });

  // Step 4: review & save
  const reviewText = await page.evaluate(()=>document.body.innerText);
  console.log('review mentions Turf rate:', reviewText.includes('Turf'));
  console.log('review mentions waste item name:', reviewText.includes('Green waste tip run'));
  await (await page.$('button[data-action="saveServiceBuilder"]')).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_saved.png', fullPage: true });

  // productivity table should now include Hedge cutting
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const pricingText = await page.evaluate(()=>document.body.innerText);
  console.log('pricing tab lists Hedge cutting productivity row:', pricingText.includes('Hedge cutting'));
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_pricing_tab.png', fullPage: true });

  // --- Use it in a quote ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Builder Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);

  const hedgeTile = await page.$('[data-action="toggleQuoteService"]:has-text("Hedge cutting")');
  console.log('Hedge cutting tile in wizard:', !!hedgeTile);
  await hedgeTile.click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> measure

  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_measure.png', fullPage: true });
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_measure_filled.png', fullPage: true });

  const measureText = await page.evaluate(()=>document.body.innerText);
  console.log('measure step shows Turf material:', measureText.includes('Turf'));
  console.log('measure step Turf qty ~20:', /Turf[\s\S]{0,40}20/.test(measureText));
  console.log('measure step shows waste item (Green waste tip run):', measureText.includes('Green waste tip run'));
  console.log('measure step waste qty ~4 (100m2 / 25):', /Green waste tip run[\s\S]{0,40}4\s*run/.test(measureText));
  console.log('measure step materials total = Turf £133.17 + waste £133.33 = £266.50:', measureText.includes('£266.50'));

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // preview

  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_preview.png', fullPage: true });
  const previewText = await page.evaluate(()=>document.body.innerText);
  console.log('preview mentions Hedge cutting:', previewText.includes('Hedge cutting'));
  // The customer-facing preview never itemizes individual material names for ANY service (built-in
  // or custom) — only the combined section materials total, which we already confirmed above at
  // the measure step. Here we only confirm the combined total carries through, and that this custom
  // service's own waste cost was NOT also pulled into the separate shared spoil-removal section
  // (no digger/grab hire "Waste removal & site clearance" section should exist, since nothing
  // spoil-eligible like paving/turf was used in this quote).
  console.log('preview materials total carries through (£266.50):', previewText.includes('£266.50'));
  console.log('preview does NOT create a separate shared "Waste removal & site clearance" section (no spoil-eligible service used):', !previewText.includes('Waste removal & site clearance'));

  await (await page.$('button[data-action="saveSentQuote"]')).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/mobiletest/svcbuilder_quote_detail.png', fullPage: true });
  const detailText = await page.evaluate(()=>document.body.innerText);
  console.log('saved quote detail materials total still £266.50 (Turf + waste item):', detailText.includes('£266.50'));
  console.log('saved quote detail has no separate shared waste-removal section:', !detailText.includes('Waste removal & site clearance'));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

// Verifies the turf-specific rework (direct user request): "Blended loam topsoil" renamed to
// "Quality topsoil" (unit changed to tonnes), with its quantity now area ÷ baseline coverage ×
// (dig-out depth ÷ baseline depth) instead of a flat area/10 — both baselines editable settings
// defaulting to 10 m²/tonne and 50mm. The turf wastage multiplier (was a fixed 1.1) is now an
// editable "wastage %" setting, default 10%. The flat "1" consumables allowance is now an
// editable "quantity per job" setting, default 1, still only applied when area>0.
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

  async function startTurfQuote(name, w, l){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);
    await page.fill('[data-row="0"] input[data-mf="width"]', String(w));
    await page.fill('[data-row="0"] input[data-mf="length"]', String(l));
    await page.waitForTimeout(200);
  }
  function materialsAllowedText(bodyText){
    const m = bodyText.match(/Materials allowed for:[^\n]*/);
    return m ? m[0] : '';
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

  // --- Materials list shows the renamed material, no trace of the old name ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click().catch(()=>{});
  await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('materials list shows "Quality topsoil"', /Quality topsoil/.test(bodyText));
  check('materials list no longer shows "Blended loam topsoil"', !/Blended loam topsoil/.test(bodyText));

  // --- Settings > Pricing has the new editable turf fields, with the documented defaults ---
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const baselineCoverage = await page.$eval('#st_turfBaselineCoverage', el => el.value).catch(()=>null);
  const baselineDepth = await page.$eval('#st_turfBaselineDepth', el => el.value).catch(()=>null);
  const wastage = await page.$eval('#st_turfWastage', el => el.value).catch(()=>null);
  const consumables = await page.$eval('#st_turfConsumables', el => el.value).catch(()=>null);
  check('topsoil baseline coverage field present, defaults to 10', baselineCoverage === '10');
  check('topsoil baseline depth field present, defaults to 50', baselineDepth === '50');
  check('turf wastage % field present, defaults to 10', wastage === '10');
  check('turf consumables qty field present, defaults to 1', consumables === '1');

  // --- Default-depth turf job: 100 m² -> topsoil = ru((100/10)*(50/50)) = 10 tonnes;
  //     turf = ru(100*1.10) = 110 m² (same as the old fixed-1.1 behaviour, via the 10% default) ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startTurfQuote('Turf default depth', 10, 10);
  const digDepthVal = await page.$eval('[data-opt="digOutDepth"]', el => el.value).catch(()=>null);
  check('"Dig-out depth (mm)" option present, defaults to 50', digDepthVal === '50');
  // Turf is waste-eligible, so the wizard inserts an extra "Waste removal" step: measure -> waste
  // -> people -> extras -> preview, i.e. 4 "Next" clicks from here.
  for(let i=0;i<4;i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[default depth] 10 tonnes of Quality topsoil allowed for', /Quality topsoil \(10 tonnes\)/.test(materialsAllowedText(bodyText)) || /Quality topsoil \(10 /.test(bodyText));
  check('[default depth] 110 m² of Turf allowed for (10% wastage)', /Turf \(110 /.test(bodyText));

  // --- Double the dig-out depth to 100mm -> topsoil scales to ru((100/10)*(100/50)) = 20 tonnes,
  //     turf (unaffected by depth) stays at 110 m² ---
  await (await page.$('button[data-action="saveSentQuote"]')).click().catch(()=>{});
  await page.waitForTimeout(250);
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startTurfQuote('Turf doubled depth', 10, 10);
  await (await page.$('[data-opt="digOutDepth"]')).fill('100');
  await page.waitForTimeout(200);
  for(let i=0;i<4;i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[100mm dig-out, double the 50mm baseline] topsoil doubles to 20 tonnes', /Quality topsoil \(20 /.test(bodyText));
  check('[100mm dig-out] turf quantity unaffected by depth, still 110 m²', /Turf \(110 /.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

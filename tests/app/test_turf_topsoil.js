// Verifies the turf-specific rework (direct user request): "Blended loam topsoil" renamed to
// "Quality topsoil" (unit changed to tonnes), with its quantity now area ÷ baseline coverage ×
// (dig-out depth ÷ baseline depth) instead of a flat area/10 — both baselines editable settings
// defaulting to 10 m²/tonne and 50mm. The turf wastage multiplier (was a fixed 1.1) is now the
// "Wastage for cuts (%)" question on the turf step of the quote wizard (default 0, remembered). The flat "1" consumables allowance is now an
// editable "quantity per job" setting, default 1, still only applied when area>0.
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
  // The letter's consolidated "Materials allowed for" list, as "Name (qty unit), ..."
  async function materialsAllowedText(){
    return (await page.$$eval('#letterCapture table.letter-mats tr', trs => trs.map(tr => `${tr.cells[0].textContent} (${tr.cells[1].textContent})`))).join(', ');
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
  check('no turf wastage field in Settings (asked in the quote wizard instead)', wastage === null);
  check('turf consumables qty field present, defaults to 1', consumables === '1');

  // --- Default-depth turf job: 100 m² -> topsoil = ru((100/10)*(50/50)) = 10 tonnes;
  //     turf = ru(100*1.10) = 110 m² (same as the old fixed-1.1 behaviour, via the 10% default) ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startTurfQuote('Turf default depth', 10, 10);
  const digDepthVal = await page.$eval('[data-opt="digOutDepth"]', el => el.value).catch(()=>null);
  check('"Dig-out depth (mm)" option present, defaults to 50', digDepthVal === '50');
  check('turf step asks wastage for cuts, starting at 0', await page.$eval('[data-opt="wastagePct"]', el => el.value).catch(()=>null) === '0');
  await page.fill('[data-opt="wastagePct"]', '10'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await page.waitForTimeout(200);
  // Turf is waste-eligible, so the wizard inserts an extra "Waste removal" step: measure -> waste
  // -> people -> extras -> preview, i.e. 4 "Next" clicks from here.
  for(let i=0;i<4;i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[default depth] 10 tonnes of Quality topsoil allowed for', /Quality topsoil \(10 tonnes\)/.test(await materialsAllowedText()));
  check('[default depth] 110 m² of Turf allowed for (10% wastage set in the wizard)', /Turf \(110 /.test(await materialsAllowedText()));

  // --- Double the dig-out depth to 100mm -> topsoil scales to ru((100/10)*(100/50)) = 20 tonnes,
  //     turf (unaffected by depth) stays at 110 m² ---
  await (await page.$('button[data-action="saveSentQuote"]')).click().catch(()=>{});
  await page.waitForTimeout(250);
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startTurfQuote('Turf doubled depth', 10, 10);
  check('turf wastage remembered from the last turf quote (10)', await page.$eval('[data-opt="wastagePct"]', el => el.value).catch(()=>null) === '10');
  await (await page.$('[data-opt="digOutDepth"]')).fill('100');
  await page.waitForTimeout(200);
  for(let i=0;i<4;i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[100mm dig-out, double the 50mm baseline] topsoil doubles to 20 tonnes', /Quality topsoil \(20 /.test(await materialsAllowedText()));
  check('[100mm dig-out] turf quantity unaffected by depth, still 110 m²', /Turf \(110 /.test(await materialsAllowedText()));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

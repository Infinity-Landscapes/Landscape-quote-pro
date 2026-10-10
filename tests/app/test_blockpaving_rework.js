// Verifies the October 2026 Block paving rework: per-row dig-out depth (default 250mm) feeding
// the shared waste pool as an exact area-weighted volume, the new Type 1 MOT formula (dig-out
// depth − surface build-up, scaled from an editable baseline — 40m² -> 12 tonnes at defaults),
// no default block (tenant adds blocks mid-quote, wastage % on the block only), a direct
// "Edging length (m)" input (no automatic perimeter), tenant-built jointing-compound/edging-style
// libraries (coverage prefilled 8), editable consumables/wastage/surface-build-up settings, and
// the edging-productivity setting actually seeding new quotes.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
  const page = await context.newPage();
  require('/tmp/mobiletest/row_helper.js')(page);
  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }
  const txt = () => page.$eval('#App', el => el.textContent);
  async function fillModal(fields){
    for (const [key, val] of Object.entries(fields)) {
      const el = await page.$(`#mf_${key}`);
      if (el) await el.fill(String(val));
    }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
    await page.waitForTimeout(250);
  }
  async function startQuote(name){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="blockpaving"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  }
  async function discard(){
    await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(200);
    const d = await page.$('button[data-action="discardDraft"]');
    if (d) { await d.click(); await page.waitForTimeout(150); const ok = await page.$('button[data-action="modalOk"]'); if (ok) { await ok.click(); await page.waitForTimeout(250); } }
  }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin', '1234'); await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // ---- Settings defaults ----
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const val = id => page.$eval(id, el => el.value).catch(()=>null);
  check('no surface build-up setting: MOT depth = dig-out − 100mm (50mm bedding + 50mm block)', !(await page.$('#st_blockSurfaceBuildUp')) && /dig-out depth − 100mm/.test(await txt()));
  check('no block wastage field in Settings (it is asked in the quote wizard)', !(await page.$('#st_blockWastage')));
  check('MOT baseline rate defaults to 0.3', await val('#st_blockMotRate') === '0.3');
  check('MOT baseline depth defaults to 150', await val('#st_blockMotDepth') === '150');
  check('consumables quantity defaults to 1', await val('#st_blockConsumables') === '1');
  check('block edging productivity defaults to 12', await val('#st_blockEdgingProd') === '12');
  check('block paving dig-out default is 250', await page.$eval('input[data-digdepth="blockpaving"]', el => el.value).catch(()=>null) === '250');
  check('no block types saved by default', /None added yet — add a block type/.test(await txt()));

  // ---- Quote: 4-column rows, depth prefilled, no default block ----
  await startQuote('Block rework');
  check('measurement row uses the 4-column layout', !!(await page.$('.meas-row.four')));
  check('dig-out depth input present on each row', (await page.$$('input[data-mf="digOutDepth"]')).length === (await page.$$('div[data-row]')).length);
  check('dig-out depth prefilled with 250', await page.$eval('[data-row="0"] input[data-mf="digOutDepth"]', el => el.value) === '250');
  check('no job-level dig-out depth option any more', !(await page.$('[data-opt="digOutDepth"]')));
  check('edging length input present and blank by default', await page.$eval('[data-opt="edgingLength"]', el => el.value) === '');
  const opts = await page.$$eval('[data-row="0"] select[data-mf="blockType"] option', els => els.map(e => e.textContent));
  check('block style has no built-in blocks, only "+ Add new…"', opts.filter(o=>!/Select|Add new/.test(o)).length === 0);
  check('"Standard block paving" is gone', !/Standard block paving/.test(await txt()));

  await page.fill('[data-row="0"] input[data-mf="width"]', '5');
  await page.fill('[data-row="0"] input[data-mf="length"]', '8');
  await page.waitForTimeout(200);
  let t = await txt();
  check('40m² at defaults needs 12 tonnes Type 1 MOT', t.includes('Type 1 MOT12 tonne'));
  check('block paving step asks wastage for cuts, starting at 0', await page.$eval('[data-opt="wastagePct"]', el => el.value) === '0');
  await page.fill('[data-opt="wastagePct"]', '10'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await page.waitForTimeout(200);

  // Add a block mid-quote
  await page.selectOption('[data-row="0"] select[data-mf="blockType"]', '__add_other__'); await page.waitForTimeout(200);
  await page.fill('#modalMatName', 'Test Block'); await page.fill('#modalMatPrice', '50');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  t = await txt();
  check('block quantity = area × 1.10 wastage = 44 m²', t.includes('Test Block44'));
  check('block cost = 44 × £41.67 net = £1,833.33', /1,?833\.33/.test(t));
  check('geotextile uses laid area (40), no wastage', t.includes('Geotextile membrane40'));
  check('blocker until a bedding material is chosen', /Select a bedding material/.test(t));
  await page.selectOption('select[data-opt="bedding"]','__add_other__'); await page.waitForTimeout(200);
  await page.fill('#mf_name','Granite dust'); await page.fill('#mf_price','60'); await page.fill('#mf_supplier','AWBS');
  await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  t = await txt();
  check('bedding (granite dust) = ROUNDUP(40/10) = 4 tonnes', t.includes('Granite dust4') && !t.includes('Limestone 2-6mm'));
  check('consumables 1', t.includes('Consumables1'));

  // Edging: direct length, tenant-defined style
  await page.fill('[data-opt="edgingLength"]', '25'); await page.waitForTimeout(200);
  await page.selectOption('select[data-opt="edgingStyle"]', '__add_other__'); await page.waitForTimeout(200);
  await fillModal({name:'Kerb edge', piecesPerMetre:4, price:2});
  t = await txt();
  check('edging quantity = 25m × 4/m = 100', t.includes('Kerb edge100'));
  check('sharp sand = ROUNDUP(25/10) = 3', t.includes('Sharp sand3'));
  check('cement matches sand = 3', t.includes('Cement3'));

  // Jointing compound: coverage prefilled with 8
  await page.selectOption('select[data-opt="jointingCompound"]', '__add_other__'); await page.waitForTimeout(200);
  check('jointing compound add dialog prefills coverage with 8', await page.$eval('#mf_coverage', el => el.value) === '8');
  await fillModal({name:'Grout', price:30});
  t = await txt();
  check('jointing compound qty = ROUNDUP(40/8) = 5', t.includes('Grout5'));

  // Second row with a different depth: 10m² at 150mm
  await page.fill('[data-row="1"] input[data-mf="width"]', '2');
  await page.fill('[data-row="1"] input[data-mf="length"]', '5');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]', '150');
  await page.waitForTimeout(250);
  t = await txt();
  // avg depth = (40×250 + 10×150)/50 = 230 -> MOT depth 130 -> ROUNDUP(50×0.3×130/150) = 13
  check('MOT follows the area-weighted average depth (13 tonnes)', t.includes('Type 1 MOT13 tonne'));
  // person-days = 50/5 + 25/12 = 12.0833; labour = 12.0833 × £150 = £1,812.50
  check('labour = (area÷5 + edging÷12) person-days × day rate = £1,812.50', /1,?812\.50/.test(t));

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('waste step: combined area 50.00 m²', /50\.00 m²/.test(t));
  check('waste step: dig-out volume = 40×0.25 + 10×0.15 = 11.50 m³', /11\.50 m³/.test(t));

  // ---- Settings changes take effect + edging productivity seeds new quotes ----
  await discard();
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await page.fill('#st_blockConsumables', '2');
  await page.fill('#st_blockEdgingProd', '10');
  await (await page.$('button[data-action="saveSettingsForm"]')).click(); await page.waitForTimeout(250);
  await startQuote('Block settings');
  await page.fill('[data-row="0"] input[data-mf="width"]', '5');
  await page.fill('[data-row="0"] input[data-mf="length"]', '8');
  await page.waitForTimeout(200);
  check('edging productivity option seeded from settings (10)', await page.$eval('[data-opt="edgingProductivity"]', el => el.value) === '10');
  check('wastage remembered from the last block paving quote (10)', await page.$eval('[data-opt="wastagePct"]', el => el.value) === '10');
  await page.fill('[data-opt="wastagePct"]', '20'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await page.waitForTimeout(200);
  await page.selectOption('[data-row="0"] select[data-mf="blockType"]', 'Test Block'); await page.waitForTimeout(200);
  t = await txt();
  // MOT depth = 250 − 100 (fixed) = 150 -> ROUNDUP(40×0.3×150/150) = 12
  check('build-up fixed at 100mm -> MOT 12 tonnes', t.includes('Type 1 MOT12 tonne'));
  check('bedding remembered from the last block paving quote', await page.$eval('select[data-opt="bedding"]', el => el.value) === 'Granite dust');
  check('wastage 20% -> block 48 m²', t.includes('Test Block48'));
  check('consumables quantity 2', t.includes('Consumables2'));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

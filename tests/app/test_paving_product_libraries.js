// Verifies the October 2026 Paving rework. Slab type is a normal `customizable` materials-list
// pick (like Gravel/Block paving/Wall skin/Pergola post type) — "+ Add new…" on its dropdown
// saves straight into settings.materials, no built-in default, and it's deletable from Settings
// → Pricing → Paving (the one gap that mechanism otherwise has). Jointing compound and edging
// style keep their own tenant-built libraries (Settings → Pricing → Paving) since each needs an
// extra ratio field (coverage / pieces-per-metre) a plain material doesn't have — but their
// dropdowns ALSO offer an inline "+ Add new…" so a tenant never has to leave the quote wizard to
// add one (per Matt's direct feedback after the first version of this rework put slab type
// behind a Settings-only library instead of letting it be added from the quote, like every
// other material pick in the app). Also checks the dig-out-depth-scaled Type 1 MOT formula and
// the "Paving primer" rename with its editable coverage setting, and that patio cleaner /
// recessed manhole cover / consumables are unchanged.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1100 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  async function startPavingQuote(name, w, l){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="paving"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
    await page.fill('[data-row="0"] input[data-mf="width"]', String(w));
    await page.fill('[data-row="0"] input[data-mf="length"]', String(l));
    await page.waitForTimeout(200);
  }
  // The measurement step's live materials table renders name and qty in adjacent table cells
  // with no text node between them (e.g. "Type 1 MOT" + "10 tonne" -> "Type 1 MOT10 tonne"), so
  // matching "<name><qty>" as one substring is the reliable way to check a line's quantity.
  function hasMaterialQty(bodyText, name, qty){ return bodyText.includes(name + String(qty)); }
  // Isolates the measurement step's live materials table from the rest of the page (option
  // hints can otherwise contain a material's name in plain English, e.g. "...Type 1 MOT
  // sub-base depth", producing a false positive for a naive whole-page "includes" check).
  function materialsTableText(bodyText){
    const m = bodyText.match(/\bMaterials\s*\n([\s\S]*?)\n\s*(?:Back|Review quote)/);
    return m ? m[1] : '';
  }
  async function discardAndMenu(){
    await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(200);
    const discardBtn = await page.$('button[data-action="discardDraft"]');
    if (discardBtn) {
      await discardBtn.click(); await page.waitForTimeout(150);
      const confirmBtn = await page.$('button[data-action="modalOk"]');
      if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(250); }
    }
  }
  // Fills a generic showForm-backed modal (ids mf_<key>) and confirms it — used for the
  // Settings "+ Add…" buttons AND the wizard's own inline "+ Add new…" sentinel, since both
  // open the exact same openPavingProductModal-built form.
  async function fillAndSaveFormModal(fields){
    for (const [key, val] of Object.entries(fields)) {
      const el = await page.$(`#mf_${key}`);
      if (!el) continue;
      const tag = await el.evaluate(e=>e.tagName.toLowerCase());
      if (tag === 'input' && (await el.getAttribute('type')) === 'checkbox') {
        const checked = await el.isChecked();
        if (checked !== !!val) await el.click();
      } else {
        await el.fill(String(val));
      }
    }
    await (await page.$('button[data-action="modalOk"]')).click();
    await page.waitForTimeout(250);
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

  // --- Materials list: "Paving primer" exists, "SBR primer" is gone ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(200);
  await page.fill('#matFilter', 'primer');
  await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('materials list shows "Paving primer"', /Paving primer/.test(bodyText));
  check('materials list no longer shows "SBR primer"', !/SBR primer/.test(bodyText));

  // --- Settings > Pricing > Paving: new fields present with documented defaults ---
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const primerCoverage = await page.$eval('#st_pavingPrimerCoverage', el => el.value).catch(()=>null);
  const edgingProdSetting = await page.$eval('#st_pavingEdgingProd', el => el.value).catch(()=>null);
  const grabM3Setting = await page.$eval('#st_wasteGrabM3PerLoad', el => el.value).catch(()=>null);
  check('paving primer coverage field present, defaults to 20', primerCoverage === '20');
  check('paving edging productivity setting field present, defaults to 12', edgingProdSetting === '12');
  check('grab hire capacity (m³/load) field present, defaults to 5', grabM3Setting === '5');

  // --- Add a jointing compound via Settings > Pricing > Paving's own "+ Add…" button (the
  //     tenant-built-library mechanism, unchanged apart from being refactored to share code
  //     with the wizard's new inline "+ Add new…") ---
  async function clickAddButton(btnMatch){
    const btns = await page.$$('button[data-action="addPavingProduct"]');
    for (const b of btns) { const lbl = await b.getAttribute('data-label'); if (lbl === btnMatch) { await b.click(); return true; } }
    return false;
  }
  check('opened "+ Add jointing compound"', await clickAddButton('jointing compound'));
  await page.waitForTimeout(200);
  await fillAndSaveFormModal({name:'Everbuild Jointing Grout', price:30, coverage:8});
  bodyText = await page.$eval('#App', el => el.textContent);
  check('settings page lists the new jointing compound', /Everbuild Jointing Grout/.test(bodyText));

  // --- Start a Paving quote: dig-out depth defaults to 150mm; slab type is a `customizable`
  //     materials pick (not a `source` library) with no built-in default ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startPavingQuote('Paving rework — default depth', 10, 5); // area = 50 m²
  const digDepthVal = await page.$eval('[data-opt="digOutDepth"]', el => el.value).catch(()=>null);
  check('"Dig-out depth (mm)" option present, defaults to 150', digDepthVal === '150');

  const styleSelect = await page.$('select[data-opt="style"]');
  check('slab-type select is marked customizable (the normal materials-pick mechanism)', (await styleSelect.getAttribute('data-customizable')) === 'paving');
  check('slab-type select has no selected value yet (placeholder, no built-in default)', await styleSelect.evaluate(el=>el.value) === '');
  const styleOptionTexts0 = await styleSelect.$$eval('option', els => els.map(e => e.textContent));
  check('slab-type select offers "+ Add new…"', styleOptionTexts0.includes('+ Add new…'));

  // Add the slab type inline from the wizard — this is the behaviour Matt specifically asked
  // for (it should "add it to materials"), via the same generic add-a-material dialog gravel's
  // style dropdown already uses.
  await styleSelect.selectOption('__add_other__');
  await page.waitForTimeout(200);
  check('"+ Add new…" opens the add-a-material dialog', (await page.$('#modalMatName')) !== null);
  await (await page.$('#modalMatName')).fill('Premium Porcelain 900x600');
  await (await page.$('#modalMatPrice')).fill('60');
  await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);
  check('slab-type select now shows the new slab type selected', await page.$eval('select[data-opt="style"]', el => el.value) === 'Premium Porcelain 900x600');

  // Select the jointing compound added earlier via Settings; leave edging off for now.
  await page.selectOption('select[data-opt="jointingCompound"]', 'Everbuild Jointing Grout');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  // Type 1 MOT at the 150mm default dig-out: MOT depth = 150-50 = 100mm, quantity =
  // ROUNDUP((50/5) * (100/100)) = 10 tonnes — matches the long-standing area/5 baseline exactly.
  check('[150mm dig-out, default] Type 1 MOT = 10 tonnes (matches the old area÷5 baseline)', hasMaterialQty(bodyText, 'Type 1 MOT', 10));
  // Slab: 50 m² + the default 10% slab wastage = 55 m², at £60/m² Inc VAT -> net £50/m² ->
  // £2,750.00, via the normal shared-materials price lookup (ctx.price), exactly like gravel's style.
  check('slab type priced via the normal materials lookup (55 m² incl. 10% wastage × £50 net = £2,750.00)', /2,?750\.00/.test(bodyText));
  // Jointing compound: ROUNDUP(50/8) = 7 units at £30/unit Inc VAT -> net £25 -> £175.00.
  check('jointing compound quantity = ROUNDUP(area ÷ coverage) = 7 units', hasMaterialQty(bodyText, 'Everbuild Jointing Grout', 7));
  check('jointing compound cost = 7 × £25 net = £175.00', /175\.00/.test(bodyText));
  // Paving primer at the default 20 m²/unit coverage: ROUNDUP(50/20) = 3 units.
  check('Paving primer quantity = ROUNDUP(area ÷ 20) = 3 units', hasMaterialQty(bodyText, 'Paving primer', 3));

  // --- Double the dig-out depth to 250mm: MOT depth = 200mm, quantity = ROUNDUP((50/5)*(200/100)) = 20 tonnes ---
  await (await page.$('[data-opt="digOutDepth"]')).fill('250');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[250mm dig-out] Type 1 MOT doubles to 20 tonnes', hasMaterialQty(bodyText, 'Type 1 MOT', 20));

  // --- Dig-out depth of 50mm or less leaves no MOT layer at all (top 50mm is sand/bedding only) ---
  await (await page.$('[data-opt="digOutDepth"]')).fill('40');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[40mm dig-out, under the 50mm sand/bedding depth] Type 1 MOT quantity is 0 (no row shown)', !materialsTableText(bodyText).includes('Type 1 MOT'));

  // --- Edging: turn on, then add a NEW edging style inline from the wizard's own "+ Add new…"
  //     sentinel (the new capability) instead of pre-adding it via Settings — 10m of edging ->
  //     qty = 10 × 2 = 20 (not rounded) ---
  await (await page.$('[data-opt="digOutDepth"]')).fill('150');
  await (await page.$('[data-opt="edging"][data-val="true"]')).click();
  await page.waitForTimeout(150);
  const edgingSelect = await page.$('select[data-opt="edgingStyle"]');
  check('edging-style select carries the inline-add sentinel attributes', (await edgingSelect.getAttribute('data-source-add')) === 'pavingEdgingStyles');
  const edgingOptionTexts0 = await edgingSelect.$$eval('option', els => els.map(e => e.textContent));
  check('edging-style select offers "+ Add new…"', edgingOptionTexts0.includes('+ Add new…'));
  await edgingSelect.selectOption('__add_other__');
  await page.waitForTimeout(200);
  check('"+ Add new…" opens the tenant-library add form (not the plain add-a-material dialog)', (await page.$('#mf_name')) !== null && (await page.$('#modalMatName')) === null);
  check('the opened form asks for pieces/metre (the field this library needs beyond price)', (await page.$('#mf_piecesPerMetre')) !== null);
  await fillAndSaveFormModal({name:'Charcoal Metal Edging', piecesPerMetre:2, price:4});
  check('edging-style select now shows the newly-added style selected, straight from the wizard', await page.$eval('select[data-opt="edgingStyle"]', el => el.value) === 'Charcoal Metal Edging');

  await (await page.$('[data-opt="edgingLength"]')).fill('10');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('edging style quantity = edgingLength × piecesPerMetre = 20 (not rounded)', hasMaterialQty(bodyText, 'Charcoal Metal Edging', 20));
  // 20 pieces at £4/piece Inc VAT -> net £3.3333 -> £66.67.
  check('edging style cost = 20 × £3.33 net ≈ £66.67', /66\.67/.test(bodyText));

  // --- Patio cleaner, recessed manhole cover, consumables unchanged ---
  await (await page.$('[data-opt="covers"][data-val="true"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('[data-opt="coverCount"]')).fill('2');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Patio cleaner unchanged: ROUNDUP(area÷20) = 3 units', hasMaterialQty(bodyText, 'Patio cleaner', 3));
  check('Recessed manhole cover unchanged: count = 2', hasMaterialQty(bodyText, 'Recessed manhole cover', 2));
  check('Consumables unchanged: flat 1 per job', hasMaterialQty(bodyText, 'Consumables', 1));

  await discardAndMenu();

  // --- The newly-added slab type shows up in Settings → Pricing → Paving's delete-only list
  //     (the one capability gap the inline "+ Add new…" mechanism had) — delete it, and it
  //     should disappear from both Settings and the dropdown on a NEW quote. ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('settings page lists the slab type added inline from the wizard', /Premium Porcelain 900x600/.test(bodyText));
  const delButtons = await page.$$('button[data-action="removeCustomStyleOption"][data-group="paving"]');
  check('a delete button exists for the slab type just added', delButtons.length > 0);
  if (delButtons.length) { await delButtons[0].click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('slab type no longer listed in Settings after deleting it', !/Premium Porcelain 900x600/.test(bodyText));

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await startPavingQuote('Paving rework — after delete', 5, 5);
  const styleOptionTexts2 = await page.$eval('select[data-opt="style"]', el => Array.from(el.options).map(o=>o.textContent)).catch(()=>[]);
  check('deleted slab type no longer offered on a fresh quote', !styleOptionTexts2.includes('Premium Porcelain 900x600'));
  check('with nothing selected, no slab-type material line is charged (name is empty, filtered out)', !/£NaN/.test(await page.$eval('#App', el => el.textContent)));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

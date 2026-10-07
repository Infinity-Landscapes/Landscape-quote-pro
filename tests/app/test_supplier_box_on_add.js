// Verifies the "Add a supplier box to all add materials" artifact comment: every place that
// creates a brand-new entry in settings.materials from the quote wizard or the Custom Service
// Builder now offers an optional Supplier field at the point of adding it, instead of always
// saving supplier:'' and making the tenant go to Materials & settings afterwards to fill it in.
// Covers: (1) the generic "+ Add new…" add-a-material dialog (customizable dropdowns —
// Gravel/Block paving/Wall skin/Paving slab type/Pergola post type all share this one dialog),
// and (2) the Custom Service Builder's own "new material" and "new waste item" rows. Also checks
// that re-adding an EXISTING material by name updates its price but only overwrites its supplier
// if a new one was actually typed (mirrors the pre-existing "don't clobber VAT setting" rule).
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

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // --- (1) The generic "+ Add new…" dialog (Gravel style used as the example) ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Supplier box test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);

  await page.selectOption('[data-row="0"] select[data-mf="gravelType"]', '__add_other__');
  await page.waitForTimeout(200);
  check('add-material dialog has a Supplier field', (await page.$('#modalMatSupplier')) !== null);
  await (await page.$('#modalMatName')).fill('Cotswold Gold Gravel');
  await (await page.$('#modalMatPrice')).fill('40');
  await (await page.$('#modalMatSupplier')).fill('Jewson');
  await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(200);
  await page.fill('#matFilter', 'Cotswold Gold'); await page.waitForTimeout(200);
  const supplierInput = await page.$('input[data-matsup="Cotswold Gold Gravel"]');
  check('supplier entered in the dialog was saved against the new material', supplierInput ? (await supplierInput.inputValue()) === 'Jewson' : false);

  // Re-add the SAME material from a fresh quote, this time leaving supplier blank — the existing
  // supplier should be left alone (not clobbered to blank), while the price still updates.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  const discardBtn1 = await page.$('button[data-action="discardDraft"]');
  if (discardBtn1) { await discardBtn1.click(); await page.waitForTimeout(150); const c=await page.$('button[data-action="modalOk"]'); if(c){await c.click(); await page.waitForTimeout(200);} }
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Supplier box test 2');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);
  await page.selectOption('[data-row="0"] select[data-mf="gravelType"]', '__add_other__');
  await page.waitForTimeout(200);
  await (await page.$('#modalMatName')).fill('Cotswold Gold Gravel');
  await (await page.$('#modalMatPrice')).fill('42');
  await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(200);
  await page.fill('#matFilter', 'Cotswold Gold'); await page.waitForTimeout(200);
  const priceInput2 = await page.$('input[data-mat="Cotswold Gold Gravel"]');
  const supplierInput2 = await page.$('input[data-matsup="Cotswold Gold Gravel"]');
  check('re-adding the same material updates its price (£42)', priceInput2 ? (await priceInput2.inputValue()) === '42' : false);
  check('re-adding with a blank supplier does NOT clobber the previously-saved supplier', supplierInput2 ? (await supplierInput2.inputValue()) === 'Jewson' : false);

  // --- (2) Custom Service Builder: new-material row and new-waste-item row ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  const discardBtn2 = await page.$('button[data-action="discardDraft"]');
  if (discardBtn2) { await discardBtn2.click(); await page.waitForTimeout(150); const c=await page.$('button[data-action="modalOk"]'); if(c){await c.click(); await page.waitForTimeout(200);} }
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  const servicesTab = await page.$('button[data-action="settingsTab"][data-tab="services"]');
  if (servicesTab) { await servicesTab.click(); await page.waitForTimeout(200); }
  await (await page.$('button[data-action="startSvcBuilder"]')).click(); await page.waitForTimeout(200);
  await page.fill('#svcName', 'Hedge trimming');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);

  const matSupplierField = await page.$('[data-svcmat-supplier="0"]');
  check('Custom Service Builder material row has a Supplier (if new) field', !!matSupplierField);
  await page.fill('[data-svcmat-name="0"]', 'Hedge feed pellets');
  await page.fill('[data-svcmat-amount="0"]', '1');
  await page.fill('[data-svcmat-per="0"]', '10');
  await page.fill('[data-svcmat-unit="0"]', 'bag');
  await page.fill('[data-svcmat-price="0"]', '12');
  await page.fill('[data-svcmat-supplier="0"]', 'Burston Garden Centre');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);

  await (await page.$('[data-action="setSvcWaste"][data-val="true"]')).click(); await page.waitForTimeout(150);
  const wasteSupplierField = await page.$('#svcWasteSupplier');
  check('Custom Service Builder waste-item row has a Supplier (if new) field', !!wasteSupplierField);
  await page.fill('#svcWasteName', 'Green waste tip run');
  await page.fill('#svcWasteAmount', '1');
  await page.fill('#svcWastePer', '25');
  await page.fill('#svcWasteUnit', 'run');
  await page.fill('#svcWastePrice', '40');
  await page.fill('#svcWasteSupplier', 'Local tip');
  await page.fill('#svcProductivity', '20');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="saveServiceBuilder"]')).click(); await page.waitForTimeout(300);

  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await page.waitForTimeout(200);
  await page.fill('#matFilter', 'Hedge feed pellets'); await page.waitForTimeout(200);
  const pelletsSupplier = await page.$('input[data-matsup="Hedge feed pellets"]');
  check('custom service material saved with its entered supplier', pelletsSupplier ? (await pelletsSupplier.inputValue()) === 'Burston Garden Centre' : false);
  await page.fill('#matFilter', 'Green waste tip run'); await page.waitForTimeout(200);
  const tipSupplier = await page.$('input[data-matsup="Green waste tip run"]');
  check('custom service waste item saved with its entered supplier', tipSupplier ? (await tipSupplier.inputValue()) === 'Local tip' : false);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

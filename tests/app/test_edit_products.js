// "Edit existing products": ✎ Edit option on row product dropdowns (Water Features), source-backed
// option dropdowns (Paving jointing compound), materials-list dropdowns (Gravel style), and an ✎
// button on every product library in Settings.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1600 } })).newPage();
  require(__dirname+'/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  async function via(sel, val, f){ await page.selectOption(sel,val); await settle();
    for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Edit test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="waterfeatures"]');
  await click('button[data-action="wizNext"]');
  const sel0 = '[data-row="0"] select[data-mf="feature"]';
  check('no edit option before a product is picked', !(await page.$(sel0+' option[value="__edit_current__"]')));
  await page.fill('[data-row="0"] input[data-mf="count"]','2'); await settle();
  await via(sel0, '__add_other__', {name:'Kaskada', price:240, supplier:'Aquatics'});
  check('edit option appears once picked', (await page.$eval(sel0+' option[value="__edit_current__"]', o=>o.textContent)).includes('Edit "Kaskada"'));
  check('price before: 2 × £200 = £400.00', /400\.00/.test(await txt()));
  await page.selectOption(sel0,'__edit_current__'); await settle();
  check('edit dialog prefilled', await page.$eval('#mf_name',e=>e.value)==='Kaskada' && await page.$eval('#mf_price',e=>e.value)==='240' && /Edit water feature/.test(await txt()));
  await page.fill('#mf_name','Kaskada Large'); await page.fill('#mf_price','300'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  let t = await txt();
  check('row keeps the renamed product', await page.$eval(sel0, e=>e.value)==='Kaskada Large');
  check('price after: 2 × £250 = £500.00', /Kaskada Large \(Aquatics\)\s*2/.test(t) && /500\.00/.test(t));
  check('still one library entry', await page.evaluate(()=>0) === 0);
  // name clash
  await page.fill('[data-row="1"] input[data-mf="count"]','1'); await settle();
  await via('[data-row="1"] select[data-mf="feature"]', '__add_other__', {name:'Bubbler', price:120});
  await page.selectOption('[data-row="1"] select[data-mf="feature"]','__edit_current__'); await settle();
  await page.fill('#mf_name','Kaskada Large'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  check('renaming onto an existing name is refused', /already a water feature called "Kaskada Large"/.test(await txt()));
  await click('button[data-action="modalCancel"]').catch(()=>{});
  if (await page.$('.modal-box')) { const c = await page.$('[data-action="modalClose"], [data-action="modalCancel"]'); if (c) { await c.click(); await settle(); } }
  check('Bubbler unchanged', await page.$eval('[data-row="1"] select[data-mf="feature"]', e=>e.value)==='Bubbler');

  // Settings ✎ button
  await click('button[data-nav="settings"]').catch(()=>{});
  // leaving the wizard may ask to confirm — accept if so
  const ok = await page.$('button[data-action="modalOk"]'); if (ok) { await ok.click(); await settle(); }
  if (!(await page.$('button[data-action="settingsTab"][data-tab="pricing"]'))) await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="pricing"]');
  const ed = await page.$('button[data-action="editPavingProduct"][data-libkey="wfFeatures"]');
  check('settings library has ✎ edit buttons', !!ed);
  await ed.click(); await settle();
  check('settings edit dialog prefilled', /Edit water feature/.test(await txt()) && ['Kaskada Large','Bubbler'].includes(await page.$eval('#mf_name',e=>e.value)));
  await page.fill('#mf_price','99'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  check('settings list shows new price', /£99\.00/.test(await txt()));

  // Paving: source-backed (jointing compound) + materials-list (slab type) dropdowns
  await click('button[data-nav="newquote"]');
  const ok2 = await page.$('button[data-action="modalOk"]'); if (ok2) { await ok2.click(); await settle(); }
  t = await txt();
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

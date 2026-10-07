// October 2026 Water Features rework: per-row tenant feature products (inc-VAT materials price),
// per-row dig-out with a hole-size product feeding the waste pool, pebbles per 20kg bag,
// electrics note, consumables setting, £0 blocks, and the new letter wording.
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
  async function addVia(sel, f){ await page.selectOption(sel,'__add_other__'); await settle();
    for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  const flag = (row, field, val) => click(`button[data-action="setRowFlag"][data-row="${row}"][data-field="${field}"][data-val="${val}"]`);

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  let t = await txt();
  check('Water features settings card with libraries + consumables', /Water feature products/.test(t) && /Hole sizes/.test(t) && /Pebbles \(price per 20kg bag\)/.test(t) && !!(await page.$('#st_wfConsumables')));

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Water features');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="waterfeatures"]');
  await click('button[data-action="wizNext"]');
  check('old single typed feature fields are gone', !(await page.$('[data-opt="featureName"]')) && !(await page.$('[data-opt="featurePrice"]')));
  check('each row picks its own feature', !!(await page.$('[data-row="0"] select[data-mf="feature"]')));
  await page.fill('[data-row="0"] input[data-mf="count"]','2'); await settle();
  check('blocker: pick a water feature', /Row 1: pick a water feature/.test(await txt()));
  await addVia('[data-row="0"] select[data-mf="feature"]', {name:'Kaskada', price:240, supplier:'Maidenhead Aquatics'});
  t = await txt();
  check('feature line: 2 × £200 net (inc-VAT price stripped) = £400.00', /Kaskada \(Maidenhead Aquatics\)\s*2/.test(t) && /400\.00/.test(t));
  await page.fill('[data-row="1"] input[data-mf="count"]','1'); await settle();
  await addVia('[data-row="1"] select[data-mf="feature"]', {name:'Bubbler', price:120});
  await flag(1,'digOut','true');
  await addVia('[data-row="1"] select[data-mf="holeSize"]', {name:'Small hole', lengthMm:600, widthMm:600, depthMm:400});
  await flag(1,'pebbles','true');
  check('pebble bags default to 1', await page.$eval('[data-row="1"] input[data-mf="pebbleBags"]', e=>e.value)==='1');
  await addVia('[data-row="1"] select[data-mf="pebbleProduct"]', {name:'Slate pebbles', price:6});
  await page.fill('[data-row="1"] input[data-mf="pebbleBags"]','3'); await settle();
  await flag(1,'electrics','true');
  await flag(0,'digOut','true');
  await page.selectOption('[data-row="0"] select[data-mf="holeSize"]','Small hole'); await settle();
  t = await txt();
  check('two different features on one quote', /Kaskada \(Maidenhead Aquatics\)\s*2/.test(t) && /Bubbler( \([^)]*\))?\s*1\b/.test(t));
  check('pebbles = 3 bags', t.includes('Slate pebbles3'));
  check('consumables 1', t.includes('Consumables1'));
  check('labour = 3 / 0.7 × £150 = £642.86', /642\.86/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  await click('button[data-action="wizNext"]');
  t = await txt();
  // area 0.36×2 + 0.36×1 = 1.08 m²; volume 1.08 × 0.4 = 0.432 m³
  check('waste pool fed by dug rows only: 1.08 m²', /1\.08 m²/.test(t));
  check('waste volume 0.43 m³', /0\.43 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('letter names every feature', /Holes dug and levelled to suit the bases or reservoirs of the Kaskada and Bubbler\./.test(t));
  check('letter: install line without power wording', /Features installed and plumbed in following the manufacturer's instructions\./.test(t) && !/connected to a power source/.test(t));
  check('letter: electrician note for the ticked feature only', /The Bubbler requires a power connection — a price for this will be provided separately by an independent electrician\./.test(t));
  check('letter: pebbles line', /Surrounding area dressed with pebbles to finish\./.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  // a £0 feature can't be added
  for (let i=0;i<6 && !(await page.$('[data-row="0"] select[data-mf="feature"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  await addVia('[data-row="0"] select[data-mf="feature"]', {name:'Freebie', price:0});
  check('adding a product at £0 is refused — dialog stays open and asks for the cost', !!(await page.$('#mf_name')) && /more than £0/.test(await txt()));
  await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(250);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

// October 2026 Artificial Turf rework.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1700 } })).newPage();
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
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  const v = id => page.$eval(id, e=>e.value);
  check('settings defaults', await v('#st_atBuildUp')==='25' && await v('#st_atMotRate')==='0.3' && await v('#st_atMotDepth')==='150' && await v('#st_atRoll')==='20' && await v('#st_atInfill')==='5' && await v('#st_atConsumables')==='1' && await v('#st_atEdgingProd')==='12');
  check('no turf wastage field in Settings', !(await page.$('#st_atWastage')));
  check('new tenant: no turf product seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="atTurf"]')).length===0);

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Turf');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="artificialturf"]');
  await click('button[data-action="wizNext"]');
  check('row depth defaults to 75', await page.$eval('[data-row="0"] input[data-mf="digOutDepth"]', e=>e.value)==='75');
  await page.fill('[data-row="0"] input[data-mf="desc"]','Lawn'); await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','4');
  await page.fill('[data-row="1"] input[data-mf="desc"]','Side'); await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','3');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','100'); await settle();
  let t = await txt();
  check('blockers: turf, grano, infill', /Select an artificial turf/.test(t) && /Select a grano dust/.test(t) && /Select an infill sand/.test(t));
  check('artificial turf step asks wastage for cuts, starting at 0', await page.$eval('[data-opt="wastagePct"]', e=>e.value)==='0');
  await page.fill('[data-opt="wastagePct"]','20'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await settle();
  await addVia('[data-row="0"] select[data-mf="turfType"]', {name:'AT 35mm', price:18});
  await addVia('select[data-opt="grano"]', {name:'Grano', price:50});
  await addVia('select[data-opt="infill"]', {name:'Kiln sand', price:5});
  t = await txt();
  check('MOT = ROUNDUP(20×0.3×50/150 + 6×0.3×75/150) = 3 t', t.includes('Type 1 MOT3'));
  check('turf = ROUNDUP(26 × 1.2) = 32 m²', t.includes('AT 35mm32'));
  check('grano = ROUNDUP(26/10) = 3', t.includes('Grano3'));
  check('infill = ROUNDUP(26/5) = 6', t.includes('Kiln sand6'));
  check('membrane 26, consumables 1', t.includes('Geotextile membrane26') && t.includes('Consumables1'));
  check('no edging: no concrete or tape', !t.includes('Sharp sand') && !t.includes('Ballast') && !/Cement\d/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  // edging
  await addVia('select[data-opt="edgingStyle"]', {name:'Kerb', piecesPerMetre:4, price:2});
  await page.fill('[data-opt="edgingLength"]','18'); await settle();
  check('blocker: seam tape needed with edging', /Select an adhesive seam tape/.test(await txt()));
  await addVia('select[data-opt="seamTape"]', {name:'Tape 20m', price:15});
  t = await txt();
  check('edging 72 pieces, tape 1 roll, sand 2, ballast 2, cement 24', t.includes('Kerb72') && t.includes('Tape 20m1') && t.includes('Sharp sand2') && t.includes('Ballast2') && t.includes('Cement24'));
  check('labour = (26/5 + 18/12) × £150 = £1,005.00', /1,005\.00/.test(t));
  // steel
  await page.selectOption('select[data-opt="edgingStyle"]','__steel_edging__'); await settle();
  t = await txt();
  check('steel: no edging, concrete or tape here; Steel Edging added', !t.includes('Kerb72') && !t.includes('Tape 20m1') && !t.includes('Sharp sand2') && /Step 1 of 3/.test(t));
  await page.selectOption('select[data-opt="edgingStyle"]','Kerb'); await settle();
  // surface build-up blocker
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','25'); await settle();
  check('blocker: dig-out not deeper than build-up', /dig-out depth \(25mm\) must be deeper than the 25mm surface build-up/.test(await txt()));
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','100'); await settle();
  await click('button[data-action="wizNext"]');
  t = await txt();
  check('waste: area 26.00 m², volume 2.10 m³', /26\.00 m²/.test(t) && /2\.10 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('letter: per-row dig-out and MOT depths', /excavated to approximately: Lawn 75mm, Side 100mm\./.test(t) && /MOT sub-base installed: Lawn 50mm, Side 75mm deep\./.test(t));
  check('letter: concrete edge + glued edges', /Edge restraint installed around the perimeter, set in concrete\./.test(t) && /Edges glued to the concrete edge restraint/.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  // existing business turf seed
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.atTurfSeeded; d.atTurf = []; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('existing business: "Artificial turf" £18 seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="atTurf"]')).length===1);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

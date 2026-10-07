// October 2026 Flower Beds rework.
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
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings: bag volume 0.5, mulch depth 50, consumables 1, edging productivity 12', await page.$eval('#st_fbBagVol',e=>e.value)==='0.5' && await page.$eval('#st_fbMulchDepth',e=>e.value)==='50' && await page.$eval('#st_fbConsumables',e=>e.value)==='1' && await page.$eval('#st_fbEdgingProd',e=>e.value)==='12');
  check('no compost/mulch libraries in settings', !(await page.$('[data-lib="fbCompost"]')) && !(await txt()).includes('Compost (price per bulk bag)'));
  check('waste table: Flower Beds always feeds the pool (no switch)', !(await page.$('button[data-action="toggleGeneratesSpoil"][data-key="flowerbeds"]')) && await page.$eval('input[data-digdepth="flowerbeds"]', e=>e.value)==='300');

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Beds');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="flowerbeds"]');
  await click('button[data-action="wizNext"]');
  check('row depth defaults to 300', await page.$eval('[data-row="0"] input[data-mf="digOutDepth"]', e=>e.value)==='300');
  await page.fill('[data-row="0"] input[data-mf="desc"]','Front'); await page.fill('[data-row="0"] input[data-mf="width"]','4'); await page.fill('[data-row="0"] input[data-mf="length"]','2.5');
  await page.fill('[data-row="1"] input[data-mf="desc"]','Back'); await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','1');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','450'); await settle();
  let t = await txt();
  check('no compost / mulch dropdowns', !(await page.$('select[data-opt="compost"]')) && !(await page.$('select[data-opt="mulch"]')));
  // compost = (10×(0.3−0.05) + 2×(0.45−0.05)) = 3.3 m³ ÷ 0.5 = 6.6 → 7; mulch = 12×0.05 = 0.6 ÷ 0.5 = 1.2 → 2
  check('compost = ROUNDUP(3.3/0.5) = 7 bulk bags', t.includes('Peat free compost bulk bag7'));
  check('bark mulch = ROUNDUP(0.6/0.5) = 2 bulk bags', t.includes('Bark mulch2'));
  // give them prices if they're blank (new business), via the price boxes
  for (const nm of ['Peat free compost bulk bag','Bark mulch']){
    const b2 = await page.$(`button[data-action="quickPrice"][data-name="${nm}"]`);
    if (b2){ const inp = await b2.evaluateHandle(b=>b.closest('.quick-price').querySelector('[data-qp-price]')); await inp.fill(nm.startsWith('Bark')?'99':'85'); await b2.click(); await settle(); }
  }
  t = await txt();
  check('membrane = 12 m²', t.includes('Geotextile membrane12'));
  check('consumables 1', t.includes('Consumables1'));
  check('no blockers', !/Needs attention/.test(t));
  // edging
  await addVia('select[data-opt="edgingStyle"]', {name:'Brick edge', piecesPerMetre:10, price:0.8});
  await page.fill('[data-opt="edgingLength"]','14'); await settle();
  t = await txt();
  check('edging = ROUNDUP(14 × 10) = 140', t.includes('Brick edge140'));
  check('labour = (12/6.7 + 14/12) × £150 = £443.66', /443\.66/.test(t));
  // steel handoff
  await page.selectOption('select[data-opt="edgingStyle"]','__steel_edging__'); await settle();
  t = await txt();
  check('steel: edging length hidden, no edging line, Steel Edging added', !(await page.$('[data-opt="edgingLength"]')) && !t.includes('Brick edge140') && /Step 1 of 3/.test(t));
  await page.selectOption('select[data-opt="edgingStyle"]','Brick edge'); await settle();
  check('switching back removes the empty Steel Edging', /Step 1 of 2/.test(await txt()));
  await click('button[data-action="wizNext"]');
  t = await txt();
  check('waste: area 12.00 m², volume 3.90 m³', /12\.00 m²/.test(t) && /3\.90 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('letter lists each row depth', /Bed areas dug out to: Front 300mm, Back 450mm\./.test(t));
  check('letter: membrane line + mulch + edging', /Geotextile membrane laid on top to suppress weeds until ready for planting\./.test(t) && /Topped with 50mm of bark mulch\./.test(t) && /Edging installed around the bed\./.test(t));
  for (let i=0;i<6 && !(await page.$('button[data-action="setOpt"][data-opt="plantingNow"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  await click('button[data-action="setOpt"][data-opt="plantingNow"][data-val="true"]');
  check('planting now: no membrane', !(await txt()).includes('Geotextile membrane12'));
  for (let i=0;i<5 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  check('letter: ready for immediate planting', /Flower bed ready for immediate planting\./.test(await txt()));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

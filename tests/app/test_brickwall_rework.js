// October 2026 Block Retaining Wall rework: footing rows feeding waste, baseline-scaled footing
// concrete (shared Sharp sand), rebar, concrete-block inside skin + optional face product, mortar,
// coping (slab types + coping library), blockers, settings, letter, and the tonne unit relabel.
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
  const v = id => page.$eval(id, e=>e.value).catch(()=>null);
  const settle = () => page.waitForTimeout(220);
  async function fillModal(f){ for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(!el) continue;
      if ((await el.evaluate(e=>e.tagName))==='SELECT') await el.selectOption(String(x)); else await el.fill(String(x)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250); }
  async function addVia(sel, f){ await page.selectOption(sel,'__add_other__'); await settle(); await fillModal(f); }
  async function tick(opt){ await (await page.$(`button[data-action="setOpt"][data-opt="${opt}"][data-val="true"]`)).click(); await settle(); }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await settle(); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await settle();
  const defs = {'#st_bwBaseArea':'10','#st_bwBaseDepth':'100','#st_bwBallast':'1','#st_bwSharpSand':'1','#st_bwCement':'12','#st_bwRebarLines':'2','#st_bwRebarLap':'300','#st_bwBlocksPerM2':'10','#st_bwFinishProd':'10','#st_bwConsumables':'1'};
  for (const [id,d] of Object.entries(defs)) check(`default ${id} = ${d}`, await v(id)===d);
  check('waste table: Block Retaining Wall shows per-row footing depth, no depth input', !(await page.$('input[data-digdepth="brickwall"]')));
  // Materials units relabelled to tonne
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await settle();
  let t = await txt();
  check('Pea shingle / Limestone labelled in tonnes', /Pea shingle\s*tonne/.test(t) && /Limestone 2-6mm\s*tonne/.test(t) && !/Pea shingle\s*bulk bag/.test(t));

  await (await page.$('button[data-nav="newquote"]')).click(); await settle();
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Wall rework');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="brickwall"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  check('6-column footing rows with headings', !!(await page.$('.meas-row.six')) && !!(await page.$('.meas-head')));
  check('footing width/depth prefilled 450/300', await v('[data-row="0"] input[data-mf="footingWidth"]')==='450' && await v('[data-row="0"] input[data-mf="footingDepth"]')==='300');
  check('no skins selector / old dig-out option', !(await page.$('[data-opt="skins"]')) && !(await page.$('[data-opt="digOutDepth"]')));
  await page.fill('[data-row="0"] input[data-mf="length"]','10'); await settle();
  await page.fill('[data-row="0"] input[data-mf="height"]','1'); await settle();
  check('footing length follows wall length', await v('[data-row="0"] input[data-mf="footingLength"]')==='10');
  await page.fill('[data-row="1"] input[data-mf="length"]','4'); await settle();
  await page.fill('[data-row="1"] input[data-mf="height"]','0.5');
  await page.fill('[data-row="1"] input[data-mf="footingLength"]','5');
  await page.fill('[data-row="1"] input[data-mf="footingWidth"]','600');
  await page.fill('[data-row="1"] input[data-mf="footingDepth"]','200'); await settle();
  await page.fill('[data-row="1"] input[data-mf="length"]','4'); await settle();
  check('overwritten footing length is kept', await v('[data-row="1"] input[data-mf="footingLength"]')==='5');
  t = await txt();
  // footing vol = 10×0.45×0.3 + 5×0.6×0.2 = 1.35 + 0.6 = 1.95 m³ -> scale 1.95
  check('ballast = 1.95 t', t.includes('Ballast1.95'));
  check('sharp sand (shared item) = 1.95 tonne', t.includes('Sharp sand1.95 tonne'));
  check('building sand = ROUNDUP(12/14) × 1 = 1', t.includes('Building sand1'));
  check('cement = ROUNDUP(23.4 + 6) = 30', t.includes('Cement30'));
  check('feb = ROUNDUP(1.2) = 2', t.includes('Feb2'));
  check('concrete blocks = 120', t.includes('Concrete blocks120'));
  check('pea shingle 1 tonne', t.includes('Pea shingle1 tonne'));
  check('geotextile 12', t.includes('Geotextile membrane12'));
  check('consumables 1', t.includes('Consumables1'));
  check('blocker: £0 pea shingle', /Pea shingle has no price/.test(t));

  await tick('faceSkin');
  await addVia('[data-row="0"] select[data-mf="faceType"]', {name:'Red brick face', price:1.65, facePricedPer:'piece', piecesPerM2:60, thicknessMm:102});
  t = await txt();
  check('face = ROUNDUP(12 × 60) = 720', t.includes('Red brick face720'));
  check('2 skins: building sand 2, feb 4, cement ROUNDUP(23.4+12)=36', t.includes('Building sand2') && t.includes('Feb4') && t.includes('Cement36'));
  check('wall ties 2 with face skin, £0 blocks', t.includes('Wall ties2') && /Wall ties have no price/.test(t));

  await tick('rebar');
  await addVia('select[data-opt="rebarProduct"]', {name:'A142 mesh', price:30, widthMm:2400, lengthMm:4800});
  check('rebar mesh (shared with Concrete base) = ROUNDUP(7.5 m² footing ÷ 11.52 m² sheet) = 1', (await txt()).includes('A142 mesh1'));
  check('the same mesh is in the Concrete base mesh list', await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('__mockdb__')); const k=Object.keys(s).find(k=>s[k]&&s[k].cbMesh); return !!k && s[k].cbMesh.some(m=>m.name==='A142 mesh'); }));
  check('no "Compost needed?" option', !(await page.$('[data-opt="compost"]')) && !/Compost needed/.test(await txt()));

  await tick('coping');
  await addVia('select[data-opt="copingProduct"]', {name:'Coping stone', price:20, copingPricedPer:'m2'});
  t = await txt();
  // wall length × footing width = 10×0.45 + 4×0.6 = 6.9 -> 7 m²
  check('per-m² coping = wall length × footing width = ROUNDUP(6.9) = 7', t.includes('Coping stone7'));
  // labour = (12/2.7 + 14/10) × 150 = £876.67
  check('labour includes finishing only with coping (£876.67)', /876\.67/.test(t));

  // Waste
  // set prices for pea shingle + wall ties so later preview can save
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('waste area = footing plan area 7.50 m²', /7\.50 m²/.test(t));
  check('waste volume = footing volume 1.95 m³', /1\.95 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('#quoteBlockers')); i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); }
  t = await txt();
  check('preview blocked (pea shingle / wall ties £0)', !!(await page.$('#quoteBlockers')) && !(await page.$('button[data-action="saveSentQuote"]')));
  check('letter: footing range + rebar', /footing poured 450–600mm wide by 200–300mm deep, reinforced with rebar\./.test(t));
  check('letter: concrete blocks wording', /Wall built up in concrete blocks in a staggered running bond\./.test(t) && !/100 x 400 x 200mm/.test(t));
  check('letter: face, coping lines', /Wall faced in Red brick face\./.test(t) && /Finished with coping along the top\./.test(t));
  check('letter: no compost line', !/compost on completion/.test(t));

  // Price pea shingle and wall ties, then the quote can be saved
  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="materials"]')).click(); await settle();
  await page.fill('input[data-mat="Pea shingle"]','45'); await page.fill('input[data-mat="Wall ties"]','12');
  await (await page.$('button[data-action="saveMaterialsForm"]')).click(); await settle();
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('after pricing, no blockers on the review page', !(await page.$('#quoteBlockers')) && !!(await page.$('button[data-action="saveSentQuote"]')));

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

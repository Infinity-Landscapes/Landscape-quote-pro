// October 2026 Gravel rework: per-row dig-out, tenant gravel per tonne, gravel/MOT depth formulas
// rounded once on totals, blockers, tenant edging styles vs Steel edging hand-off, no welder,
// letter figures, Block edging seed for the existing business only.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
  require(__dirname+'/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const v = id => page.$eval(id, e=>e.value).catch(()=>null);
  const settle = () => page.waitForTimeout(220);
  async function fillModal(f){ for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250); }
  async function login(){ const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await settle(); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await settle();
  const defs = {'#st_gravelCoverage':'10','#st_gravelBaseDepth':'50','#st_gravelMotCoverage':'5','#st_gravelMotDepth':'100','#st_gravelConsumables':'1','#st_gravelEdgingProd':'12'};
  for (const [id,d] of Object.entries(defs)) check(`default ${id} = ${d}`, await v(id)===d);
  check('new tenant has no seeded edging style', (await page.$$('button[data-action="removePavingProduct"][data-libkey="gravelEdgingStyles"]')).length===0);

  await (await page.$('button[data-nav="newquote"]')).click(); await settle();
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Gravel rework');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  check('4-column rows with dig-out depth prefilled 150', !!(await page.$('.meas-row.four')) && await v('[data-row="0"] input[data-mf="digOutDepth"]')==='150');
  check('no job-level dig-out option', !(await page.$('[data-opt="digOutDepth"]')));
  check('gravel depth defaults to 50', await v('[data-opt="gravelDepth"]')==='50');
  const styleOpts = await page.$$eval('select[data-opt="style"] option', els=>els.map(e=>e.textContent));
  check('no built-in gravel styles', !styleOpts.some(o=>/Cotswold|Shingle|Cobbles/.test(o)));
  await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','4');
  await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','5');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','200'); await settle();
  check('blocker: select a gravel type', /Select a gravel type/.test(await txt()));
  await page.selectOption('select[data-opt="style"]','__add_other__'); await settle();
  check('add-gravel dialog asks for price per tonne', /Price per tonne/.test(await txt()));
  await page.fill('#modalMatName','Test gravel'); await page.fill('#modalMatPrice','60');
  await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  let t = await txt();
  check('gravel = ROUNDUP(30/10) = 3 tonnes', t.includes('Test gravel3'));
  check('MOT = 20/5×1 + 10/5×1.5 = 7', t.includes('Type 1 MOT7'));
  check('geotextile = 2 × 30 = 60', t.includes('Geotextile membrane60'));
  check('consumables 1', t.includes('Consumables1'));
  check('no welder in gravel', !/Welder/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  await page.fill('[data-opt="gravelDepth"]','40'); await settle();
  t = await txt();
  check('gravel at 40mm = ROUNDUP(2.4) = 3', t.includes('Test gravel3'));
  check('MOT rounded once on total: 4.4 + 3.2 = 7.6 -> 8 (not 5+4)', t.includes('Type 1 MOT8'));
  await page.fill('[data-opt="gravelDepth"]','150'); await settle();
  check('blocker: gravel depth >= a row dig-out depth', /Gravel depth \(150mm\) must be less than every row's dig-out depth/.test(await txt()));
  await page.fill('[data-opt="gravelDepth"]','50'); await settle();

  // Tenant edging style
  await (await page.$('button[data-action="setOpt"][data-opt="edging"][data-val="true"]')).click(); await settle();
  const eOpts = await page.$$eval('select[data-opt="edgingStyle"] option', els=>els.map(e=>e.textContent));
  check('edging dropdown offers Steel edging and + Add new', eOpts.includes('Steel edging') && eOpts.includes('+ Add new…'));
  check('no Metal/Block edging type dropdown', !(await page.$('[data-opt="edgingType"]')));
  check('edging length blank by default', await v('[data-opt="edgingLength"]')==='');
  await page.selectOption('select[data-opt="edgingStyle"]','__add_other__'); await settle();
  await fillModal({name:'Kerb', piecesPerMetre:4, price:2});
  check('blocker: enter the edging length', /Enter the edging length/.test(await txt()));
  await page.fill('[data-opt="edgingLength"]','10'); await settle();
  t = await txt();
  check('edging = ROUNDUP(10 × 4) = 40', t.includes('Kerb40'));
  // labour = (30/16.7 + 10/12) × £150 = £394.46
  check('labour includes edging time (£394.46)', /394\.46/.test(t));

  // Steel edging hand-off
  await page.selectOption('select[data-opt="edgingStyle"]','__steel_edging__'); await settle();
  t = await txt();
  check('steel: edging length + edging productivity hidden', !(await page.$('[data-opt="edgingLength"]')) && !(await page.$('[data-opt="edgingProductivity"]')));
  check('steel: no edging line priced in gravel', !t.includes('Kerb40'));
  check('steel: labour back to laying only (30/16.7 × £150 = £269.46)', /269\.46/.test(t));
  check('steel: page counter now shows a second service', /Step 1 of 3/.test(t));
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  check('next page is the Steel Edging service', /Steel Edging/.test(await txt()) && !!(await page.$('[data-opt="steelProduct"]')));
  await (await page.$('button[data-action="wizBack"]')).click(); await page.waitForTimeout(300);
  await page.selectOption('select[data-opt="edgingStyle"]','Kerb'); await settle();
  check('switching back removes the empty auto-added Steel Edging', /Step 1 of 2/.test(await txt()));

  // Waste + letter
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('waste area 30.00 m²', /30\.00 m²/.test(t));
  check('waste volume 20×0.15 + 10×0.2 = 5.00 m³', /5\.00 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); }
  t = await txt();
  check('letter: dig-out range', /Area excavated to depths of 150–200mm and the subsoil compacted\./.test(t));
  check('letter: MOT range', /A 100–150mm compacted Type 1 MOT sub-base installed\./.test(t));
  check('letter: gravel depth + name', /Finished with 50mm of Test gravel\./.test(t));
  check('letter: edge restraints shown with edging', /Edge restraints installed around the perimeter/.test(t));
  check('letter: both geotextile lines kept', /Geotextile membrane laid to the excavation/.test(t) && /second geotextile membrane laid over the sub-base/.test(t));

  // Existing-business seed
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.gravelEdgingSeeded; delete d.gravelEdgingStyles; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await settle();
  const seeded = await page.$$('button[data-action="removePavingProduct"][data-libkey="gravelEdgingStyles"]');
  t = await txt();
  check('existing business gets Block edging (20/m, £1)', seeded.length===1 && /Block edging/.test(t) && /20\/m/.test(t));

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

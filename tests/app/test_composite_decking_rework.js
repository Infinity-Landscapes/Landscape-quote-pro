// October 2026 Composite Decking rework: per-row mm formulas, tenant-defined boards/screws/
// fascia, conditional per-row dig-out depth, blockers, editable settings, 6dp rounding.
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
  let pass = true;
  const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  async function fillModal(f){ for (const [k,v] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(v)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250); }
  async function addVia(sel, fields){ await page.selectOption(sel,'__add_other__'); await page.waitForTimeout(200); await fillModal(fields); }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);
  // Oct 2026: £0 materials now block every service — price the two £0-by-default composite items.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ d.materials['Composite posts'].price = 20; d.materials['Composite joists'].price = 15; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  // Settings defaults + new tenant has no seeded screw
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const v = id => page.$eval(id, e=>e.value).catch(()=>null);
  const defs = {'#st_compBoardGap':'5','#st_compJoistLength':'3000','#st_compJoistCentres':'400','#st_compNoggin':'1000','#st_compPostsPerM2':'1','#st_compPostStock':'2400','#st_compInGround':'600','#st_compPostcrete':'2','#st_compScrewsCrossing':'2','#st_compConsumables':'1'};
  for (const [id,d] of Object.entries(defs)) check(`default ${id} = ${d}`, await v(id)===d);
  check('new tenant has no seeded decking screw', !/Decking screws\s*£?6\.99/.test(await txt()) && (await page.$$('[data-libkey="compositeDeckScrews"][data-action="removePavingProduct"]')).length===0);

  // Quote
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Composite rework');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="compositedecking"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  check('no tier dropdown any more', !(await page.$('select[data-opt="tier"]')));
  check('no job-level dig-out depth / fascia count inputs', !(await page.$('[data-opt="digOutDepth"]')) && !(await page.$('[data-opt="fasciaCount"]')));
  check('deck height defaults to 300', await v('[data-opt="deckHeight"]')==='300');
  check('3-column rows while dig out unticked', !!(await page.$('.meas-row:not(.four)')) && !(await page.$('input[data-mf="digOutDepth"]')));
  await page.fill('[data-row="0"] input[data-mf="width"]','3'); await page.fill('[data-row="0"] input[data-mf="length"]','6');
  await page.fill('[data-row="1"] input[data-mf="width"]','3'); await page.fill('[data-row="1"] input[data-mf="length"]','1.2');
  await page.waitForTimeout(200);
  let t = await txt();
  check('blocker: select a deck board', /Select a deck board for Composite Decking/.test(t));
  check('blocker: select a decking screw', /Select a decking screw product/.test(t));

  await addVia('[data-row="0"] select[data-mf="boardType"]', {name:'Test board', price:20, lengthMm:3600, widthMm:140});
  check('screw add dialog prefills 100 screws per box', (await (async()=>{ await page.selectOption('select[data-opt="screws"]','__add_other__'); await page.waitForTimeout(200); return v('#mf_screwsPerBox'); })())==='100');
  await fillModal({name:'Screws', price:6.99});
  t = await txt();
  // Row0 3m x 6m: boards 2*21=42; joists 16+4=20; noggins 5. Row1 3m x 1.2m (1.2/0.4 must be 3, not 4):
  // boards 1*21=21; joists 4+2=6; noggins 1. Totals: boards 63, joists 32.
  check('boards per row summed = 63', t.includes('Test board63'));
  check('joists incl. noggin joists = 32 (1.2÷0.4 stays 3)', t.includes('Composite joists32'));
  // Posts 18 + ru(3.6)=4 = 22; cut 900 -> 2 per stock post -> 11
  check('stock posts = ROUNDUP(22 ÷ 2) = 11', t.includes('Composite posts11'));
  check('postcrete = 22 posts × 2 bags = 44', t.includes('Postcrete44'));
  // Screws 2*21*16=672 + 2*21*4=168 = 840 -> 9 boxes
  check('screw boxes = ROUNDUP(840 ÷ 100) = 9', t.includes('Screws9'));
  check('geotextile = area 21.6', t.includes('Geotextile membrane21.6'));
  check('consumables 1', t.includes('Consumables1'));
  check('no blockers left', !/Needs attention/.test(t));

  // Post too short
  await page.fill('[data-opt="deckHeight"]','2000'); await page.waitForTimeout(200);
  check('blocker: deck height needs longer post', /Deck height needs a longer post than the stock length/.test(await txt()));
  await page.fill('[data-opt="deckHeight"]','300'); await page.waitForTimeout(200);

  // Fascia
  await (await page.$('button[data-action="setOpt"][data-opt="fascia"][data-val="true"]')).click(); await page.waitForTimeout(200);
  check('fascia run input present, no count', !!(await page.$('[data-opt="fasciaRun"]')));
  await page.fill('[data-opt="fasciaRun"]','10'); await page.waitForTimeout(150);
  await addVia('select[data-opt="fasciaBoard"]', {name:'Fascia X', price:15, lengthMm:2400, widthMm:150});
  t = await txt();
  check('fascia qty = ROUNDUP(10m ÷ 2400) × ROUNDUP(300 ÷ 150) = 10', t.includes('Fascia X10'));

  // Dig out -> per-row depth column
  await (await page.$('button[data-action="setOpt"][data-opt="digOut"][data-val="true"]')).click(); await page.waitForTimeout(250);
  check('rows gain a dig-out depth column prefilled 150', (await page.$$('input[data-mf="digOutDepth"]')).length===(await page.$$('div[data-row]')).length && await v('[data-row="0"] input[data-mf="digOutDepth"]')==='150');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','250'); await page.waitForTimeout(200);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('waste pool area 21.60 m²', /21\.60 m²/.test(t));
  check('waste pool volume = 18×0.15 + 3.6×0.25 = 3.60 m³', /3\.60 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('#quoteBlockers, .letter, [data-action="saveDraftQuote"]')); i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); }
  t = await txt();
  check('preview letter uses the selected board name', /Test board laid with a slight fall away from buildings/.test(t));
  check('preview letter has the fascia line', /Fascia X fitted around the deck edge \(10m run\)/.test(t));
  check('dig-out line retained', /Ground dug out beneath the deck/.test(t));
  check('save buttons present when nothing blocks', !!(await page.$('button[data-action="saveSentQuote"]')));

  // Settings change takes effect: board gap 10 -> row0 boards 2*ru(3000/150)=40, row1 20 -> 60
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await page.fill('#st_compBoardGap','10'); await page.fill('#st_compConsumables','3');
  await (await page.$('button[data-action="saveSettingsForm"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  for (let i=0;i<8 && !(await page.$('[data-row="0"] input[data-mf="width"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await page.waitForTimeout(250); }
  t = await txt();
  check('board gap 10 -> boards 60', t.includes('Test board60'));
  check('consumables quantity 3', t.includes('Consumables3'));

  // a £0 board can't be added
  await page.selectOption('[data-row="0"] select[data-mf="boardType"]','__add_other__'); await page.waitForTimeout(200);
  await fillModal({name:'Free board', price:0, lengthMm:3600, widthMm:140});
  check('adding a product at £0 is refused — dialog stays open and asks for the cost', !!(await page.$('#mf_name')) && /more than £0/.test(await txt()));
  await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(250);

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

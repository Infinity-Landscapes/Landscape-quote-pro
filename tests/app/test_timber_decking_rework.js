// October 2026 Timber Decking rework — per-row mm formulas, tenant boards/joists, shared screws,
// sleeves per post, blockers, conditional dig-out column, seeding for the existing business only.
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
  async function fillModal(f){ for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250); }
  async function addVia(sel, f){ await page.selectOption(sel,'__add_other__'); await page.waitForTimeout(200); await fillModal(f); }
  async function login(){ const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const defs = {'#st_timCentres':'400','#st_timPostsPerM2':'1','#st_timPostStock':'2400','#st_timPostcrete':'2','#st_timScrewsCrossing':'2','#st_timConsumables':'1'};
  for (const [id,d] of Object.entries(defs)) check(`default ${id} = ${d}`, await v(id)===d);
  check('new tenant has no seeded joist', (await page.$$('button[data-action="removePavingProduct"][data-libkey="timberJoists"]')).length===0);

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Timber rework');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="timberdecking"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  check('no job-level dig-out depth option', !(await page.$('[data-opt="digOutDepth"]')));
  check('deck height defaults to 300', await v('[data-opt="deckHeight"]')==='300');
  await page.fill('[data-row="0"] input[data-mf="width"]','3'); await page.fill('[data-row="0"] input[data-mf="length"]','6');
  await page.fill('[data-row="1"] input[data-mf="width"]','3'); await page.fill('[data-row="1"] input[data-mf="length"]','1.2');
  await page.waitForTimeout(200);
  let t = await txt();
  check('blocker: select a deck board', /Select a deck board for Timber Decking/.test(t));
  check('blocker: select a joist', /Select a joist for Timber Decking/.test(t));
  check('blocker: select a decking screw', /Select a decking screw product/.test(t));
  check('old hardcoded board product is gone', !/3\.6m x 120mm/.test(t));

  await addVia('[data-row="0"] select[data-mf="boardType"]', {name:'Test board', price:20, lengthMm:3600, widthMm:140});
  await addVia('select[data-opt="joist"]', {name:'Test joist', price:10, lengthMm:3000});
  await page.selectOption('select[data-opt="screws"]','__add_other__'); await page.waitForTimeout(200);
  check('screw dialog prefills 100 per box', await v('#mf_screwsPerBox')==='100');
  await fillModal({name:'Screws', price:6.99});
  t = await txt();
  check('boards = 63', t.includes('Test board63'));
  check('joists incl. noggin joists = 32', t.includes('Test joist32'));
  check('stock posts = ROUNDUP(22 ÷ 2) = 11', t.includes('100x100mm Treated timber post11'));
  check('sleeves = total posts 22 (not stock posts)', t.includes('Post saver sleeve22'));
  check('postcrete = 22 × 2 = 44', t.includes('Postcrete44'));
  check('screw boxes = 9', t.includes('Screws9'));
  check('geotextile 21.6', t.includes('Geotextile membrane21.6'));
  check('consumables 1', t.includes('Consumables1'));
  check('no blockers', !/Needs attention/.test(t));
  // joist pricing: 32 pieces at £10 inc VAT -> net £8.333 -> £266.67
  check('joists priced per piece (32 × £8.33 net = £266.67)', /266\.67/.test(t));

  await page.fill('[data-opt="deckHeight"]','2000'); await page.waitForTimeout(200);
  check('blocker: deck height needs a longer post', /Deck height needs a longer post than the stock length/.test(await txt()));
  await page.fill('[data-opt="deckHeight"]','300'); await page.waitForTimeout(200);

  await (await page.$('button[data-action="setOpt"][data-opt="digOut"][data-val="true"]')).click(); await page.waitForTimeout(250);
  check('rows gain dig-out depth column prefilled 150', (await page.$$('input[data-mf="digOutDepth"]')).length===(await page.$$('div[data-row]')).length && await v('[data-row="0"] input[data-mf="digOutDepth"]')==='150');
  await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','250'); await page.waitForTimeout(200);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('waste pool area 21.60 m²', /21\.60 m²/.test(t));
  check('waste pool volume 3.60 m³', /3\.60 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); }
  t = await txt();
  check('letter keeps posts/post-saver/frame/noggin/dig-out wording', /Posts treated with a post-saver sleeve/.test(t) && /one per square metre, straight into the ground with postcrete/.test(t) && /internal joists fixed at 400mm centres and noggins/.test(t) && /Ground dug out beneath the deck/.test(t));
  check('letter board line carries the board name', /Deck boards \(Test board\) laid with a consistent gap/.test(t));
  check('save buttons present', !!(await page.$('button[data-action="saveSentQuote"]')));

  // Settings take effect; a £0 joist can't be added
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await page.fill('#st_timPostcrete','3'); await page.fill('#st_timConsumables','2');
  await (await page.$('button[data-action="saveSettingsForm"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  for (let i=0;i<8 && !(await page.$('[data-row="0"] input[data-mf="width"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await page.waitForTimeout(250); }
  t = await txt();
  check('postcrete bags 3 per post -> 66', t.includes('Postcrete66'));
  check('consumables quantity 2', t.includes('Consumables2'));
  await page.selectOption('select[data-opt="joist"]','__add_other__'); await page.waitForTimeout(200);
  await fillModal({name:'Free joist', price:0, lengthMm:3000});
  check('adding a product at £0 is refused — dialog stays open and asks for the cost', !!(await page.$('#mf_name')) && /more than £0/.test(await txt()));
  await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(250);

  // Existing-business joist seed, once only
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.timberJoistsSeeded; delete d.timberJoists; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  let btns = await page.$$('button[data-action="removePavingProduct"][data-libkey="timberJoists"]');
  t = await txt();
  check('existing business gets one seeded joist (6x2 treated timber, 3000mm, £27.71)', btns.length===1 && /6x2 treated timber/.test(t) && /£27\.71/.test(t) && /3000mm long/.test(t));
  await btns[0].click(); await page.waitForTimeout(250);
  await page.reload(); await page.waitForTimeout(500); await login();
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  check('deleted joist not re-seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="timberJoists"]')).length===0);

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

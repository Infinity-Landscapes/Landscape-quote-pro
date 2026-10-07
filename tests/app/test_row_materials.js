// Each measurement area picks its own main material: gravel type, slab type, block style,
// artificial turf, deck board, sleeper, block-wall face skin, steel edging. Mixed types get one
// material line each, worked out from just their own areas; everything else (sub-base, sand,
// labour…) is unchanged. The letter names which type goes where. Old quotes (one type for the
// whole job) still price the same.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1200,height:1000} })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,calcWithRowChoices,priceSection,sectionCopy,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_rowmat_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  await page.goto('file://'+__dirname+'/_rowmat_exposed.html'); await wait(400);
  await page.fill('#f_name','Row Materials Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await wait(400);

  // Seed products the calcs can use.
  await page.evaluate(()=>{
    const s = window.__T.S().settings;
    const mat = (n,u)=>{ s.materials[n] = {unit:u, section:'x', price:40, supplier:'', vatIncluded:false}; };
    ['Golden gravel','Slate chips'].forEach(n=>mat(n,'tonne')); ['Porcelain grey','Indian sandstone'].forEach(n=>mat(n,'m²')); ['Charcoal block','Brindle block'].forEach(n=>mat(n,'m²'));
    s.customStyleOptions = Object.assign({}, s.customStyleOptions, {gravel:['Golden gravel','Slate chips'], paving:['Porcelain grey','Indian sandstone'], block:['Charcoal block','Brindle block']});
    s.atTurf = [{id:'t1',name:'Lush 40mm',price:20,vatIncluded:false},{id:'t2',name:'Play 25mm',price:15,vatIncluded:false}];
    s.compositeDeckBoards = [{id:'b1',name:'Grey board',price:30,lengthMm:3600,widthMm:140,vatIncluded:false},{id:'b2',name:'Oak board',price:35,lengthMm:4800,widthMm:140,vatIncluded:false}];
    s.sleeperProducts = [{id:'s1',name:'Oak sleeper',price:50,lengthMm:2400,heightMm:200,vatIncluded:false},{id:'s2',name:'Green sleeper',price:30,lengthMm:2400,heightMm:200,vatIncluded:false}];
    s.steelEdgingProducts = [{id:'e1',name:'Corten 100',priceM:12,vatIncluded:false},{id:'e2',name:'Black 150',priceM:15,vatIncluded:false}];
  });
  const run = (key, rows, opt) => page.evaluate(([key, rows, opt])=>{
    const T = window.__T, s = T.S().settings, ctx = T.ctxFor(s, 2), def = T.SERVICES[key];
    const options = {}; (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key] = o.default; }); Object.assign(options, opt||{});
    const r = T.calcWithRowChoices(def, rows, options, ctx);
    const sec = T.priceSection(key, rows, options, ctx, []);
    return { mats: Object.fromEntries(r.materials.filter(m=>m[0]).map(m=>[m[0], m[1]])), blockers: r.blockers||[], area: r.area, personDays: r.personDays, letter: T.sectionCopy(sec).join(' | ') };
  }, [key, rows, opt]);

  // ---- Paving: slab per area ----
  const pavA = await run('paving', [{desc:'Patio',width:10,length:5,slabType:'Porcelain grey'},{desc:'Path',width:2,length:10,slabType:'Indian sandstone'}], {});
  const pavOne = await run('paving', [{desc:'Patio',width:10,length:5},{desc:'Path',width:2,length:10}], {style:'Porcelain grey'});
  check('paving: two slab lines, each with its own 10% wastage (50→55, 20→22)', pavA.mats['Porcelain grey']===55 && pavA.mats['Indian sandstone']===22);
  check('paving: everything else matches the single-type job (MOT, sand, cement, membrane)', ['Type 1 MOT','Sharp sand','Cement','Geotextile membrane','Paving primer'].every(n=>pavA.mats[n]===pavOne.mats[n]));
  check('paving: same labour as one type', Math.abs(pavA.personDays-pavOne.personDays)<1e-9);
  check('paving: letter says which slab goes where', /Porcelain grey \(Patio\) and Indian sandstone \(Path\)/.test(pavA.letter));
  check('paving: old single-type quote unchanged (77 m² of Porcelain grey)', pavOne.mats['Porcelain grey']===77 && !('Indian sandstone' in pavOne.mats));
  const pavMissing = await run('paving', [{desc:'Patio',width:10,length:5,slabType:'Porcelain grey'},{desc:'Path',width:2,length:10}], {});
  check('paving: an area with no slab chosen blocks the quote', pavMissing.blockers.some(b=>/slab type for every line \(Path\)/.test(b)));
  // ---- Block paving ----
  const blk = await run('blockpaving', [{desc:'Drive',width:10,length:6,digOutDepth:250,blockType:'Charcoal block'},{desc:'Edge',width:1,length:10,digOutDepth:250,blockType:'Brindle block'}], {});
  check('block paving: a line per block style', blk.mats['Charcoal block']>0 && blk.mats['Brindle block']>0 && Math.abs(blk.mats['Charcoal block']-60*1.1)<0.01 && Math.abs(blk.mats['Brindle block']-11)<0.01);
  // ---- Gravel (own calc) ----
  const gr = await run('gravel', [{desc:'Drive',width:10,length:10,digOutDepth:150,gravelType:'Golden gravel'},{desc:'Border',width:2,length:5,digOutDepth:150,gravelType:'Slate chips'}], {gravelDepth:50});
  check('gravel: 100 m² golden = 10 t, 10 m² slate = 1 t', gr.mats['Golden gravel']===10 && gr.mats['Slate chips']===1);
  check('gravel: letter names each area\'s gravel', /Drive in Golden gravel, Border in Slate chips/.test(gr.letter));
  const grOld = await run('gravel', [{desc:'Drive',width:10,length:10,digOutDepth:150}], {gravelDepth:50, style:'Golden gravel'});
  check('gravel: old one-type quote still prices (10 t)', grOld.mats['Golden gravel']===10 && /Finished with 50mm of Golden gravel\./.test(grOld.letter));
  // ---- Artificial turf ----
  const at = await run('artificialturf', [{desc:'Lawn',width:10,length:4,digOutDepth:100,turfType:'Lush 40mm'},{desc:'Play',width:5,length:4,digOutDepth:100,turfType:'Play 25mm'}], {});
  check('artificial turf: a line per turf', at.mats['Lush 40mm']>=40 && at.mats['Play 25mm']>=20);
  // ---- Composite decking: each board's count equals that area priced alone ----
  const dk = await run('compositedecking', [{desc:'Main',width:4,length:3,boardType:'Grey board'},{desc:'Step',width:2,length:1,boardType:'Oak board'}], {});
  const dk1 = await run('compositedecking', [{desc:'Main',width:4,length:3}], {board:'Grey board'});
  const dk2 = await run('compositedecking', [{desc:'Step',width:2,length:1}], {board:'Oak board'});
  check('decking: each board quantity = its own area priced alone', dk.mats['Grey board']===dk1.mats['Grey board'] && dk.mats['Oak board']===dk2.mats['Oak board'] && dk.mats['Grey board']>0);
  // ---- Sleeper wall ----
  const sw = await run('sleeperwall', [{desc:'Back',length:4.8,height:0.6,sleeperType:'Oak sleeper'},{desc:'Side',length:2.4,height:0.4,sleeperType:'Green sleeper'}], {});
  check('sleeper wall: a line per sleeper', sw.mats['Oak sleeper']>0 && sw.mats['Green sleeper']>0);
  // ---- Steel edging ----
  const st = await run('steeledging', [{desc:'Bed',length:12,steelType:'Corten 100'},{desc:'Path',length:8,steelType:'Black 150'}], {});
  check('steel edging: 12 m Corten + 8 m Black', st.mats['Corten 100']===12 && st.mats['Black 150']===8);

  // ---- In the wizard: gravel and paving rows show their own dropdown ----
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Rows UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="paving"]'); await wait(120);
  await page.click('button[data-action="wizNext"]'); await wait(200);
  check('paving row has its own Slab type dropdown', !!(await page.$('[data-row="0"] select[data-mf="slabType"]')));
  check('the job-level Slab type dropdown is gone', !(await page.$('select[data-opt="style"]')));
  check('column heading "Slab type" shown', /Slab type/.test(await page.$eval('.meas-head', e=>e.innerText).catch(()=> '')));
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','5');
  await page.selectOption('[data-row="0"] select[data-mf="slabType"]','Indian sandstone'); await wait(250);
  await page.click('[data-action="addMeasRow"]'); await wait(250);
  check('a new line starts with the slab of the line above', await page.$eval('[data-row="1"] select[data-mf="slabType"]', e=>e.value) === 'Indian sandstone');
  await page.selectOption('[data-row="1"] select[data-mf="slabType"]','Porcelain grey'); await wait(250);
  await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','10'); await wait(300);
  const t = await page.$eval('#app', e=>e.innerText);
  check('materials panel lists both slabs (55 and 22)', /Indian sandstone\s+55\b/.test(t) && /Porcelain grey\s+22\b/.test(t));
  await page.screenshot({path:__dirname+'/row_materials_paving.png'});

  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

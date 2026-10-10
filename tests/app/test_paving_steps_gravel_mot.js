// (1) Gravel: an area dug out only as deep as the gravel needs no Type 1 MOT (and only one
// membrane); the letter only mentions MOT where there is some. (2) Paving: "Steps?" — each line is
// width × depth (tread) and height (mm) × how many; risers priced like a Block Retaining Wall in
// concrete blocks (length = width + 2 × depth, × height); the tread area is paved and added to the
// paving m² (not dug out: no extra MOT, membrane or waste); never double-counted with per-area slabs.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,calcWithRowChoices,priceSection,sectionCopy,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_steps_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  await page.goto('file:///tmp/mobiletest/_steps_exposed.html'); await wait(400);
  await page.fill('#f_name','Steps Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234'); await page.click('button[data-action="setupNext"]'); await wait(400);
  await page.evaluate(()=>{ const s = window.__T.S().settings;
    ['Golden gravel'].forEach(n=>{ s.materials[n] = {unit:'tonne', section:'x', price:40, supplier:'x', vatIncluded:false}; });
    ['Porcelain grey','Indian sandstone'].forEach(n=>{ s.materials[n] = {unit:'m²', section:'x', price:40, supplier:'x', vatIncluded:false}; });
    s.customStyleOptions = Object.assign({}, s.customStyleOptions, {gravel:['Golden gravel'], paving:['Porcelain grey','Indian sandstone']});
    s.pavingJointingCompounds = [{id:'j', name:'Test Joint', price:20, coverage:10, vatIncluded:false}];
    s.materials['Concrete blocks'].price = s.materials['Concrete blocks'].price || 2;
  });
  const run = (key, rows, opt) => page.evaluate(([key, rows, opt])=>{
    const T = window.__T, s = T.S().settings, ctx = T.ctxFor(s, 2), def = T.SERVICES[key];
    const options = {}; (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key] = o.default; }); Object.assign(options, opt||{});
    const r = T.calcWithRowChoices(def, rows, options, ctx);
    const sec = T.priceSection(key, rows, options, ctx, []);
    const m = {}; r.materials.filter(x=>x[0]).forEach(x=>{ m[x[0]] = (m[x[0]]||0) + x[1]; });
    return { m, blockers: r.blockers||[], area: r.area, wasteArea: r.wasteArea, personDays: r.personDays, days: r.days, kf: r.keyFigures, letter: T.sectionCopy(sec).join(' | '), secArea: sec.area,
      secMats: Object.fromEntries(sec.materials.map(x=>[x.name, x.qty])) };
  }, [key, rows, opt]);
  const near = (a,b) => Math.abs(a-b) < 1e-6;

  // ---------- Gravel ----------
  let g = await run('gravel', [{desc:'Path',width:10,length:1,digOutDepth:50,gravelType:'Golden gravel'}], {gravelDepth:50});
  check('gravel: dug out to the gravel depth → no Type 1 MOT', !g.m['Type 1 MOT']);
  check('gravel: …only one membrane (10 m²)', g.m['Geotextile membrane']===10);
  check('gravel: …no blocker', !g.blockers.some(b=>/Gravel depth/.test(b)));
  check('gravel: …letter has no MOT or second membrane', !/Type 1 MOT/.test(g.letter) && !/second geotextile/.test(g.letter));
  g = await run('gravel', [{desc:'Path',width:10,length:1,digOutDepth:50,gravelType:'Golden gravel'},{desc:'Drive',width:10,length:5,digOutDepth:150,gravelType:'Golden gravel'}], {gravelDepth:50});
  check('gravel: mixed — MOT only for the drive (50 m² at 100mm = 10 t)', g.m['Type 1 MOT']===10);
  check('gravel: mixed — membrane 10 + 2 × 50 = 110 m²', g.m['Geotextile membrane']===110);
  check('gravel: mixed — letter names where the MOT goes', /100mm compacted Type 1 MOT sub-base installed \(Drive\)/.test(g.letter));
  g = await run('gravel', [{desc:'Path',width:10,length:1,digOutDepth:40,gravelType:'Golden gravel'}], {gravelDepth:50});
  check('gravel: gravel deeper than the dig-out still blocks', g.blockers.some(b=>/can't be more than a row's dig-out depth/.test(b)));
  g = await run('gravel', [{desc:'Drive',width:10,length:5,digOutDepth:150,gravelType:'Golden gravel'}], {gravelDepth:50});
  check('gravel: normal dig-out unchanged (10 t MOT, 100 m² membrane, letter as before)', g.m['Type 1 MOT']===10 && g.m['Geotextile membrane']===100 && /A 100mm compacted Type 1 MOT sub-base installed\./.test(g.letter));

  // ---------- Paving steps ----------
  const pv = {style:'Porcelain grey', jointingCompound:'Test Joint', digOutDepth:150, productivity:6};
  const base = await run('paving', [{desc:'Patio',width:10,length:5}], pv);
  const st = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {steps:true, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]}));
  check('steps: tread 2 × 0.4 × 3 = 2.4 m² added to the paving area (52.4)', near(st.area, 52.4) && near(st.secArea, 52.4));
  check('steps: slabs 50 + 2.4 = 52.4 m²', near(st.m['Porcelain grey'], 52.4));
  check('steps: risers (2 + 0.4 + 0.4) × 0.15 × 3 = 1.26 m² → 13 concrete blocks at 10/m²', st.m['Concrete blocks']===13);
  check('steps: riser mortar — 1 building sand, 1 Feb', st.m['Building sand']===1 && st.m['Feb']===1);
  check('steps: cement = paving 30 + treads 2 + riser mortar 6 = 38', st.m['Cement']===38 && base.m['Cement']===30);
  check('steps: sharp sand 5 + 1 = 6, primer and jointing go up too', st.m['Sharp sand']===6 && st.m['Paving primer']>=base.m['Paving primer'] && st.m['Test Joint']===base.m['Test Joint']+1);
  check('steps: no extra Type 1 MOT or membrane (treads aren\'t dug out)', st.m['Type 1 MOT']===base.m['Type 1 MOT'] && st.m['Geotextile membrane']===base.m['Geotextile membrane']);
  check('steps: waste removal still from the dug-out 50 m² only', st.wasteArea===50);
  check('steps: labour adds tread laying + riser building (2.4/6 + 1.26/2.7)', near(st.personDays - base.personDays, 2.4/6 + 1.26/2.7));
  check('steps: key figures show the steps', JSON.stringify(st.kf).includes('"Steps","3 (2.40 m² of treads)"'));
  check('steps: letter says 3 steps with block risers', /3 steps built with concrete block risers set in mortar, with treads finished in the same paving to match\./.test(st.letter));
  const two = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {steps:true, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3},{width:1, depth:0.3, heightMm:170, qty:2}]}));
  check('steps: a second line with other dimensions adds on (tread 2.4 + 0.6 = 3.0 m²)', near(two.area, 53) && near(two.m['Porcelain grey'], 53));
  // per-area slabs: steps counted once, on the first area's slab
  const mix = await run('paving', [{desc:'Patio',width:10,length:5,slabType:'Porcelain grey'},{desc:'Path',width:2,length:10,slabType:'Indian sandstone'}], Object.assign({}, pv, {style:'', steps:true, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]}));
  check('steps with two slab types: treads on the first area\'s slab only (52.4 + 20)', near(mix.m['Porcelain grey'], 52.4) && near(mix.m['Indian sandstone'], 20) && mix.m['Concrete blocks']===13);
  const mix2 = await run('paving', [{desc:'Patio',width:10,length:5,slabType:'Porcelain grey'},{desc:'Path',width:2,length:10,slabType:'Indian sandstone'}], Object.assign({}, pv, {style:'', steps:true, stepsSlab:'Indian sandstone', stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]}));
  check('steps: a chosen tread slab gets the tread area instead (50 + 22.4)', near(mix2.m['Porcelain grey'], 50) && near(mix2.m['Indian sandstone'], 22.4) && /treads finished in Indian sandstone/.test(mix2.letter));
  const wst = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {wastagePct:10, steps:true, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]}));
  check('steps: wastage for cuts covers the tread slabs too (52.4 × 1.1 → 58)', wst.secMats['Porcelain grey']===58);
  const off = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {steps:false, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]}));
  check('steps answered No: nothing added', near(off.area, 50) && !off.m['Concrete blocks']);

  // ---------- Paving steps in the wizard ----------
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Steps UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="paving"]'); await wait(100);
  await page.click('button[data-action="wizNext"]'); await wait(250);
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','5'); await wait(150);
  await page.selectOption('[data-row="0"] select[data-mf="slabType"]','Porcelain grey'); await wait(200);
  check('wizard: Steps? question, no step boxes until Yes', /Steps\?/.test(await page.$eval('#app', e=>e.innerText)) && !(await page.$('[data-step-f]')));
  await page.click('[data-action="setOpt"][data-opt="steps"][data-val="true"]'); await wait(250);
  check('wizard: Yes shows one step line (width, depth, height, how many = 1)', (await page.$$("[data-steprow]")).length===1 && await page.$eval('[data-steprow="0"] [data-step-f="qty"]', e=>e.value)==='1');
  await page.click('[data-steprow="0"] [data-step-f="width"]'); await page.keyboard.type('2');
  await page.click('[data-steprow="0"] [data-step-f="depth"]'); await page.keyboard.type('0.4');
  await page.click('[data-steprow="0"] [data-step-f="heightMm"]'); await page.keyboard.type('150');
  await page.fill('[data-steprow="0"] [data-step-f="qty"]','3'); await page.dispatchEvent('[data-steprow="0"] [data-step-f="qty"]','input'); await wait(300);
  check('wizard: typing keeps focus and value (height 150)', await page.$eval('[data-steprow="0"] [data-step-f="heightMm"]', e=>e.value)==='150');
  let t = await page.$eval('#app', e=>e.innerText);
  check('wizard: materials show the step blocks and the area includes the treads', /Concrete blocks\s+13\b/.test(t) && /52\.40 m²/.test(t));
  await page.click('[data-action="addStepRow"]'); await wait(200);
  check('wizard: "+ Add steps with different dimensions" adds a line', (await page.$$("[data-steprow]")).length===2);
  await page.click('[data-steprow="1"] [data-step-f="width"]'); await page.keyboard.type('1');
  await page.click('[data-steprow="1"] [data-step-f="depth"]'); await page.keyboard.type('0.3');
  await page.click('[data-steprow="1"] [data-step-f="heightMm"]'); await page.keyboard.type('170'); await wait(300);
  t = await page.$eval('#app', e=>e.innerText);
  check('wizard: second line counted (52.4 + 0.3 = 52.70 m²)', /52\.70 m²/.test(t));
  await page.click('[data-action="removeStepRow"][data-idx="1"]'); await wait(200);
  check('wizard: ✕ removes a line', (await page.$$("[data-steprow]")).length===1 && /52\.40 m²/.test(await page.$eval('#app', e=>e.innerText)));
  await page.setViewportSize({width:390, height:844}); await wait(300);
  check('phone: no sideways scrolling with the step boxes', await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1));
  await (await page.$('[data-steprow="0"]')).scrollIntoViewIfNeeded(); await page.evaluate(()=>window.scrollBy(0,-160)); await wait(150);
  await page.screenshot({path:'/tmp/mobiletest/paving_steps.png'});
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

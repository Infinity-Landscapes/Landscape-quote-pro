// Paving: "Wastage for cuts (%)" asked on the paving step of the quote wizard (default 0) adds
// extra slabs for cuts — slab quantity only, rounded up (100 m² at 10% → 110). Sub-base, sand,
// cement, primer, membrane, jointing compound, non-timber edging etc. stay on the measured area.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,calcWithRowChoices,applyCutWastage,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_pavwaste_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  await page.goto('file:///tmp/mobiletest/_pavwaste_exposed.html'); await wait(400);
  await page.fill('#f_name', 'Wastage Test Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await wait(400);

  // Paving calc as the quote prices it (calc, then wastage on cut materials only).
  const calc = (w, l, extra) => page.evaluate(([w,l,extra])=>{
    const T = window.__T, s = T.S().settings;
    s.materials = s.materials || {};
    s.materials['Test Slab'] = s.materials['Test Slab'] || {unit:'m²', section:'paving', price:30, supplier:'', vatIncluded:false};
    s.pavingJointingCompounds = [{id:'j', name:'Test Joint', price:20, coverage:10, vatIncluded:false}];
    s.edgingStyles = [{id:'e', name:'Test Edge', piecesPerMetre:2, price:3, vatIncluded:false}];
    const ctx = T.ctxFor(s, 2), def = T.SERVICES.paving, rows = [{width:w, length:l}];
    const options = Object.assign({style:'Test Slab', digOutDepth:150, jointingCompound:'Test Joint', edging:true, edgingLength:8, edgingStyle:'Test Edge', productivity:6}, extra||{});
    const r = T.applyCutWastage('paving', def, rows, options, T.calcWithRowChoices(def, rows, options, ctx));
    return Object.fromEntries(r.materials.filter(m=>m[0]).map(m=>[m[0], m[1]]));
  }, [w, l, extra]);

  check('new business: no wastage remembered for paving', await page.evaluate(()=>!((window.__T.S().settings.wastageDefaults||{}).paving)));
  let m = await calc(10, 10);
  check('default 0% → exactly the measured 100 m² of slabs', m['Test Slab'] === 100);
  m = await calc(10, 10, {wastagePct:10});
  check('100 m² at 10% → 110 slabs (m²)', m['Test Slab'] === 110);
  check('membrane still 100 (measured area)', m['Geotextile membrane'] === 100);
  check('Type 1 MOT unaffected (20 t)', m['Type 1 MOT'] === 20);
  check('sharp sand unaffected (10)', m['Sharp sand'] === 10);
  check('cement unaffected (60)', m['Cement'] === 60);
  check('primer unaffected (5)', m['Paving primer'] === 5);
  check('jointing compound unaffected (100 ÷ 10 = 10)', m['Test Joint'] === 10);
  check('non-timber edging unaffected (8 m × 2 = 16)', m['Test Edge'] === 16);
  check('patio cleaner unaffected (5)', m['Patio cleaner'] === 5);
  m = await calc(7.3, 3, {wastagePct:10});
  check('21.9 m² at 10% = 24.09 → rounds up to 25', m['Test Slab'] === 25);
  m = await calc(10, 10, {wastagePct:15});
  check('100 m² at 15% → 115, others unchanged', m['Test Slab'] === 115 && m['Geotextile membrane'] === 100 && m['Test Joint'] === 10);

  // ---- no wastage field in Settings any more ----
  await page.click('button[data-nav="settings"]'); await wait(200);
  await page.click('button[data-action="settingsTab"][data-tab="pricing"]'); await wait(200);
  check('no slab wastage field in Settings → Pricing', !(await page.$('#st_pavingWastage')) && !(await page.$('#st_blockWastage')) && !(await page.$('#st_turfWastage')) && !(await page.$('#st_atWastage')));

  // ---- through the real wizard: the question sits on the paving step ----
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Wastage UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="paving"]'); await wait(150);
  await page.click('button[data-action="wizNext"]'); await wait(200);
  check('paving step asks "Wastage for cuts (%)"', /Wastage for cuts \(%\)/.test(await page.$eval('#app', e=>e.innerText)));
  check('…and it starts at 0', await page.$eval('[data-opt="wastagePct"]', e=>e.value) === '0');
  await page.evaluate(()=>{ const s=window.__T.S().settings; s.materials['Test Slab']={unit:'m²',section:'paving',price:30,supplier:'',vatIncluded:false};
    s.customStyleOptions = s.customStyleOptions||{}; s.customStyleOptions.paving = ['Test Slab']; });
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await wait(300);
  await page.selectOption('[data-row="0"] select[data-mf="slabType"]', 'Test Slab'); await wait(300);
  let t = await page.$eval('#app', e=>e.innerText);
  check('wizard materials list shows Test Slab 100 at 0%', /Test Slab\s+100\b/.test(t));
  await page.fill('[data-opt="wastagePct"]', '12'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await wait(400);
  t = await page.$eval('#app', e=>e.innerText);
  check('set to 12% → Test Slab 112 (10 × 10 m² + 12%)', /Test Slab\s+112\b/.test(t));
  check('MOT still on the measured area', /Type 1 MOT\s+20\b/.test(t));
  await wait(1200);
  check('the figure is remembered for the next paving quote', await page.evaluate(()=>(window.__T.S().settings.wastageDefaults||{}).paving) === 12);

  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

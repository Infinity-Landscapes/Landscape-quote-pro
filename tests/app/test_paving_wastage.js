// Paving: tenant "Slab wastage (%)" (Settings → Pricing → Paving, default 10) adds extra slabs for
// cuts and breakages — slab quantity only, rounded up (100 m² at 10% → 110). Sub-base, sand,
// cement, primer, membrane, jointing compound, edging etc. stay on the measured area.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_pavwaste_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  await page.goto('file://'+__dirname+'/_pavwaste_exposed.html'); await wait(400);
  await page.fill('#f_name', 'Wastage Test Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await wait(400);

  // Paving calc straight from the service, with the business's own settings.
  const calc = (w, l, extra) => page.evaluate(([w,l,extra])=>{
    const T = window.__T, s = T.S().settings;
    s.materials = s.materials || {};
    s.materials['Test Slab'] = s.materials['Test Slab'] || {unit:'m²', section:'paving', price:30, supplier:'', vatIncluded:false};
    s.pavingJointingCompounds = [{id:'j', name:'Test Joint', price:20, coverage:10, vatIncluded:false}];
    s.pavingEdgingStyles = [{id:'e', name:'Test Edge', piecesPerMetre:2, price:3, vatIncluded:false}];
    const ctx = T.ctxFor(s, 2);
    const r = T.SERVICES.paving.calc([{width:w, length:l}], Object.assign({style:'Test Slab', digOutDepth:150, jointingCompound:'Test Joint', edging:true, edgingLength:8, edgingStyle:'Test Edge', productivity:6}, extra||{}), ctx);
    return Object.fromEntries(r.materials.filter(m=>m[0]).map(m=>[m[0], m[1]]));
  }, [w, l, extra]);

  check('default slab wastage is 10%', await page.evaluate(()=>window.__T.S().settings.pavingWastagePercent) === 10);
  let m = await calc(10, 10);
  check('100 m² at 10% → 110 slabs (m²)', m['Test Slab'] === 110);
  check('membrane still 100 (measured area)', m['Geotextile membrane'] === 100);
  check('Type 1 MOT unaffected (20 t)', m['Type 1 MOT'] === 20);
  check('sharp sand unaffected (10)', m['Sharp sand'] === 10);
  check('cement unaffected (60)', m['Cement'] === 60);
  check('primer unaffected (5)', m['Paving primer'] === 5);
  check('jointing compound unaffected (100 ÷ 10 = 10)', m['Test Joint'] === 10);
  check('edging unaffected (8 m × 2 = 16)', m['Test Edge'] === 16);
  check('patio cleaner unaffected (5)', m['Patio cleaner'] === 5);
  m = await calc(7.3, 3);
  check('21.9 m² at 10% = 24.09 → rounds up to 25', m['Test Slab'] === 25);

  // ---- Settings → Pricing → Paving: edit it ----
  await page.click('button[data-nav="settings"]'); await wait(200);
  await page.click('button[data-action="settingsTab"][data-tab="pricing"]'); await wait(200);
  check('Slab wastage (%) field shows 10', await page.$eval('#st_pavingWastage', e=>e.value) === '10');
  await page.fill('#st_pavingWastage', '15');
  await page.click('button[data-action="saveSettingsForm"]'); await wait(300);
  check('saved as 15', await page.evaluate(()=>window.__T.S().settings.pavingWastagePercent) === 15);
  m = await calc(10, 10);
  check('100 m² at 15% → 115', m['Test Slab'] === 115 && m['Geotextile membrane'] === 100 && m['Test Joint'] === 10);
  // block paving keeps its own wastage
  const bp = await page.evaluate(()=>window.__T.S().settings.blockPavingWastagePercent);
  check('block paving wastage untouched (10)', bp === 10);
  await page.fill('#st_pavingWastage', '0');
  await page.click('button[data-action="saveSettingsForm"]'); await wait(300);
  m = await calc(10, 10);
  check('0% → exactly the measured 100', m['Test Slab'] === 100);
  await page.fill('#st_pavingWastage', '12');
  await page.click('button[data-action="saveSettingsForm"]'); await wait(300);

  // ---- stored with the business: survives a reload ----
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await page.click('button[data-action="login"]'); await wait(400);
  check('setting kept after reload (12)', await page.evaluate(()=>window.__T.S().settings.pavingWastagePercent) === 12);
  m = await calc(10, 10);
  check('100 m² at 12% → 112 after reload', m['Test Slab'] === 112);

  // ---- through the real wizard: the materials panel shows the uplifted slab quantity ----
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Wastage UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="paving"]'); await wait(150);
  await page.click('button[data-action="wizNext"]'); await wait(200);
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await wait(200);
  await page.evaluate(()=>{ const s=window.__T.S().settings; s.materials['Test Slab']={unit:'m²',section:'paving',price:30,supplier:'',vatIncluded:false};
    s.customStyleOptions = s.customStyleOptions||{}; s.customStyleOptions.paving = ['Test Slab']; });
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await wait(300);
  const opts = await page.$$eval('[data-row="0"] select[data-mf="slabType"] option', os=>os.map(o=>o.value).filter(v=>v && !v.startsWith('__')));
  console.log('  slab types offered:', opts.length);
  await page.selectOption('[data-row="0"] select[data-mf="slabType"]', opts[0]); await wait(300);
  const t = await page.$eval('#app', e=>e.innerText);
  const esc = opts[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  check(`wizard materials list shows ${opts[0]} 112 (10 × 10 m² + 12%)`, new RegExp(esc+'\\s+112\\b').test(t));

  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

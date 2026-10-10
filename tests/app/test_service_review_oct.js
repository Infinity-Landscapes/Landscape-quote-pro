// October 2026 full service review: gravel grids + 0mm top dressing; one shared edging list;
// one shared bedding list (Block paving + Artificial turf); pergola roofing board; new default
// productivities (and businesses on the old defaults moved over); fence type panel dropdown;
// customer-supplied water feature (£50, editable, in Materials); remembered values next time;
// concrete steps with a face skin; "Welded Steel Edging" everywhere.
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
  fs.writeFileSync('/tmp/mobiletest/_review_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  const txt = () => page.$eval('#app', e=>e.innerText);
  const click = async sel => { await (await page.$(sel)).click(); await wait(220); };
  const store = () => page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('__mockdb__')); const k=Object.keys(s).find(k=>s[k]&&s[k].materials); return s[k]; });
  await page.goto('file:///tmp/mobiletest/_review_exposed.html'); await wait(400);
  await page.fill('#f_name','Review Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','150'); await page.fill('#f_expenses','90'); } await click('button[data-action="setupNext"]'); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234'); await click('button[data-action="setupNext"]');
  const run = (key, rows, opt) => page.evaluate(([key, rows, opt])=>{
    const T = window.__T, s = T.S().settings, ctx = T.ctxFor(s, 2), def = T.SERVICES[key];
    const options = {}; (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key] = o.default; }); Object.assign(options, opt||{});
    const r = T.calcWithRowChoices(def, rows, options, ctx); const sec = T.priceSection(key, rows, options, ctx, []);
    const m = {}; r.materials.filter(x=>x[0]).forEach(x=>{ m[x[0]] = (m[x[0]]||0) + x[1]; });
    return { m, blockers:r.blockers||[], area:r.area, wasteArea:r.wasteArea, digOutDepth:r.digOutDepth, letter:T.sectionCopy(sec).join(' | ') };
  }, [key, rows, opt]);

  // ---------- new business: defaults ----------
  let b = await store();
  check('new business: gravel grid seeded at the Toolstation reference (£31.72/m²)', (b.gravelGrids||[]).length===1 && b.gravelGrids[0].price===31.72 && b.gravelGrids[0].supplier==='Toolstation');
  check('new business: customer-supplied water feature £50, also in Materials', (b.wfFeatures||[]).some(f=>f.name==='Customer-supplied water feature' && f.price===50) && b.materials['Customer-supplied water feature'] && b.materials['Customer-supplied water feature'].price===50);
  check('new business: productivity defaults (decking 6, sleeper wall 7.2, pergola 9, water features 0.5)', b.productivity.compositedecking===6 && b.productivity.timberdecking===6 && b.productivity.sleeperwall===7.2 && b.productivity.pergola===9 && b.productivity.waterfeatures===0.5);
  check('new business: fence types Close-board 8, Panel 10 m/day', b.fenceTypes.find(f=>f.id==='closeboard').productivity===8 && b.fenceTypes.find(f=>f.id==='panel').productivity===10);

  // ---------- gravel ----------
  await page.evaluate(()=>{ const s = window.__T.S().settings; s.materials['Pea gravel'] = {unit:'tonne', section:'x', price:40, supplier:'x', vatIncluded:false}; });
  let g = await run('gravel', [{desc:'Path',width:10,length:1,digOutDepth:0,gravelType:'Pea gravel'}], {gravelDepth:50});
  check('gravel 0mm dig-out (top dressing): allowed — no blocker', !g.blockers.some(x=>/dig-out/.test(x)));
  check('…no Type 1 MOT, nothing to take away', !g.m['Type 1 MOT'] && g.wasteArea===0);
  check('…letter: laid on the existing ground, no excavation', /top dressing — no excavation/.test(g.letter) && /membrane laid over the existing ground/.test(g.letter) && !/excavated/.test(g.letter));
  g = await run('gravel', [{desc:'Path',width:10,length:1,digOutDepth:0,gravelType:'Pea gravel'},{desc:'Drive',width:5,length:4,digOutDepth:150,gravelType:'Pea gravel'}], {gravelDepth:50});
  check('gravel mixed: only the dug area goes to waste (20 m² at 150mm)', g.wasteArea===20 && Math.abs(g.digOutDepth-150)<1e-9 && /Path laid directly on the existing ground as a top dressing/.test(g.letter));
  g = await run('gravel', [{desc:'Drive',width:5,length:4,digOutDepth:150,gravelType:'Pea gravel'}], {gravelDepth:50, grids:true, gridProduct:'Gravel grid 590 × 390mm (pack of 5)'});
  check('gravel grids: 20 m² of grids at the grid price', g.m['Gravel grid 590 × 390mm (pack of 5)']===20 && /Gravel grids laid/.test(g.letter));
  g = await run('gravel', [{desc:'Drive',width:5,length:4,digOutDepth:150,gravelType:'Pea gravel'}], {gravelDepth:50, grids:true, gridProduct:'', wastagePct:10});
  check('gravel grids: blocker until one is picked', g.blockers.some(x=>/Select a gravel grid/.test(x)));

  // ---------- wizard: shared edging, shared bedding, remembered values ----------
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Review UI');
  await click('button[data-action="wizNext"]');
  for (const s of ['paving','gravel','blockpaving','artificialturf']) await click(`[data-action="toggleQuoteService"][data-key="${s}"]`);
  await click('button[data-action="wizNext"]');
  // paving: add an edging style
  await click('[data-action="setOpt"][data-opt="edging"][data-val="true"]');
  await page.selectOption('select[data-opt="edgingStyle"]','__add_other__'); await wait(200);
  await page.fill('#mf_name','Granite kerb'); await page.fill('#mf_piecesPerMetre','2'); await page.fill('#mf_price','6'); await page.fill('#mf_supplier','Minster');
  await click('button[data-action="modalOk"]');
  await click('button[data-action="wizNext"]');
  // gravel: the same edging list
  await click('[data-action="setOpt"][data-opt="edging"][data-val="true"]');
  let eo = await page.$$eval('select[data-opt="edgingStyle"] option', os=>os.map(o=>o.textContent));
  check('edging added on Paving shows on Gravel (one shared list), with Welded steel edging', eo.includes('Granite kerb') && eo.includes('Welded steel edging'));
  await page.fill('[data-opt="gravelDepth"]','40'); await page.dispatchEvent('[data-opt="gravelDepth"]','input'); await wait(300);
  check('gravel step asks about gravel grids', /Gravel grids\?/.test(await txt()));
  await click('button[data-action="wizNext"]');
  // block paving: add a bedding material
  await page.selectOption('select[data-opt="bedding"]','__add_other__'); await wait(200);
  await page.fill('#mf_name','Limestone chip 0-6mm'); await page.fill('#mf_price','55'); await page.fill('#mf_supplier','AWBS');
  await click('button[data-action="modalOk"]');
  eo = await page.$$eval('select[data-opt="edgingStyle"] option', os=>os.map(o=>o.textContent));
  check('Block paving edging list is the same shared list', eo.includes('Granite kerb'));
  await click('button[data-action="wizNext"]');
  // artificial turf: same bedding list
  const bo = await page.$$eval('select[data-opt="grano"] option', os=>os.map(o=>o.textContent));
  check('bedding added on Block paving shows on Artificial turf (one shared list)', bo.includes('Limestone chip 0-6mm') && /Bedding material/.test(await txt()));
  check('artificial turf asks "Are there any joins?"', /Are there any joins\?/.test(await txt()));
  await wait(1200);
  b = await store();
  check('remembered for next time: gravel depth 40 and the bedding picked', b.optionDefaults && b.optionDefaults.gravel && b.optionDefaults.gravel.gravelDepth===40 && b.optionDefaults.blockpaving.bedding==='Limestone chip 0-6mm');
  check('…but not job sizes (edging length)', !(b.optionDefaults.paving||{}).edgingLength);
  await click('button[data-nav="menu"]');
  const dd = await page.$('button[data-action="discardDraft"]'); if (dd){ await dd.click(); await wait(150); const c = await page.$('#modalConfirmBtn'); if(c) await click('#modalConfirmBtn'); }
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Review 2');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="gravel"]');
  await click('button[data-action="wizNext"]');
  check('next quote starts with the remembered gravel depth (40)', await page.$eval('[data-opt="gravelDepth"]', e=>e.value)==='40');

  // ---------- pergola roofing board, steel rename ----------
  const pg = await page.evaluate(()=>{ const o = window.__T.SERVICES.pergola.options.find(x=>x.key==='osbProduct'); return o.label + '|' + (typeof o.showIf==='string'?o.showIf:''); });
  check('pergola: "Roofing board" dropdown shown whenever there is a roof (no OSB gate)', pg==='Roofing board (£ per board)|roof');
  check('"Welded Steel Edging" service name', await page.evaluate(()=>window.__T.SERVICES.steeledging.label)==='Welded Steel Edging');

  // ---------- concrete steps with a face skin ----------
  await page.evaluate(()=>{ const s = window.__T.S().settings; s.materials['Slab A'] = {unit:'m²', section:'x', price:40, supplier:'x', vatIncluded:false};
    s.brickwallFaceProducts = [{id:'f1', name:'Red brick', price:0.8, facePricedPer:'piece', piecesPerM2:60, thicknessMm:102, vatIncluded:false}];
    s.cbReadyMix = [{id:'r1', name:'C25 mix', price:120, vatIncluded:false}]; s.cbShuttering = [{id:'sh', name:'Board 2.4', price:10, lengthMm:2400, vatIncluded:false}]; });
  const pv = {style:'Slab A', digOutDepth:150, steps:true, stepRows:[{width:2, depth:0.4, heightMm:150, qty:3}]};
  let st = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {stepsBuild:'Concrete'}));
  // volume 2 × 0.4 × 0.15 × 3 = 0.36 m³ → baseline 1 m³: ROUNDUP(0.36) = 1 sand, 1 ballast, ROUNDUP(4.32) = 5 cement (+ paving's own)
  check('concrete steps: no riser blocks; concrete mixed on site added', !st.m['Concrete blocks'] && st.m['Ballast']===1);
  st = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {stepsBuild:'Concrete', stepsReadyMix:true, stepsReadyMixProduct:'C25 mix', stepsShuttering:'Board 2.4', stepsFace:true, stepsFaceProduct:'Red brick'}));
  // shuttering run (2 + 0.8) × 3 = 8.4 m → ROUNDUP(8400/2400) = 4 boards × 1 high
  check('concrete steps: ready-mix 0.5 m³, 4 shuttering boards', st.m['C25 mix']===0.5 && st.m['Board 2.4']===4);
  check('concrete steps: face skin on the risers (1.26 m² × 60 = 76 bricks)', st.m['Red brick']===76);
  check('letter: formed in concrete and faced', /3 steps formed in concrete and faced in Red brick, with treads finished in the same paving to match\./.test(st.letter));
  st = await run('paving', [{desc:'Patio',width:10,length:5}], Object.assign({}, pv, {stepsBuild:'Block', stepsFace:true, stepsFaceProduct:'Red brick'}));
  check('block steps with a face skin: blocks + bricks + wall ties', st.m['Concrete blocks']===13 && st.m['Red brick']===76 && st.m['Wall ties']===1 && /faced in Red brick/.test(st.letter));

  // ---------- fence builder panel dropdown ----------
  await click('button[data-nav="menu"]');
  const dd2 = await page.$('button[data-action="discardDraft"]'); if (dd2){ await dd2.click(); await wait(150); const c = await page.$('#modalConfirmBtn'); if(c) await click('#modalConfirmBtn'); }
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  await click('button[data-action="addFenceType"]');
  check('fence type builder has a Panel dropdown', !!(await page.$('#svcPanel')));
  await page.fill('#svcName','Hit and miss'); await page.fill('#svcPostMaterial','100x100 treated timber fence post');
  await page.selectOption('#svcPanel','__add_other__'); await wait(300);
  await page.fill('#mf_name','Hit & miss panel'); await page.fill('#mf_price','48'); await page.fill('#mf_supplier','Jewson');
  await click('button[data-action="modalOk"]');
  check('new panel picked, typed fence name kept', await page.$eval('#svcPanel', e=>e.value)==='Hit & miss panel' && await page.$eval('#svcName', e=>e.value)==='Hit and miss');
  b = await store();
  check('panel saved to the panel list and Materials', (b.fencePanels||[]).some(p=>p.name==='Hit & miss panel' && p.price===48) && b.materials['Hit & miss panel']);

  // ---------- existing business on old default rates moves over ----------
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('__mockdb__')); const k=Object.keys(s).find(k=>s[k]&&s[k].materials); const d=s[k];
    delete d._prodReview1026; d.productivity.pergola = 16.7; d.productivity.sleeperwall = 12; d.productivity.compositedecking = 2.7;
    d.fenceTypes.find(f=>f.id==='closeboard').productivity = 5; localStorage.setItem('__mockdb__', JSON.stringify(s)); });
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await click('button[data-action="login"]'); await wait(300);
  b = await store();
  check('old default rates move to the new ones; a rate the business set itself is kept', b.productivity.pergola===9 && b.productivity.compositedecking===6 && b.productivity.sleeperwall===12 && b.fenceTypes.find(f=>f.id==='closeboard').productivity===8);
  // ---------- existing business: per-service lists folded into the shared ones ----------
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('__mockdb__')); const k=Object.keys(s).find(k=>s[k]&&s[k].materials); const d=s[k];
    delete d.edgingStyles; delete d.beddingMaterials;
    d.pavingEdgingStyles = [{id:'p1', name:'Sett edging', piecesPerMetre:5, price:2, vatIncluded:true}];
    d.gravelEdgingStyles = [{id:'g1', name:'Block edging', piecesPerMetre:20, price:1, vatIncluded:true},{id:'g2', name:'Sett edging', piecesPerMetre:5, price:3, vatIncluded:true}];
    d.atGrano = [{id:'a1', name:'Grano dust', price:48, vatIncluded:true}];
    localStorage.setItem('__mockdb__', JSON.stringify(s)); });
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await click('button[data-action="login"]'); await wait(400);
  b = await store();
  check('existing edging styles folded into one list (no duplicates)', b.edgingStyles.map(e=>e.name).filter(n=>n==='Sett edging').length===1 && b.edgingStyles.some(e=>e.name==='Block edging'));
  check('existing grano dust becomes a bedding material', (b.beddingMaterials||[]).some(e=>e.name==='Grano dust' && e.price===48));
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

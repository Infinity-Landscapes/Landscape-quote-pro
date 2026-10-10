// Wastage for cuts: one "Wastage for cuts (%)" question on each service's quote-wizard step
// (default 0, remembered per service once set), applied only to materials that get cut to size —
// decking boards/joists, pergola timber, slabs, blocks, turf, artificial grass, fence panels and
// boards, gravel boards, timber/composite edging. Fixings, sub-base, sand, postcrete, adhesive etc.
// are never uplifted. No wastage fields in Settings. Every material added in the wizard needs a
// cost (> £0) and a supplier, and lands in the tenant's Materials list (edits there sync back).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,calcWithRowChoices,applyCutWastage,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_cutwaste_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  const txt = () => page.$eval('#App', e => e.textContent);
  await page.goto('file://'+__dirname+'/_cutwaste_exposed.html'); await wait(400);
  await page.fill('#f_name','Cut Wastage Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234'); await page.click('button[data-action="setupNext"]'); await wait(400);

  // ---- a new business starts with no wastage, and that survives a reload ----
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await page.click('button[data-action="login"]'); await wait(400);
  check('new business: no wastage figures after a reload (all services start at 0)', await page.evaluate(()=>Object.keys(window.__T.S().settings.wastageDefaults||{}).length===0));

  // ---- the calc: which lines move at 10% ----
  const diff = (key, opts) => page.evaluate(([key, opts])=>{
    const T=window.__T, s=T.S().settings, def=T.SERVICES[key], options={};
    const prod = (lib,i)=>({id:lib+i, name:lib+' item', price:20, priceM:10, lengthMm:3600, widthMm:140, heightMm:200, coverage:10, piecesPerMetre:2, vatIncluded:false});
    (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key]=o.default; });
    (def.options||[]).forEach(o=>{ if(o.source && o.source!=='fenceTypes'){ if(!Array.isArray(s[o.source])||!s[o.source].length) s[o.source]=[prod(o.source,1)]; if(!options[o.key]) options[o.key]=s[o.source][0].name; } });
    (def.options||[]).forEach(o=>{ if(o.customizable){ const n='Cut '+key+' material'; s.materials[n]={unit:'m²',section:key,price:30,supplier:'x',vatIncluded:false}; options[o.key]=n; } });
    Object.entries(opts.libs||{}).forEach(([lib,name])=>{ s[lib]=[Object.assign(prod(lib,2),{name})]; });
    Object.assign(options, opts.options||{});
    const row={desc:'A'}; def.cols.forEach(c=>{ if(c!=='desc') row[c]= c==='heightMm'?2400 : c==='digOutDepth'?150 : 4; });
    const ctx=T.ctxFor(s,2);
    const mats = pct => { const o=Object.assign({},options,{wastagePct:pct}); const r=T.applyCutWastage(key, def, [row], o, T.calcWithRowChoices(def, [row], o, ctx)); return Object.fromEntries((r.materials||[]).filter(m=>m[0]&&m[1]>0).map(m=>[m[0], m[1]])); };
    const a=mats(0), b=mats(10);
    return {changed:Object.keys(a).filter(n=>a[n]!==b[n]), same:Object.keys(a).filter(n=>a[n]===b[n]), a, b};
  }, [key, opts||{}]);
  const exactly = (r, names) => names.every(n=>r.changed.includes(n)) && r.changed.length===names.length;
  let r;
  r = await diff('paving', {options:{edging:true, edgingLength:8, edgingStyle:'Sandstone kerb'}, libs:{edgingStyles:'Sandstone kerb'}});
  check('paving: only the slabs go up (not MOT, sand, cement, primer, jointing, stone edging)', exactly(r, ['Cut paving material']) && ['Type 1 MOT','Sharp sand','Cement','Sandstone kerb'].every(n=>r.same.includes(n)));
  r = await diff('paving', {options:{edging:true, edgingLength:8, edgingStyle:'Treated timber edging'}, libs:{edgingStyles:'Treated timber edging'}});
  check('paving: timber edging strips are cut too', exactly(r, ['Cut paving material','Treated timber edging']));
  r = await diff('blockpaving');
  check('block paving: only the blocks go up', exactly(r, ['Cut blockpaving material']) && r.same.includes('Type 1 MOT'));
  r = await diff('turf');
  check('turf: turf goes up, topsoil and consumables don\'t', exactly(r, ['Turf']) && r.same.includes('Quality topsoil'));
  r = await diff('artificialturf');
  check('artificial grass: the grass goes up, not grano, infill, MOT, membrane', exactly(r, ['atTurf item']) && ['beddingMaterials item','atInfill item','Type 1 MOT','Geotextile membrane'].every(n=>r.same.includes(n)));
  r = await diff('timberdecking');
  check('timber decking: boards and joists go up; posts, sleeves, postcrete, screws don\'t', exactly(r, ['timberDeckBoards item','timberJoists item']) && ['Postcrete','Post saver sleeve','100x100mm Treated timber post'].every(n=>r.same.includes(n)));
  check('timber decking: 56 boards at 10% → 62 (rounded up)', r.a['timberDeckBoards item']===56 && r.b['timberDeckBoards item']===62);
  r = await diff('compositedecking', {options:{fascia:true, fasciaRun:8}});
  check('composite decking: boards, joists and fascia go up; posts, postcrete, screws don\'t', ['compositeDeckBoards item','Composite joists','compositeFasciaBoards item'].every(n=>r.changed.includes(n)) && ['Composite posts','Postcrete'].every(n=>r.same.includes(n)));
  r = await diff('pergola');
  check('pergola: posts and joists (timber) go up; postcrete, DPM, screws don\'t', exactly(r, ['pgPosts item','pgJoists item']) && ['Postcrete','pgDpm item','pgScrews item'].every(n=>r.same.includes(n)));
  for (const [ft, cut, notCut] of [['closeboard',['Feather edge board','Timber gravel board'],['100x100 treated timber fence post','Postcrete','Arris rail','Box of nails']],
                                   ['panel',['Lap panel','Timber gravel board'],['100x100 treated timber fence post','Postcrete','Box of 5x80mm screws']],
                                   ['composite',['Composite fence panels'],['Composite fence posts','Postcrete']]]){
    r = await diff('fence', {options:{fenceType:ft}});
    check(`fencing (${ft}): ${cut.join(' + ')} go up; posts, postcrete, rails, fixings don't`, exactly(r, cut) && notCut.every(n=>r.same.includes(n)));
  }
  r = await diff('gravel', {options:{edging:true, edgingLength:10, edgingStyle:'Treated timber edging'}, libs:{edgingStyles:'Treated timber edging'}});
  check('gravel: timber edging goes up; gravel, MOT, membrane don\'t', exactly(r, ['Treated timber edging']));
  r = await diff('gravel', {options:{edging:true, edgingLength:10, edgingStyle:'Granite sett edging'}, libs:{edgingStyles:'Granite sett edging'}});
  check('gravel: non-timber edging isn\'t uplifted (nothing changes)', r.changed.length===0);
  r = await diff('flowerbeds', {options:{edging:true, length:10, edgingLength:10, edgingStyle:'Composite edging strip'}, libs:{edgingStyles:'Composite edging strip'}});
  check('flower beds: composite edging goes up; compost, mulch, membrane don\'t', exactly(r, ['Composite edging strip']));

  // ---- Settings has no wastage fields ----
  await page.click('button[data-nav="settings"]'); await wait(200);
  await page.click('button[data-action="settingsTab"][data-tab="pricing"]'); await wait(200);
  check('no wastage fields in Settings → Pricing', !/wastage/i.test(await page.$eval('#App', e=>[...e.querySelectorAll('label')].map(l=>l.textContent).join('|'))));

  // ---- the question on each service's wizard step ----
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Cut wastage UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  const svcs = ['paving','blockpaving','turf','artificialturf','timberdecking','compositedecking','pergola','fence','gravel'];
  for (const s of svcs){ await page.click(`[data-action="toggleQuoteService"][data-key="${s}"]`); await wait(100); }
  await page.click('button[data-action="wizNext"]'); await wait(250);
  const seen = {};
  for (let i=0;i<svcs.length;i++){
    const head = await page.evaluate(()=>{ const h=document.querySelector('#App h2, #App .wiz-title, #App h3'); return h?h.textContent:''; });
    const f = await page.$('[data-opt="wastagePct"]');
    seen[head.trim()] = f ? await f.inputValue() : null;
    await page.click('button[data-action="wizNext"]'); await wait(200);
  }
  console.log('  wizard steps:', JSON.stringify(seen));
  const vals = Object.values(seen);
  check('8 of the 9 service steps ask the wastage question, all at 0 (gravel only asks once timber/composite edging is on)', vals.filter(v=>v==='0').length===8 && vals.filter(v=>v===null).length===1);

  // ---- adding a material in the wizard: cost and supplier required, then in the Materials list ----
  await page.click('button[data-nav="menu"]'); await wait(150);
  const d = await page.$('button[data-action="discardDraft"]'); if (d){ await d.click(); await wait(150); const c=await page.$('#modalConfirmBtn'); if(c){ await c.click(); await wait(200);} }
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Board add');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="compositedecking"]'); await wait(100);
  await page.click('button[data-action="wizNext"]'); await wait(250);
  await page.fill('[data-row="0"] input[data-mf="width"]','4'); await page.fill('[data-row="0"] input[data-mf="length"]','3'); await wait(200);
  await page.selectOption('[data-row="0"] select[data-mf="boardType"]','__add_other__'); await wait(200);
  check('add-board dialog has a Supplier field', !!(await page.$('#mf_supplier')));
  await page.fill('#mf_name','Grey composite 3.6m'); await page.fill('#mf_lengthMm','3600'); await page.fill('#mf_widthMm','140');
  await page.fill('#mf_price','0');
  await page.click('button[data-action="modalOk"]'); await wait(200);
  check('£0 board refused (dialog stays open, asks for the cost)', !!(await page.$('#mf_name')) && /more than £0/.test(await txt()));
  check('…and what was typed is kept', await page.$eval('#mf_name', e=>e.value)==='Grey composite 3.6m' && await page.$eval('#mf_lengthMm', e=>e.value)==='3600');
  await page.fill('#mf_price','36');
  await page.click('button[data-action="modalOk"]'); await wait(200);
  check('no supplier refused', !!(await page.$('#mf_name')) && /"Supplier" is required/.test(await txt()));
  await page.fill('#mf_supplier','Deck Direct');
  await page.click('button[data-action="modalOk"]'); await wait(300);
  check('board saved and picked on the row', !(await page.$('#mf_name')) && await page.$eval('[data-row="0"] select[data-mf="boardType"]', e=>e.value)==='Grey composite 3.6m');
  await page.fill('[data-opt="wastagePct"]','10'); await page.dispatchEvent('[data-opt="wastagePct"]','change'); await wait(1200);
  check('wastage remembered for composite decking only', await page.evaluate(()=>JSON.stringify(window.__T.S().settings.wastageDefaults))==='{"compositedecking":10}');
  await page.click('button[data-nav="settings"]'); await wait(200);
  await page.click('button[data-action="settingsTab"][data-tab="materials"]'); await wait(200);
  await page.fill('#matFilter','Grey composite'); await wait(200);
  check('the new board is in Materials with its cost and supplier', await page.$eval('input[data-mat="Grey composite 3.6m"]', e=>e.value).catch(()=>null)==='36' && await page.$eval('input[data-matsup="Grey composite 3.6m"]', e=>e.value).catch(()=>null)==='Deck Direct');
  await page.fill('input[data-mat="Grey composite 3.6m"]','40'); await page.fill('input[data-matsup="Grey composite 3.6m"]','Jewson');
  await page.click('button[data-action="saveMaterialsForm"]'); await wait(300);
  const lib = await page.evaluate(()=>(window.__T.S().settings.compositeDeckBoards||[]).find(b=>b.name==='Grey composite 3.6m'));
  check('editing it in Materials updates the board used by the quote (price and supplier)', lib && lib.price===40 && lib.supplier==='Jewson');
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await page.click('button[data-action="login"]'); await wait(400);
  check('after reload: wastage figure and board both kept', await page.evaluate(()=>{ const s=window.__T.S().settings; const b=(s.compositeDeckBoards||[]).find(x=>x.name==='Grey composite 3.6m'); return s.wastageDefaults.compositedecking===10 && b && b.price===40 && s.materials['Grey composite 3.6m'] && s.materials['Grey composite 3.6m'].supplier==='Jewson'; }));

  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

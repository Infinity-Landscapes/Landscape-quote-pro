// Block Retaining Wall: "Inside skin product" — Concrete blocks by default, or a wall skin product
// priced per piece (pieces per m²) or per m², with its own thickness used for the coping width.
// The inside and face skins share ONE product list: anything added to either shows in both.
// A business that already had a separate first-skin list gets it folded into the shared one.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,ctxFor,calcWithRowChoices,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_insideskin_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  const txt = () => page.$eval('#App', e => e.textContent);
  await page.goto('file://'+__dirname+'/_insideskin_exposed.html'); await wait(400);
  await page.fill('#f_name','Inside Skin Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234'); await page.click('button[data-action="setupNext"]'); await wait(400);
  const calc = (opt, rows) => page.evaluate(([opt, rows])=>{
    const T=window.__T, s=T.S().settings, def=T.SERVICES.brickwall, options={};
    (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key]=o.default; });
    Object.assign(options, opt);
    rows = rows || [{desc:'Back',length:5,height:1,footingLength:5,footingWidth:450,footingDepth:300}];
    const r=T.calcWithRowChoices(def, rows, options, T.ctxFor(s,2));
    const m={}; r.materials.filter(x=>x[0]).forEach(x=>{ m[x[0]] = (m[x[0]]||0) + x[1]; });
    return {m, blockers:r.blockers||[]};
  }, [opt, rows]);
  let r = await calc({});
  check('default inside skin is Concrete blocks', r.m['Concrete blocks']>0);
  await page.evaluate(()=>{ window.__T.S().settings.brickwallFaceProducts=[{id:'f1',name:'Red brick',price:0.8,facePricedPer:'piece',piecesPerM2:60,thicknessMm:102,vatIncluded:false},{id:'f2',name:'Stone skin',price:60,facePricedPer:'m2',thicknessMm:150,vatIncluded:false}]; });
  r = await calc({firstSkinProduct:'Red brick'});
  check('inside skin from the shared list replaces concrete blocks (5 m² × 60 = 300)', r.m['Red brick']===300 && !('Concrete blocks' in r.m));
  r = await calc({firstSkinProduct:'Stone skin'});
  check('per-m² inside skin = wall area (5 m²)', r.m['Stone skin']===5);
  r = await calc({firstSkinProduct:'Missing thing'});
  check('an inside skin that no longer exists blocks the quote, named "inside skin"', r.blockers.some(b=>/inside skin product/.test(b)));
  // same product both sides, with two different face products across rows
  const rows2 = [{desc:'A',length:5,height:1,footingLength:5,footingWidth:450,footingDepth:300,faceType:'Red brick'},
                 {desc:'B',length:3,height:1,footingLength:3,footingWidth:450,footingDepth:300,faceType:'Stone skin'}];
  r = await calc({firstSkinProduct:'Red brick', faceSkin:true}, rows2);
  // inside: 8 m² × 60 = 480 red bricks; face: row A 5 × 60 = 300 red bricks, row B 3 m² stone
  check('red brick inside on both walls + red brick face on wall A = 480 + 300 = 780', r.m['Red brick']===780);
  check('stone face on wall B = 3 m²', r.m['Stone skin']===3);
  r = await calc({firstSkinProduct:'Stone skin', faceSkin:true}, rows2);
  check('stone inside on both walls (8) + stone face on wall B (3) = 11 m², red brick face on A = 300', r.m['Stone skin']===11 && r.m['Red brick']===300);

  // Wizard: label, shared list both ways
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Inside skin UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="brickwall"]'); await wait(100);
  await page.click('button[data-action="wizNext"]'); await wait(250);
  const t = await txt();
  check('wizard says "Inside skin product" (no "first skin")', /Inside skin product/.test(t) && !/first skin/i.test(t));
  check('inside skin starts on Concrete blocks', await page.$eval('select[data-opt="firstSkinProduct"]', e=>e.value)==='Concrete blocks');
  await page.selectOption('select[data-opt="firstSkinProduct"]','__add_other__'); await wait(200);
  await page.fill('#mf_name','Engineering brick'); await page.fill('#mf_price','0.9');
  const pp = await page.$('#mf_piecesPerM2'); if (pp) await pp.fill('60');
  await page.fill('#mf_supplier','AWBS');
  await page.click('button[data-action="modalOk"]'); await wait(300);
  check('new product picked as the inside skin', await page.$eval('select[data-opt="firstSkinProduct"]', e=>e.value)==='Engineering brick');
  await page.click('[data-action="setOpt"][data-opt="faceSkin"][data-val="true"]').catch(async()=>{ await page.selectOption('select[data-opt="faceSkin"]','true'); }); await wait(300);
  await page.fill('[data-row="0"] input[data-mf="length"]','4'); await page.fill('[data-row="0"] input[data-mf="height"]','1'); await wait(200);
  const faceOpts = await page.$$eval('[data-row="0"] select[data-mf="faceType"] option', os=>os.map(o=>o.value));
  check('the product added for the inside skin shows in the face skin list', faceOpts.includes('Engineering brick') && faceOpts.includes('Red brick'));
  const insideOpts = await page.$$eval('select[data-opt="firstSkinProduct"] option', os=>os.map(o=>o.value));
  check('face products show in the inside skin list (plus Concrete blocks)', insideOpts.includes('Red brick') && insideOpts.includes('Stone skin') && insideOpts.includes('Concrete blocks'));
  await page.selectOption('[data-row="0"] select[data-mf="faceType"]','__add_other__'); await wait(200);
  await page.fill('#mf_name','Buff facing'); await page.fill('#mf_price','1.1');
  const pp2 = await page.$('#mf_piecesPerM2'); if (pp2) await pp2.fill('60');
  await page.fill('#mf_supplier','AWBS');
  await page.click('button[data-action="modalOk"]'); await wait(300);
  check('a product added on the face skin shows in the inside skin list', (await page.$$eval('select[data-opt="firstSkinProduct"] option', os=>os.map(o=>o.value))).includes('Buff facing'));
  check('materials list knows both, under one wall skin list', await page.evaluate(()=>{ const m=window.__T.S().settings.materials; return m['Engineering brick'].lib==='brickwallFaceProducts' && m['Buff facing'].lib==='brickwallFaceProducts'; }));

  // Settings: one shared list
  await page.click('button[data-nav="settings"]'); await wait(200);
  await page.click('button[data-action="settingsTab"][data-tab="pricing"]'); await wait(200);
  const st = await txt();
  check('Settings shows one "Wall skin products (inside and face skin)" list', /Wall skin products \(inside and face skin\)/.test(st) && !/First skin products/.test(st) && !/Face skin products/.test(st));

  // Existing business with a separate first-skin list: folded into the shared list once
  await page.evaluate(()=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')); const key = Object.keys(s).find(k=>/business$/.test(k) || (s[k] && s[k].brickwallFaceProducts));
    s[key].brickwallFirstSkinProducts = [{id:'x1',name:'Old inside block',price:3,facePricedPer:'piece',piecesPerM2:10,thicknessMm:140,vatIncluded:false},{id:'x2',name:'Red brick',price:0.8,facePricedPer:'piece',piecesPerM2:60,vatIncluded:false}];
    s[key].materials['Old inside block'] = {unit:'each',section:'Block Retaining Wall',price:3,supplier:'Old',vatIncluded:false,lib:'brickwallFirstSkinProducts'};
    localStorage.setItem('__mockdb__', JSON.stringify(s)); });
  await page.reload(); await wait(500);
  await page.fill('#loginPin','1234'); await page.click('button[data-action="login"]'); await wait(600);
  const mig = await page.evaluate(()=>{ const s=window.__T.S().settings; const st = JSON.parse(localStorage.getItem('__mockdb__')); const key = Object.keys(st).find(k=>st[k] && st[k].brickwallFaceProducts);
    return {names:s.brickwallFaceProducts.map(x=>x.name), reds:s.brickwallFaceProducts.filter(x=>x.name==='Red brick').length, lib:s.materials['Old inside block'].lib, storedFirst:(st[key].brickwallFirstSkinProducts||[]).length, storedFace:st[key].brickwallFaceProducts.map(x=>x.name)}; });
  check('old first-skin products folded into the shared list (no duplicates)', mig.names.includes('Old inside block') && mig.reds===1);
  check('…its Materials entry now points at the shared list', mig.lib==='brickwallFaceProducts');
  check('…and saved, so it only happens once', mig.storedFirst===0 && mig.storedFace.includes('Old inside block'));
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

// Block Retaining Wall: "First skin product" (inside skin) — Concrete blocks by default, or a
// tenant product priced per piece (pieces per m²) or per m², with its own thickness used for the
// coping width. Adding one needs a cost and a supplier and puts it in the Materials list.
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
  fs.writeFileSync(__dirname+'/_firstskin_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  const txt = () => page.$eval('#App', e => e.textContent);
  await page.goto('file://'+__dirname+'/_firstskin_exposed.html'); await wait(400);
  await page.fill('#f_name','First Skin Ltd');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234'); await page.click('button[data-action="setupNext"]'); await wait(400);
  const calc = opt => page.evaluate(opt=>{
    const T=window.__T, s=T.S().settings, def=T.SERVICES.brickwall, options={};
    (def.options||[]).forEach(o=>{ if(o.default!==undefined) options[o.key]=o.default; });
    Object.assign(options, opt);
    const rows=[{desc:'Back',length:5,height:1,footingLength:5,footingWidth:450,footingDepth:300}];
    const r=T.calcWithRowChoices(def, rows, options, T.ctxFor(s,2));
    return {m:Object.fromEntries(r.materials.filter(m=>m[0]).map(m=>[m[0], m[1]])), blockers:r.blockers||[]};
  }, opt);
  let r = await calc({});
  check('default first skin is Concrete blocks', r.m['Concrete blocks']>0);
  await page.evaluate(()=>{ window.__T.S().settings.brickwallFirstSkinProducts=[{id:'f1',name:'Hollow block 215',price:4,facePricedPer:'piece',piecesPerM2:10,thicknessMm:215,vatIncluded:false},{id:'f2',name:'Stone skin',price:60,facePricedPer:'m2',thicknessMm:150,vatIncluded:false}]; });
  r = await calc({firstSkinProduct:'Hollow block 215'});
  check('per-piece first skin replaces concrete blocks (5 m² × 10 = 50)', r.m['Hollow block 215']===50 && !('Concrete blocks' in r.m));
  r = await calc({firstSkinProduct:'Stone skin'});
  check('per-m² first skin = wall area (5 m²)', r.m['Stone skin']===5 && !('Concrete blocks' in r.m));
  r = await calc({firstSkinProduct:'Missing thing'});
  check('a first skin that no longer exists blocks the quote', r.blockers.some(b=>/first skin product/i.test(b)));

  // Wizard: the dropdown, and adding one needs a cost + supplier
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','First skin UI');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="brickwall"]'); await wait(100);
  await page.click('button[data-action="wizNext"]'); await wait(250);
  check('wizard shows "First skin product", set to Concrete blocks', /First skin product/.test(await txt()) && await page.$eval('select[data-opt="firstSkinProduct"]', e=>e.value)==='Concrete blocks');
  await page.selectOption('select[data-opt="firstSkinProduct"]','__add_other__'); await wait(200);
  await page.fill('#mf_name','Dense block 140'); await page.fill('#mf_price','3.5');
  const pp = await page.$('#mf_piecesPerM2'); if (pp) await pp.fill('10');
  await page.click('button[data-action="modalOk"]'); await wait(200);
  check('adding without a supplier is refused', !!(await page.$('#mf_name')) && /"Supplier" is required/.test(await txt()));
  await page.fill('#mf_supplier','AWBS'); await page.click('button[data-action="modalOk"]'); await wait(300);
  check('new first skin picked', await page.$eval('select[data-opt="firstSkinProduct"]', e=>e.value)==='Dense block 140');
  check('…and saved to the Materials list with its supplier', await page.evaluate(()=>{ const m=window.__T.S().settings.materials['Dense block 140']; return !!m && m.supplier==='AWBS' && m.lib==='brickwallFirstSkinProducts'; }));
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

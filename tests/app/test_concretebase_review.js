// Concrete base review fixes: revising pre-rework quotes, priced MOT depth in the letter,
// "to depths of" wording, whole-mm dig-out. Loads a copy of the app with internals exposed.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={SERVICES,SERVICE_COPY,ctxFor,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_cb_exposed.html', html);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  await page.goto('file:///tmp/mobiletest/_cb_exposed.html'); await page.waitForTimeout(400);

  // ---- Review fixes: legacy rows on revision, priced MOT depth in the letter, wording ----
  const r = await page.evaluate(() => { const T = window.__T;
    const ctx = Object.assign(T.ctxFor(T.S().settings), {netPrice:(p)=>Number(p)||0});
    const legacyOpt = {depth:100, productivity:5};
    const oldOnly = T.SERVICES.concretebase.calc([{width:5,length:4}], legacyOpt, ctx);
    const mixed = T.SERVICES.concretebase.calc([{width:5,length:4},{width:1,length:1,digOutDepth:'200'}], legacyOpt, ctx);
    const copy = T.SERVICE_COPY.concretebase({shutteringLength:''}, {motDepth:80, rows:[{desc:'Shed',width:2,length:2,digOutDepth:'230'},{width:0,length:0},{width:1,length:1,digOutDepth:'180'}]});
    const rounded = T.SERVICES.concretebase.calc([{width:1,length:1,digOutDepth:'200.4'}], {productivity:5}, ctx);
    const rmLib = [{name:'RM', price:100}];
    const rmCtx = Object.assign({}, ctx, {cbReadyMix: rmLib});
    const rmQty = (w,l,d) => { const m = T.SERVICES.concretebase.calc([{width:w,length:l,digOutDepth:String(d),readyMix:true,readyMixProduct:'RM',rebar:false}], {productivity:5}, rmCtx).materials.find(x=>x[0]==='RM'); return m && m[1]; };
    const rm = [rmQty(2,2,200), rmQty(2,3,200), rmQty(5,4,200)];
    return {rm, oldDig: oldOnly.digOutDepth, oldMats: oldOnly.materials.map(m=>m[0]).join('|'),
      mixedBlk: (mixed.blockers||[]).filter(b=>/dig-out depth/.test(b)).length, mixedDig: mixed.digOutDepth, mixedMot: mixed.motDepth,
      copy: copy.join(' '), roundedDig: rounded.digOutDepth};
  });
  check('legacy-only quote still prices the old way', r.oldDig===100 && /Rebar mesh/.test(r.oldMats));
  check('revised old quote: legacy row falls back to old depth + MOT (no 0mm blocker)', r.mixedBlk===0 && Math.abs(r.mixedDig-200)<1e-6);
  check('calc returns the MOT depth used', r.mixedMot===100);
  check('letter uses the priced MOT depth (80mm)', /Type 1 MOT, to a depth of 80mm/.test(r.copy));
  check('letter: "to depths of", base numbered by row position', /to depths of Shed 150mm, base 3 100mm/.test(r.copy));
  check('ready-mix rounds up to 0.5m³ (0.4→0.5, 0.6→1, 2→2)', JSON.stringify(r.rm)==='[0.5,1,2]');
  check('dig-out depth rounded to whole mm', r.roundedDig===200);

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

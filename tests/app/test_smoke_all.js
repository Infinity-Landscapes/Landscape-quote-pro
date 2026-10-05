// Whole-app smoke test: every screen and settings tab (light + dark, phone + desktop), every
// built-in service taken through the quote wizard to the review page, a quote saved, accepted
// and its job page opened — watching for page errors, console errors and sideways overflow.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const errors = [];
  for (const vp of [{width:390,height:844,name:'phone'},{width:1280,height:900,name:'desktop'}]) {
    const page = await (await browser.newContext({ viewport:{width:vp.width,height:vp.height}, timezoneId:'Europe/London' })).newPage();
    await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
    page.on('pageerror', e => errors.push(`[${vp.name}] PAGEERROR: ${e.message}`));
    page.on('console', m => { if (m.type()==='error' && !/net::ERR|Failed to load resource|fonts\.g/.test(m.text())) errors.push(`[${vp.name}] CONSOLE: ${m.text()}`); });
    const settle = () => page.waitForTimeout(220);
    const click = async sel => { const el = await page.$(sel); if(!el) throw new Error('missing '+sel); await el.click(); await settle(); };
    const overflow = () => page.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
    await page.fill('#f_name','Infinity Landscapes and Design LTD');
    for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await click('button[data-action="setupNext"]');
    // ---- every service through the wizard ----
    const services = await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); const b = st[Object.keys(st).find(k=>/business$/.test(k))]; return b.servicesEnabled; });
    const reached = [], crashed = [];
    for (const key of services) {
      const before = errors.length;
      try {
        await click('button[data-nav="newquote"]');
        if (await page.$('button[data-action="startOverDraft"], a[data-action="startOverDraft"]')) {}
        await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Smoke '+key);
        await click('button[data-action="wizNext"]');
        await click(`[data-action="toggleQuoteService"][data-key="${key}"]`);
        await click('button[data-action="wizNext"]');
        // fill whatever measurement boxes the first line has
        for (const f of ['width','length','height','count','depth']) { const el = await page.$(`[data-row="0"] input[data-mf="${f}"]`); if (el) await el.fill(f==='count'?'2':(f==='height'?'1.2':'4')); }
        await settle();
        for (let i=0;i<6 && !(await page.$('button[data-action="saveSentQuote"], #quoteBlockers')); i++) { const n = await page.$('button[data-action="wizNext"]'); if(!n) break; await n.click(); await settle(); }
        const ok = !!(await page.$('.letter'));
        if (ok) reached.push(key); else crashed.push(key);
      } catch(e) { crashed.push(key+' ('+e.message.split('\n')[0]+')'); }
      if (errors.length>before) crashed.push(key+' (errors)');
      // discard the draft
      await click('button[data-nav="menu"]');
      const dd = await page.$('button[data-action="discardDraft"]'); if (dd) { await dd.click(); await settle(); const ok = await page.$('button[data-action="modalOk"]'); if (ok) { await ok.click(); await settle(); } }
    }
    check(`[${vp.name}] all ${services.length} services reach the review page without errors`, crashed.length===0);
    if (crashed.length) console.log('   problems:', crashed.join(', '));
    // ---- save, accept, job page ----
    await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
      d.customServices = [{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2, lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}];
      d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
    await page.reload(); await page.waitForTimeout(500); await page.fill('#loginPin','1234'); await click('button[data-action="login"]');
    await click('button[data-nav="newquote"]');
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Smoke Job'); await click('button[data-action="wizNext"]');
    await click('[data-action="toggleQuoteService"][data-key="custom_testbed"]'); await click('button[data-action="wizNext"]');
    await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','6'); await settle();
    for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++) await click('button[data-action="wizNext"]');
    await click('button[data-action="saveSentQuote"]');
    await click('button[data-action="showAccept"]'); await page.fill('#acceptStart','2026-11-02'); await click('button[data-action="confirmAccept"]');
    const jobText = await page.$eval('#App', e=>e.textContent);
    check(`[${vp.name}] quote saved, accepted, job page complete`, /ongoing/.test(jobText) && /Job finance tracker/.test(jobText) && /Payments against the plan/.test(jobText) && /Materials to order/.test(jobText));
    // ---- every screen and settings tab, light and dark ----
    const screens = [['menu'],['quotes'],['calendar'],['overview'],['settings','services'],['settings','pricing'],['settings','schedule'],['settings','teams'],['settings','materials'],['settings','company'],['settings','letter']];
    const overflowAt = [];
    for (const scheme of ['light','dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [nav, tab] of screens) {
        await click(`button[data-nav="${nav}"]`);
        if (tab) await click(`button[data-action="settingsTab"][data-tab="${tab}"]`);
        if (await overflow()) overflowAt.push(`${scheme} ${nav}${tab?'/'+tab:''}`);
      }
      await click('button[data-nav="quotes"]'); await click('[data-action="openQuote"]');
      if (await overflow()) overflowAt.push(`${scheme} job page`);
    }
    check(`[${vp.name}] every screen opens in light and dark mode with no sideways scrolling`, overflowAt.length===0);
    if (overflowAt.length) console.log('   overflow:', overflowAt.join(', '));
    await page.close();
  }
  check('no page or console errors anywhere', errors.length===0);
  if (errors.length) console.log(errors.slice(0,10).join('\n'));
  console.log(pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass ? 0 : 1);
})();

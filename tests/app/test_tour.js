// First-time walkthrough (tour) + Help / FAQ screen.
//  - starts automatically when a new business finishes setup, over the real screens
//  - every step opens its screen and highlights a visible target
//  - the example quote is never saved, never takes a quote number, never touches a draft in progress
//  - Skip asks "are you sure?" and says where to replay it; skipping or finishing stops it auto-starting
//  - not finished or skipped -> it starts again at the next unlock
//  - Help (?) has Replay the tutorial and FAQ sections for account setup, quotes, billing, cancelling
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('path').join(__dirname, 'tour_shots');
fs.mkdirSync(OUT, {recursive:true});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  const errors = [];
  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  async function newPage(opts={}){
    const context = await browser.newContext(Object.assign({ viewport: { width: 1100, height: 1000 } }, opts));
    const page = await context.newPage();
    await page.addInitScript(mockScript);
    await page.addInitScript('window.__NO_AUTO_TOUR__ = false;');
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });
    return page;
  }
  const wait = (p, ms=250) => p.waitForTimeout(ms);
  async function setup(page){
    await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await wait(page, 400);
    await page.fill('#f_name', 'Tour Test Landscapes');
    for (let i=0;i<3;i++){
      if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); }
      await page.click('button[data-action="setupNext"]'); await wait(page, 200);
    }
    await page.fill('#f_pin', '1234'); await page.fill('#f_pin2', '1234');
    await page.click('button[data-action="setupNext"]'); await wait(page, 500);
  }
  const tourOpen = page => page.$eval('#tourLayer', el => !!el).catch(()=>false);
  const tipText = page => page.$eval('#tourLayer .tour-tip', el => el.innerText).catch(()=> '');
  const store = page => page.evaluate(() => localStorage.getItem('__mockdb__') || '{}');
  async function settingsDoc(page){
    const s = JSON.parse(await store(page));
    const k = Object.keys(s).find(k => /business$/.test(k));
    return k ? s[k] : null;
  }
  async function stepState(page){
    return page.evaluate(() => {
      const tip = document.querySelector('#tourLayer .tour-tip');
      const spot = document.querySelector('#tourLayer .tour-spot');
      const title = (document.querySelector('#tourTitle')||{}).textContent || '';
      const count = (document.querySelector('#tourLayer .tour-count')||{}).textContent || '';
      const sr = spot.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      const spotOn = getComputedStyle(spot).display !== 'none' && sr.width > 10 && sr.height > 10;
      const overlap = spotOn && !(tr.bottom <= sr.top + 8 || tr.top >= sr.bottom - 8 || tr.right <= sr.left + 8 || tr.left >= sr.right - 8) && sr.height < window.innerHeight*0.6;
      const tipVisible = tr.top >= 0 && tr.bottom <= window.innerHeight + 1 && tr.width > 100;
      return { title, count, spotOn, overlap, tipVisible, screenText: document.getElementById('app').innerText };
    });
  }

  // ---------- 1. new business: tour starts by itself and walks every step ----------
  const page = await newPage();
  await setup(page);
  check('tour starts automatically when setup is finished', await tourOpen(page));
  let st = await stepState(page);
  check('first step is the welcome card', /Welcome to Quote Pro/.test(st.title) && /1 of \d+/.test(st.count));
  const s0 = await settingsDoc(page);
  check('tutorialPending saved with the new business', s0 && s0.tutorialPending === true);

  // the app underneath can't be clicked while the tour is open
  const blocked = await page.evaluate(() => {
    const t = document.querySelector('[data-nav="newquote"]'); if(!t) return null;
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return !!(hit && hit.closest('#tourLayer'));
  });
  check('the app underneath is covered while the tour is open', blocked === true);

  const total = parseInt((st.count.match(/of (\d+)/)||[])[1]||'0', 10);
  check('tour has 12+ steps', total >= 12);
  const seen = [];
  const want = {
    'Getting around': /Menu|New quote/,
    'Your business details': /Company/i,
    'Your rates': /day rate|Day rate/i,
    'Your materials list': /Material/i,
    "Step 1: who it's for": /customer/i,
    'Step 2: pick the services': /Turf|Paving|Gravel/,
    'Step 3: measure it': /Measurements/,
    'How the price is worked out': /SECTION COST|Section cost/i,
    'Step 6: check and save': /Mr & Mrs Example/,
    'Your PDF quote': /Download PDF/,
  };
  for (let i = 0; i < total; i++){
    st = await stepState(page);
    seen.push(st.title);
    if (i > 0 && !/Plans, billing/.test(st.title)) check(`step ${i+1} "${st.title}": target highlighted`, st.spotOn);
    check(`step ${i+1} "${st.title}": card fully on screen and not covering the highlight`, st.tipVisible && !st.overlap);
    if (/Plans, billing|Help is always|Getting around|Building a quote/.test(st.title)) check(`step ${i+1} "${st.title}": menu doesn't show the example quote`, !/Mr & Mrs Example|unfinished quote/.test(st.screenText));
    if (want[st.title]) check(`step ${i+1} "${st.title}": real screen shown behind it`, want[st.title].test(st.screenText));
    if (['Welcome to Quote Pro','Step 3: measure it','How the price is worked out','Your PDF quote','Plans, billing and cancelling'].includes(st.title))
      await page.screenshot({ path: `${OUT}/desktop_${String(i+1).padStart(2,'0')}.png` });
    if (i === 2){ // Back works
      await page.click('#tourLayer [data-tour-act="back"]'); await wait(page);
      const b = await stepState(page);
      check('Back goes to the previous step', b.title === seen[1]);
      await page.click('#tourLayer [data-tour-act="next"]'); await wait(page);
    }
    if (i < total - 1){ await page.click('#tourLayer [data-tour-act="next"]'); await wait(page, 300); }
  }
  for (const t of ["Your business details","Your rates","Your materials list","Building a quote","Step 2: pick the services","How the price is worked out","Your PDF quote","Plans, billing and cancelling","Help is always here"])
    check(`tour covers "${t}"`, seen.includes(t));
  const billingTip = seen.indexOf('Plans, billing and cancelling');
  check('last step is "Help is always here" and its button says Finish', seen[seen.length-1] === 'Help is always here' && /Finish/.test(await tipText(page)));
  await page.click('#tourLayer [data-tour-act="next"]'); await wait(page, 500);
  check('Finish closes the tour and lands on the menu', !(await tourOpen(page)) && !!(await page.$('[data-tour="start-quote"]')));
  let sd = await settingsDoc(page);
  check('finishing saves tutorialDone, clears tutorialPending', sd && sd.tutorialDone === true && sd.tutorialPending === false && sd.tutorialOutcome === 'finished');
  const raw = await store(page);
  check('the example quote/customer was never saved anywhere', !/Mr & Mrs Example|__tour__|EXAMPLE/.test(raw));
  check('the quote counter was not used up', !(sd.quoteCounter > 0));
  const inMem = await page.evaluate(() => document.getElementById('app').innerText);
  check('no example quote left on screen', !/Mr & Mrs Example/.test(inMem));
  await page.click('button[data-nav="quotes"], button[data-nav="jobs"]').catch(()=>{}); await wait(page);
  check('Jobs list has no example quote', !/Mr & Mrs Example|EXAMPLE/.test(await page.evaluate(() => document.getElementById('app').innerText)));

  // reload + unlock: no tour now
  await page.reload(); await wait(page, 500);
  await page.fill('#loginPin', '1234'); await page.click('button[data-action="login"]'); await wait(page, 500);
  check('after finishing, the tour does not start again at the next unlock', !(await tourOpen(page)));

  // ---------- 2. Help: FAQ + replay, and a quote in progress survives ----------
  await page.click('button[data-nav="newquote"]'); await wait(page);
  await page.fill('#q_creator', 'Matt'); await page.fill('#q_cname', 'Real Customer Ltd'); await wait(page, 300);
  await page.click('button[data-action="help"]'); await wait(page);
  const helpText = await page.evaluate(() => document.getElementById('app').innerText);
  check('Help opens from the ? button', /Replay the tutorial/.test(helpText));
  for (const h of ['Account and setup','Quotes','Billing and plans','Cancelling'])
    check(`FAQ has a "${h}" section`, helpText.includes(h));
  check('FAQ answers cancelling in the App Store / Google Play', /How do I cancel\?/.test(helpText));
  const faqCount = await page.$$eval('details.faq', els => els.length);
  check('FAQ has 15+ questions', faqCount >= 15);
  await page.click('details.faq >> nth=0'); await wait(page, 150);
  check('a FAQ question opens to show its answer', await page.$eval('details.faq', d => d.open && d.querySelector('.faq-a').offsetHeight > 0));
  await page.screenshot({ path: `${OUT}/desktop_help.png`, fullPage: true });
  await page.click('[data-action="startTour"]'); await wait(page, 400);
  check('Replay the tutorial starts the tour', await tourOpen(page) && /Welcome/.test(await tipText(page)));
  // jump through to the quote steps and finish
  for (let i = 0; i < total - 1; i++){ await page.click('#tourLayer [data-tour-act="next"]'); await wait(page, 150); }
  await page.click('#tourLayer [data-tour-act="next"]'); await wait(page, 400);
  await page.click('button[data-nav="newquote"]'); await wait(page, 300);
  const cname = await page.$eval('#q_cname', el => el.value).catch(()=> '');
  check('the quote in progress is put back after the tour', cname === 'Real Customer Ltd');
  check('the replay did not save the example anywhere', !/Mr & Mrs Example|__tour__/.test(await store(page)));

  // Settings also links to Help
  await page.click('button[data-nav="settings"]'); await wait(page);
  check('Materials & settings has a link to Help, FAQ & tutorial', !!(await page.$('#App [data-action="help"]')));

  // ---------- 3. skipping asks first and says where to replay ----------
  const p2 = await newPage();
  await setup(p2);
  check('(2nd business) tour starts', await tourOpen(p2));
  await p2.click('#tourLayer [data-tour-act="next"]'); await wait(p2);
  const before = (await stepState(p2)).title;
  await p2.click('#tourLayer [data-tour-act="skip"]'); await wait(p2);
  const conf = await tipText(p2);
  check('Skip asks "Are you sure you want to skip?"', /Are you sure you want to skip\?/.test(conf));
  check('the skip prompt says where to reopen it (? Help → Replay the tutorial)', /\?/.test(conf) && /Help/.test(conf) && /Replay the tutorial/.test(conf));
  await p2.screenshot({ path: `${OUT}/desktop_skip_confirm.png` });
  await p2.click('#tourLayer [data-tour-act="keep"]'); await wait(p2);
  check('"Keep going" returns to the same step', (await stepState(p2)).title === before);
  await p2.keyboard.press('Escape'); await wait(p2);
  check('Escape also asks before skipping', /Are you sure/.test(await tipText(p2)));
  await p2.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(p2, 500);
  check('"Yes, skip" closes the tour', !(await tourOpen(p2)));
  sd = await settingsDoc(p2);
  check('skipping is remembered (no auto-start again)', sd && sd.tutorialPending === false && sd.tutorialOutcome === 'skipped');
  await p2.reload(); await wait(p2, 500);
  await p2.fill('#loginPin', '1234'); await p2.click('button[data-action="login"]'); await wait(p2, 500);
  check('after skipping, the next unlock has no tour', !(await tourOpen(p2)));

  // ---------- 4. closed mid-way (app shut) -> starts again at the next unlock ----------
  const p3 = await newPage();
  await setup(p3);
  await p3.click('#tourLayer [data-tour-act="next"]'); await wait(p3);
  await p3.reload(); await wait(p3, 500);
  await p3.fill('#loginPin', '1234'); await p3.click('button[data-action="login"]'); await wait(p3, 500);
  check('tour not finished or skipped -> starts again at the next unlock', await tourOpen(p3));

  // ---------- 5. phone + dark mode screenshots, layout checks ----------
  for (const [name, opts] of [['phone', { viewport:{width:390,height:844} }], ['phone_dark', { viewport:{width:390,height:844}, colorScheme:'dark' }]]){
    const pp = await newPage(opts);
    await setup(pp);
    check(`(${name}) tour starts`, await tourOpen(pp));
    let n = 0;
    for (let i = 0; i < total; i++){
      const s = await stepState(pp);
      const w = await pp.evaluate(() => document.querySelector('#tourLayer .tour-tip').getBoundingClientRect().right <= window.innerWidth + 1);
      if (!(s.tipVisible && w && !s.overlap)) { n++; console.log(`  (${name}) layout issue at step ${i+1} "${s.title}"`, JSON.stringify({tip:s.tipVisible, w, overlap:s.overlap})); }
      if ([0,3,7,8,10,12,13].includes(i) || /Plans, billing/.test(s.title)) await pp.screenshot({ path: `${OUT}/${name}_${String(i+1).padStart(2,'0')}.png` });
      if (i < total - 1){ await pp.click('#tourLayer [data-tour-act="next"]'); await wait(pp, 250); }
    }
    check(`(${name}) every step's card fits on screen without covering the highlight`, n === 0);
    await pp.click('#tourLayer [data-tour-act="skip"]'); await wait(pp);
    await pp.screenshot({ path: `${OUT}/${name}_skip.png` });
    await pp.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(pp, 400);
    const helpBtn = await pp.$('.topbar [data-action="help"]');
    check(`(${name}) ? Help button is visible in the top bar`, !!helpBtn && await helpBtn.isVisible());
    const noHScroll = await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`(${name}) no sideways scrolling on the menu`, noHScroll);
    await helpBtn.click(); await wait(pp);
    await pp.click('details.faq >> nth=0'); await wait(pp, 150);
    await pp.screenshot({ path: `${OUT}/${name}_help.png`, fullPage: true });
  }

  console.log('ERRORS:', errors.length ? errors : 'none');
  if (errors.length) pass = false;
  await browser.close();
  console.log(pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

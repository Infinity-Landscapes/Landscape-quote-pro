// Calendar and Business overview tours: start the first time each screen is opened, highlight
// real parts of the screen, ask before skipping (and say where to replay), never start again once
// finished or skipped (saved with the business), and can be replayed from Help.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/tmp/mobiletest/tour_shots';
fs.mkdirSync(OUT, {recursive:true});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const mock = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  const errors = [];
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  async function newPage(vp){
    const page = await (await browser.newContext({ viewport: vp || {width:1100,height:1000} })).newPage();
    await page.addInitScript(mock);
    await page.addInitScript('window.__NO_AUTO_TOUR__ = false;');
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
    return page;
  }
  const wait = (p, ms=250) => p.waitForTimeout(ms);
  const open = p => p.$eval('#tourLayer', ()=>true).catch(()=>false);
  const tip = p => p.$eval('#tourLayer .tour-tip', e=>e.innerText).catch(()=> '');
  const settings = async p => { const s = JSON.parse(await p.evaluate(()=>localStorage.getItem('__mockdb__')||'{}')); const k = Object.keys(s).find(k=>/business$/.test(k)); return k ? s[k] : {}; };
  async function setupAndSkipMain(p){
    await p.goto('file:///home/claude/build/app.html'); await wait(p, 400);
    await p.fill('#f_name', 'Section Tours Ltd');
    for (let i=0;i<3;i++){ if (await p.$('#f_dayrate')) { await p.fill('#f_dayrate','180'); await p.fill('#f_expenses','90'); } await p.click('button[data-action="setupNext"]'); await wait(p, 200); }
    await p.fill('#f_pin','1234'); await p.fill('#f_pin2','1234');
    await p.click('button[data-action="setupNext"]'); await wait(p, 500);
    await p.click('#tourLayer [data-tour-act="skip"]'); await wait(p);
    await p.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(p, 400);
  }
  async function state(p){
    return p.evaluate(()=>{
      const t = document.querySelector('#tourLayer .tour-tip'), s = document.querySelector('#tourLayer .tour-spot');
      const tr = t.getBoundingClientRect(), sr = s.getBoundingClientRect();
      const spotOn = getComputedStyle(s).display!=='none' && sr.width>10 && sr.height>10;
      const overlap = spotOn && !(tr.bottom<=sr.top+8 || tr.top>=sr.bottom-8 || tr.right<=sr.left+8 || tr.left>=sr.right-8) && sr.height < window.innerHeight*0.6;
      return { title: (document.querySelector('#tourTitle')||{}).textContent||'', count: (document.querySelector('#tourLayer .tour-count')||{}).textContent||'',
        spotOn, overlap, onScreen: tr.top>=0 && tr.bottom<=window.innerHeight+1 && tr.right<=window.innerWidth+1 };
    });
  }
  async function walk(p, label, shotPrefix){
    const first = await state(p);
    const total = parseInt((first.count.match(/of (\d+)/)||[])[1]||'0',10);
    const titles = [];
    for (let i=0;i<total;i++){
      const st = await state(p); titles.push(st.title);
      check(`${label} step ${i+1} "${st.title}": highlighted, card on screen and not covering it`, st.spotOn && st.onScreen && !st.overlap);
      if (shotPrefix) await p.screenshot({ path: `${OUT}/${shotPrefix}_${i+1}.png` });
      if (i<total-1){ await p.click('#tourLayer [data-tour-act="next"]'); await wait(p, 250); }
    }
    return {total, titles};
  }

  // ---------- calendar: first visit starts it, finish keeps you on the calendar ----------
  const p = await newPage();
  await setupAndSkipMain(p);
  check('main tour skipped', !(await open(p)));
  await p.click('button[data-nav="calendar"]'); await wait(p, 500);
  check('opening the Calendar for the first time starts its tour', await open(p) && /Your calendar/.test(await tip(p)));
  check('first button says Next (not "Start the tour")', /Next/.test(await tip(p)) && !/Start the tour/.test(await tip(p)));
  const cal = await walk(p, 'calendar', 'cal');
  check('calendar tour has 4 steps', cal.total === 4);
  check('covers moving months, adding entries and the key', ['Moving around','Adding your own entries','Reading the calendar'].every(t=>cal.titles.includes(t)));
  check('last button says Finish', /Finish/.test(await tip(p)));
  await p.click('#tourLayer [data-tour-act="next"]'); await wait(p, 400);
  check('finishing closes it and stays on the Calendar', !(await open(p)) && !!(await p.$('[data-tour="cal-grid"]')));
  check('calendar tour saved as seen', ((await settings(p)).toursSeen||{}).calendar === 'finished');
  await p.click('button[data-nav="menu"]'); await wait(p); await p.click('button[data-nav="calendar"]'); await wait(p, 400);
  check('opening the Calendar again: no tour', !(await open(p)));

  // ---------- business overview: skip asks first, says where to replay ----------
  await p.click('button[data-nav="overview"]'); await wait(p, 500);
  check('opening the Business overview for the first time starts its tour', await open(p) && /Your business at a glance/.test(await tip(p)));
  const ov = await walk(p, 'overview', 'ov');
  check('overview tour has 4 steps', ov.total === 4);
  check('explains the figures, where they come from, overspending and jobs', ['Your business at a glance','Where the numbers come from','Spotting overspending','Your jobs'].every(t=>ov.titles.includes(t)));
  await p.click('#tourLayer [data-tour-act="skip"]'); await wait(p);
  const sk = await tip(p);
  check('Skip asks "Are you sure" and names "Business overview tour" in Help', /Are you sure you want to skip\?/.test(sk) && /Business overview tour/.test(sk) && /Help/.test(sk));
  await p.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(p, 400);
  check('skipped: closes and stays on the Business overview', !(await open(p)) && !!(await p.$('[data-tour="ov-figures"]')));
  check('overview tour saved as seen (skipped)', ((await settings(p)).toursSeen||{}).overview === 'skipped');
  check('calendar still marked seen', ((await settings(p)).toursSeen||{}).calendar === 'finished');

  // ---------- after reload + unlock: neither starts again ----------
  await p.reload(); await wait(p, 500);
  await p.fill('#loginPin','1234'); await p.click('button[data-action="login"]'); await wait(p, 500);
  await p.click('button[data-nav="calendar"]'); await wait(p, 400);
  check('after reload: Calendar has no tour', !(await open(p)));
  await p.click('button[data-nav="overview"]'); await wait(p, 400);
  check('after reload: Business overview has no tour', !(await open(p)));

  // ---------- Help: replay each, FAQ section ----------
  await p.click('button[data-action="help"]'); await wait(p);
  const help = await p.$eval('#app', e=>e.innerText);
  check('Help has Calendar tour and Business overview tour buttons', /Calendar tour/.test(help) && /Business overview tour/.test(help));
  check('FAQ has a "Jobs, calendar and money" section', /Jobs, calendar and money/.test(help) && /customer said yes/.test(help));
  await p.click('[data-action="startTour"][data-tour-kind="calendar"]'); await wait(p, 500);
  check('Calendar tour replays from Help (opens the Calendar)', await open(p) && /Your calendar/.test(await tip(p)) && !!(await p.$('[data-tour="cal-grid"]')));
  await p.keyboard.press('Escape'); await wait(p); await p.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(p, 400);
  check('replaying doesn\'t undo "finished"', ((await settings(p)).toursSeen||{}).calendar === 'skipped' || ((await settings(p)).toursSeen||{}).calendar === 'finished');
  await p.click('button[data-action="help"]'); await wait(p);
  await p.click('[data-action="startTour"][data-tour-kind="overview"]'); await wait(p, 500);
  check('Business overview tour replays from Help', await open(p) && /Your business at a glance/.test(await tip(p)) && !!(await p.$('[data-tour="ov-figures"]')));
  await p.keyboard.press('Escape'); await wait(p); await p.click('#tourLayer [data-tour-act="confirmSkip"]'); await wait(p, 300);
  await p.click('button[data-action="help"]'); await wait(p);
  await p.click('[data-action="startTour"]:not([data-tour-kind])'); await wait(p, 500);
  check('main tutorial still replays from Help', await open(p) && /Welcome to Quote Pro/.test(await tip(p)));
  check('main tutorial mentions the section tours', await (async()=>{ await p.click('#tourLayer [data-tour-act="next"]'); await wait(p); return /own short tour/.test(await tip(p)); })());

  // ---------- phone width ----------
  const ph = await newPage({width:390,height:844});
  await setupAndSkipMain(ph);
  await ph.click('button[data-nav="calendar"]'); await wait(ph, 500);
  await walk(ph, '(phone) calendar', 'phone_cal');
  await ph.click('#tourLayer [data-tour-act="next"]'); await wait(ph, 300);
  await ph.click('button[data-nav="overview"]'); await wait(ph, 500);
  await walk(ph, '(phone) overview', 'phone_ov');

  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass = false;
  await browser.close();
  console.log(pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

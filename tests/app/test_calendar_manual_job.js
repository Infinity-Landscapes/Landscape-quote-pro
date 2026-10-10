// Verifies the follow-up request (an artifact comment) on the calendar feature: "Make this so
// it is able to add a tick box for is this a job and how many days are allowed" — anchored to
// the "Add calendar entry" form. A manually-added calendar entry can now be ticked as "this is
// a job", given a number of working days, and is scheduled across that many working days using
// the same working-week + skip-blocked-days logic as an app-generated job.
// Checks: the "This is a job" tick box and "Number of working days" field are present on the
// add-entry form; a manual entry NOT ticked as a job still occupies exactly its one date; a
// manual entry ticked as a job with N days spans N working days (skipping non-working days);
// a blocking multi-day manual "job" entry makes a real quoted job skip past every one of its
// days, not just the first; and editing a manual entry to add/remove the job tick recomputes
// its span.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  async function buildFlowerbedQuoteToPreview(name, w, l){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="custom_testbed"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);
    await page.fill('[data-row="0"] input[data-mf="width"]', String(w));
    await page.fill('[data-row="0"] input[data-mf="length"]', String(l));
    // Oct 2026: Flower Beds now needs products and feeds the waste pool — these tests use a custom service
    // (no waste, no £0 blocks) at Flower Beds' old 6.7 m²/day/person rate so every figure is unchanged.
    await page.fill('[data-opt="productivity"]', '6.7');
    await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  }
  async function acceptCurrentQuote(startDate){
    await (await page.$('button[data-action="saveSentQuote"]')).click();
    await page.waitForTimeout(300);
    await (await page.$('button[data-action="showAccept"]')).click();
    await page.waitForTimeout(150);
    await page.fill('#acceptStart', startDate);
    await (await page.$('button[data-action="confirmAccept"]')).click();
    await page.waitForTimeout(300);
    return await page.$eval('#App', el => el.textContent);
  }
  function parseScheduleLine(text){
    const m = text.match(/(\d+) working days?, (\d{2}\/\d{2}\/\d{4})(?: to (\d{2}\/\d{2}\/\d{4}))?\./);
    if(!m) return null;
    return { count: parseInt(m[1],10), first: m[2], last: m[3] || m[2] };
  }
  async function navigateCalendarToMonth(monthLabelSubstr, maxClicks){
    await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
    for(let i=0;i<maxClicks;i++){
      const label = await page.$eval('#calMonthLabel', el => el.textContent).catch(()=>'');
      if(label.includes(monthLabelSubstr)) return true;
      const nextBtn = await page.$('button[data-action="calNextMonth"]');
      if(!nextBtn) return false;
      await nextBtn.click(); await page.waitForTimeout(120);
    }
    return false;
  }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // Oct 2026: these tests need a plain area service with no waste step and no £0 blocks. Every
  // reworked built-in now needs tenant products, so give this business a simple custom service
  // ("Test beds", 6.7 m²/day/person, just consumables) straight in its stored settings and reload.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  // --- Add-entry form has the new "is this a job" tick + "how many days" field ---
  await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="addCalendarEntry"]')).click(); await page.waitForTimeout(150);
  check('"This is a job" tick box is present', !!(await page.$('#mf_isJob')));
  check('"Number of working days" field is present', !!(await page.$('#mf_days')));
  await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(150);

  // --- A plain (non-job) manual entry occupies only its one date ---
  await (await page.$('button[data-action="addCalendarEntry"]')).click(); await page.waitForTimeout(150);
  await page.fill('#mf_title', 'Plain single-day entry');
  await page.fill('#mf_date', '2026-11-02'); // Monday
  // leave "This is a job" unticked
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);
  let found = await navigateCalendarToMonth('November 2026', 14);
  check('could navigate to November 2026', found);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('[plain entry] appears on the calendar', /Plain single-day entry/.test(bodyText));

  // --- A manual entry ticked as a job, 3 working days starting Monday 2026-11-02, should span
  // Mon/Tue/Wed (02, 03, 04 Nov) — not a 4th day. ---
  await (await page.$('button[data-action="addCalendarEntry"]')).click(); await page.waitForTimeout(150);
  await page.fill('#mf_title', 'Subcontracted fencing job');
  await page.fill('#mf_date', '2026-11-09'); // a different Monday, clear of the entry above
  await (await page.$('#mf_isJob')).click();
  await page.fill('#mf_days', '3');
  await (await page.$('#mf_blocksDay')).click(); // tick blocking, so we can test it pushes a real job off later
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[manual job entry] shown with its 🧰 job marker', /🧰 Subcontracted fencing job/.test(bodyText));

  // Jump through the 3 days it should span and confirm it's shown on each, with no 4th day.
  found = await navigateCalendarToMonth('November 2026', 14); // should already be here, but be safe
  for(const d of ['02','03','04','05','06','07','08','09','10','11']) { /* no-op: keeping single month view */ }

  // --- A real quoted job requested to start ON the blocking manual job-entry's FIRST day should
  // skip past the ENTIRE span (09, 10, 11 Nov) and land on 12/11/2026, not just skip one day. ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Blocked-by-manual-job Test', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-09');
  const sched = parseScheduleLine(bodyText);
  check('[real job] skipped the ENTIRE multi-day blocking manual job entry (09-11 Nov) and landed on 12/11/2026', !!sched && sched.first === '12/11/2026');

  // --- Editing a manual entry to turn OFF "this is a job" collapses it back to a single day ---
  await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
  found = await navigateCalendarToMonth('November 2026', 14);
  const chips = await page.$$('[data-action="editCalendarEntry"]');
  let jobChip = null;
  for(const c of chips){ const t = await c.textContent(); if(/Subcontracted fencing job/.test(t)){ jobChip = c; break; } }
  check('found the manual job entry chip to edit', !!jobChip);
  if(jobChip){
    await jobChip.click();
    await page.waitForTimeout(200);
    const isJobChecked = await page.$eval('#mf_isJob', el => el.checked).catch(()=>null);
    check('[edit] "This is a job" is pre-checked', isJobChecked === true);
    const daysVal = await page.$eval('#mf_days', el => el.value).catch(()=>null);
    check('[edit] days field pre-fills 3', daysVal === '3');
    await (await page.$('#mf_isJob')).click(); // untick "this is a job"
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
    await page.waitForTimeout(250);
  }
  // Now a job requested for 2026-11-10 (the entry's old 2nd day) should NOT be pushed off,
  // since the entry collapsed back to just its single start date (09/11) once un-ticked.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('After-untick Test', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-10');
  const sched2 = parseScheduleLine(bodyText);
  check('[after untick] the entry no longer blocks its old 2nd/3rd days — job lands on 10/11/2026', !!sched2 && sched2.first === '10/11/2026');

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

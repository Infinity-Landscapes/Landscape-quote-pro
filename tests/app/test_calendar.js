// Verifies the job calendar feature, per the direct request: "Add a job calendar to the app,
// showing a visual schedule of when confirmed jobs start and their expected duration. Add a
// configurable working-week setting in business settings where the user ticks which days of
// the week they work; job duration is scheduled using only those ticked working days, not a
// hardcoded Monday-to-Friday. Allow manually adding a calendar entry that isn't linked to an
// app-generated quote or job. Each calendar entry, whether job-generated or manually added,
// should have a tick option for whether it blocks that day off from other job scheduling...
// When scheduling a job's span of working days, if a working day within that span is already
// blocked by another entry, the calendar should automatically skip that day and push the job
// onto the next available working day, rather than double-booking."
//
// Checks: the Schedule settings tab exists and defaults to Mon-Fri ticked, Sat/Sun unticked;
// accepting a job schedules it onto working days starting at its agreed start date; a second
// job accepted with the SAME start date, already taken by the first (jobs block by default),
// automatically skips to the next available working day instead of double-booking; a
// manually-added BLOCKING calendar entry likewise makes a job's schedule skip that day; a
// manually-added NON-blocking entry (the default for manual entries) does NOT make a job skip
// that day, so a full job can still land on the same day as something like an evening
// appointment; turning off a weekday in the working-week setting makes job scheduling skip
// that weekday instead of a hardcoded Mon-Fri; the Calendar screen renders both job and manual
// entries on the right days; editing and deleting a manual calendar entry round-trip; and
// editing an ongoing job's schedule (new start date) recomputes its scheduled days.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
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
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // people
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // extras
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview
  }
  async function estimatedDaysOnPreview(){
    // totalDays can be fractional (e.g. "Estimated 0.5 working days on site.") before it's
    // rounded to a whole number of calendar working days by scheduleWorkingDays — round the
    // same way here so this helper reflects how many days the job actually gets scheduled for.
    const txt = await page.$eval('#App', el => el.textContent);
    const m = txt.match(/Estimated ([\d.]+) working day/);
    return m ? Math.max(Math.round(parseFloat(m[1]))||1, 1) : null;
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
  // Pulls "N working day(s), DD/MM/YYYY[ to DD/MM/YYYY]" out of the job detail's Schedule card.
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

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
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

  // --- Schedule settings tab: exists, defaults to Mon-Fri ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="schedule"]')).click(); await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Schedule settings tab is present', /Calendar & scheduling/.test(bodyText));
  check('working week defaults to Monday ticked', await page.$eval('[data-workday="1"]', el => el.checked));
  check('working week defaults to Friday ticked', await page.$eval('[data-workday="5"]', el => el.checked));
  check('working week defaults to Saturday unticked', !(await page.$eval('[data-workday="6"]', el => el.checked)));
  check('working week defaults to Sunday unticked', !(await page.$eval('[data-workday="0"]', el => el.checked)));

  // --- Job A: accept on a known Monday (2026-11-02), a 3x3 flowerbed -> almost certainly 1 day ---
  await buildFlowerbedQuoteToPreview('Calendar Job A', 3, 3);
  const daysA = await estimatedDaysOnPreview();
  check('[Job A] a small 3x3 flowerbed is quoted at exactly 1 working day (needed for the skip-day check below)', daysA === 1);
  bodyText = await acceptCurrentQuote('2026-11-02');
  let sched = parseScheduleLine(bodyText);
  check('[Job A] schedule card is shown', /📅 Schedule/.test(bodyText));
  check('[Job A] scheduled onto its requested start date, 02/11/2026', !!sched && sched.first === '02/11/2026' && sched.count === 1);
  check('[Job A] blocks other job scheduling by default', /Blocks these days from other job scheduling/.test(bodyText));

  // --- Job B: identical size, same requested start date -> 02/11/2026 is already taken by Job A,
  // so Job B must automatically skip to the next working day, 03/11/2026 (a Tuesday). ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Calendar Job B', 3, 3);
  const daysB = await estimatedDaysOnPreview();
  check('[Job B] also quoted at exactly 1 working day', daysB === 1);
  bodyText = await acceptCurrentQuote('2026-11-02');
  sched = parseScheduleLine(bodyText);
  check('[Job B] auto-skipped the already-blocked 02/11/2026 and landed on 03/11/2026 instead of double-booking', !!sched && sched.first === '03/11/2026');

  // --- Manual BLOCKING calendar entry on a Wednesday (2026-11-11) -> a job requested to start
  // that day must skip it, landing on the next working day (12/11/2026, Thursday). ---
  await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="addCalendarEntry"]')).click(); await page.waitForTimeout(150);
  await page.fill('#mf_title', 'Site visit — new enquiry');
  await page.fill('#mf_date', '2026-11-11');
  await (await page.$('#mf_blocksDay')).click(); // tick "block this day off"
  await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Calendar Job C', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-11');
  sched = parseScheduleLine(bodyText);
  check('[Job C] skipped the day blocked by a manual blocking entry (11/11) and landed on 12/11/2026', !!sched && sched.first === '12/11/2026');

  // --- Manual NON-blocking calendar entry (the default) on 2026-11-16 (Monday) -> a job
  // requested to start that day should NOT be pushed off it. ---
  await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="addCalendarEntry"]')).click(); await page.waitForTimeout(150);
  await page.fill('#mf_title', 'Evening appointment — Mrs Jones');
  await page.fill('#mf_date', '2026-11-16');
  // leave "block this day off" unticked — the default
  await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Calendar Job D', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-16');
  sched = parseScheduleLine(bodyText);
  check('[Job D] a non-blocking manual entry does NOT push a full job off the same day', !!sched && sched.first === '16/11/2026');

  // --- Configurable working week: turn Wednesday off, then a job requested to start on a
  // Wednesday must skip straight to Thursday instead of using a hardcoded Mon-Fri week. ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="schedule"]')).click(); await page.waitForTimeout(200);
  await (await page.$('[data-workday="3"]')).click(); // untick Wednesday
  await (await page.$('button[data-action="saveScheduleForm"]')).click();
  await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('schedule settings save confirmation shown', /Schedule saved/.test(bodyText));

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Calendar Job E', 3, 3);
  // 2026-11-25 is a Wednesday, now switched off as a working day.
  bodyText = await acceptCurrentQuote('2026-11-25');
  sched = parseScheduleLine(bodyText);
  check('[Job E] Wednesday turned off in the working week -> job skips 25/11 (Wed) and lands on 26/11 (Thu)', !!sched && sched.first === '26/11/2026');
  // Restore Wednesday as a working day so it doesn't affect anything checked after this.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="schedule"]')).click(); await page.waitForTimeout(200);
  await (await page.$('[data-workday="3"]')).click();
  await (await page.$('button[data-action="saveScheduleForm"]')).click();
  await page.waitForTimeout(250);

  // --- Calendar screen: shows both a job entry and manual entries on the right days ---
  const found = await navigateCalendarToMonth('November 2026', 14);
  check('could navigate the calendar to November 2026', found);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[calendar] shows scheduled job "Calendar Job A"', /Calendar Job A/.test(bodyText));
  check('[calendar] shows the manual "Site visit" entry', /Site visit — new enquiry/.test(bodyText));
  check('[calendar] shows the manual "Evening appointment" entry', /Evening appointment — Mrs Jones/.test(bodyText));

  // --- Edit and delete a manual calendar entry ---
  const siteVisitChip = await page.$('[data-action="editCalendarEntry"]');
  check('a manual calendar entry chip is clickable to edit', !!siteVisitChip);
  // Find the specific "Site visit" chip rather than whichever is first.
  const chips = await page.$$('[data-action="editCalendarEntry"]');
  let targetChip = null;
  for(const c of chips){ const t = await c.textContent(); if(/Site visit/.test(t)){ targetChip = c; break; } }
  check('found the "Site visit" calendar entry chip specifically', !!targetChip);
  if(targetChip){
    await targetChip.click();
    await page.waitForTimeout(200);
    const titleVal = await page.$eval('#mf_title', el => el.value).catch(()=>'');
    check('[edit entry] form pre-fills the existing title', /Site visit/.test(titleVal));
    await page.fill('#mf_title', 'Site visit — RESCHEDULED');
    await (await page.$('button[data-action="modalOk"]')).click();
    await page.waitForTimeout(250);
    bodyText = await page.$eval('#App', el => el.textContent);
    check('[edit entry] updated title now shown on the calendar', /Site visit — RESCHEDULED/.test(bodyText));
    check('[edit entry] old title no longer shown', !/Site visit — new enquiry/.test(bodyText));

    // Delete it.
    const chips2 = await page.$$('[data-action="editCalendarEntry"]');
    let delChip = null;
    for(const c of chips2){ const t = await c.textContent(); if(/RESCHEDULED/.test(t)){ delChip = c; break; } }
    const delBtn = delChip ? await delChip.$('[data-action="deleteCalendarEntry"]') : null;
    check('[delete entry] found its remove (✕) button', !!delBtn);
    if(delBtn){
      await delBtn.click();
      await page.waitForTimeout(150);
      await (await page.$('.modal-overlay button[data-action="modalOk"]')).click();
      await page.waitForTimeout(250);
      bodyText = await page.$eval('#App', el => el.textContent);
      check('[delete entry] entry is gone from the calendar after confirming', !/RESCHEDULED/.test(bodyText));
    }
  }

  // --- Editing an ongoing job's schedule reschedules it ---
  // Job A is still "Calendar Job A" on the calendar/Jobs list — open it and reschedule.
  await (await page.$('button[data-nav="quotes"]')).click(); await page.waitForTimeout(250);
  await (await page.$('[data-action="jobsFilter"][data-filter="ongoing"]')).click();
  await page.waitForTimeout(150);
  const rows = await page.$$('.quote-list-item[data-action="openQuote"]');
  let jobARow = null;
  for(const r of rows){ const t = await r.textContent(); if(/Calendar Job A/.test(t)){ jobARow = r; break; } }
  check('found Calendar Job A in the ongoing jobs list', !!jobARow);
  if(jobARow){
    await jobARow.click();
    await page.waitForTimeout(250);
    bodyText = await page.$eval('#App', el => el.textContent);
    check('[Job A detail] "Edit schedule" button is present on an ongoing job', /Edit schedule/.test(bodyText));
    await (await page.$('[data-action="editJobSchedule"]')).click();
    await page.waitForTimeout(200);
    const startVal = await page.$eval('#mf_startDate', el => el.value).catch(()=>'');
    check('[edit schedule] form pre-fills the current start date', startVal === '2026-11-02');
    await page.fill('#mf_startDate', '2026-12-07'); // a Monday, clear of every other entry above
    await (await page.$('button[data-action="modalOk"]')).click();
    await page.waitForTimeout(300);
    bodyText = await page.$eval('#App', el => el.textContent);
    sched = parseScheduleLine(bodyText);
    check('[edit schedule] job rescheduled onto the new start date', !!sched && sched.first === '07/12/2026');
  }

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

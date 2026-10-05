// Verifies the teams/crews feature, per the direct request: "Add support for teams or crews to
// the job calendar: allow adding an unlimited number of teams in business settings, with staff
// assignable to each. Every job and calendar entry gets assigned to a specific team, and the
// calendar view shows all teams together... Update the clash avoidance logic so it checks each
// team's schedule independently... a blocked day for one team shouldn't prevent scheduling a
// job for a different team on that same day."
//
// Checks: a new tenant starts with one default team; the Teams & crews settings tab can add a
// second team, rename teams, and add/remove staff per team, all round-tripping after Save; a
// job accepted for Team 1 on a given start date does NOT push a job accepted for Team 2 off
// that SAME date (independent schedules); a job IS still pushed off a date already taken by
// another job on the SAME team; the calendar's team filter buttons show/hide the right jobs;
// removing a team that's still in use warns first; and the last remaining team can't be removed.
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
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  }
  async function acceptCurrentQuote(startDate, teamLabel){
    await (await page.$('button[data-action="saveSentQuote"]')).click();
    await page.waitForTimeout(300);
    await (await page.$('button[data-action="showAccept"]')).click();
    await page.waitForTimeout(150);
    await page.fill('#acceptStart', startDate);
    if(teamLabel) await page.selectOption('#acceptTeam', { label: teamLabel });
    await (await page.$('button[data-action="confirmAccept"]')).click();
    await page.waitForTimeout(300);
    return await page.$eval('#App', el => el.textContent);
  }
  function parseScheduleLine(text){
    const m = text.match(/(\d+) working days?, (\d{2}\/\d{2}\/\d{4})(?: to (\d{2}\/\d{2}\/\d{4}))?\./);
    if(!m) return null;
    return { count: parseInt(m[1],10), first: m[2], last: m[3] || m[2] };
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

  // --- Teams & crews settings tab: starts with one default team ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="teams"]')).click(); await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Teams & crews settings tab is present', /Teams & crews/.test(bodyText));
  // Team names live in input VALUES, not text nodes, so read .value rather than textContent.
  async function teamNameValues(){ return page.$$eval('[data-team-name]', els => els.map(e => e.value)); }
  async function teamStaffValues(){ return page.$$eval('[data-team-staff]', els => els.map(e => e.value)); }
  check('starts with one default "Team 1"', (await teamNameValues()).includes('Team 1'));
  check('a lone team cannot be removed yet (only one exists)', !!(await page.$('[data-action="removeTeam"]')));

  // Try removing the only team -> should be blocked with an alert.
  await (await page.$('[data-action="removeTeam"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('.modal-overlay', el => el.textContent).catch(()=>'');
  check('removing the last team is blocked with a warning', /at least one team/i.test(bodyText));
  await (await page.$('.modal-overlay button[data-action="modalOk"]')).click();
  await page.waitForTimeout(150);

  // Add a second team, rename both, add staff to the new one.
  await (await page.$('[data-action="addTeam"]')).click(); await page.waitForTimeout(200);
  check('"+ Add team" created "Team 2"', (await teamNameValues()).includes('Team 2'));
  const nameInputs = await page.$$('[data-team-name]');
  check('two team name inputs now present', nameInputs.length === 2);
  await nameInputs[0].fill('Paving crew');
  await nameInputs[1].fill('Groundworks crew');
  const addStaffBtns = await page.$$('[data-action="addTeamStaff"]');
  await addStaffBtns[1].click(); // add a staff slot to the second team — a re-render happens
  // here, so this also exercises that the not-yet-saved name edits above survive it.
  await page.waitForTimeout(150);
  check('typed name "Paving crew" survives the re-render triggered by "+ Add staff" before Save', (await teamNameValues()).includes('Paving crew'));
  check('typed name "Groundworks crew" survives the re-render triggered by "+ Add staff" before Save', (await teamNameValues()).includes('Groundworks crew'));
  const staffInputs = await page.$$('[data-team-staff]');
  check('a staff input appeared for the second team', staffInputs.length >= 1);
  await staffInputs[staffInputs.length-1].fill('Dave');
  await (await page.$('[data-action="saveTeamsForm"]')).click();
  await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('renamed teams persisted ("Paving crew")', (await teamNameValues()).includes('Paving crew'));
  check('renamed teams persisted ("Groundworks crew")', (await teamNameValues()).includes('Groundworks crew'));
  check('staff member "Dave" persisted under Groundworks crew', (await teamStaffValues()).includes('Dave'));
  check('"Teams saved." confirmation shown', /Teams saved/.test(bodyText));

  // --- Independent scheduling: Team A and Team B can both take the SAME start date ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Paving Crew Job', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-02', 'Paving crew');
  let sched = parseScheduleLine(bodyText);
  check('[Paving crew job] scheduled on its requested date 02/11/2026', !!sched && sched.first === '02/11/2026');
  check('[Paving crew job] shows its team name on the schedule card', /Paving crew/.test(bodyText));

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Groundworks Crew Job', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-02', 'Groundworks crew'); // SAME date, different team
  sched = parseScheduleLine(bodyText);
  check('[Groundworks crew job] NOT pushed off 02/11/2026 despite Paving crew already booked that day — independent team schedules', !!sched && sched.first === '02/11/2026');

  // --- Same-team clash still skips as before ---
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuoteToPreview('Second Paving Crew Job', 3, 3);
  bodyText = await acceptCurrentQuote('2026-11-02', 'Paving crew'); // same date, SAME team as the first
  sched = parseScheduleLine(bodyText);
  check('[second Paving crew job] skips the day already taken by its OWN team and lands on 03/11/2026', !!sched && sched.first === '03/11/2026');

  // --- Calendar: team filter buttons ---
  await (await page.$('button[data-nav="calendar"]')).click(); await page.waitForTimeout(250);
  for(let i=0;i<14;i++){
    const label = await page.$eval('#calMonthLabel', el => el.textContent).catch(()=>'');
    if(label.includes('November 2026')) break;
    await (await page.$('button[data-action="calNextMonth"]')).click(); await page.waitForTimeout(120);
  }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[calendar, all teams] shows the Paving crew job', /Paving Crew Job/.test(bodyText));
  check('[calendar, all teams] shows the Groundworks crew job', /Groundworks Crew Job/.test(bodyText));
  check('team filter buttons are present', /All teams/.test(bodyText));

  const pavingFilterBtn = await page.$('[data-action="calTeamFilter"][data-team]:has-text("Paving crew")') ;
  // Fall back to finding by text content if :has-text isn't supported in this Playwright build.
  const filterBtns = await page.$$('[data-action="calTeamFilter"]');
  let pavingBtn = null;
  for(const b of filterBtns){ const txt = await b.textContent(); if(/Paving crew/.test(txt)){ pavingBtn = b; break; } }
  check('found the "Paving crew" filter button', !!pavingBtn);
  if(pavingBtn){
    await pavingBtn.click();
    await page.waitForTimeout(200);
    bodyText = await page.$eval('#App', el => el.textContent);
    check('[filtered to Paving crew] shows the Paving crew job', /Paving Crew Job/.test(bodyText));
    check('[filtered to Paving crew] hides the Groundworks crew job', !/Groundworks Crew Job/.test(bodyText));
  }

  // --- Removing a team that's still in use warns first ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="teams"]')).click(); await page.waitForTimeout(200);
  const removeBtns = await page.$$('[data-action="removeTeam"]');
  let groundworksRemoveBtn = null;
  for(const b of removeBtns){
    const card = await b.evaluateHandle(el => el.closest('.card'));
    // The team's name lives in its name <input>'s value, not in the card's textContent.
    const nameVal = await card.evaluate(el => { const inp = el.querySelector('[data-team-name]'); return inp ? inp.value : ''; });
    if(/Groundworks crew/.test(nameVal)){ groundworksRemoveBtn = b; break; }
  }
  check('found the remove button for Groundworks crew', !!groundworksRemoveBtn);
  if(groundworksRemoveBtn){
    await groundworksRemoveBtn.click();
    await page.waitForTimeout(150);
    bodyText = await page.$eval('.modal-overlay', el => el.textContent).catch(()=>'');
    check('removing an in-use team says its jobs move to another team', /will move to/.test(bodyText));
    await (await page.$('.modal-overlay button[data-action="modalCancel"]')).click(); // back out, keep the team
  }

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

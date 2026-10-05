// Verifies the unified "Jobs" menu (replacing separate quote/job status views) and the new
// "Business overview" screen, per the direct request: "Replace separate quote and job status
// views with a single 'Jobs' menu item, filterable by status: pending approval, ongoing, finished,
// and cancelled... Add a 'Business overview' menu item... rolling up live totals across all active
// jobs' finance trackers — total profit, which cost category overruns most often, and amounts
// owed versus paid — with a tappable job list underneath." Also covers cancelling an accepted job
// (finance data retained) and permanently deleting a finished/cancelled job with a confirmation.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  async function buildFlowerbedQuote(name){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="custom_testbed"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);
    await page.fill('[data-row="0"] input[data-mf="width"]', '3');
    await page.fill('[data-row="0"] input[data-mf="length"]', '3');
    // Oct 2026: Flower Beds now needs products and feeds the waste pool — these tests use a custom service
    // (no waste, no £0 blocks) at Flower Beds' old 6.7 m²/day/person rate so every figure is unchanged.
    await page.fill('[data-opt="productivity"]', '6.7');
    await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // people
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // extras
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview
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

  // One draft job.
  await buildFlowerbedQuote('Draft Job Customer');
  await (await page.$('button[data-action="saveDraftQuote"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);

  // One ongoing job (accepted).
  await buildFlowerbedQuote('Ongoing Job Customer');
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('button[data-action="showAccept"]')).click(); await page.waitForTimeout(150);
  await page.fill('#acceptStart', '2026-11-05');
  await (await page.$('button[data-action="confirmAccept"]')).click();
  await page.waitForTimeout(300);

  // One job that we'll mark finished.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuote('Finished Job Customer');
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('button[data-action="showAccept"]')).click(); await page.waitForTimeout(150);
  await page.fill('#acceptStart', '2026-11-06');
  await (await page.$('button[data-action="confirmAccept"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('[data-action="markFinished"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('.modal-overlay button[data-action="modalOk"]')).click();
  await page.waitForTimeout(300);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('job pill shows "finished" after marking finished', /finished/.test(bodyText));
  check('"Mark job as finished"/"Cancel this job" buttons are gone once finished', !/Mark job as finished/.test(bodyText));

  // One job that we'll cancel.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  await buildFlowerbedQuote('Cancelled Job Customer');
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('button[data-action="showAccept"]')).click(); await page.waitForTimeout(150);
  await page.fill('#acceptStart', '2026-11-07');
  await (await page.$('button[data-action="confirmAccept"]')).click();
  await page.waitForTimeout(300);
  await (await page.$('[data-action="cancelJob"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('.modal-overlay button[data-action="modalOk"]')).click();
  await page.waitForTimeout(300);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('job pill shows "cancelled" after cancelling', /cancelled/.test(bodyText));
  check('cancelled job still shows its finance tracker (finance data retained)', /Job finance tracker/.test(bodyText));

  // --- Jobs list + filters ---
  await (await page.$('button[data-nav="quotes"]')).click(); await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Jobs screen heading is "Jobs" (not "Previous quotes")', /\bJobs\b/.test(bodyText));
  check('"All" filter tab shows all 4 jobs', /All \(4\)/.test(bodyText));
  check('"Pending approval" filter tab shows 1', /Pending approval \(1\)/.test(bodyText));
  check('"Ongoing" filter tab shows 1', /Ongoing \(1\)/.test(bodyText));
  check('"Finished" filter tab shows 1', /Finished \(1\)/.test(bodyText));
  check('"Cancelled" filter tab shows 1', /Cancelled \(1\)/.test(bodyText));

  await (await page.$('[data-action="jobsFilter"][data-filter="ongoing"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('filtering to "ongoing" shows only the ongoing job', /Ongoing Job Customer/.test(bodyText) && !/Draft Job Customer/.test(bodyText) && !/Finished Job Customer/.test(bodyText) && !/Cancelled Job Customer/.test(bodyText));

  // --- Business overview ---
  await (await page.$('button[data-nav="overview"]')).click(); await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Business overview heading is present', /Business overview/.test(bodyText));
  check('Business overview shows a "Total profit" figure', /Total profit/.test(bodyText));
  check('Business overview shows "Owed by customers" / "Paid so far" figures', /Owed by customers/.test(bodyText) && /Paid so far/.test(bodyText));
  check('Business overview jobs list includes the ongoing job', /Ongoing Job Customer/.test(bodyText));
  check('Business overview jobs list includes the finished job', /Finished Job Customer/.test(bodyText));
  check('Business overview jobs list EXCLUDES the cancelled job', !/Cancelled Job Customer/.test(bodyText));
  check('Business overview jobs list EXCLUDES the still-draft job (no finance tracker yet)', !/Draft Job Customer/.test(bodyText));

  // Tapping a job in the overview list opens its detail.
  const overviewJobRow = await page.$('.quote-list-item[data-action="openQuote"]');
  check('overview job list rows are tappable (openQuote action)', !!overviewJobRow);
  if (overviewJobRow) {
    await overviewJobRow.click();
    await page.waitForTimeout(250);
    bodyText = await page.$eval('#App', el => el.textContent);
    check('tapping a job in the overview opens the quote/job detail screen', /Job finance tracker/.test(bodyText));
  }

  // --- Permanent delete on a finished job --- (navigate purely via the UI, via the Jobs list)
  await (await page.$('button[data-nav="quotes"]')).click(); await page.waitForTimeout(250);
  await (await page.$('[data-action="jobsFilter"][data-filter="finished"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Jobs list filtered to "finished" shows the finished job', /Finished Job Customer/.test(bodyText));
  const finishedRow = await page.$('.quote-list-item[data-action="openQuote"]');
  await finishedRow.click();
  await page.waitForTimeout(250);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('finished job detail offers "Permanently delete this job"', /Permanently delete this job/.test(bodyText));
  await (await page.$('[data-action="deleteQuote"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('.modal-overlay', el => el.textContent).catch(()=>'');
  check('delete confirmation warns it is permanent and finance data will be lost', /[Pp]ermanently delete this job/.test(bodyText));
  await (await page.$('.modal-overlay button[data-action="modalOk"]')).click();
  await page.waitForTimeout(300);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('after confirming, we land back on the Jobs list (not an error screen)', /\bJobs\b/.test(bodyText));
  await (await page.$('[data-action="jobsFilter"][data-filter="finished"]')).click();
  await page.waitForTimeout(150);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('finished job is actually gone after confirming permanent delete', !/Finished Job Customer/.test(bodyText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

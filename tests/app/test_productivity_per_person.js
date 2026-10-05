// Verifies the September 2026 productivity rework (direct user request): productivity is now
// explicitly per-person-per-day. For a given job, calendar days = person-days ÷ people on site
// (rounded up to the nearest quarter day), where person-days = quantity ÷ per-person
// productivity. Labour cost = person-days × day rate per person — NOT multiplied again by
// people on site — so adding more people shortens the schedule without changing the labour
// bill. Running costs = business running costs per day × CALENDAR days (not person-days), since
// they reflect how long the business is tied up on the job regardless of crew size. Also checks
// the VAT-stripping rule: an Inc-VAT material/running-cost price is only divided by (1+VAT rate)
// when the business is VAT-registered; with VAT-registered off, the full flagged price is used
// as-is (no VAT stripped out).
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
  function approxEqual(a,b,eps=0.5){ return Math.abs(a-b)<eps; }

  // Flowerbeds isn't waste-eligible, so its wizard has no extra "Waste removal" step —
  // measure -> people -> extras -> preview, a clean 3 "Next" clicks from the measure page.
  async function buildFlowerbedQuote(name, w, l, people){
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
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> people
    await page.fill('#q_people', String(people));
    await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> extras
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> preview
    const bodyText = await page.$eval('#App', el => el.textContent);
    const daysMatch = bodyText.match(/Estimated ([\d.]+) working day/);
    const labourMatch = bodyText.match(/Labour£([\d,]+\.\d\d)/) || bodyText.match(/Labour\s*£([\d,]+\.\d\d)/);
    const runningMatch = bodyText.match(/Running costs£([\d,]+\.\d\d)/) || bodyText.match(/Running costs\s*£([\d,]+\.\d\d)/);
    return {
      bodyText,
      days: daysMatch ? parseFloat(daysMatch[1]) : null,
      labour: labourMatch ? parseFloat(labourMatch[1].replace(/,/g,'')) : null,
      running: runningMatch ? parseFloat(runningMatch[1].replace(/,/g,'')) : null,
    };
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

  // --- Flower beds, 60 m², at the default 6.7 m²/day/person productivity ---
  // personDays = 60/6.7 = 8.9552...
  // 1 person:  days = ruq(8.9552/1) = 9
  // 3 people:  days = ruq(8.9552/3) = ruq(2.985) = 3
  // 9 people:  days = ruq(8.9552/9) = ruq(0.995) = 1
  // Labour cost should be IDENTICAL across all three (personDays × £150/day/person = £1,343.28).
  async function saveAndReturnToMenu(){
    await (await page.$('button[data-action="saveSentQuote"]')).click().catch(()=>{});
    await page.waitForTimeout(250);
    await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  }

  const r1 = await buildFlowerbedQuote('1 person', 6, 10, 1);
  check('[1 person] days = ruq(60/6.7 / 1) = 9', r1.days === 9);
  await saveAndReturnToMenu();

  const r3 = await buildFlowerbedQuote('3 people', 6, 10, 3);
  check('[3 people] days = ruq(60/6.7 / 3) = 3', r3.days === 3);
  await saveAndReturnToMenu();

  const r9 = await buildFlowerbedQuote('9 people', 6, 10, 9);
  check('[9 people] days = ruq(60/6.7 / 9) = 1', r9.days === 1);
  await saveAndReturnToMenu();

  check('labour cost is the SAME for 1 vs 3 people (not multiplied by headcount)', r1.labour!=null && r3.labour!=null && approxEqual(r1.labour, r3.labour));
  check('labour cost is the SAME for 1 vs 9 people (not multiplied by headcount)', r1.labour!=null && r9.labour!=null && approxEqual(r1.labour, r9.labour));
  check('labour cost matches personDays(8.9552) x £150/day/person = £1343.28', r1.labour!=null && approxEqual(r1.labour, 1343.28, 1));

  // Running costs are driven by CALENDAR days, so they shrink as people increase (9 days -> 3
  // days -> 1 day), proportionally with the day count — the opposite of labour cost above.
  check('running costs for 9 days > running costs for 3 days (driven by calendar days)', r1.running!=null && r3.running!=null && r1.running > r3.running);
  check('running costs for 3 days > running costs for 1 day (driven by calendar days)', r3.running!=null && r9.running!=null && r3.running > r9.running);
  check('running costs scale exactly with calendar days (9 days = 9x the 1-day rate)', r1.running!=null && r9.running!=null && approxEqual(r1.running, 9*r9.running, 1));
  check('running costs scale exactly with calendar days (3 days = 3x the 1-day rate)', r3.running!=null && r9.running!=null && approxEqual(r3.running, 3*r9.running, 1));

  // --- VAT-stripping: turn VAT-registered OFF and confirm an Inc-VAT running-cost rate is used
  // as-is (not divided by 1.2) — business running costs default to £515/day, Inc VAT ticked. ---
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const vatRegisteredBefore = await page.$eval('#st_vatregistered', el => el.checked);
  check('VAT-registered is ON by default', vatRegisteredBefore === true);
  await (await page.$('#st_vatregistered')).click(); // turn OFF
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(250);

  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(150);
  const rNoVat = await buildFlowerbedQuote('VAT off', 6, 10, 9); // 1 day, for a clean per-day comparison
  // With VAT off, expensesPerDay should be the FULL £515 (not £515/1.2=£429.17).
  check('[VAT-registered OFF] running costs for 1 day use the full £515 Inc-VAT rate, not stripped', rNoVat.running!=null && approxEqual(rNoVat.running, 515, 1));
  check('[VAT-registered OFF] that is clearly more than the VAT-stripped 1-day rate from before (£429.17)', rNoVat.running!=null && r9.running!=null && rNoVat.running > r9.running);

  console.log('\n[debug] r1:', r1.days, r1.labour, r1.running);
  console.log('[debug] r3:', r3.days, r3.labour, r3.running);
  console.log('[debug] r9:', r9.days, r9.labour, r9.running);
  console.log('[debug] rNoVat:', rNoVat.days, rNoVat.labour, rNoVat.running);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

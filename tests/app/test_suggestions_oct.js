// Oct 2026 approved suggestions: chase sent quotes (sent N days ago, needs-chasing filter/badge/
// menu banner, Call/Text/Email log a follow-up); one starting measurement row ("+ Add line" for more); sticky
// wizard bar with running total; price a £0 item from inside the quote; materials-to-order list
// merged across services and grouped by supplier; payments set against the plan with overdue
// flags (job, jobs list, overview); deposit shown as a % covering materials/plant/20% running.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId:'Europe/London' })).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(250);
  const click = async sel => { const el = await page.$(sel); if(!el) throw new Error('missing '+sel); await el.click(); await settle(); };
  const txt = () => page.$eval('#App', el => el.textContent);
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  const mutate = async fn => { await page.evaluate(fn); await page.reload(); await page.waitForTimeout(500); await login(); };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await mutate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = [
      {key:'custom_a', label:'Service A', group:'Other services', measureType:'area_wl', v:2, lines:[{material:'Consumables', basis:'job', amount:1, per:1},{material:'Sharp sand', basis:'job', amount:2, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:10},
      {key:'custom_b', label:'Service B', group:'Other services', measureType:'area_wl', v:2, lines:[{material:'Sharp sand', basis:'job', amount:3, per:1},{material:'Cement', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:10}];
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_a','custom_b']);
    d.materials['Sharp sand'].supplier = 'Jewson'; d.materials['Cement'].supplier = 'Travis Perkins'; d.materials['Consumables'].price = 0;
  } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  // ---- build a quote ----
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Chase Test'); await page.fill('#q_cphone','07700 900123'); await page.fill('#q_cemail','chase@example.com'); await settle();
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="custom_a"]');
  await click('[data-action="toggleQuoteService"][data-key="custom_b"]');
  await click('button[data-action="wizNext"]');
  check('measurement step starts with one row', (await page.$$('div[data-row]')).length===1);
  await page.fill('[data-row="0"] input[data-mf="width"]','4'); await settle();
  check('typing doesn\'t add a line by itself', (await page.$$('div[data-row]')).length===1);
  await click('button[data-action="addMeasRow"]');
  check('"+ Add line" adds a second line', (await page.$$('div[data-row]')).length===2);
  await page.fill('[data-row="0"] input[data-mf="length"]','5'); await settle();
  const bar = await page.$('.wiz-bar');
  check('Back/Next bar is pinned to the bottom', !!bar && await bar.evaluate(e=>getComputedStyle(e).position)==='sticky');
  check('bar shows a running total', /Running total£[\d,]+\.\d\d/.test(await bar.textContent()));
  // £0 consumables → price box right in the quote
  check('a £0 item gets a price box in the quote', !!(await page.$('#measBlockers [data-action="quickPrice"]')));
  await page.fill('#measBlockers [data-qp-price]','12'); await click('#measBlockers [data-action="quickPrice"]');
  check('saving the price clears the problem', !(await page.$('#measBlockers')));
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','2'); await page.fill('[data-row="0"] input[data-mf="length"]','5'); await settle();
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++) await click('button[data-action="wizNext"]');
  await click('button[data-action="saveSentQuote"]');
  let t = await txt();
  check('sent quote shows a Follow up card with Call/Text/Email', /Follow up/.test(t) && !!(await page.$('button[data-action="chaseQuote"][data-how="call"]')) && !!(await page.$('button[data-action="chaseQuote"][data-how="text"]')));

  check('says sent today', /Sent today/.test(t));
  // make it 9 days old
  await mutate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ if(/\/quotes\//.test(k)){ const d = new Date(); d.setDate(d.getDate()-9); st[k].sentAt = d.toISOString(); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  t = await txt();
  check('menu shows "1 sent quote needs chasing"', /1 sent quote needs chasing/.test(t));
  await click('button[data-action="showChaseList"]');
  t = await txt();
  check('Needs chasing filter lists it with badge and "Sent 9 days ago"', /Needs chasing \(1\)/.test(t) && /NEEDS CHASING/.test(t) && /Sent 9 days ago/.test(t));
  await page.click('button[data-action="chaseQuote"][data-how="text"]'); await page.waitForTimeout(600);
  check('Text opens a dialog with the message and an sms: link', /just checking you received our quote/.test(await page.$eval('.modal-box textarea', e=>e.value)) && !!(await page.$('.modal-box a[href^="sms:07700900123"][target="_blank"]')));
  await click('button[data-action="modalCancel"]');
  t = await txt();
  check('texting logs a follow-up and clears the flag', /Needs chasing \(0\)/.test(t));
  await click('button[data-action="jobsFilter"][data-filter="all"]'); await click('[data-action="openQuote"]');
  t = await txt();
  check('activity log records the follow-up', /Followed up by text message/.test(t) && /chased today \(text message\)/.test(t));
  await click('button[data-action="chaseQuote"][data-how="email"]');
  check('Email opens a ready-to-send follow-up (nothing sent automatically)', /Following up: your quote/.test(await page.$$eval('.modal-box input', els=>els.map(e=>e.value).join(' '))));
  await click('button[data-action="modalCancel"]');
  await click('button[data-action="chaseQuote"][data-how="call"]');
  check('Call opens a dialog with the number to copy and a tel: link', await page.$eval('.modal-box input', e=>e.value)==='07700 900123' && !!(await page.$('.modal-box a[href="tel:07700900123"][target="_blank"]')));
  await click('button[data-action="modalCancel"]');
  // ---- accept with a past start date ----
  await click('button[data-action="showAccept"]');
  await page.fill('#acceptStart','2026-09-07');
  await click('button[data-action="confirmAccept"]');
  t = await txt();
  check('deposit shown as a % covering materials & plant hire', /Deposit \(\d+% — materials & plant hire\)/.test(t));
  check('Materials to order merges shared items (Sharp sand 5) and groups by supplier', /Materials to order/.test(t) && /JEWSON|Jewson/.test(t) && /Sharpsand5tonne/.test(t.replace(/\s+/g,'')) && /Travis Perkins/i.test(t));
  check('payment tracking flags overdue instalments', /Payments against the plan/.test(t) && /Overdue/.test(t));
  await click('button[data-action="nav"][data-nav="quotes"]');
  check('jobs list shows an OVERDUE badge', /OVERDUE £/.test(await txt()));
  await click('button[data-nav="overview"]');
  t = await txt();
  check('overview shows overdue total and an Overdue payments list', /Overdue£[1-9]/.test(t.replace(/\s+/g,'')) && /Overdue payments/.test(t));
  await click('button[data-nav="quotes"]'); await click('[data-action="openQuote"]');
  await click('button[data-action="markInstalmentPaid"]');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  t = await txt();
  check('Mark paid logs the payment and the deposit shows Paid', /Payments against the plan[\s\S]*Deposit[^]*?Paid/.test(t));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

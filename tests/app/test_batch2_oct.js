// October 2026, batch 2 (19 items): email/WhatsApp addressed to the customer and line endings on
// the share text; "Mark as sent" from the Jobs list; accept as a centred dialog; hand-edited
// payment plan that only saves when it adds up; tenant logo on the payment plan; Job finances on
// its own page; weather day off on the calendar; profit only from completed jobs; Length × Width
// × Depth services; builder field order, labels and required letter bullets; weekly instalment
// label; team colour picker; materials grouped by supplier; green tour buttons; tour wording.
const { chromium } = require('playwright');
const fs = require('fs');
const PLATFORM = `window.__platform = { email:()=>'matt@example.com', signOut(){}, readOnly:()=>false, explainReadOnly(){}, openAccount(){}, openPlans(){}, status:()=>({entitled:true}) };`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let pass = true; const errors = [];
const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };

async function setup(page, url){
  await page.goto(url || 'file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await page.waitForTimeout(150); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await page.waitForTimeout(300);
}
async function makeQuote(page, name, opts={}){
  await page.click('button[data-nav="newquote"]'); await page.waitForTimeout(200);
  const d = await page.$('button[data-action="discardDraft"]'); if (d) { await d.click(); await page.waitForTimeout(150); const c = await page.$('button[data-action="modalOk"]'); if (c) { await c.click(); await page.waitForTimeout(150); } await page.click('button[data-nav="newquote"]'); await page.waitForTimeout(200); }
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname',name);
  if (opts.email) await page.fill('#q_cemail', opts.email);
  if (opts.phone) await page.fill('#q_cphone', opts.phone);
  await page.click('button[data-action="wizNext"]'); await page.waitForTimeout(150);
  await page.click(`[data-action="toggleQuoteService"][data-key="${opts.service||'turf'}"]`); await page.waitForTimeout(150);
  await page.click('button[data-action="wizNext"]'); await page.waitForTimeout(200);
  for (const [k,v] of Object.entries(opts.row || {width:'10', length:'10'})) await page.fill(`[data-row="0"] input[data-mf="${k}"]`, v);
  await page.waitForTimeout(150);
  for (let i=0;i<6 && !(await page.$('button[data-action="saveDraftQuote"]')); i++){ await page.click('button[data-action="wizNext"]'); await page.waitForTimeout(200); }
}
const stored = (page, name) => page.evaluate(n=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')||'{}'); const k = Object.keys(s).find(k=>/quotes\//.test(k) && s[k].customer && s[k].customer.name===n); return k ? s[k] : null; }, name);
const biz = page => page.evaluate(()=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')||'{}'); const k = Object.keys(s).find(k=>s[k] && s[k].materials); return s[k]; });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- 1–2: own website email — addressed to the customer, line endings kept ----------
  for (const share of [true, false]) {
    const ctx = await browser.newContext({ viewport: share ? {width:390, height:844} : {width:1200, height:900}, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
    await page.addInitScript(PLATFORM);
    await page.addInitScript(`(()=>{
      window.__opened = []; window.__copied = []; window.__shared = null;
      document.addEventListener('click', e=>{ const a = e.target && e.target.closest && e.target.closest('a');
        if(a && /^(mailto:|googlegmail:|https:\\/\\/(mail\\.google|outlook|wa\\.me))/.test(a.href)){ window.__opened.push(a.href); e.preventDefault(); } }, true);
      try{ Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{ writeText: async t=>{ window.__copied.push(t); } }}); }catch(e){}
      if(${share}){ navigator.canShare = d => !!(d && d.files); navigator.share = async d => { window.__shared = {title:d.title, text:d.text}; }; }
      else { try{ delete Navigator.prototype.share; delete Navigator.prototype.canShare; }catch(e){} navigator.share = undefined; navigator.canShare = undefined; }
    })();`);
    const tag = share ? '[phone]' : '[desktop]';
    await setup(page);
    await makeQuote(page, 'Email Person', {email:'cust@example.com', phone:'07700 900123'});
    await page.click('button[data-action="saveDraftQuote"]'); await page.waitForTimeout(400);
    if (!(await page.$('button[data-action="emailQuote"]'))) { await page.click('button[data-nav="quotes"]'); await page.waitForTimeout(200); await page.click('[data-action="openQuote"]'); await page.waitForTimeout(200); }
    await page.click('button[data-action="emailQuote"]'); await page.waitForTimeout(300);
    await page.waitForSelector('[data-action="emailDownloadOpen"][data-via="whatsapp"]:not([disabled])', {timeout:30000});
    check(`${tag} a WhatsApp button addressed to the customer's phone`, true);
    if (share) {
      check(`${tag} the hint names the copied address`, /cust@example\.com/.test(await page.$eval('.modal-box', e=>e.innerText)));
      check(`${tag} an "Email app" button that opens addressed to the customer`, !!(await page.$('[data-action="emailDownloadOpen"][data-via="mail"]')));
      await page.click('[data-action="emailShare"]'); await page.waitForTimeout(300);
      const sh = await page.evaluate(()=>window.__shared);
      check(`${tag} share text keeps its line breaks as email line endings (CRLF)`, sh && /\r\n\r\n/.test(sh.text) && !/[^\r]\n/.test(sh.text));
      check(`${tag} the customer's email is copied for "To"`, (await page.evaluate(()=>window.__copied)).includes('cust@example.com'));
    }
    await page.click('[data-action="emailDownloadOpen"][data-via="whatsapp"]'); await page.waitForTimeout(300);
    const opened = await page.evaluate(()=>window.__opened);
    const wa = opened.find(u=>/wa\.me/.test(u)) || '';
    check(`${tag} WhatsApp opens to the customer's number in international form (447700900123)`, /^https:\/\/wa\.me\/447700900123\?text=/.test(wa));
    check(`${tag} WhatsApp message keeps its line breaks`, /%0A%0A/.test(wa));
    check(`${tag} dialog says the PDF was saved and WhatsApp opened`, /WhatsApp opened to 07700 900123/.test(await page.$eval('.modal-box', e=>e.innerText)));
    if (!share) {
      await page.click('[data-action="emailDownloadOpen"][data-via="gmail"]'); await page.waitForTimeout(300);
      const g = (await page.evaluate(()=>window.__opened)).find(u=>/mail\.google/.test(u)) || '';
      check(`${tag} Gmail opens with the customer's email in "To"`, /to=cust%40example\.com/.test(g));
    }
    await ctx.close();
  }

  // ---------- the rest, in the Claude version ----------
  const ctx = await browser.newContext({ viewport: process.env.SHOTS ? {width:390, height:844} : {width:1200, height:1000} });
  const shot = async n => { if (process.env.SHOTS) await page.screenshot({path:`/tmp/mobiletest/b2_${n}.png`, fullPage: n!=='modal'&&!n.startsWith('m_')}); };
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const txt = () => page.$eval('#App', e=>e.innerText);
  const click = async sel => { const el = await page.$(sel); if (!el) throw new Error('missing '+sel); await el.click(); await page.waitForTimeout(200); };
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={S:()=>S, render, teamColor, SECTION_TOURS};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_batch2_exposed.html', html);
  await setup(page, 'file:///tmp/mobiletest/_batch2_exposed.html');

  // 3: Mark as sent from the Jobs list (quotes sent by WhatsApp, text, by hand…)
  await makeQuote(page, 'Batch Two', {phone:'07700 900456'});
  await click('button[data-action="saveDraftQuote"]');
  await click('button[data-nav="quotes"]');
  check('draft quote in the Jobs list has a "Mark as sent" button', !!(await page.$('button[data-action="markSentList"]')));
  await click('button[data-action="markSentList"]');
  check('marking it sent from the list stores it as sent', (await stored(page,'Batch Two')).status==='sent');
  check('…and the list no longer offers it', !(await page.$('button[data-action="markSentList"]')) && await page.$eval('#App', e=>/\bsent\b/.test(e.innerText)));
  await click('[data-action="openQuote"]');

  // 4: accept opens a centred dialog
  await click('button[data-action="showAccept"]');
  await shot('m_accept');
  check('accept opens as a dialog with the start date and team', !!(await page.$('.modal-overlay .modal-box #acceptStart')) && !!(await page.$('.modal-overlay #acceptTeam')));
  await click('button[data-action="confirmAccept"]');
  check('no date: the dialog stays open and says why', !!(await page.$('.modal-overlay #acceptStart')) && /Pick the agreed start date first/.test(await page.$eval('.modal-box', e=>e.innerText)));
  await page.fill('#acceptStart','2026-11-02');
  await click('button[data-action="confirmAccept"]');
  let q = await stored(page,'Batch Two');
  check('accepting closes the dialog and the job is ongoing with a plan', !(await page.$('.modal-overlay')) && q.status==='ongoing' && q.paymentSchedule.length>1);

  // 7: job finances on their own page
  let t = await txt();
  check('job page no longer carries the finance tracker / materials list / payment tracking', !/Job finance tracker/.test(t) && !(await page.$('[data-action="copyOrder"],[data-action="markInstalmentPaid"],[data-action="addPayment"]')));
  check('job page has a Job finances card with a button', /Job finances/.test(t) && !!(await page.$('button[data-action="openJobFinances"]')));
  await click('button[data-action="openJobFinances"]');
  t = await txt();
  await shot('finances');
  check('Job finances page shows materials to order, payments against the plan and the tracker', /Job finances — Batch Two/.test(t) && /Materials to order/.test(t) && /Payments against the plan/.test(t) && /Job finance tracker/.test(t));
  await click('button[data-action="closeJobFinances"]');
  check('Back returns to the job page', !!(await page.$('#paymentCapture')));

  // 6: tenant logo on the payment plan
  check('Infinity (no uploaded logo) keeps its text name on the payment plan', !(await page.$('#paymentCapture img.invoice-logo')) && !!(await page.$('#paymentCapture .invoice-brand')));
  await page.evaluate(p=>{ __T.S().logo = p; __T.render(); }, PNG);
  check('an uploaded logo appears at the top of the payment plan', !!(await page.$('#paymentCapture img.invoice-logo')));
  await page.evaluate(()=>{ __T.S().logo = null; __T.render(); });

  // 5: hand-edited payment plan
  const target = q.totals.total, n0 = q.paymentSchedule.length;
  await click('button[data-action="editPaymentPlan"]');
  await shot('planedit');
  check('plan editor opens with every payment', (await page.$$('[data-perow]')).length===n0);
  await click('button[data-action="planEditSplit"][data-idx="0"]');
  check('Split in two adds a payment and still adds up (Save enabled)', (await page.$$('[data-perow]')).length===n0+1 && !(await page.$eval('#planEditSave', b=>b.disabled)));
  const a0 = await page.$eval('[data-pe="amount"][data-pe-i="0"]', e=>e.value);
  await page.fill('[data-pe="amount"][data-pe-i="0"]', (parseFloat(a0)+10).toFixed(2));
  check('changing an amount so it no longer adds up disables Save', await page.$eval('#planEditSave', b=>b.disabled) && /£10\.00 more than the quote total/.test(await page.$eval('#planEditStatus', e=>e.textContent)));
  await page.fill('[data-pe="amount"][data-pe-i="1"]', (parseFloat(await page.$eval('[data-pe="amount"][data-pe-i="1"]', e=>e.value))-10).toFixed(2));
  check('taking it off another payment makes it add up again', !(await page.$eval('#planEditSave', b=>b.disabled)) && /Adds up to/.test(await page.$eval('#planEditStatus', e=>e.textContent)));
  await page.fill('[data-pe="label"][data-pe-i="0"]', 'Deposit — first half');
  await click('button[data-action="planEditSave"]');
  q = await stored(page,'Batch Two');
  const sumNow = Math.round(q.paymentSchedule.reduce((a,p)=>a+p.amount,0)*100)/100;
  check('saved plan has the extra payment, the new label and adds up to the total', q.paymentSchedule.length===n0+1 && q.paymentSchedule[0].label==='Deposit — first half' && /\(part 2\)$/.test(q.paymentSchedule[1].label) && Math.abs(sumNow-target)<0.005 && q.planEdited===true);
  check('the payment plan document shows the edited plan', /Deposit — first half/.test(await page.$eval('#paymentCapture', e=>e.innerText)));

  // 8: weather day off on the calendar
  const days0 = q.scheduledDays.slice(), final0 = q.paymentSchedule.find(p=>/^Final payment/.test(p.label));
  await click('button[data-nav="calendar"]');
  await page.evaluate(()=>{ __T.S()._calMonth = {year:2026, month:10}; __T.render(); }); await page.waitForTimeout(150);
  await click(`button[data-action="addCalendarEntryForDay"][data-date="${days0[0]}"]`);
  await shot('m_dayoptions');
  check('a day with a job offers a day off for it', !!(await page.$('.modal-box button[data-action="dayOffForJob"]')) && /Day off for Batch Two/.test(await page.$eval('.modal-box', e=>e.innerText)));
  check('…and still offers a normal calendar entry', !!(await page.$('.modal-box button[data-action="dayAddEntry"]')));
  await click('.modal-box button[data-action="dayOffForJob"]');
  await click('button[data-action="modalOk"]'); await page.waitForTimeout(200);
  q = await stored(page,'Batch Two');
  const exp = []; { let d = new Date(days0[0]); while (exp.length < days0.length) { d.setDate(d.getDate()+1); if (d.getDay()>0 && d.getDay()<6) exp.push(d.toISOString().slice(0,10)); } }
  check(`job moved back one working day (${days0.join(',')} → ${q.scheduledDays.join(',')})`, JSON.stringify(q.scheduledDays)===JSON.stringify(exp));
  check('day off stored with its reason', q.daysOff && q.daysOff[0].date===days0[0] && q.daysOff[0].reason==='weather');
  const final1 = q.paymentSchedule.find(p=>/^Final payment/.test(p.label));
  check('completion payment follows the new last day', !final0 || final1.date===q.scheduledDays[q.scheduledDays.length-1]);
  check('a message says where the job now finishes', /now finishes/.test(await page.$eval('.modal-box', e=>e.innerText).catch(()=>'')));
  const ok = await page.$('.modal-box button[data-action="modalOk"]'); if (ok) await ok.click(); await page.waitForTimeout(150);
  await shot('calendar');
  check('calendar shows the day off', /Batch Two — day off/.test(await txt()));
  check('activity log records it', /Day off on/.test(JSON.stringify(q.activityLog)));
  await click('button[data-action="addCalendarEntry"]');
  check('"+ Add entry" (no day picked) still goes straight to the entry form', !!(await page.$('.modal-box #mf_title')));
  await click('button[data-action="modalCancel"]');

  // 9 + 19: profit only from completed jobs
  await click('button[data-nav="overview"]');
  t = await txt();
  check('ongoing job: total profit £0.00 (0 completed jobs)', /Total profit \(0 completed jobs\)\s*£0\.00/i.test(t));
  await click('button[data-nav="quotes"]'); await click('[data-action="openQuote"]');
  await click('button[data-action="markFinished"]'); await click('.modal-overlay button[data-action="modalOk"]');
  await click('button[data-nav="overview"]');
  t = await txt();
  check('finished job counts towards total profit', /Total profit \(1 completed job\)\s*£[1-9]/i.test(t));
  check('overview tour: total profit is "what you\'ve made on completed jobs"', await page.evaluate(()=>__T.SECTION_TOURS.overview.steps()[0].body.includes("what you've made on completed jobs")));

  // 15: weekly instalment label
  await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('weekly instalment explains it is charged to the customer each week', /Weekly instalment \(£\) \(the amount charged to the customer each week on their invoice\)/.test(await txt()));

  // 16: team colour
  await click('button[data-action="settingsTab"][data-tab="teams"]');
  const tid = await page.$eval('[data-team-color]', e=>e.getAttribute('data-team-color'));
  await page.selectOption(`[data-team-color="${tid}"]`, '#c1503a'); await page.waitForTimeout(100);
  await shot('teams');
  check('picking a colour updates the swatch straight away', /193, 80, 58/.test(await page.$eval(`[data-team-swatch="${tid}"]`, e=>e.style.background)));
  await click('button[data-action="saveTeamsForm"]');
  check('team colour saved', (await biz(page)).teams[0].color==='#c1503a');
  check('calendar uses the chosen colour', await page.evaluate(id=>__T.teamColor(id), tid)==='#c1503a');
  await page.selectOption(`[data-team-color="${tid}"]`, ''); await click('button[data-action="saveTeamsForm"]');
  check('"Automatic" goes back to the palette colour', !(await biz(page)).teams[0].color);

  // 17: materials grouped by supplier
  await click('button[data-action="settingsTab"][data-tab="materials"]');
  t = await txt();
  await shot('materials');
  check('materials page reminds to check prices roughly monthly', /Check your prices with each supplier roughly once a month/.test(t));
  const heads = await page.$$eval('.tbl-wrap > div', els=>els.map(e=>e.textContent.trim()));
  const sups = await page.evaluate(()=>[...new Set(Object.values(__T.S().settings.materials).map(m=>(m.supplier||'').trim()).filter(Boolean))]);
  check('materials are grouped under supplier headings', heads.length>0 && heads.filter(h=>h!=='No supplier set').every(h=>sups.includes(h)) && (sups.length===0 || heads.length>=Math.min(2, sups.length)));
  await page.fill('#matFilter', sups[0] || 'zzz'); await page.waitForTimeout(150);
  check('searching by supplier name finds that supplier\'s materials', sups.length===0 || (await page.$$eval('.tbl-wrap > div', els=>els.map(e=>e.textContent.trim()))).includes(sups[0]));
  await page.fill('#matFilter', ''); await page.waitForTimeout(100);

  // 18: green tour buttons
  await click('button[data-action="help"]');
  await shot('help');
  check('Replay, Calendar tour and Business overview tour are all green (primary) buttons', (await page.$$eval('button[data-action="startTour"]', bs=>bs.map(b=>b.classList.contains('btn-primary')))).join()==='true,true,true');

  // 10–14: service builder
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  await click('button[data-action="startSvcBuilder"]');
  check('Length × Width × Depth is offered as a measurement type', /Length × Width × Depth/.test(await txt()));
  await page.fill('#svcName','Dig out');
  await click('[data-action="setSvcMeasureType"][data-val="volume"]');
  await click('button[data-action="svcBuilderNext"]');
  const order = await page.evaluate(()=>{ const b = document.querySelector('[data-svcmat-basis="0"]'), a = document.querySelector('[data-svcmat-amount="0"]'); return !!(b && a && (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  await shot('builder2');
  check('add material: the quantity type selector comes before the amount', order);
  t = await txt();
  check('"Only when" and "Number option" now explain themselves', /Include this material/.test(t) && /Which number option\?/.test(t) && /Only used when the quantity is worked out/.test(t));
  check('per m³ quantity rule for a volume service', /per 1 m³|per m³/.test(await page.$eval('[data-svcmat-basis="0"]', e=>e.innerText)));
  await page.fill('[data-svcmat-name="0"]','Muck away load'); await page.fill('[data-svcmat-amount="0"]','1'); await page.fill('[data-svcmat-per="0"]','1');
  await page.fill('[data-svcmat-unit="0"]','m³'); await page.fill('[data-svcmat-price="0"]','30'); await page.fill('[data-svcmat-supplier="0"]','Skip Co');
  await click('button[data-action="svcBuilderNext"]');
  t = await txt();
  await shot('builder3');
  check('letter wording is required and pre-filled with three example bullets', /Quote letter wording \*/.test(t) && (await page.$$('[data-svcltr-text]')).length===3);
  check('helper text explains it is where you describe your method', /Describe your method here/.test(t));
  check('"+ Add bullet" button', !!(await page.$('button[data-action="addSvcLetterRow"]')) && /\+ Add bullet/.test(t));
  for (let i=0;i<3;i++) await click('button[data-action="removeSvcLetterRow"][data-idx="0"]');
  await page.fill('#svcProductivity','4');
  await click('button[data-action="svcBuilderNext"]');
  check('cannot continue with no letter bullets', /Add at least one bullet to the quote letter wording/.test(await txt()));
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="0"]','Area dug out to the depth agreed and the spoil taken away');
  await click('button[data-action="svcBuilderNext"]');
  await click('button[data-action="saveServiceBuilder"]');
  const cs = (await biz(page)).customServices.find(c=>c.label==='Dig out');
  check('volume service saved with its letter bullet', cs && cs.measureType==='volume' && cs.letter.length===1);
  // quote it: 2m × 3m × 500mm = 3 m³
  await makeQuote(page, 'Volume Customer', {service: cs.key, row:{width:'2', length:'3', depth:'500'}});
  t = await txt();
  check('a Length × Width × Depth row asks for the depth in mm and prices 3.00 m³', /3\.00 m³/.test(t));
  check('the letter carries the business\'s own bullet', /Area dug out to the depth agreed and the spoil taken away\./.test(t));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

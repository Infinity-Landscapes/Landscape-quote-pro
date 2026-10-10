// Oct 2026: extras ask for materials £, plant hire £ and labour person-days. Labour = days × day
// rate, the days split across the crew add to days on site (and running costs); only materials and
// plant go towards the deposit; the letter shows each extra at its full sell price; old qty × price
// extras still read as materials.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={calcQuote,extrasBreakdown,extraParts,calcPaymentSchedule,createFinanceTracker,extraSellPrice,ctxFor,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_extras_exposed.html', html);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({timezoneId:'Europe/London'})).newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  await page.goto('file:///tmp/mobiletest/_extras_exposed.html'); await page.waitForTimeout(400);
  const r = await page.evaluate(()=>{
    const T = window.__T; const st = T.S().settings; st.dayRatePerPerson = 150; st.expensesPerDay = 100; st.expensesIncludeVat = false;
    const ctx = Object.assign(T.ctxFor(st, 2), {markupPercent:10, vatRate:0.2});
    // extra: materials 200, plant 100, 3 person-days with 2 people → 1.5 days on site
    const extras = [{description:'Outside tap', materials:'200', plant:'100', labourDays:'3'}];
    const xb = T.extrasBreakdown(extras, ctx);
    const t = T.calcQuote([], extras, ctx);
    const plan = T.calcPaymentSchedule([], extras, t, '2026-11-02', 4000, true, '2026-11-03');
    const q = {totals:t, sections:[], extras: extras.map((e,i)=>Object.assign({}, e, {cost: xb.each[i]})), markupPercent:10, vatRate:0.2, vatRegistered:true};
    const fin = T.createFinanceTracker(q);
    const legacy = T.extraParts({description:'Old', qty:2, price:50});
    return {xb, t, dep: plan[0], fin: {m: fin.materials.quotedTotal, l: fin.labor.quotedCost, r: fin.runningCosts.quotedTotal, chk: fin.materials.checklist.map(c=>c.quotedTotal)}, sell: T.extraSellPrice(q, q.extras[0]), legacy};
  });
  check('labour = 3 person-days × £150 = £450', r.xb.labour===450);
  check('1.5 days on site (3 ÷ 2 people) → running £150', r.xb.days===1.5 && r.xb.expenses===150);
  check('extra cost = 200 + 100 + 450 + 150 = £900', Math.abs(r.xb.total-900)<1e-9 && Math.abs(r.t.extrasTotal-900)<1e-9);
  check('days add to the job\'s days on site', r.t.totalDays===1.5);
  // deposit share = (200+100)/900 = 33% of total (900 × 1.1 × 1.2 = 1188) = 396
  check('deposit covers only materials + plant: 33% = £396.00', /Deposit \(33%/.test(r.dep.label) && Math.abs(r.dep.amount-396)<0.01);
  check('finance baselines split the extra (materials 200 / labour 450 / running+plant 250)', r.fin.m===200 && r.fin.l===450 && r.fin.r===250 && JSON.stringify(r.fin.chk)==='[200]');
  check('letter sell price = 900 × 1.1 × 1.2 = £1,188.00', r.sell===1188);
  check('old qty × price extra reads as materials (2 × £50 = £100)', r.legacy.legacy && r.legacy.materials===100);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

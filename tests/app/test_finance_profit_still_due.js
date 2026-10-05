// "Profit so far" deducts the quoted allowance still to come: unordered materials, labour for
// days not yet logged, and running costs pro rata to those days; nothing once finished/cancelled.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={financeActualProfit,financeStillDue,financeTrackerHtml,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_fin_exposed.html', html);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  await page.goto('file://'+__dirname+'/_fin_exposed.html'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const T = window.__T; T.S().settings.dayRatePerPerson = 150;
    // price £10,000 ex VAT: materials 3,000 (A 2,000 + B 1,000), labour 3,000 (20 person-days), running 1,000, margin 3,000
    const mk = () => ({status:"ongoing", totals:{subtotal:10000, markup:3000}, finance:{
      materials:{quotedTotal:3000, checklist:[{name:'A',quotedTotal:2000,ordered:false,actualTotal:null},{name:'B',quotedTotal:1000,ordered:false,actualTotal:null}], unplanned:[]},
      labor:{quotedDays:10, quotedCost:3000, log:[]}, runningCosts:{quotedTotal:1000, entries:[]}, payments:[]}});
    const out = {};
    let q = mk(); out.start = T.financeActualProfit(q);
    q.finance.materials.checklist[0].ordered = true; q.finance.materials.checklist[0].actualTotal = 1800;
    out.afterOrder = T.financeActualProfit(q);              // saved £200 on A
    q.finance.labor.log.push({hours:80});                    // 10 person-days = £1,500, half the labour
    out.due = T.financeStillDue(q);
    out.afterHalf = T.financeActualProfit(q);
    q.finance.runningCosts.entries.push({amount:400});       // logged 400 for the first half (allowance 500)
    out.afterRunning = T.financeActualProfit(q);
    q.finance.runningCosts.entries.push({amount:300});       // now 700 logged — over the 500 allowance
    out.overRunning = T.financeActualProfit(q);
    q.status = "finished"; out.finished = T.financeActualProfit(q);
    q.status = "ongoing"; out.html = T.financeTrackerHtml(q).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    return out;
  });
  check('before any spend, profit so far = quoted margin £3,000', r.start===3000);
  check('ordering a material under quote shows the saving (£3,200)', r.afterOrder===3200);
  check('still due: materials £1,000, labour £1,500, running £500', r.due.materials===1000 && r.due.labor===1500 && r.due.runningCosts===500 && r.due.total===3000);
  check('half the labour worked at quoted rate: profit unchanged (£3,200) — running for worked days counted at allowance', r.afterHalf===3200);
  check('logging running costs under the allowance keeps the allowance (£3,200)', r.afterRunning===3200);
  check('logging running costs over the allowance lowers profit (£3,000)', r.overRunning===3000);
  // finished: 10000 − (1800 + 1500 + 700) = 6000 (B never ordered, half the labour never needed)
  check('finished job: nothing still due (£6,000)', r.finished===6000);
  check('tracker explains the allowance still to come', /Allows £3,000\.00 still to come — materials not yet ordered £1,000\.00 · labour for days not yet worked £1,500\.00 · running costs for those days £500\.00/.test(r.html));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

// October 2026 Pond rework: per-row depth, liner/pump/filter products, liner fit check (either
// orientation), underlay from the required liner area, rocks coverage, bridge product,
// electrics letter line, £0 blocks, and per-row depth feeding the waste pool.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1700 } })).newPage();
  require('/tmp/mobiletest/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  async function addVia(sel, f){ await page.selectOption(sel,'__add_other__'); await settle();
    for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  const fillRow = async (i, f, v) => { await page.fill(`[data-row="${i}"] input[data-mf="${f}"]`, v); await settle(); };

  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('Pond settings: overlap 300, rocks 5, consumables 1', await page.$eval('#st_pondOverlap',e=>e.value)==='300' && await page.$eval('#st_pondRocks',e=>e.value)==='5' && await page.$eval('#st_pondConsumables',e=>e.value)==='1');

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Pond test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="pond"]');
  await click('button[data-action="wizNext"]');
  check('row depth defaults to 600mm', await page.$eval('[data-row="0"] input[data-mf="digOutDepth"]', e=>e.value)==='600');
  check('no job-level dig-out depth option', !(await page.$('[data-opt="digOutDepth"]')));
  await fillRow(0,'length','5'); await fillRow(0,'width','4');
  await fillRow(1,'length','2'); await fillRow(1,'width','1.5'); await fillRow(1,'digOutDepth','400');
  let t = await txt();
  check('row shows the liner size it needs (6800 × 5800)', /Needs a liner of at least 6800 × 5800 mm/.test(t));
  check('blocker: pick a liner (with size)', /Row 1: pick a liner \(needs at least 6800 × 5800 mm\)/.test(t));
  await addVia('[data-row="0"] select[data-mf="liner"]', {name:'Small liner', price:150, lengthMm:3000, widthMm:3500});
  check('too-small liner blocked with required size', /liner "Small liner" \(3000 × 3500 mm\) is too small — it needs at least 6800 × 5800 mm/.test(await txt()));
  await addVia('[data-row="0"] select[data-mf="liner"]', {name:'Big liner', price:500, lengthMm:7000, widthMm:6000});
  await page.selectOption('[data-row="1"] select[data-mf="liner"]','Small liner'); await settle();
  await addVia('[data-row="0"] select[data-mf="pump"]', {name:'P1', price:200});
  await page.selectOption('[data-row="1"] select[data-mf="pump"]','P1'); await fillRow(1,'pumpQty','2');
  await addVia('[data-row="0"] select[data-mf="filter"]', {name:'F1', price:300});
  await fillRow(1,'filterQty','0');
  await click('button[data-action="setRowFlag"][data-row="1"][data-field="electrics"][data-val="true"]');
  t = await txt();
  check('small liner fits row 2 rotated (3400 × 2900 inside 3000 × 3500)', !/Small liner" \(3000 × 3500 mm\) is too small/.test(t));
  check('one liner per row at its own price', t.includes('Big liner1') && t.includes('Small liner1'));
  check('underlay = 6.8×5.8 + 3.4×2.9 = 49.3 m²', t.includes('Pond underlay49.3'));
  check('pumps 1 + 2 = 3, filters 1', t.includes('P13') && t.includes('F11'));
  check('rocks = ROUNDUP(23/5) = 5', t.includes('Rocks5'));
  check('consumables 1', t.includes('Consumables1'));
  check('labour = 23/16.7 × £150 = £206.59', /206\.59/.test(t));
  await click('button[data-action="setOpt"][data-opt="bridge"][data-val="true"]');
  check('blocker: select a bridge', /Select a bridge/.test(await txt()));
  await addVia('select[data-opt="bridgeProduct"]', {name:'Wood bridge', price:400});
  t = await txt();
  check('bridge line', t.includes('Wood bridge1'));
  check('no blockers', !/Needs attention/.test(t));
  await click('button[data-action="wizNext"]');
  t = await txt();
  check('waste area 23.00 m²', /23\.00 m²/.test(t));
  check('waste volume 20×0.6 + 3×0.4 = 13.20 m³', /13\.20 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('letter keeps shelf/central depth wording', /20–30cm deep, then a deeper central zone to at least 60cm/.test(t));
  check('letter: pump and filter line', /Pump and filter installed and commissioned\./.test(t));
  check('letter: electrics line', /The pond requires a power connection — a price for this will be provided separately by an independent electrician\./.test(t));
  check('letter: bridge line', /Bridge installed across the pond\./.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  for (let i=0;i<6 && !(await page.$('[data-row="0"] select[data-mf="pump"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  await addVia('[data-row="0"] select[data-mf="pump"]', {name:'Free pump', price:0});
  check('adding a product at £0 is refused — dialog stays open and asks for the cost', !!(await page.$('#mf_name')) && /more than £0/.test(await txt()));
  await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(250);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

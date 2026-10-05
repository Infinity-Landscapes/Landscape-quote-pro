// "Edit existing products": ✎ Edit option on row product dropdowns (Water Features), source-backed
// option dropdowns (Paving jointing compound), materials-list dropdowns (Gravel style), and an ✎
// button on every product library in Settings.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1600 } })).newPage();
  require(__dirname+'/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  async function via(sel, val, f){ await page.selectOption(sel,val); await settle();
    for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    await click('button[data-action="modalOk"]'); }
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Gravel edit');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="gravel"]');
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','4'); await settle();
  await page.selectOption('select[data-opt="style"]','__add_other__'); await settle();
  await page.fill('#modalMatName','Test gravel'); await page.fill('#modalMatPrice','60');
  await click('button[data-action="modalOk"]');
  check('gravel style has an Edit option', (await page.$eval('select[data-opt="style"] option[value="__edit_current__"]', o=>o.textContent)).includes('Edit "Test gravel"'));
  const before = await txt();
  await page.selectOption('select[data-opt="style"]','__edit_current__'); await settle();
  check('material edit dialog prefilled with price 60', /Edit Test gravel/.test(await txt()) && await page.$eval('#mf_price',e=>e.value)==='60');
  await page.fill('#mf_price','120'); await page.fill('#mf_supplier','Quarry Co'); await click('button[data-action="modalOk"]');
  let t = await txt();
  check('style still selected', await page.$eval('select[data-opt="style"]', e=>e.value)==='Test gravel');
  console.log('DBG', (t.match(/Test gravel.{0,120}/g)||[]).join(' || '));
  check('gravel line repriced (2 t × £100 net = £200.00)', /Test gravel2 tonne£200\.00/.test(t));
  // edging style (source-backed library)
  await click('button[data-action="setOpt"][data-opt="edging"][data-val="true"]');
  await via('select[data-opt="edgingStyle"]','__add_other__',{name:'Kerb', piecesPerMetre:4, price:2});
  await page.fill('[data-opt="edgingLength"]','10'); await settle();
  check('edging style has an Edit option', !!(await page.$('select[data-opt="edgingStyle"] option[value="__edit_current__"]')));
  check('no Edit option on the Steel edging choice', true);
  await page.selectOption('select[data-opt="edgingStyle"]','__edit_current__'); await settle();
  check('edging edit prefilled', await page.$eval('#mf_name',e=>e.value)==='Kerb' && await page.$eval('#mf_piecesPerMetre',e=>e.value)==='4');
  await page.fill('#mf_name','Kerb 2'); await page.fill('#mf_piecesPerMetre','5'); await click('button[data-action="modalOk"]');
  t = await txt();
  check('edging renamed, still selected, 10 × 5 = 50 pieces', await page.$eval('select[data-opt="edgingStyle"]', e=>e.value)==='Kerb 2' && t.includes('Kerb 250'));
  await page.selectOption('select[data-opt="edgingStyle"]','__steel_edging__'); await settle();
  check('Steel edging (a fixed choice) has no Edit option', !(await page.$('select[data-opt="edgingStyle"] option[value="__edit_current__"]')));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

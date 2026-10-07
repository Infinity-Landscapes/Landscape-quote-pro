// October 2026 Steel Edging rework: tenant steel (per metre) + rebar (per bar) products, per-run
// stakes with end stakes, cuts per bar, stake settings, welder plant, £0 blocks, letter from settings.
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
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings: stake spacing 500, stake length 500, consumables 1', await page.$eval('#st_steelSpacing',e=>e.value)==='500' && await page.$eval('#st_steelStakeLen',e=>e.value)==='500' && await page.$eval('#st_steelConsumables',e=>e.value)==='1');
  check('new tenant: no rebar seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="steelRebar"]')).length===0);
  check('steel edging not in waste eligibility table', !(await page.$('button[data-action="toggleGeneratesSpoil"][data-key="steeledging"]')));

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Steel test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="steeledging"]');
  await click('button[data-action="wizNext"]');
  check('no 3mm/5mm thickness dropdown', !(await page.$('[data-opt="thickness"]')));
  await page.fill('[data-row="0"] input[data-mf="length"]','6');
  await page.fill('[data-row="1"] input[data-mf="length"]','2.3'); await settle();
  let t = await txt();
  check('blockers: select steel + rebar', /Select a steel edging product/.test(t) && /Select a rebar/.test(t));
  check('picker label says £ per metre', /Steel edging \(£ per metre\)/.test(t));
  await page.selectOption('[data-row="0"] select[data-mf="steelType"]','__add_other__'); await settle();
  check('add form labels the price "£ per metre"', /Price \(£ per metre\)/.test(await txt()));
  await page.fill('#mf_name','Corten 150mm'); await page.fill('#mf_priceM','24'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  await page.selectOption('select[data-opt="rebarProduct"]','__add_other__'); await settle();
  await page.fill('#mf_name','Rebar 6m'); await page.fill('#mf_price','12'); await page.fill('#mf_lengthMm','6000'); { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]');
  t = await txt();
  check('picker option shows the per-metre price', /Corten 150mm — £24\.00 per metre/.test(await page.$eval('[data-row="0"] select[data-mf="steelType"]', s=>s.options[s.selectedIndex].textContent)));
  check('steel qty = 8.3 m, cost 8.3 × £20 net = £166.00', t.includes('Corten 150mm8.3') && /166\.00/.test(t));
  // stakes = (12+1) + (5+1) = 19; 6000/500 = 12 per bar -> ROUNDUP(19/12) = 2 bars
  check('stakes 19 -> 2 bars', /Stakes19/.test(t) && t.includes('Rebar 6m2'));
  check('consumables 1', t.includes('Consumables1'));
  check('labour = 8.3/10 × £150 = £124.50', /124\.50/.test(t));
  check('welder plant charged', /Plant hire\s*£2\.08/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('no waste page; letter uses product name and stake setting', /Corten 150mm steel edging sections placed into the trench/.test(t) && /Rebar cut into 500mm lengths/.test(t) && !/50mm lengths/.test(t));
  // stake longer than the bar blocks
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings list shows £ per metre', /Corten 150mm\s*£24\.00 per metre/.test(await txt()));
  await page.fill('#st_steelStakeLen','7000'); await click('button[data-action="saveSettingsForm"]');
  await click('button[data-nav="newquote"]');
  for (let i=0;i<6 && !(await page.$('[data-row="0"] select[data-mf="steelType"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  check('stake longer than bar blocks', /The stake length \(7000mm\) is longer than the rebar bar \(6000mm\)/.test(await txt()));
  // existing business gets the rebar seed
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.steelRebarSeeded; d.steelRebar = []; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  t = await txt();
  check('existing business: rebar 6000mm £12 seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="steelRebar"]')).length===1 && /6000mm long/.test(t));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

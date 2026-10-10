// October 2026 Concrete Base rework.
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
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  const v = id => page.$eval(id, e=>e.value);
  const rowFill = async (i,f,x) => { await page.fill(`[data-row="${i}"] input[data-mf="${f}"]`, x); await settle(); };
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings defaults', await v('#st_cbMot')==='100' && await v('#st_cbMotRate')==='0.3' && await v('#st_cbMotBase')==='150' && await v('#st_cbBaseArea')==='10' && await v('#st_cbBaseDepth')==='100' && await v('#st_cbBallast')==='1' && await v('#st_cbSand')==='1' && await v('#st_cbCement')==='12' && await v('#st_cbBoard')==='150' && await v('#st_cbScrews')==='1' && await v('#st_cbConsumables')==='1');
  check('default dig-out depth 200 in waste table', await v('input[data-digdepth="concretebase"]')==='200');

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Concrete');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="concretebase"]');
  await click('button[data-action="wizNext"]');
  check('row depth defaults to 200; no job-level depth', await page.$eval('[data-row="0"] input[data-mf="digOutDepth"]', e=>e.value)==='200' && !(await page.$('[data-opt="depth"]')));
  await rowFill(0,'desc','Base A'); await rowFill(0,'width','4'); await rowFill(0,'length','3');
  await rowFill(1,'desc','Base B'); await rowFill(1,'width','2'); await rowFill(1,'length','2'); await rowFill(1,'digOutDepth','250');
  check('each base has its own concrete thickness, starting at 100mm', await page.$eval('[data-row="1"] input[data-mf="thickness"]', e=>e.value)==='100');
  await rowFill(1,'thickness','150');
  check('row shows MOT + concrete split', /100mm MOT \+ 100mm concrete/.test(await txt()) && /100mm MOT \+ 150mm concrete/.test(await txt()));
  await addVia('[data-row="0"] select[data-mf="meshProduct"]', {name:'A142', price:30, widthMm:2400, lengthMm:4800});
  await click('button[data-action="setRowFlag"][data-row="1"][data-field="rebar"][data-val="false"]');
  await click('button[data-action="setRowFlag"][data-row="1"][data-field="readyMix"][data-val="true"]');
  await addVia('[data-row="1"] select[data-mf="readyMixProduct"]', {name:'C25', price:120});
  check('no screws question until there is shuttering', !(await page.$('select[data-opt="screwProduct"]')));
  await addVia('select[data-opt="shutteringProduct"]', {name:'Board 4.8', price:20, lengthMm:4800});
  await page.fill('[data-opt="shutteringLength"]','14'); await settle();
  check('shuttering needs screws: blocker until picked', /Select the screws for the shuttering/.test(await txt()));
  await addVia('select[data-opt="screwProduct"]', {name:'Screw box', price:10});
  let t = await txt();
  check('MOT = ROUNDUP(16 × 0.3 × 100/150) = 4', t.includes('Type 1 MOT4'));
  check('mixed concrete 1.2m³: sand 2, ballast 2, cement 15', t.includes('Sharp sand2') && t.includes('Ballast2') && t.includes('Cement15'));
  check('ready-mix = ROUNDUP(0.6) = 1 m³', t.includes('C251'));
  await rowFill(1,'thickness','100');
  check('ready-mix 0.4m³ shows as 0.5 on screen', (await txt()).includes('C250.5'));
  await rowFill(1,'thickness','150'); t = await txt();
  check('mesh = ROUNDUP(12 ÷ 11.52) = 2 sheets (rebar-off row excluded)', t.includes('A1422'));
  check('shuttering = ROUNDUP(14000/4800) × 1 high = 3', t.includes('Board 4.83'));
  check('screws 1, consumables 1', t.includes('Screw box1') && t.includes('Consumables1'));
  check('labour = 16/5 × £150 = £480.00', /480\.00/.test(t));
  check('mixer charged with mixed concrete (£10.42 plant)', /Plant hire\s*£10\.42/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  await rowFill(0,'digOutDepth','100');
  t = await txt();
  check('a shallow dig-out builds up above the ground instead of blocking', /100mm built up above the ground/.test(t) && !/must be deeper/.test(t) && t.includes('Sharp sand2'));
  await rowFill(0,'digOutDepth','0');
  check('0mm dig-out: base built entirely on the ground', /200mm built up above the ground/.test(await txt()));
  await rowFill(0,'digOutDepth','200');
  await click('button[data-action="setOpt"][data-opt="mot"][data-val="false"]');
  t = await txt();
  check('Type 1 MOT sub-base? No — no MOT at all', !/Type 1 MOT\d/.test(t) && /100mm concrete — finishes 100mm below ground level/.test(t));
  await click('button[data-action="setOpt"][data-opt="mot"][data-val="true"]');
  await click('button[data-action="wizNext"]');
  t = await txt();
  check('waste: area 16.00 m², volume 3.40 m³', /16\.00 m²/.test(t) && /3\.40 m³/.test(t));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('letter: MOT depth, formwork, mesh for Base A only, per-row concrete depths', /typically Type 1 MOT, to a depth of 100mm\./.test(t) && /Formwork installed/.test(t) && /Reinforcement mesh laid in Base A,/.test(t) && /Concrete poured to depths of Base A 100mm, Base B 150mm, levelled and tamped\./.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  for (let i=0;i<6 && !(await page.$('[data-row="0"] input[data-mf="width"]')); i++){ const b = await page.$('button[data-action="wizBack"]'); if(!b) break; await b.click(); await settle(); }
  await click('button[data-action="setRowFlag"][data-row="0"][data-field="readyMix"][data-val="true"]');
  await page.selectOption('[data-row="0"] select[data-mf="readyMixProduct"]','C25'); await settle();
  t = await txt();
  check('all ready-mix: no sand/ballast/cement, no mixer (£5.21 plant)', !t.includes('Sharp sand') && !t.includes('Ballast') && /Plant hire\s*£5\.21/.test(t) && t.includes('C252'));
  // seed
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.cbSeeded; d.cbScrews = []; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('existing business: screws £10 seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="cbScrews"]')).length===1);

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

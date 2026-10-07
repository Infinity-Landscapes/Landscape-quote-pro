// October 2026 Sleeper Retaining Wall rework.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
  require(__dirname+'/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const v = id => page.$eval(id, e=>e.value).catch(()=>null);
  const settle = () => page.waitForTimeout(220);
  async function fillModal(f){ for (const [k,x] of Object.entries(f)){ const el = await page.$('#mf_'+k); if(el) await el.fill(String(x)); }
    await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250); }
  async function addVia(sel, f){ await page.selectOption(sel,'__add_other__'); await settle(); await fillModal(f); }
  async function login(){ const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await settle(); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await settle();
  check('defaults: spacing 1200, screws/sleeper 6, consumables 1', await v('#st_slSpacing')==='1200' && await v('#st_slScrews')==='6' && await v('#st_slConsumables')==='1');
  check('not in waste eligibility table', !(await page.$('button[data-action="toggleGeneratesSpoil"][data-key="sleeperwall"]')));
  check('new tenant: no seeded sleeper/screw', (await page.$$('button[data-action="removePavingProduct"][data-libkey="sleeperProducts"]')).length===0 && (await page.$$('button[data-action="removePavingProduct"][data-libkey="sleeperScrews"]')).length===0);

  await (await page.$('button[data-nav="newquote"]')).click(); await settle();
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Sleeper rework');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="sleeperwall"]')).click(); await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="length"]','6'); await page.fill('[data-row="0"] input[data-mf="height"]','0.6');
  await page.fill('[data-row="1"] input[data-mf="length"]','3.5'); await page.fill('[data-row="1"] input[data-mf="height"]','1'); await settle();
  let t = await txt();
  check('blockers: select sleeper + screw', /Select a sleeper/.test(t) && /Select a screw product/.test(t));
  await addVia('[data-row="0"] select[data-mf="sleeperType"]', {name:'Oak sleeper', price:9, lengthMm:2400, heightMm:200});
  await addVia('select[data-opt="screws"]', {name:'Hex screws', price:24.84, screwsPerBox:25});
  t = await txt();
  check('sleepers per row summed = 3×3 + 2×5 = 19', t.includes('Oak sleeper19'));
  check('posts in ground = (5+1)+(3+1) = 10; cut 1600 -> 1 per stock -> 10 stock posts', t.includes('100x100mm Treated timber post10'));
  check('postcrete = 10 posts × 2 = 20', t.includes('Postcrete20'));
  check('screw boxes = ROUNDUP(19×6/25) = 5', t.includes('Hex screws5'));
  check('DPM = ROUNDUP(7.1/10) = 1', t.includes('Blackjack DPM1'));
  check('consumables 1', t.includes('Consumables1'));
  check('labour = 7.1/10 × £150 = £106.50', /106\.50/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  await page.fill('[data-row="1"] input[data-mf="height"]','1.9'); await settle();
  check('blocker: wall too tall for stock post', /Wall height needs a longer post than the stock length/.test(await txt()));
  await page.fill('[data-row="1"] input[data-mf="height"]','1'); await settle();
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  t = await txt();
  check('no waste page follows', !/Waste removal &? ?site clearance/.test(t) || !(await page.$('[data-opt="diggerProductivity"]')));
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await page.waitForTimeout(300); }
  t = await txt();
  check('letter keeps post/DPM/fixing lines', /Post holes dug individually and posts set using postcrete/.test(t) && /Blackjack DPM/.test(t) && /secured with long screws/.test(t));
  check('letter drops the sanding line', !/sanded smooth/.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));

  // Seed for an existing business
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.sleeperSeeded; delete d.sleeperProducts; delete d.sleeperScrews; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await (await page.$('button[data-nav="settings"]')).click(); await settle();
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await settle();
  t = await txt();
  check('existing business: one sleeper (£9, 2400×200) and one screw (25/box, £24.84)',
    (await page.$$('button[data-action="removePavingProduct"][data-libkey="sleeperProducts"]')).length===1 &&
    (await page.$$('button[data-action="removePavingProduct"][data-libkey="sleeperScrews"]')).length===1 &&
    /2400mm long/.test(t) && /200mm high/.test(t) && /25\/box/.test(t) && /£24\.84/.test(t));

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

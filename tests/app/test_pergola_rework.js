// October 2026 Pergola rework.
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
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('settings defaults', await v('#st_pgSpacing')==='3000' && await v('#st_pgStock')==='3000' && await v('#st_pgCentres')==='400' && await v('#st_pgTin')==='30' && await v('#st_pgScrewCov')==='10' && await v('#st_pgOsbCov')==='2' && await v('#st_pgConsumables')==='1');
  check('no waste switch for Pergola', !(await page.$('button[data-action="toggleGeneratesSpoil"][data-key="pergola"]')));
  check('new tenant: no pergola products seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="pgPosts"]')).length===0);

  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Pergola');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="pergola"]');
  await click('button[data-action="wizNext"]');
  check('old fixed post list gone; height per row defaults 2400', !(await page.$('[data-opt="post"]')) && await page.$eval('[data-row="0"] input[data-mf="heightMm"]', e=>e.value)==='2400');
  await page.fill('[data-row="0"] input[data-mf="length"]','6'); await page.fill('[data-row="0"] input[data-mf="width"]','3');
  await page.fill('[data-row="1"] input[data-mf="length"]','4'); await page.fill('[data-row="1"] input[data-mf="width"]','2.5');
  await page.fill('[data-row="1"] input[data-mf="heightMm"]','2000'); await settle();
  let t = await txt();
  check('blockers: post, joist, DPM, screws', /Select a post/.test(t) && /Select a joist/.test(t) && /Select a Blackjack DPM/.test(t) && /Select the screws/.test(t));
  await addVia('select[data-opt="postProduct"]', {name:'Oak post', price:140});
  await addVia('select[data-opt="joistProduct"]', {name:'6x2 oak', price:90, lengthMm:3000});
  await addVia('select[data-opt="dpmProduct"]', {name:'Blackjack', price:40});
  await addVia('select[data-opt="screwProduct"]', {name:'Hexhead box', price:11});
  t = await txt();
  check('stock posts 6 + 6 = 12', t.includes('Oak post12'));
  check('postcrete = 12 posts × 2 = 24', t.includes('Postcrete24'));
  check('DPM = ROUNDUP(12/30) = 1 tin', t.includes('Blackjack1'));
  check('joists = (2 + 16) + (2 + 11) = 31 pieces', t.includes('6x2 oak31'));
  check('screws = ROUNDUP(28/10) = 3', t.includes('Hexhead box3'));
  check('consumables 1', t.includes('Consumables1'));
  check('labour = 28/9 × £150 = £466.67', /466\.67/.test(t));
  check('no blockers', !/Needs attention/.test(t));
  await page.fill('[data-row="1"] input[data-mf="heightMm"]','2700'); await settle();
  check('blocker: cut longer than stock post', /3300mm post cut \(in-ground 600mm \+ height 2700mm\) is longer than the 3000mm stock post/.test(await txt()));
  await page.fill('[data-row="1"] input[data-mf="heightMm"]','2000'); await settle();
  await click('button[data-action="setOpt"][data-opt="roof"][data-val="true"]');
  await addVia('select[data-opt="osbProduct"]', {name:'OSB 18mm', price:30});
  await addVia('select[data-opt="coveringProduct"]', {name:'Felt roll', price:25, coverageM2:5});
  t = await txt();
  check('roof: OSB = ROUNDUP(28/2) = 14, covering = ROUNDUP(28/5) = 6', t.includes('OSB 18mm14') && t.includes('Felt roll6'));
  await click('button[data-action="wizNext"]');
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('no waste page; letter lines incl. roof', /Oak post posts set in postcrete footings/.test(t) && /Roof deck of OSB 18mm fixed across the rafters\./.test(t) && /Roof finished with Felt roll\./.test(t) && !/Waste removal &amp; site clearance/.test(t));
  check('quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  // existing business seeds
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.pgSeeded; ['pgPosts','pgJoists','pgDpm','pgScrews'].forEach(x=>d[x]=[]); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  t = await txt();
  check('existing business: 5 posts, 2 joists, DPM, screws seeded', (await page.$$('button[data-action="removePavingProduct"][data-libkey="pgPosts"]')).length===5 && (await page.$$('button[data-action="removePavingProduct"][data-libkey="pgJoists"]')).length===2 && (await page.$$('button[data-action="removePavingProduct"][data-libkey="pgDpm"]')).length===1 && (await page.$$('button[data-action="removePavingProduct"][data-libkey="pgScrews"]')).length===1);
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

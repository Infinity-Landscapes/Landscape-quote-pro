// Oct 2026 service review: Resin bound is open to every business — first-time setup asks "Do you
// offer resin bound paving?" (No to start). Yes needs the business's own resin system (name + its
// materials, each with a cost, m² coverage or once per job, and supplier) before setup carries on.
// A switched-off service stays off after reloading.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };
  const txt = () => page.$eval('#app', e=>e.innerText);
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','New Co');
  await click('button[data-action="setupNext"]');
  // ---- step 2: the resin question ----
  let t = await txt();
  check('setup asks "Do you offer resin bound paving?"', /Do you offer resin bound paving\?/.test(t));
  check('…answered No to start, and Resin bound is not one of the service tiles', !!(await page.$('[data-action="setupResin"][data-val="false"].on')) && !(await page.$('[data-action="toggleSetupService"][data-key="resinbound"]')));
  await click('[data-action="setupResin"][data-val="true"]');
  check('Yes: shows the resin systems list with "+ Add resin system"', !!(await page.$('[data-action="addResinSystem"]')));
  await click('button[data-action="setupNext"]');
  check('can\'t carry on with Yes and no resin system', /Add your resin system/.test(await txt()) && !!(await page.$('[data-action="setupResin"]')));
  await click('[data-action="addResinSystem"]');
  check('resin system dialog opens', /Add a resin system/.test(await txt()));
  await page.fill('[data-rs-name]','StoneSet Resin');
  await page.fill('[data-rs-line="0"] [data-rs-f="material"]','Resin kit'); await page.fill('[data-rs-line="0"] [data-rs-f="unit"]','kit');
  await page.fill('[data-rs-line="0"] [data-rs-f="price"]','84'); await page.fill('[data-rs-line="0"] [data-rs-f="coverage"]','4');
  await click('button[data-action="modalOk"]');
  check('supplier required', /Enter the supplier for "Resin kit"/.test(await txt()));
  await page.fill('[data-rs-line="0"] [data-rs-f="supplier"]','AWBS');
  await click('button[data-action="addResinLine"]');
  await page.fill('[data-rs-line="1"] [data-rs-f="material"]','Delivery'); await page.fill('[data-rs-line="1"] [data-rs-f="price"]','70');
  await page.check('[data-rs-line="1"] [data-rs-f="perJob"]'); await page.fill('[data-rs-line="1"] [data-rs-f="supplier"]','AWBS');
  check('typed values kept when a line is added', await page.$eval('[data-rs-line="0"] [data-rs-f="price"]', e=>e.value)==='84' && await page.$eval('[data-rs-name]', e=>e.value)==='StoneSet Resin');
  await click('button[data-action="modalOk"]');
  t = await txt();
  check('saved: StoneSet Resin listed in setup (2 materials)', !(await page.$('.modal-box')) && /StoneSet Resin/.test(t) && /2 materials/.test(t));
  await click('button[data-action="setupNext"]');
  if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','150'); await page.fill('#f_expenses','515'); }
  await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  // ---- quoting with it ----
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Resin Co');
  await click('button[data-action="wizNext"]');
  check('Resin bound is on the quote services', !!(await page.$('[data-action="toggleQuoteService"][data-key="resinbound"]')));
  await click('[data-action="toggleQuoteService"][data-key="resinbound"]');
  await click('button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','3'); await page.fill('[data-row="0"] input[data-mf="length"]','4'); await settle();
  check('blocker until a resin system is picked', /Select a resin system/.test(await txt()));
  await page.selectOption('select[data-opt="resinSystem"]','StoneSet Resin'); await settle();
  t = await txt();
  check('materials: 12 m² ÷ 4 = 3 kits; delivery once per job', /Resin kit( \(AWBS\))?\s*3/.test(t) && /Delivery( \(AWBS\))?\s*1/.test(t));
  check('the materials went into the Materials list', await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('__mockdb__')); const k=Object.keys(s).find(k=>s[k]&&s[k].resinSystems); return !!k && s[k].materials['Resin kit'] && s[k].materials['Resin kit'].supplier==='AWBS' && s[k].resinSystems[0].name==='StoneSet Resin'; }));
  // ---- settings: edit, and services stay as switched ----
  await click('button[data-nav="menu"]').catch(()=>{});
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  check('Settings → Pricing lists the resin system with Edit', /Resin systems/.test(await txt()) && !!(await page.$('[data-action="editResinSystem"]')));
  await click('[data-action="editResinSystem"]');
  check('edit dialog prefilled', await page.$eval('[data-rs-name]', e=>e.value)==='StoneSet Resin' && await page.$eval('[data-rs-line="1"] [data-rs-f="perJob"]', e=>e.checked));
  await click('button[data-action="modalCancel"]');
  await click('button[data-action="settingsTab"][data-tab="services"]');
  await click('[data-action="toggleSettingsService"][data-key="pergola"]');
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  check('switched-off service stays off after reload', !(await page.$('[data-action="toggleSettingsService"][data-key="pergola"].on')));
  check('Resin bound still on', !!(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"].on')));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

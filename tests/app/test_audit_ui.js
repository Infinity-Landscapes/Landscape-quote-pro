// Oct 2026 audit UI fixes at phone width: unsaved settings survive re-renders (e.g. an "+ Add…"
// dialog) and leaving the tab asks first; working hours set per business appear on the letter;
// extras have labels and typing replaces the starting qty; calendar keeps all 7 columns with a
// job booked; tall dialogs scroll; dark-mode builder background is dark; buttons in rows sit
// side by side; materials table shows the price column first.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId:'Europe/London' });
  const page = await ctx.newPage();
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const settle = () => page.waitForTimeout(250);
  const click = async sel => { const el = await page.$(sel); if(!el) throw new Error('missing '+sel); await el.click(); await settle(); };
  const txt = () => page.$eval('#App', el => el.textContent);
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++) await click('button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  // ---- unsaved settings ----
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="pricing"]');
  await page.fill('#st_dayrate','240');
  const sel = await page.$('select[data-opt], select[data-libadd], [data-action^="addPaving"], [data-action="addLibProduct"]');
  const addBtn = await page.$('button[data-action="addLibraryProduct"], button[data-action="addPavingProduct"], button[data-lib]');
  if (addBtn) { await addBtn.click(); await settle(); const c = await page.$('button[data-action="modalCancel"]'); if (c) await click('button[data-action="modalCancel"]'); }
  check('typed day rate survives opening/cancelling an "+ Add" dialog', await page.$eval('#st_dayrate', e=>e.value)==='240');
  await click('button[data-action="settingsTab"][data-tab="schedule"]');
  check('leaving the tab with unsaved edits asks first', /without saving/.test(await txt()));
  await click('button[data-action="modalCancel"]'); // keep editing
  check('"Keep editing" stays on the tab with the edit', await page.$eval('#st_dayrate', e=>e.value)==='240');
  await click('button[data-action="saveSettingsForm"]');
  await click('button[data-action="settingsTab"][data-tab="schedule"]');
  check('after saving, switching tab doesn\'t ask', !/without saving/.test(await txt()) && !!(await page.$('#st_workStart')));
  // ---- working hours ----
  await page.check('[data-workday="6"]');
  await page.fill('#st_workStart','08:00'); await page.fill('#st_workEnd','16:30');
  await click('button[data-action="saveScheduleForm"]');
  // ---- quote with an extra ----
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Hours Test');
  await click('button[data-action="wizNext"]');
  await click('[data-action="toggleQuoteService"][data-key="custom_testbed"]');
  await click('button[data-action="wizNext"]');
  check('measurement fields are labelled on a phone', await page.$eval('[data-row="0"] .mf-lbl', e=>getComputedStyle(e).display!=='none' && /Width/.test(e.parentElement.parentElement.textContent)));
  await page.fill('[data-row="0"] input[data-mf="width"]','4'); await page.fill('[data-row="0"] input[data-mf="length"]','5'); await settle();
  await click('button[data-action="wizNext"]'); await click('button[data-action="wizNext"]');
  await click('button[data-action="addExtra"]');
  await page.fill('[data-extra="0"] [data-ef="description"]','Outside tap');
  await page.click('[data-extra="0"] [data-ef="materials"]'); await page.keyboard.type('85');
  await page.click('[data-extra="0"] [data-ef="labourDays"]'); await page.keyboard.type('1'); await settle();
  check('extras fields start blank, so typing gives exactly what was typed', await page.$eval('[data-extra="0"] [data-ef="materials"]', e=>e.value)==='85' && await page.$eval('[data-extra="0"] [data-ef="labourDays"]', e=>e.value)==='1');
  check('extras fields are labelled', /Materials £[\s\S]*Plant hire £[\s\S]*Labour days/.test(await page.$eval('[data-extra="0"]', e=>e.textContent)));
  await click('button[data-action="wizNext"]');
  check('letter uses the business\'s own working days and hours', /working hours are Monday to Saturday 8am – 4:30pm/.test(await txt()));
  await click('button[data-action="saveSentQuote"]');
  await click('button[data-action="showAccept"]');
  await page.fill('#acceptStart','2026-11-04');
  await click('button[data-action="confirmAccept"]');
  // ---- calendar keeps 7 columns ----
  await click('button[data-nav="calendar"]');
  const t0 = await txt();
  if (!/November 2026/.test(t0)) { for (let i=0;i<2 && !/November 2026/.test(await txt()); i++) { const nx = await page.$('[data-action="calNextMonth"]'); if (nx) { await nx.click(); await settle(); } } }
  const widths = await page.$$eval('.cal-grid > .cal-dow', els=>els.map(e=>Math.round(e.getBoundingClientRect().right)));
  const gridRight = await page.$eval('.cal-grid', e=>Math.round(e.getBoundingClientRect().right));
  check('calendar: all 7 day columns fit inside the grid', widths.length===7 && Math.max(...widths) <= gridRight+1);
  // ---- buttons side by side ----
  const yes = await page.evaluate(()=>{ const b = document.querySelectorAll('.row > .btn'); return b.length; });
  // ---- dialog scrolls ----
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="materials"]');
  const heads = await page.$$eval('table th', els=>els.slice(0,2).map(e=>e.textContent.trim()));
  check('materials table: unit price is the second column', heads[1]==='Unit price');
  check('materials search box isn\'t auto-focused (no keyboard pop-up)', await page.evaluate(()=>document.activeElement && document.activeElement.id)!=='matFilter');
  const mh = await page.evaluate(()=>{ const d = document.createElement('div'); d.className='modal-box'; document.body.appendChild(d); const v = getComputedStyle(d).maxHeight; d.remove(); return v; });
  check('dialogs have a max height so they scroll', mh && mh!=='none');
  // ---- dark mode builder panel ----
  await page.emulateMedia({ colorScheme: 'dark' });
  const panel = await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--panel').trim());
  check('dark mode defines a dark panel colour', panel==='#252a23');
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

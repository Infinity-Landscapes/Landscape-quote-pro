// Oct 2026: Resin bound is only offered to the pre-existing business; a switched-off service now
// stays off after reloading (it used to be switched back on every load).
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
  const login = async () => { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await click('button[data-action="login"]'); } };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','New Co');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','150'); await page.fill('#f_expenses','515'); } await click('button[data-action="setupNext"]'); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]');
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  check('new business: no Resin bound tile', !(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"]')));
  await click('[data-action="toggleSettingsService"][data-key="pergola"]');
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  check('switched-off service stays off after reload', !(await page.$('[data-action="toggleSettingsService"][data-key="pergola"].on')));
  check('still no Resin bound after reload', !(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"]')));
  // become the pre-existing business
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.extraServices; delete d.servicesSeen; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  check('pre-existing business keeps Resin bound (switched on)', !!(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"].on')));
  await click('[data-action="toggleSettingsService"][data-key="resinbound"]');
  await page.reload(); await page.waitForTimeout(500); await login();
  await click('button[data-nav="settings"]'); await click('button[data-action="settingsTab"][data-tab="services"]');
  check('pre-existing business can switch Resin bound off and it stays off', !!(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"]')) && !(await page.$('[data-action="toggleSettingsService"][data-key="resinbound"].on')));
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

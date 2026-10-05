const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  // Oct 2026: a new business must enter its own rates in setup; Infinity's are restored by name.
  { const n = await page.$('#f_name'); if (n) await n.fill('Infinity Landscapes and Design'); }
  for (let i = 0; i < 4; i++) {
    const pinInputs = await page.$$('input[type=password]');
    if (pinInputs.length >= 2) break;
    const btn = await page.$('button.btn-primary');
    if (!btn) break;
    await btn.click(); await page.waitForTimeout(250);
  }
  const pinInputs = await page.$$('input[type=password]');
  await pinInputs[0].fill('1234'); await pinInputs[1].fill('1234');
  await (await page.$('button.btn-primary')).click(); await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
  await page.fill('[data-prod="wasteDigger"]', '45');
  // October 2026: grab hire moved from an area-based productivity figure (data-prod="wasteGrab")
  // to a volume-based "m³/load" capacity setting, its own dedicated field — see calcWasteRemoval.
  await page.fill('#st_wasteGrabM3PerLoad', '8');
  await page.fill('[data-prod="wasteLabour"]', '60');
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(()=>(st=>st[Object.keys(st).find(k=>/business$/.test(k))])(JSON.parse(localStorage.getItem('__mockdb__'))));
  console.log('saved productivity.wasteDigger/wasteLabour (expect 45/60):', saved.productivity.wasteDigger, saved.productivity.wasteLabour);
  console.log('saved wasteGrabM3PerLoad (expect 8):', saved.wasteGrabM3PerLoad);
  console.log('no leftover wasteLabourRate field on saved doc (expect undefined):', saved.wasteLabourRate);

  // Reload and confirm the new rates come back
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin2 = await page.$('#loginPin');
  if (loginPin2) { await loginPin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(250);
  const diggerVal = await page.$eval('[data-prod="wasteDigger"]', el=>el.value);
  console.log('digger productivity persists after reload (expect 45):', diggerVal);
  const grabVal = await page.$eval('#st_wasteGrabM3PerLoad', el=>el.value);
  console.log('grab hire capacity persists after reload (expect 8):', grabVal);

  // Waste removal rates (digger productivity, grab m³/load, clearance labour) save and reload.
  const ok1 = saved.productivity.wasteDigger==45 && saved.productivity.wasteLabour==60 && saved.wasteGrabM3PerLoad==8 && saved.wasteLabourRate===undefined;
  const ok2 = String(diggerVal)==='45' && String(grabVal)==='8';
  console.log((ok1?'PASS':'FAIL')+' - waste rates saved (45 / 8 m³ / 60)');
  console.log((ok2?'PASS':'FAIL')+' - waste rates shown again after reload');
  console.log('ERRORS:', errors.length ? errors : 'none');
  const ok = ok1 && ok2 && errors.length===0;
  console.log(ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exitCode = ok ? 0 : 1;
  await browser.close();
})();

// Existing business (settings saved before the rework, no compositeScrewsSeeded flag) gets exactly
// one seeded screw: 100/box at £6.99 inc VAT; seeding runs once and is not re-added once deleted.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  let pass=true; const check=(l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);
  // Strip the new keys from the stored settings to simulate a pre-rework business.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); 
    for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.compositeScrewsSeeded; delete d.compositeDeckScrews; delete d.compositeDeckBoards; } }
    localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  let btns = await page.$$('button[data-action="removePavingProduct"][data-libkey="compositeDeckScrews"]');
  check('exactly one seeded screw', btns.length===1);
  const t = await page.$eval('#App', e=>e.textContent);
  check('seeded screw shows £6.99 and 100/box', /£6\.99/.test(t) && /100\/box/.test(t));
  await btns[0].click(); await page.waitForTimeout(250);
  await page.reload(); await page.waitForTimeout(500);
  const pin2 = await page.$('#loginPin'); if(pin2){ await pin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  check('deleted screw is not re-seeded on next load', (await page.$$('button[data-action="removePavingProduct"][data-libkey="compositeDeckScrews"]')).length===0);
  console.log('ERRORS:', errors.length?errors:'none'); console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

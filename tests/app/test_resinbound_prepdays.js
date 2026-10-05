// Verifies the Resin bound service's "Prep days" figure follows the new "1 prep day per 40m²"
// rule (quarter-day precision), replacing the old "2 flat days + 1 per 35m² beyond the first 35"
// formula, per the artifact comment "1 prep day per 40m2".
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }
  function prepDaysValue(bodyText){
    const m = bodyText.match(/Prep days(\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // Oct 2026: Resin bound is only offered to the pre-existing business — simulate it by dropping
  // the extraServices/servicesSeen fields a brand-new business gets, then reloading.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.extraServices; delete d.servicesSeen; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Resin bound prep-days test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="resinbound"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);

  // 10 m² -> 10/40 = 0.25 -> exactly a quarter-day, no old "2 day minimum" anymore.
  await page.fill('[data-row="0"] input[data-mf="width"]', '2');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('10 m²: prep days = 0.25 (1 day per 40m², no more 2-day flat minimum)', prepDaysValue(bodyText) === '0.25');

  // 40 m² -> exactly 1.0 day.
  await page.fill('[data-row="0"] input[data-mf="length"]', '20');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('40 m²: prep days = exactly 1 (not bumped to the next quarter)', prepDaysValue(bodyText) === '1');

  // 50 m² -> 50/40 = 1.25 -> rounds up to 1.25 exactly.
  await page.fill('[data-row="0"] input[data-mf="length"]', '25');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('50 m²: prep days = 1.25', prepDaysValue(bodyText) === '1.25');

  // 0 m² (nothing entered) -> 0 prep days.
  await page.fill('[data-row="0"] input[data-mf="width"]', '0');
  await page.fill('[data-row="0"] input[data-mf="length"]', '0');
  await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('0 m²: prep days = 0', prepDaysValue(bodyText) === '0');

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

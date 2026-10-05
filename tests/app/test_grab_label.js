const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  const pricingTab = await page.$('button[data-action="settingsTab"][data-tab="pricing"]');
  if (pricingTab) { await pricingTab.click(); await page.waitForTimeout(250); }

  const grabRow = await page.$eval('body', () => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find(r => r.textContent.includes('Grab hire'));
    return row ? row.textContent : null;
  });
  console.log('Grab hire row text:', grabRow);
  // October 2026: grab hire moved from an area-based m²/load productivity figure to a
  // volume-based m³/load capacity figure (see calcWasteRemoval) — this row's unit changed
  // deliberately as part of that rework.
  check('Grab hire row shows m³/load', /m³\/load/.test(grabRow||''));
  check('Grab hire row does NOT show m²/day', !/Grab hire[\s\S]*?m²\/day/.test(grabRow||''));
  check('Grab hire row does NOT show the old m²/load unit', !/m²\/load/.test(grabRow||''));

  const diggerRow = await page.$eval('body', () => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find(r => r.textContent.includes('Digger hire'));
    return row ? row.textContent : null;
  });
  console.log('Digger hire row text:', diggerRow);
  check('Digger hire row still shows m²/day', /m²\/day/.test(diggerRow||''));

  console.log('\n' + (pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass ? 0 : 1);
})();

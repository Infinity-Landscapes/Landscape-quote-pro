const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1100 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  // Oct 2026: a new business must enter its own rates in setup; Infinity's are restored by name.
  { const n = await page.$('#f_name'); if (n) await n.fill('Infinity Landscapes and Design'); }
  for (let i = 0; i < 4; i++) {
    const pinInputs = await page.$$('input[type=password]');
    if (pinInputs.length >= 2) break;
    const btn = await page.$('button.btn-primary');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  const pinInputs = await page.$$('input[type=password]');
  await pinInputs[0].fill('1234');
  await pinInputs[1].fill('1234');
  await (await page.$('button.btn-primary')).click();
  await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  // Build a minimal custom service via the builder
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="startSvcBuilder"]')).click(); await page.waitForTimeout(150);
  await page.fill('#svcName', 'Irrigation install');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(150); // -> step2
  await page.fill('[data-svcmat-name="0"]', 'Turf');
  await page.fill('[data-svcmat-amount="0"]', '1');
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(150); // -> step3
  await (await page.$('button[data-action="svcBuilderNext"]')).click(); await page.waitForTimeout(150); // -> step4
  await (await page.$('button[data-action="saveServiceBuilder"]')).click(); await page.waitForTimeout(300);

  const delBtn = await page.$('[data-action="deleteCustomService"]');
  console.log('delete button present after save:', !!delBtn);
  await delBtn.click();
  await page.waitForTimeout(150);
  const confirmBtn = await page.$('button[data-action="modalOk"]');
  console.log('confirm dialog appeared:', !!confirmBtn);
  await confirmBtn.click();
  await page.waitForTimeout(300);

  const stillThere = await page.$('[data-action="deleteCustomService"]');
  console.log('custom service removed:', !stillThere);

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'X'); await page.fill('#q_cname', 'Y');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
  const bodyText = await page.evaluate(()=>document.body.innerText);
  console.log('wizard no longer offers deleted service:', !bodyText.includes('Irrigation install'));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

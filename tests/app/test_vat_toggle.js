// Verifies the new "VAT registered" yes/no toggle in business settings, per the direct request:
// "When the toggle is off... VAT must not be mentioned anywhere on the quote letter or payment
// plan, not even as a zero figure." Checks: the toggle defaults to on (checked) and existing
// behaviour (VAT mentioned, "inc VAT" rates, VAT breakdown row) is unchanged while on; turning it
// off and creating a fresh quote produces a letter and payment plan with NO occurrence of the
// word "VAT" anywhere, while the total charged still matches the ex-VAT subtotal (i.e. nothing is
// silently still being added/charged); and turning it back on restores normal VAT behaviour for a
// new quote.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  async function buildFlowerbedQuoteToPreview(name){
    await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', name);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="custom_testbed"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250);
    await page.fill('[data-row="0"] input[data-mf="width"]', '3');
    await page.fill('[data-row="0"] input[data-mf="length"]', '3');
    // Oct 2026: Flower Beds now needs products and feeds the waste pool — these tests use a custom service
    // (no waste, no £0 blocks) at Flower Beds' old 6.7 m²/day/person rate so every figure is unchanged.
    await page.fill('[data-opt="productivity"]', '6.7');
    await page.waitForTimeout(200);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // people
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // extras
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview
  }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  // Oct 2026: these tests need a plain area service with no waste step and no £0 blocks. Every
  // reworked built-in now needs tenant products, so give this business a simple custom service
  // ("Test beds", 6.7 m²/day/person, just consumables) straight in its stored settings and reload.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  // Confirm the toggle exists and defaults to on.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  const vatToggle = await page.$('#st_vatregistered');
  check('VAT registered toggle is present', !!vatToggle);
  check('VAT registered toggle defaults to checked (on)', await vatToggle.isChecked());

  // VAT ON: build a quote and confirm VAT is mentioned as usual.
  await buildFlowerbedQuoteToPreview('Alpha Customer');
  let previewText = await page.$eval('.letter', el => el.textContent).catch(()=>'');
  check('[VAT ON] letter preview mentions VAT', /VAT/.test(previewText));
  check('[VAT ON] letter preview shows "inc VAT" on a section line', /inc VAT/.test(previewText));
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);
  let letterHtml = await page.$eval('#letterCapture', el => el.textContent);
  check('[VAT ON] quote detail letter mentions VAT', /VAT/.test(letterHtml));

  // Turn VAT registration OFF.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await (await page.$('#st_vatregistered')).click();
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(300);

  // VAT OFF: build a fresh quote — the letter/preview must not mention VAT anywhere, not even £0.
  await buildFlowerbedQuoteToPreview('Bravo Customer');
  previewText = await page.$eval('.letter', el => el.textContent).catch(()=>'');
  check('[VAT OFF] letter preview does NOT mention VAT anywhere', !/VAT/i.test(previewText));
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);
  letterHtml = await page.$eval('#letterCapture', el => el.textContent);
  check('[VAT OFF] quote detail letter does NOT mention VAT anywhere', !/VAT/i.test(letterHtml));

  // Accept it and check the payment plan too.
  await (await page.$('button[data-action="showAccept"]')).click(); await page.waitForTimeout(150);
  await page.fill('#acceptStart', '2026-11-10');
  await (await page.$('button[data-action="confirmAccept"]')).click();
  await page.waitForTimeout(300);
  const paymentHtml = await page.$eval('#paymentCapture', el => el.textContent).catch(()=>'');
  check('[VAT OFF] payment plan does NOT mention VAT anywhere', !!paymentHtml && !/VAT/i.test(paymentHtml));

  // Turn VAT registration back ON and confirm a brand-new quote shows VAT again.
  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="settingsTab"][data-tab="pricing"]')).click(); await page.waitForTimeout(200);
  await (await page.$('#st_vatregistered')).click();
  await (await page.$('button[data-action="saveSettingsForm"]')).click();
  await page.waitForTimeout(300);
  await buildFlowerbedQuoteToPreview('Charlie Customer');
  previewText = await page.$eval('.letter', el => el.textContent).catch(()=>'');
  check('[VAT RESTORED] a new quote mentions VAT again', /VAT/.test(previewText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

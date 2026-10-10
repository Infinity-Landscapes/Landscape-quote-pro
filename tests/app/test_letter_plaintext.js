const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  // The app's code runs inside one closure, so expose what this test needs on a copy.
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={buildQuoteFromDraft,quoteLetterPlainText,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_letter_exposed.html', html);
  await page.goto('file:///tmp/mobiletest/_letter_exposed.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
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

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Plaintext Rate Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(100);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // waste
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview

  const text = await page.evaluate(() => {
    const T = window.__T; const q = T.buildQuoteFromDraft(T.S().draft, "draft");
    return T.quoteLetterPlainText(q);
  });
  // Plain-text (email) version of the letter: company name, working hours, each section with its
  // inc-VAT price and per-m² rate, and the VAT breakdown adding up to the total.
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  check('company name in the greeting paragraph', /Thank you for choosing Infinity Landscapes and Design/.test(text));
  check('working hours from settings', /working hours are Monday to Friday 7:30am - 3:30pm/.test(text));
  check('turf line shows area, inc-VAT price and per-m² rate', /Turf - 100\.00 m² - £[\d,]+\.\d\d inc VAT \(£[\d.]+\/m²\)/.test(text));
  check('waste removal line present', /Waste removal & site clearance - 100\.00 m²/.test(text));
  const sub = parseFloat(text.match(/Subtotal \(ex VAT\): £([\d,.]+)/)[1].replace(/,/g,''));
  const vat = parseFloat(text.match(/VAT @ 20%: £([\d,.]+)/)[1].replace(/,/g,''));
  const tot = parseFloat(text.match(/Total: £([\d,.]+)/)[1].replace(/,/g,''));
  check('subtotal + VAT = total (to the penny)', Math.abs(sub + vat - tot) <= 0.01);
  console.log('ERRORS:', errors.length ? errors : 'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

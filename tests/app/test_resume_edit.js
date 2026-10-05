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

  // Create and save a full quote first
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Edit Resume Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // waste page (turf is waste-eligible)
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // preview
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);

  // Now edit it, jump to measure, change width, but DON'T save yet — simulate closing mid-edit
  await (await page.$('button[data-action="editQuote"]')).click();
  await page.waitForTimeout(250);
  const measureStepPill = await page.$('.wstep.done[data-step="measure"]');
  await measureStepPill.click();
  await page.waitForTimeout(200);
  await page.fill('[data-row="0"] input[data-mf="width"]', '25');
  await page.waitForTimeout(700); // allow autosave debounce to flush

  const draftDoc = await page.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb__'))['drafts/current']);
  console.log('editingQuoteId saved in draft doc:', draftDoc && draftDoc.editingQuoteId);
  console.log('step saved:', draftDoc && draftDoc.draft && draftDoc.draft.step);

  // Reload (simulate closing the app mid-edit)
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin2 = await page.$('#loginPin');
  if (loginPin2) { await loginPin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await page.screenshot({ path: __dirname+'/resume_edit_menu.png', fullPage: true });
  const resumeBtn = await page.$('button[data-action="resumeDraft"]');
  console.log('resume button present:', !!resumeBtn);
  if (resumeBtn) { await resumeBtn.click(); await page.waitForTimeout(400); }

  await page.screenshot({ path: __dirname+'/resume_edit_after_click.png', fullPage: true });
  const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('heading after Resume click (expect Turf/measure step):', heading);
  const widthVal = await page.$eval('[data-row="0"] input[data-mf="width"]', el => el.value).catch(()=>'FIELD NOT FOUND');
  console.log('width value (expect 25):', widthVal);

  // check quote count didn't duplicate
  await (await page.$('button[data-nav="quotes"]')).click(); await page.waitForTimeout(300);
  const items = await page.$$('.quote-list-item');
  console.log('quote count on quotes list (expect 1):', items.length);

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

// Verifies the "+ Add new…" flow on material-style dropdowns (Gravel style used as the
// example — this same generic customizable-materials mechanism is also used by Block paving,
// Wall skin, Pergola post type, and (October 2026) Paving's own slab type — see
// test_paving_product_libraries.js for the slab-type-specific version of this flow): choosing
// "+ Add new…" opens a dialog for a description + price per m², saves it as a real material
// (so it prices the current quote) AND adds it to that dropdown's option list for future jobs
// (persisted + reappears after reload).
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  let pass = true;
  function check(label, cond){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) pass = false; }

  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Custom material test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);

  // Fill a footprint so area > 0
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  await page.waitForTimeout(200);

  const styleSelect = await page.$('[data-row="0"] select[data-mf="gravelType"]');
  check('gravel style select present', !!styleSelect);
  check('gravel style select is marked customizable', (await styleSelect.getAttribute('data-row-material')) === 'gravel');
  const optionTexts = await styleSelect.$$eval('option', els => els.map(e => e.textContent));
  check('"+ Add new…" option is present', optionTexts.includes('+ Add new…'));

  // Pick "+ Add new…" — should open the modal rather than saving the sentinel value.
  await styleSelect.selectOption('__add_other__');
  await page.waitForTimeout(200);
  check('add-material modal appears', (await page.$('#modalMatName')) !== null);
  check('style select reverts to its real value while modal is open (sentinel not saved)', await page.$eval('[data-row="0"] select[data-mf="gravelType"]', el => el.value) !== '__add_other__');

  // Try saving with no description — should show an inline error and stay open.
  await (await page.$('#modalMatPrice')).fill('35');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(150);
  check('validation error shown for missing description', /description/i.test(await page.$eval('#App', el => el.textContent)));
  check('modal still open after failed validation', (await page.$('#modalMatName')) !== null);

  // Now fill in a real description and save.
  await (await page.$('#modalMatName')).fill('Bradstone Blue Slate 600x600');
  await (await page.$('#modalMatPrice')).fill('45');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click();
  await page.waitForTimeout(250);

  check('modal closes after a valid save', (await page.$('#modalMatName')) === null);
  const bodyText1 = await page.$eval('#App', el => el.textContent);
  check('style select now shows the new material selected', await page.$eval('[data-row="0"] select[data-mf="gravelType"]', el => el.value) === 'Bradstone Blue Slate 600x600');
  // 20m² × a £45 gross / VAT-included price (vatRate 0.2) nets to £37.50 → £750.00 — matches
  // the same "vatIncluded defaults to true" convention used for materials created via the
  // service builder (see saveServiceBuilder).
  // Since the Oct 2026 gravel rework gravel is priced per tonne: ROUNDUP(20m² ÷ 10 × 50/50) = 2 tonnes.
  check('internal materials table prices per tonne net of VAT (2 t × £37.50 = £75.00)', /£75\.00/.test(bodyText1));

  // Reload — the new material should be saved for good, independent of this draft: check it
  // shows up as a normal entry in Materials & settings (the shared, durable materials list),
  // not just wired into whatever quote happened to add it.
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin = await page.$('#loginPin');
  if (loginPin) { await loginPin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  await (await page.$('button[data-nav="settings"]')).click(); await page.waitForTimeout(250);
  const tabBtn = await page.$('button[data-action="settingsTab"][data-tab="materials"]');
  if (tabBtn) { await tabBtn.click(); await page.waitForTimeout(250); }
  await page.fill('#matFilter', 'Bradstone');
  await page.waitForTimeout(200);
  const matRowText = await page.$eval('#App', el => el.textContent).catch(()=>'');
  check('new material persists in Materials & settings after reload', /Bradstone Blue Slate 600x600/.test(matRowText));
  const matPriceInput = await page.$('input[data-mat="Bradstone Blue Slate 600x600"]');
  check('persisted material kept its entered price (£45.00)', matPriceInput ? (await matPriceInput.inputValue()) === '45' : false);

  // And confirm it reappears as a normal, always-available dropdown option on a fresh quote —
  // discard the in-progress draft first (from the menu) so we land on a clean "who" step,
  // not a resumed one.
  await (await page.$('button[data-nav="menu"]')).click(); await page.waitForTimeout(200);
  const discardBtn = await page.$('button[data-action="discardDraft"]');
  if (discardBtn) {
    await discardBtn.click(); await page.waitForTimeout(150);
    const confirmBtn = await page.$('button[data-action="modalOk"]');
    if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(250); }
  }
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(250);
  if (await page.$('#q_creator')) {
    await page.fill('#q_creator', 'Matt');
    await page.fill('#q_cname', 'Second test');
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
    await (await page.$('[data-action="toggleQuoteService"][data-key="gravel"]')).click();
    await page.waitForTimeout(80);
    await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
    const optionTexts2 = await page.$eval('[data-row="0"] select[data-mf="gravelType"]', el => Array.from(el.options).map(o=>o.textContent)).catch(()=>[]);
    check('new material persists as a selectable option on a fresh quote after reload', optionTexts2.includes('Bradstone Blue Slate 600x600'));
  } else {
    check('reached a fresh new-quote flow after reload to verify dropdown persistence', false);
  }

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

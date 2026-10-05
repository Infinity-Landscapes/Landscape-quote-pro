// Verifies the new per-measurement-step notes feature, per the direct request: "Add a notes
// option to each measurement step in the quote wizard, allowing multiple separate notes to be
// added per step... Each individual note should have its own toggle for whether it appears on
// the customer-facing quote sheet or stays internal only. All notes, whether from measurement
// steps or added separately, should roll up into a single internal notes view on the quote."
// Checks: multiple notes can be added to a measurement step, each with its own customer-facing
// toggle; a general ("not tied to a step") note can be added on the Extras step; a
// customer-facing note appears on the customer letter (inside that section's bullet list, or in
// a "Notes" block for the general one) while an internal-only note does NOT appear on the
// letter; and the quote detail's internal Notes card rolls up every note from every step (plus
// the general one) regardless of its customer-facing flag.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  const page = await context.newPage();
  const mockScript = fs.readFileSync(__dirname+'/db_mock.js', 'utf8');
  await page.addInitScript(mockScript);
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

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

  // Oct 2026: these tests need a plain area service with no waste step and no £0 blocks. Every
  // reworked built-in now needs tenant products, so give this business a simple custom service
  // ("Test beds", 6.7 m²/day/person, just consumables) straight in its stored settings and reload.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = (d.customServices||[]).concat([{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2,
      lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[], productivityDefault:6.7}]);
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Notes Feature Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="custom_testbed"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(250); // -> measure (Flower Beds)
  await page.fill('[data-row="0"] input[data-mf="width"]', '4');
  await page.fill('[data-row="0"] input[data-mf="length"]', '5');
  // Oct 2026: Flower Beds now needs products and feeds the waste pool — these tests use a custom service
  // (no waste, no £0 blocks) at Flower Beds' old 6.7 m²/day/person rate so every figure is unchanged.
  await page.fill('[data-opt="productivity"]', '6.7');
  await page.waitForTimeout(150);

  // Add two notes to the Flower Beds measurement step — one customer-facing, one internal only.
  await (await page.$('[data-action="addSectionNote"][data-key="custom_testbed"]')).click();
  await page.waitForTimeout(150);
  await page.fill('#noteText_custom_testbed_0', 'Customer wants the bed edged in a gentle curve, not straight lines.');
  await page.waitForTimeout(100);
  await (await page.$('[data-note-customer][data-note-scope="custom_testbed"][data-note-idx="0"]')).click();
  await page.waitForTimeout(100);

  await (await page.$('[data-action="addSectionNote"][data-key="custom_testbed"]')).click();
  await page.waitForTimeout(150);
  await page.fill('#noteText_custom_testbed_1', 'Watch out — buried cable runs along the south fence line.');
  await page.waitForTimeout(100);
  // Leave this one unticked (internal only — the default).

  // Check the textareas' live .value (not #App's textContent — a textarea's textContent reflects
  // what the server-rendered HTML looked like, not a value set afterwards via fill()/typing).
  const noteVals = await page.$$eval('textarea[data-note-text]', els => els.map(e => e.value));
  check('both note textareas are present on the measurement step', noteVals.some(v=>/gentle curve/.test(v)) && noteVals.some(v=>/buried cable/.test(v)));
  let bodyText;

  // Continue through to Extras and add a general note.
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // extras
  bodyText = await page.$eval('#App', el => el.textContent);
  check('Extras step offers an "Other notes" section (general, not tied to a step)', /Other notes/.test(bodyText));
  await (await page.$('[data-action="addSectionNote"][data-key="general"]')).click();
  await page.waitForTimeout(150);
  await page.fill('#noteText_general_0', 'Customer will be away the week of the 12th — key under the mat.');
  await page.waitForTimeout(100);
  await (await page.$('[data-note-customer][data-note-scope="general"][data-note-idx="0"]')).click();
  await page.waitForTimeout(100);

  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // preview

  // --- Customer-facing letter checks ---
  const letterText = await page.$eval('.letter', el => el.textContent);
  check('[letter] shows the customer-facing section note', /gentle curve/.test(letterText));
  check('[letter] does NOT show the internal-only section note', !/buried cable/.test(letterText));
  check('[letter] shows the customer-facing general note under a "Notes" heading', /key under the mat/.test(letterText));

  // --- Internal "Notes" roll-up view checks (on the wizard preview) ---
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[internal notes view] shows the customer-facing section note', /gentle curve/.test(bodyText));
  check('[internal notes view] ALSO shows the internal-only section note (internal view sees everything)', /buried cable/.test(bodyText));
  check('[internal notes view] shows the general note too', /key under the mat/.test(bodyText));
  check('[internal notes view] labels the internal-only note as "internal only"', /internal only/.test(bodyText));
  check('[internal notes view] labels the customer-facing ones as "on quote sheet"', /on quote sheet/.test(bodyText));

  // Save as draft and reopen it — notes (and their per-step scoping) must round-trip.
  await (await page.$('button[data-action="saveDraftQuote"]')).click();
  await page.waitForTimeout(300);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[quote detail] internal Notes card shows all 3 notes after saving', /gentle curve/.test(bodyText) && /buried cable/.test(bodyText) && /key under the mat/.test(bodyText));

  await (await page.$('[data-action="editQuote"]')).click();
  await page.waitForTimeout(300);
  // Jump back to the Flower Beds measurement step via its step pill.
  const measureStepPill = await page.$('.wstep.done[data-step="measure"], .wstep[data-step="measure"]');
  if (measureStepPill) { await measureStepPill.click(); await page.waitForTimeout(250); }
  bodyText = await page.$eval('#App', el => el.textContent);
  check('[re-opened for edit] the two section notes are still attached to the Flower Beds step', /gentle curve/.test(bodyText) && /buried cable/.test(bodyText));
  const customerToggleStillOn = await page.$eval('[data-note-customer][data-note-scope="custom_testbed"][data-note-idx="0"]', el => el.checked).catch(()=>null);
  check('[re-opened for edit] the customer-facing toggle round-tripped correctly (still checked)', customerToggleStillOn === true);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

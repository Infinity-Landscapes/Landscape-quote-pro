// Verifies the new "Waste removal & site clearance" page inside the Measurements wizard:
//  - It appears (as its own page) only when a waste-eligible service is in the quote
//  - It shows a read-only, auto-calculated combined area
//  - Its three productivity fields are editable and feed the cost preview
//  - The override survives navigating forward/back, resuming a reloaded draft, and being
//    saved into a real quote + re-opened for editing
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

  await page.goto('file:///home/claude/build/app.html');
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

  // --- Test A: a NON-waste-eligible service (fencing) should never show the waste page ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'No Waste Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="fence"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // measure: fencing
  await page.fill('[data-row="0"] input[data-mf="length"]', '20');
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // should skip straight to people
  let heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('A) fencing-only quote skips waste page, lands on Labour step (expect true):', /people|labour/i.test(heading) || !!(await page.$('#q_people')));
  await page.waitForTimeout(700); // let the draft's debounced autosave flush before we wipe it below
  // Wipe just the draft (keep onboarding/settings) between tests A and B, then start fresh.
  // Post-multi-tenant-migration, drafts live at "data/users/<uid>/business/drafts/current",
  // not the legacy flat "drafts/current" key — match either so this keeps working.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('__mockdb__') || '{}');
    Object.keys(db).forEach(k => { if (k === 'drafts/current' || k.endsWith('/drafts/current')) delete db[k]; });
    localStorage.setItem('__mockdb__', JSON.stringify(db));
  });
  await page.reload();
  await page.waitForTimeout(400);
  const loginPinX = await page.$('#loginPin');
  if (loginPinX) { await loginPinX.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }

  // --- Test B: a waste-eligible service (turf) shows the waste page, with live area + overrides ---
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Waste Page Test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click();
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // measure: turf
  await page.fill('[data-row="0"] input[data-mf="width"]', '10');
  await page.fill('[data-row="0"] input[data-mf="length"]', '10');
  await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); // -> waste page

  heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('B) heading on waste page (expect "Waste removal & site clearance"):', heading);
  const areaText = await page.$eval('.kfig .v', el => el.textContent).catch(()=>null);
  console.log('   combined area shown, read-only info (expect 100.00 m²):', areaText);

  const prodInputs = await page.$$('[data-opt]');
  console.log('   three productivity override fields present (expect 3):', prodInputs.length);
  const diggerInput = await page.$('[data-opt="diggerProductivity"]');
  const diggerDefault = await diggerInput.inputValue();
  console.log('   digger productivity default (expect 50):', diggerDefault);

  // Override clearance labour productivity for this job only
  const labourInput = await page.$('[data-opt="labourProductivity"]');
  await labourInput.fill('40');
  await page.waitForTimeout(700); // let debounce flush

  // Back out to the turf page and forward again -> override should persist
  await (await page.$('button[data-action="wizBack"]')).click(); await page.waitForTimeout(150);
  heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('   Back from waste goes to Turf:', heading);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  const labourValAfterRevisit = await page.$eval('[data-opt="labourProductivity"]', el => el.value);
  console.log('   labour productivity override persists after navigating away and back (expect 40):', labourValAfterRevisit);

  // Reload mid-draft (simulating closing the app) -> resume should land back on the waste page with the override intact
  await page.reload();
  await page.waitForTimeout(400);
  const loginPin2 = await page.$('#loginPin');
  if (loginPin2) { await loginPin2.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); }
  const resumeBtn = await page.$('button[data-action="resumeDraft"]');
  console.log('   resume button present after reload:', !!resumeBtn);
  if (resumeBtn) { await resumeBtn.click(); await page.waitForTimeout(300); }
  heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('   resumed draft lands back on waste page (expect "Waste removal & site clearance"):', heading);
  const labourValAfterResume = await page.$eval('[data-opt="labourProductivity"]', el => el.value).catch(()=>'FIELD NOT FOUND');
  console.log('   override survives reload+resume (expect 40):', labourValAfterResume);

  // Continue through to a saved quote, then re-open it for editing and confirm the override round-trips
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // people
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // extras
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150); // preview
  const previewText = await page.$eval('.card', el => el.textContent).catch(()=>'');
  console.log('   preview mentions Waste removal:', /Waste removal/i.test(previewText));
  await (await page.$('button[data-action="saveSentQuote"]')).click();
  await page.waitForTimeout(300);

  await (await page.$('button[data-action="editQuote"]')).click();
  await page.waitForTimeout(250);
  const wastePill = await page.$('.wstep.done[data-step="measure"]');
  await wastePill.click();
  await page.waitForTimeout(200);
  // jumpStep lands on serviceIdx 0 (turf); step forward once to reach the waste page again
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200);
  const labourValAfterEditReopen = await page.$eval('[data-opt="labourProductivity"]', el => el.value).catch(()=>'FIELD NOT FOUND');
  console.log('   override round-trips into an edited saved quote (expect 40):', labourValAfterEditReopen);

  console.log('\nERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();

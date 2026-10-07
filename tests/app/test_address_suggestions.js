// Verifies the "Who's this quote for?" address field offers a dropdown of previously-used
// customer addresses (a local, no-external-API stand-in for full postcode lookup, per the
// artifact comment asking for a postcode/address dropdown). Checks: the datalist exists and is
// wired to the field, a completed quote's address becomes a future suggestion, and the app is
// honest in-page that this isn't a real postcode lookup.
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

  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html'));
  await page.waitForTimeout(400);
  await page.fill('#f_name', 'Infinity Landscapes and Design');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200);
  await page.fill('#f_pin', '1234');
  await page.fill('#f_pin2', '1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400);

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);

  check('address field is wired to the addressSuggestions datalist', await page.$eval('#q_caddress', el => el.getAttribute('list')) === 'addressSuggestions');
  check('datalist exists (empty, no quote history yet)', (await page.$('#addressSuggestions')) !== null);
  check('no address options yet (fresh tenant, no quote history)', (await page.$$('#addressSuggestions option')).length === 0);
  check('page is upfront that this is not a real postcode lookup', /postcode lookup/i.test(await page.$eval('#App', el => el.textContent)));

  // Complete a quote with an address so it can be suggested next time.
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Mr Smith');
  await page.fill('#q_caddress', '12 Orchard Lane, Holton, MI');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="paving"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);
  await page.fill('[data-row="0"] input[data-mf="width"]', '3');
  await page.fill('[data-row="0"] input[data-mf="length"]', '3');
  await page.waitForTimeout(200);
  // Oct 2026: paving now needs a slab type and jointing compound before it can be saved.
  await page.selectOption('[data-row="0"] select[data-mf="slabType"]', '__add_other__'); await page.waitForTimeout(200);
  await page.fill('#modalMatName', 'Test slab'); await page.fill('#modalMatPrice', '40');
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  await page.selectOption('select[data-opt="jointingCompound"]', '__add_other__'); await page.waitForTimeout(200);
  await page.fill('#mf_name', 'Test grout'); await page.fill('#mf_price', '30'); { const c = await page.$('#mf_coverage'); if (c) await c.fill('8'); }
  { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await (await page.$('button[data-action="modalOk"]')).click(); await page.waitForTimeout(250);
  // Paving inserts a waste-removal preview page after its own measurements, so this needs one
  // extra wizNext beyond the plain who→services→measure→people→extras→preview count.
  for (let i = 0; i < 4; i++) {
    await (await page.$('button[data-action="wizNext"]')).click();
    await page.waitForTimeout(200);
  }
  const allBtns = await page.$$eval('button', els => els.map(e => ({text: e.textContent.trim(), action: e.getAttribute('data-action')})));
  console.log('  step buttons after 4 more wizNext clicks:', JSON.stringify(allBtns));
  // If we've landed short of "preview" (no waste page on this build), keep clicking wizNext.
  while (!(await page.$('button[data-action="saveDraftQuote"]'))) {
    const nextBtn = await page.$('button[data-action="wizNext"]');
    if (!nextBtn) break;
    await nextBtn.click();
    await page.waitForTimeout(200);
  }

  await (await page.$('button[data-action="saveDraftQuote"]')).click();
  await page.waitForTimeout(300);

  // finalizeQuote clears the draft and lands on the saved quote's detail view — start a
  // fresh quote from there and check the address now suggests.
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  const optionsAfter = await page.$$eval('#addressSuggestions option', els => els.map(e => e.getAttribute('value'))).catch(()=>[]);
  console.log('  address suggestions after one completed quote:', JSON.stringify(optionsAfter));
  check('the completed quote\'s address now appears as a suggestion', optionsAfter.includes('12 Orchard Lane, Holton, MI'));

  await browser.close();
  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

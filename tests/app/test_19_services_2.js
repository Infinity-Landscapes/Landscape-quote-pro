// Second pass: exercises the remaining new/updated services not covered by test_19_services.js
// in one multi-service quote, checking every section prices without error/NaN and the letter
// renders with the right section labels.
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

  async function fillRow0(){
    for(let attempt=0; attempt<3; attempt++){
      try{
        const widthInput = await page.$('[data-row="0"] input[data-mf="width"]');
        if(widthInput) await widthInput.fill('5', {timeout:3000});
        const lengthInput = await page.$('[data-row="0"] input[data-mf="length"]');
        if(lengthInput) await lengthInput.fill('4', {timeout:3000});
        // Count-based sections (currently just Water Features) have no width/length — a plain
        // "how many" field instead.
        const countInput = await page.$('[data-row="0"] input[data-mf="count"]');
        if(countInput) await countInput.fill('2', {timeout:3000});
        await page.waitForTimeout(250);
        return;
      }catch(e){
        await page.waitForTimeout(300); // re-render mid-fill (debounced autosave) — retry
      }
    }
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

  const keysToTest = ["fence","waterfeatures","steeledging","flowerbeds","pond","brickwall"];

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Multi-service smoke test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  for(const k of keysToTest){
    await (await page.$(`[data-action="toggleQuoteService"][data-key="${k}"]`)).click();
    await page.waitForTimeout(80);
  }
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300); // -> measure: first service

  for(let i=0;i<keysToTest.length;i++){
    const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
    console.log(`  step ${i} heading: ${heading}`);
    await fillRow0();
    await (await page.$('button[data-action="wizNext"]')).click();
    await page.waitForTimeout(300);
  }

  let heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
  console.log('after all measurements, heading:', heading);

  // step through whatever remains (waste page if any is eligible, people, extras) to reach preview
  for(let i=0;i<4;i++){
    heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
    if(/preview|quote ready|your quote/i.test(heading||'')) break;
    const nextBtn = await page.$('button[data-action="wizNext"]');
    if(!nextBtn) break;
    await nextBtn.click();
    await page.waitForTimeout(250);
  }

  // Check only the rendered app UI (#App), not document.body — body.textContent also picks up
  // the page's own inline <script> source text, which of course contains "NaN"/"undefined" as
  // JS keywords and would always false-positive.
  const appText = await page.$eval('#App', el => el.textContent).catch(async ()=> page.$eval('.card', el=>el.textContent));
  check('no "NaN" anywhere in the rendered app UI', !/NaN/.test(appText));
  check('no "undefined" anywhere in the rendered app UI', !/undefined/.test(appText));

  const previewText = await page.$eval('.card', el => el.textContent).catch(()=>'');
  check('preview mentions Fencing', /Fencing/i.test(previewText));
  check('preview mentions Water Features', /Water Features/i.test(previewText));
  check('preview mentions Steel Edging', /Steel Edging/i.test(previewText));
  check('preview mentions Flower Beds', /Flower Beds/i.test(previewText));
  check('preview mentions Pond', /Pond/i.test(previewText));
  check('preview mentions Block Retaining Wall', /Block Retaining Wall/i.test(previewText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

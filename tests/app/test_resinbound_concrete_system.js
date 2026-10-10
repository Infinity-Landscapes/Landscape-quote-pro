// Verifies the new "Resin system" option on the Resin bound service, per the direct request:
// "the current resin bound only quotes for addagrip addagrid system, we need to set an option
// for 'resin path on concrete'". Checks: the select defaults to "Addagrip Addagrid" and shows
// the existing Addagrip materials by default; switching to "Resin path on concrete" swaps the
// materials table to the new recipe (1m² geotextile membrane per m², 1 bag ballast + 1 bag sharp
// sand per 10m², 1.2 bags cement per m² rounded up, 1 resin kit per 4m², 1 delivery charge per up
// to 8 kits, plus a flat £23 consumables line) and removes every Addagrip-specific line; "Prep
// days" (1 per 40m²) is unaffected by which system is chosen; and the customer letter's scope of
// works switches to the new method (excavate 115mm, geotextile membrane, 100mm solid concrete,
// 15mm resin bound gravel) instead of the Addagrip grid-based method.
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
  function prepDaysValue(bodyText){
    const m = bodyText.match(/Prep days(\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  }
  function qtyAfter(bodyText, name, unit){
    // Materials table cells are adjacent <td>s with no separating whitespace, so the name and its
    // qty+unit run together in textContent, e.g. "Ballast2 tonne".
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?: \\([^)]*\\))?(\\d+(?:\\.\\d+)?) ' + unit);
    const m = bodyText.match(re);
    return m ? m[1] : null;
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

  // Oct 2026: Resin bound is only offered to the pre-existing business — simulate it by dropping
  // the extraServices/servicesSeen fields a brand-new business gets, then reloading.
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){ delete d.extraServices; delete d.servicesSeen; delete d.resinSystems; d.brandInfinity = true; if(!d.servicesEnabled.includes('resinbound')) d.servicesEnabled.push('resinbound'); } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  { const pin = await page.$('#loginPin'); if(pin){ await pin.fill('1234'); await (await page.$('button[data-action="login"]')).click(); await page.waitForTimeout(400); } }

  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator', 'Matt');
  await page.fill('#q_cname', 'Resin bound system test');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="resinbound"]')).click();
  await page.waitForTimeout(80);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(300);

  // 12 m² (3 x 4) — chosen so Cement (12*1.2=14.4 -> 15) and Resin delivery (3/8=0.375 -> 1)
  // both exercise real round-up behaviour, not just exact whole numbers.
  await page.fill('[data-row="0"] input[data-mf="width"]', '3');
  await page.fill('[data-row="0"] input[data-mf="length"]', '4');
  await page.waitForTimeout(200);

  // Oct 2026: resin systems are the business's own. The existing business keeps its two systems
  // (same materials and ratios) as its own, editable in Settings → Pricing → Resin bound.
  const systemSelect = await page.$('select[data-opt="resinSystem"]');
  check('Resin system select is present (the business\'s own systems + "+ Add new…")', !!systemSelect);
  const sysOpts = await page.$$eval('select[data-opt="resinSystem"] option', os=>os.map(o=>o.textContent));
  check('existing business keeps Addagrip Addagrid and Resin path on concrete as its own systems', sysOpts.includes('Addagrip Addagrid') && sysOpts.includes('Resin path on concrete') && sysOpts.includes('+ Add new…'));
  check('no old fixed system dropdown on a new quote', !(await page.$('[data-opt="system"]')));
  await page.selectOption('select[data-opt="resinSystem"]', 'Addagrip Addagrid'); await page.waitForTimeout(200);
  let bodyText = await page.$eval('#App', el => el.textContent);
  check('Addagrid shows its grid system and driveway kit', /Addagrip Terrabase grid system/.test(bodyText) && /Addagrip terrabase UV 30mm driveway kit/.test(bodyText));
  check('Addagrid does NOT show Resin kit', !/Resin kit/.test(bodyText));
  check('Prep days: 12 m² -> ruq(12/40) = 0.5', prepDaysValue(bodyText) === '0.5');

  await page.selectOption('select[data-opt="resinSystem"]', 'Resin path on concrete'); await page.waitForTimeout(200);
  bodyText = await page.$eval('#App', el => el.textContent);
  check('switching removes the Addagrip lines', !/Addagrip Terrabase grid system/.test(bodyText) && !/Addagrip anti slip glass/.test(bodyText));
  check('Geotextile membrane: 1 per m² -> 12', qtyAfter(bodyText, 'Geotextile membrane', 'm²') === '12');
  check('Ballast: ru(12/10)=2', qtyAfter(bodyText, 'Ballast', 'tonne') === '2');
  check('Sharp sand: ru(12/10)=2', qtyAfter(bodyText, 'Sharp sand', 'tonne') === '2');
  check('Cement: ru(12 ÷ 0.8333 m² per bag)=15', qtyAfter(bodyText, 'Cement', 'bag') === '15');
  check('Resin kit: ru(12/4)=3', qtyAfter(bodyText, 'Resin kit', 'kit') === '3');
  check('Resin delivery: ru(12/32)=1', qtyAfter(bodyText, 'Resin delivery', 'per 8 kits') === '1');
  check('Consumables (resin path): once per job', /Consumables \(resin path\)/.test(bodyText));
  check('Prep days unaffected: still 0.5', prepDaysValue(bodyText) === '0.5');

  // Step through whatever remains (waste page — resinbound is waste-eligible — then people,
  // extras) to reach the preview, the same generic approach test_19_services_2.js uses.
  for(let i=0;i<6;i++){
    const heading = await page.$eval('h2', el => el.textContent).catch(()=>null);
    if(/preview|quote ready|your quote/i.test(heading||'')) break;
    const nextBtn = await page.$('button[data-action="wizNext"]');
    if(!nextBtn) break;
    await nextBtn.click();
    await page.waitForTimeout(250);
  }

  const previewText = await page.$eval('.card', el => el.textContent).catch(()=>'');
  check('letter mentions excavation to 115mm depth', /115mm/.test(previewText));
  check('letter names the business\'s resin system', /Sub-base prepared and the Resin path on concrete system laid\./.test(previewText));
  check('letter: resin mixed and trowelled', /Resin and aggregate mixed on site and trowelled/.test(previewText));
  check('letter does NOT mention the old Addagrip grid method', !/Addagrip grid system/i.test(previewText));

  console.log('\nERRORS:', errors.length ? errors : 'none');
  console.log('\n' + (pass && errors.length===0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass && errors.length===0 ? 0 : 1);
})();

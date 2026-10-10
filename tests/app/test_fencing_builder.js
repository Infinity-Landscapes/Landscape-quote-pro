// October 2026: one "Fencing" service with builder-defined fence types (Close-board / Panel /
// Composite pre-filled, plus custom types via "+ Add new…"), and the upgraded custom service
// builder (options, quantity rules, plant, letter lines, edit after save).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 1600 } })).newPage();
  require('/tmp/mobiletest/row_helper.js')(page);
  await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const txt = () => page.$eval('#App', el => el.textContent);
  const v = sel => page.$eval(sel, e=>e.value).catch(()=>null);
  const settle = () => page.waitForTimeout(230);
  const click = async sel => { await (await page.$(sel)).click(); await settle(); };

  await page.goto('file:///home/claude/build/app.html'); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await click('button[data-action="setupNext"]'); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click('button[data-action="setupNext"]'); await page.waitForTimeout(200);

  await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="pricing"]');
  let t = await txt();
  check('Fencing card lists the three pre-filled types', /Close-board/.test(t) && /Panel\s*\(pre-filled\)/.test(t) && /Composite\s*\(pre-filled\)/.test(t));
  await click('button[data-action="settingsTab"][data-tab="materials"]');
  check('new tenant: fence-only materials start with no price', await v('input[data-mat="100x100 treated timber fence post"]')==='0' && await v('input[data-mat="Gate"]')==='0');

  // --- Close-board quote
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Fencing test');
  await click('button[data-action="wizNext"]');
  check('three old fence services gone, one Fencing tile', !!(await page.$('[data-action="toggleQuoteService"][data-key="fence"]')) && !(await page.$('[data-key="closeboardfencing"]')));
  await click('[data-action="toggleQuoteService"][data-key="fence"]');
  await click('button[data-action="wizNext"]');
  const typeOpts = await page.$$eval('select[data-opt="fenceType"] option', els=>els.map(e=>e.textContent));
  check('fence type dropdown: 3 types + Add other', ['Close-board','Panel','Composite','+ Add new…'].every(x=>typeOpts.includes(x)));
  await page.fill('[data-row="0"] input[data-mf="length"]','10');
  await page.fill('[data-row="1"] input[data-mf="length"]','4.5'); await settle();
  check('blocker until a fence type is picked', /Select a fence type/.test(await txt()));
  await page.selectOption('select[data-opt="fenceType"]','closeboard'); await settle();
  t = await txt();
  check('productivity starts at the type rate (Close-board 8 m/day)', await v('[data-opt="productivity"]')==='8');
  check('stock posts = 5 + 3 = 8 (cut 2400 = stock)', t.includes('100x100 treated timber fence post8'));
  check('sleeves = 8 posts', t.includes('Post saver sleeve8'));
  check('postcrete = 8 × 2 = 16', t.includes('Postcrete16'));
  check('arris = 6 bays × 3 = 18', t.includes('Arris rail18'));
  check('feather edge = ROUNDUP(100) + ROUNDUP(45) = 145', t.includes('Feather edge board145'));
  check('gravel board / capping / counter = 6', t.includes('Timber gravel board6') && t.includes('Capping rail6') && t.includes('Counter rail6'));
  check('nails = ROUNDUP(14.5/20) = 1', t.includes('Box of nails1'));
  check('labour = 14.5/8 × £150 = £271.88', /271\.88/.test(t));
  check('£0 blockers name the lines', /"100x100 treated timber fence post" has no price/.test(t) && /"Nail gun" has no daily rate/.test(t) && /"Arris rail" has no price/.test(t));
  // common options
  await click('button[data-action="setOpt"][data-opt="removeOld"][data-val="true"]');
  await click('button[data-action="setOpt"][data-opt="gate"][data-val="true"]');
  await page.fill('[data-opt="gateCount"]','2'); await settle();
  t = await txt();
  check('remove old fence = 14.5 m', t.includes('Remove old fence14.5'));
  check('gate type dropdown, blocker until one is picked', !!(await page.$('select[data-opt="gateType"]')) && /Select a gate type/.test(t));
  await page.selectOption('select[data-opt="gateType"]','__add_other__'); await settle();
  await page.fill('#mf_name','Featheredge gate'); await page.fill('#mf_price','350'); await page.fill('#mf_supplier','Jewson');
  await click('button[data-action="modalOk"]');
  t = await txt();
  check('gates = 2 of the chosen gate type', /Featheredge gate( \(Jewson\))?\s*2/.test(t));

  // --- Panel
  await page.selectOption('select[data-opt="fenceType"]','panel'); await settle();
  t = await txt();
  check('panel: gravel board option appears, ticked by default', !!(await page.$('button[data-action="setOpt"][data-opt="t_gravelBoard"][data-val="true"].btn-primary')));
  check('panel: posts 7 + 4 = 11, lap panels 9, gravel 9, screws 1', t.includes('100x100 treated timber fence post11') && t.includes('Lap panel9') && t.includes('Timber gravel board9') && t.includes('Box of 5x80mm screws1'));
  check('panel: productivity switched to 10', await v('[data-opt="productivity"]')==='10');
  await click('button[data-action="setOpt"][data-opt="t_gravelBoard"][data-val="false"]');
  check('panel: no gravel board when unticked', !(await txt()).includes('Timber gravel board9'));
  // --- Composite
  await page.selectOption('select[data-opt="fenceType"]','composite'); await settle();
  t = await txt();
  check('composite: composite posts, no sleeves, panels 9', t.includes('Composite fence posts11') && !t.includes('Post saver sleeve') && t.includes('Composite fence panels9'));

  // --- + Add new… builder from the quote
  await page.selectOption('select[data-opt="fenceType"]','__add_other__'); await settle();
  check('builder opens in fence mode', !!(await page.$('#svcFenceHeight')));
  await page.fill('#svcName','Tall close-board');
  await page.fill('#svcFenceHeight','2100'); await page.fill('#svcPostSpacing','2000'); await page.fill('#svcStockLength','2400');
  await page.fill('#svcPostMaterial','100x100 treated timber fence post');
  await click('button[data-action="addSvcOptionRow"]');
  await page.fill('[data-svcopt-label="0"]','Trellis?');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('[data-svcmat-name="0"]','Trellis panel'); await page.fill('[data-svcmat-amount="0"]','1');
  await page.selectOption('[data-svcmat-basis="0"]','bay');
  await page.selectOption('[data-svcmat-onlyif="0"]', {label:'Only when "Trellis?" ticked'});
  await page.fill('[data-svcmat-price="0"]','25'); await page.fill('[data-svcmat-supplier="0"]','Test supplier');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('#svcProductivity','4');
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="0"]','Post holes dug to [in-ground depth]mm');
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="1"]','Trellis fitted along the top');
  await page.selectOption('[data-svcltr-onlyif="1"]', {label:'"Trellis?" ticked'});
  await click('button[data-action="svcBuilderNext"]');
  await click('button[data-action="saveServiceBuilder"]'); await settle();
  t = await txt();
  check('back on the quote with the new type selected', /Tall close-board/.test(await page.$eval('select[data-opt="fenceType"]', s=>s.options[s.selectedIndex].textContent)));
  check('cut 600+2100 > 2400 stock -> blocked', /Fence height needs a longer post than the stock length/.test(t));
  check('new type option shown (Trellis?)', !!(await page.$('button[data-action="setOpt"][data-opt^="t_"]')));
  check('trellis not counted until ticked', !t.includes('Trellis panel'));
  await click('button[data-action="setOpt"][data-opt^="t_"][data-val="true"]');
  // posts: row0 ru(10000/2000)=5+1=6 (bays 5), row1 ru(2.25)=3+1=4 (bays 3) -> 8 bays
  check('trellis = 8 bays when ticked', (await txt()).includes('Trellis panel8'));

  // --- Back to Close-board, price everything, letter
  await page.selectOption('select[data-opt="fenceType"]','closeboard'); await settle();
  await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="materials"]');
  for (const [n,pr] of [["100x100 treated timber fence post","17.35"],["Arris rail","4"],["Timber gravel board","8"],["Feather edge board","1.5"],["Capping rail","5"],["Counter rail","5"],["Box of nails","57"],["Nail gun","5"],["Gate","350"],["Remove old fence","20"]]){
    const el = await page.$(`input[data-mat="${n}"]`); if(el) await el.fill(pr);
  }
  await click('button[data-action="saveMaterialsForm"]');
  await click('button[data-nav="newquote"]');
  t = await txt();
  check('all prices entered -> no blockers on the measure page', !/Needs attention/.test(t));
  for (let i=0;i<5 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('no waste page for fencing; quote can be saved', !!(await page.$('button[data-action="saveSentQuote"]')));
  check('letter: cleared + old fencing removed', /Fence line cleared and old fencing removed\./.test(t));
  check('letter: post holes at the in-ground depth', /Post holes dug to 600mm\./.test(t));
  check('letter: counter rail + capping lines', /Counter rail fitted to the back of the fence\./.test(t) && /Finished with a capping rail\./.test(t));
  check('letter: gates line names the gate type', /2 gates installed \(Featheredge gate\)\./.test(t));

  // --- Upgraded custom service builder: options, rules, plant, letter, edit
  await click('button[data-nav="settings"]');
  await click('button[data-action="settingsTab"][data-tab="services"]');
  await click('button[data-action="startSvcBuilder"]');
  await page.fill('#svcName','Hedge trimming');
  await click('[data-action="setSvcMeasureType"][data-val="length"]');
  await click('button[data-action="addSvcOptionRow"]');
  await page.fill('[data-svcopt-label="0"]','Take away cuttings?');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('[data-svcmat-name="0"]','Green waste bag'); await page.fill('[data-svcmat-amount="0"]','1'); await page.fill('[data-svcmat-per="0"]','10');
  await page.check('[data-svcmat-roundup="0"]');
  await page.selectOption('[data-svcmat-onlyif="0"]', {label:'Only when "Take away cuttings?" ticked'});
  await page.fill('[data-svcmat-unit="0"]','bag'); await page.fill('[data-svcmat-price="0"]','3'); await page.fill('[data-svcmat-supplier="0"]','Test supplier');
  await click('button[data-action="svcBuilderNext"]');
  await page.fill('#svcProductivity','20');
  await click('button[data-action="addSvcPlantRow"]');
  await page.fill('[data-svcplant-name="0"]','Hedge trimmer'); await page.fill('[data-svcplant-price="0"]','12');
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="0"]','Hedges cut back to shape');
  await click('button[data-action="addSvcLetterRow"]');
  await page.fill('[data-svcltr-text="1"]','Cuttings bagged and taken away');
  await page.selectOption('[data-svcltr-onlyif="1"]', {label:'"Take away cuttings?" ticked'});
  await click('button[data-action="svcBuilderNext"]');
  await click('button[data-action="saveServiceBuilder"]');
  const ckey = await page.$eval('.service-tile:has-text("Hedge trimming")', el=>el.getAttribute('data-key'));
  check('custom service saved with an Edit button', !!(await page.$(`button[data-action="editCustomService"][data-key="${ckey}"]`)));
  await click(`button[data-action="editCustomService"][data-key="${ckey}"]`);
  check('edit opens the builder pre-filled', await v('#svcName')==='Hedge trimming');
  await click('button[data-action="svcBuilderNext"]'); await click('button[data-action="svcBuilderNext"]');
  await page.fill('#svcProductivity','25');
  await click('button[data-action="svcBuilderNext"]'); await click('button[data-action="saveServiceBuilder"]');
  // discard the fencing draft and quote the custom service
  await click('button[data-nav="menu"]');
  const dd = await page.$('button[data-action="discardDraft"]'); if(dd){ await dd.click(); await settle(); const ok = await page.$('button[data-action="modalOk"]'); if(ok) { const __s = await page.$('#mf_supplier, #modalMatSupplier'); if (__s && !(await __s.inputValue())) await __s.fill('Test supplier'); } await click('button[data-action="modalOk"]'); }
  await click('button[data-nav="newquote"]');
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Hedge test');
  await click('button[data-action="wizNext"]');
  await click(`[data-action="toggleQuoteService"][data-key="${ckey}"]`);
  await click('button[data-action="wizNext"]');
  check('edited productivity (25) is the default', await v('[data-opt="productivity"]')==='25');
  await page.fill('[data-row="0"] input[data-mf="length"]','25'); await settle();
  check('waste bags not counted until ticked', !(await txt()).includes('Green waste bag'));
  await click('button[data-action="setOpt"][data-opt^="o"][data-val="true"]');
  check('waste bags = ROUNDUP(25/10) = 3 when ticked', (await txt()).includes('Green waste bag3'));
  // 25m ÷ 25 = 1 person-day ÷ 3 people -> 0.5 days × £12 inc VAT (£10 net) = £5.00
  check('plant priced per day (Hedge trimmer £5.00)', /Plant hire\s*£5\.00/.test(await txt()));
  for (let i=0;i<5 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ const b = await page.$('button[data-action="wizNext"]'); if(!b) break; await b.click(); await settle(); }
  t = await txt();
  check('custom letter lines used', /Hedges cut back to shape\./.test(t) && /Cuttings bagged and taken away\./.test(t));

  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass&&!errors.length?'ALL CHECKS PASSED':'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass&&!errors.length?0:1);
})();

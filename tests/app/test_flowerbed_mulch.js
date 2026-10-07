// Flower Beds: a "Bark mulch" tick box on every measurement area, ticked by default. Unticking an
// area takes it out of the bark mulch and compost fills its whole dig-out instead; the letter only
// promises mulch where it's going.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={buildQuoteFromDraft,quoteLetterPlainText,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_mulch_exposed.html', html);

  async function run(vp, label){
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on('pageerror', e => errors.push(label+' PAGEERROR: ' + e.message));
    await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
    const wait = ms => page.waitForTimeout(ms);
    await page.goto('file://'+__dirname+'/_mulch_exposed.html'); await wait(400);
    await page.fill('#f_name', 'Infinity Landscapes and Design');
    for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await wait(200); }
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await page.click('button[data-action="setupNext"]'); await wait(400);
    await page.click('button[data-nav="newquote"]'); await wait(200);
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Mulch Test');
    await page.click('button[data-action="wizNext"]'); await wait(150);
    await page.click('[data-action="toggleQuoteService"][data-key="flowerbeds"]'); await wait(150);
    await page.click('button[data-action="wizNext"]'); await wait(200);
    await page.fill('[data-row="0"] input[data-mf="desc"]','Front bed');
    await page.fill('[data-row="0"] input[data-mf="width"]','4'); await page.fill('[data-row="0"] input[data-mf="length"]','5');
    await page.fill('[data-row="0"] input[data-mf="digOutDepth"]','300');
    await page.click('[data-action="addMeasRow"]'); await wait(200);
    await page.fill('[data-row="1"] input[data-mf="desc"]','Veg patch');
    await page.fill('[data-row="1"] input[data-mf="width"]','2'); await page.fill('[data-row="1"] input[data-mf="length"]','3');
    await page.fill('[data-row="1"] input[data-mf="digOutDepth"]','300'); await wait(200);
    const mats = () => page.evaluate(()=>{ const T=window.__T; const q=T.buildQuoteFromDraft(T.S().draft,"draft"); const s=q.sections.find(x=>x.key==='flowerbeds');
      const m = n => { const x=(s.materials||[]).find(y=>y.name===n); return x?x.qty:0; }; const w=q.sections.find(x=>x.key==='waste');
      return {compost:m('Peat free compost bulk bag'), mulch:m('Bark mulch'), text:T.quoteLetterPlainText(q), wasteArea: w ? w.area : 0}; });
    const boxes = await page.$$('[data-row] input[data-row-check="mulch"]');
    check(`${label}: a Bark mulch tick box on each area`, boxes.length===2);
    check(`${label}: ticked by default`, (await page.$$eval('[data-row] input[data-row-check="mulch"]', els=>els.every(e=>e.checked))));
    // ---- Dig out tick box: built-up beds add nothing to the waste removal ----
    check(`${label}: a Dig out tick box on each area, ticked by default`, (await page.$$eval('[data-row] input[data-row-check="digOut"]', els=>els.length===2 && els.every(e=>e.checked))));
    check(`${label}: depth column explains dug out vs built up`, /how high it's built up/.test(await page.$eval('#app', e=>e.innerText)));
    let m = await mats();
    check(`${label}: both dug out — 26 m² goes to waste removal`, Math.abs(m.wasteArea-26)<0.01);
    check(`${label}: letter says dug out`, /Bed areas dug out to a depth of 300mm\./.test(m.text));
    await page.uncheck('[data-row="1"] input[data-row-check="digOut"]'); await wait(300);
    m = await mats();
    check(`${label}: veg patch built up — only 20 m² goes to waste removal`, Math.abs(m.wasteArea-20)<0.01);
    check(`${label}: compost still fills the built-up bed (13 bags)`, m.compost===13);
    check(`${label}: letter: front bed dug out, veg patch built up`, /Front bed dug out to a depth of 300mm\./.test(m.text) && /Veg patch built up to a height of 300mm\./.test(m.text));
    await page.uncheck('[data-row="0"] input[data-row-check="digOut"]'); await wait(300);
    m = await mats();
    check(`${label}: nothing dug out — no waste removal at all`, m.wasteArea===0 && !/Waste removal/.test(m.text));
    check(`${label}: letter: built up`, /Bed areas built up to a height of 300mm\./.test(m.text) && !/dug out/.test(m.text));
    await page.check('[data-row="0"] input[data-row-check="digOut"]'); await page.check('[data-row="1"] input[data-row-check="digOut"]'); await wait(300);
    m = await mats();
    // 26 m²: mulch 26×0.05=1.3 m³ → 3 bags; compost 26×0.25=6.5 m³ → 13 bags
    check(`${label}: both mulched — 3 bags mulch, 13 bags compost`, m.mulch===3 && m.compost===13);
    check(`${label}: letter says topped with 50mm of bark mulch`, /Topped with 50mm of bark mulch\./.test(m.text));
    await page.uncheck('[data-row="1"] input[data-row-check="mulch"]'); await wait(300);
    m = await mats();
    // mulch 20×0.05=1.0 → 2 bags; compost 20×0.25 + 6×0.30 = 6.8 m³ → 14 bags
    check(`${label}: veg patch unticked — mulch drops to 2 bags`, m.mulch===2);
    check(`${label}: compost fills the veg patch's whole depth (14 bags)`, m.compost===14);
    check(`${label}: letter names only the mulched area`, /Topped with 50mm of bark mulch: Front bed\./.test(m.text) && !/Veg patch\./.test(m.text.split('Topped with')[1]||''));
    check(`${label}: the untick stays after re-render`, !(await page.isChecked('[data-row="1"] input[data-row-check="mulch"]')) && await page.isChecked('[data-row="0"] input[data-row-check="mulch"]'));
    await page.uncheck('[data-row="0"] input[data-row-check="mulch"]'); await wait(300);
    m = await mats();
    check(`${label}: nothing mulched — no bark mulch at all, letter doesn't mention it`, m.mulch===0 && !/bark mulch/i.test(m.text));
    await page.check('[data-row="0"] input[data-row-check="mulch"]'); await wait(300);
    const noOverflow = await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`${label}: no sideways scrolling`, noOverflow);
    await page.screenshot({ path: `${__dirname}/flowerbed_mulch_${label}.png`, fullPage: false });
    // reload: the draft keeps the choice
    await wait(1500);
    await page.reload(); await wait(500);
    if (await page.$('#loginPin')){ await page.fill('#loginPin','1234'); await page.click('button[data-action="login"]'); await wait(400); }
    const resume = await page.$('[data-action="resumeDraft"]'); if (resume){ await resume.click(); await wait(400); }
    const v = await page.evaluate(()=>{ const d=window.__T.S().draft; const st=d && d.sectionsRaw && d.sectionsRaw.flowerbeds; return st ? st.rows.map(r=>r.mulch) : null; });
    if(!Array.isArray(v)) console.log('  draft after reload:', JSON.stringify(await page.evaluate(()=>{ const d=window.__T.S().draft; return d ? Object.keys(d) : null; })), 'screen', await page.evaluate(()=>window.__T.S().screen));
    console.log('  rows mulch after reload:', JSON.stringify(v));
    check(`${label}: choices kept in the saved draft`, Array.isArray(v) && v[0]!==false && v[1]===false);
  }
  await run({width:1100,height:1000}, 'desktop');
  await run({width:390,height:844}, 'phone');
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

// Quote PDFs are A4 documents whatever the device: the letter is rendered at a fixed page width
// with the desktop layout (a phone's narrow layout used to make a 6-page, big-text PDF), and page
// breaks land between lines of text.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={captureForPdf,buildPdfBlobFromElement,pdfPageSlices,ensurePdfLibs,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_pdf_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const results = {};
  for (const [label, vp] of [['phone',{width:390,height:844}],['desktop',{width:1280,height:1000}]]){
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
    const wait = ms => page.waitForTimeout(ms);
    await page.goto('file://'+__dirname+'/_pdf_exposed.html'); await wait(400);
    await page.fill('#f_name','Infinity Landscapes and Design');
    for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await wait(200); }
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await page.click('button[data-action="setupNext"]'); await wait(400);
    await page.click('button[data-nav="newquote"]'); await wait(200);
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Mr and Mrs Griffin'); await page.fill('#q_cemail','g@example.com');
    await page.click('button[data-action="wizNext"]'); await wait(150);
    for (const s of ['turf','gravel']) { await page.click(`[data-action="toggleQuoteService"][data-key="${s}"]`); await wait(120); }
    await page.click('button[data-action="wizNext"]'); await wait(200);
    await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','8'); await wait(150);
    for (let i=0;i<8 && !(await page.$('#letterCapture')); i++){ if (await page.$('[data-row="0"] input[data-mf="width"]') && !(await page.$eval('[data-row="0"] input[data-mf="width"]', e=>e.value))) { await page.fill('[data-row="0"] input[data-mf="width"]','5'); await page.fill('[data-row="0"] input[data-mf="length"]','6'); await wait(150);} await page.click('button[data-action="wizNext"]'); await wait(250); }
    const shown = await page.$eval('#letterCapture', e=>Math.round(e.getBoundingClientRect().width));
    const r = await page.evaluate(async ()=>{
      const T = window.__T; await T.ensurePdfLibs();
      const c = await T.captureForPdf(document.getElementById('letterCapture'), 1);
      const pagePx = Math.floor(c.width * 297 / 210);
      const slices = T.pdfPageSlices(c, pagePx);
      // first page as an image for a look
      const p1 = document.createElement('canvas'); p1.width = c.width; p1.height = Math.min(pagePx, c.height);
      p1.getContext('2d').drawImage(c, 0, 0);
      const blob = await T.buildPdfBlobFromElement('letterCapture', {scale:2, quality:0.85});
      const txt = await blob.text();
      return { capW: c.width, capH: c.height, pages: slices.length, cuts: slices.map(s=>s[1]), pagePx, png: p1.toDataURL('image/png'), pdfPages: (txt.match(/\/Type\s*\/Page[^s]/g)||[]).length, mediabox: (txt.match(/\/MediaBox\s*\[[^\]]*\]/)||[''])[0] };
    });
    fs.writeFileSync(`${__dirname}/pdf_a4_${label}_p1.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`  ${label}: letter on screen ${shown}px wide; captured ${r.capW}×${r.capH}; pages ${r.pages} (${r.pdfPages} in PDF); ${r.mediabox}`);
    check(`${label}: PDF letter captured at the fixed A4 width (760px), not the screen width`, r.capW === 760);
    check(`${label}: PDF pages are A4 (595 × 842 pt)`, /595\.\d*\s+841\.\d*|595\.28\s+841\.89/.test(r.mediabox));
    check(`${label}: page breaks never longer than a page`, r.cuts.every(h=>h<=r.pagePx));
    check(`${label}: no errors`, !errors.length);
    results[label] = r;
    await page.context().close();
  }
  check('phone and desktop make the same PDF layout (same height and page count)', results.phone.capH === results.desktop.capH && results.phone.pages === results.desktop.pages);
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

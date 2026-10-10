// Quote letter PDF laid out like Infinity's Word letter: A4 pages with the letterhead (logo +
// strapline) and footer on every page, Word margins, and paragraphs / bullet points / materials rows
// never split across pages, with headings kept with what follows. Same PDF from a phone or computer.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let html = fs.readFileSync('/home/claude/build/app.html','utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={captureLetterPages,buildPdfBlobFromElement,ensurePdfLibs,A4_PAGE,S:()=>S};' + html.slice(k);
  fs.writeFileSync('/tmp/mobiletest/_pages_exposed.html', html);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const out = {};
  for (const [label, vp] of [['desktop',{width:1280,height:1000}],['phone',{width:390,height:844}]]){
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
    const wait = ms => page.waitForTimeout(ms);
    await page.goto('file:///tmp/mobiletest/_pages_exposed.html'); await wait(400);
    await page.fill('#f_name','Infinity Landscapes and Design');
    for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await wait(200); }
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await page.click('button[data-action="setupNext"]'); await wait(400);
    await page.click('button[data-nav="newquote"]'); await wait(200);
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Harriet Adams'); await page.fill('#q_cemail','h@example.com');
    await page.click('button[data-action="wizNext"]'); await wait(150);
    for (const s of ['turf','paving','brickwall','flowerbeds']) { await page.click(`[data-action="toggleQuoteService"][data-key="${s}"]`); await wait(120); }
    await page.click('button[data-action="wizNext"]'); await wait(200);
    for (let i=0;i<10 && !(await page.$('#letterCapture')); i++){
      for (let n=0;n<8;n++){
        const sel = await page.evaluate(()=>{ const e = Array.from(document.querySelectorAll('[data-row="0"] input[data-mf]:not([data-mf="desc"])')).find(x=>!x.value); return e ? e.getAttribute('data-mf') : null; });
        if (!sel) break;
        await page.fill(`[data-row="0"] input[data-mf="${sel}"]`, '6'); await wait(120);
      }
      await wait(150);
      await page.click('button[data-action="wizNext"]'); await wait(250);
    }
    await (await page.$('#letterCapture')).screenshot({ path: `/tmp/mobiletest/letter_screen_${label}.png` });
    const r = await page.evaluate(async ()=>{
      const T = window.__T; await T.ensurePdfLibs();
      // Count how the blocks landed on pages (layout only, before photographing)
      const el = document.getElementById('letterCapture');
      const canvases = await T.captureLetterPages(el, 1);
      const pngs = canvases.map(c=>c.toDataURL('image/png'));
      const blob = await T.buildPdfBlobFromElement('letterCapture', {scale:2, quality:0.85});
      const buf = Array.from(new Uint8Array(await blob.arrayBuffer()));
      return { n: canvases.length, sizes: canvases.map(c=>c.width+'x'+c.height), pngs, buf, kb: Math.round(blob.size/1024) };
    });
    fs.writeFileSync(`/tmp/mobiletest/letter_pages_${label}.pdf`, Buffer.from(r.buf));
    r.pngs.forEach((p,i)=>fs.writeFileSync(`/tmp/mobiletest/letter_page_${label}_${i+1}.png`, Buffer.from(p.split(',')[1],'base64')));
    console.log(`  ${label}: ${r.n} pages ${r.sizes.join(', ')}; PDF ${r.kb} KB`);
    check(`${label}: every page is exactly A4 (794×1123)`, r.sizes.every(s=>s==='794x1123'));
    check(`${label}: at least 2 pages for this quote`, r.n>=2);
    check(`${label}: no errors`, !errors.length);
    // layout checks inside the paged copy
    const lay = await page.evaluate(async ()=>{
      const T = window.__T, el = document.getElementById('letterCapture');
      // build the pages again but inspect before they're removed
      const origH2c = window.html2canvas; const seen = [];
      window.html2canvas = async (pg)=>{ const b = pg.querySelector('.lpage-body'); const kids = Array.from(b.children);
        seen.push({h:b.offsetHeight, head:!!pg.querySelector('.lpage-head img.lh-logo') && !!pg.querySelector('.lpage-head img.lh-tag'), foot:!!pg.querySelector('.lpage-foot img'),
          lastIsHeading: kids.length>1 && kids[kids.length-1].hasAttribute('data-keep'), text: b.innerText.slice(0,60)});
        return origH2c(pg, {scale:0.2}); };
      await T.captureLetterPages(el, 0.2); window.html2canvas = origH2c;
      return {seen, avail: T.A4_PAGE.h - T.A4_PAGE.top - T.A4_PAGE.bottom};
    });
    check(`${label}: letterhead (logo + strapline) and footer on every page`, lay.seen.every(p=>p.head && p.foot));
    check(`${label}: every page's text fits between header and footer`, lay.seen.every(p=>p.h<=lay.avail));
    check(`${label}: no page ends with a heading`, lay.seen.every(p=>!p.lastIsHeading));
    out[label] = r;
    await page.context().close();
  }
  check('phone and desktop give the same pages', out.phone.n === out.desktop.n);
  // ---- another business: their logo only in the header; footer = phone and email only ----
  {
    const page = await (await browser.newContext({ viewport:{width:1280,height:1000} })).newPage();
    await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
    const wait = ms => page.waitForTimeout(ms);
    await page.goto('file:///tmp/mobiletest/_pages_exposed.html'); await wait(400);
    await page.fill('#f_name','Green Thumb Gardens'); await page.fill('#f_email','hello@greenthumb.test'); await page.fill('#f_phone','01234 567890');
    await page.setInputFiles('#f_logoFile', '/tmp/mobiletest/_logo_red.png'); await wait(600);
    for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } await page.click('button[data-action="setupNext"]'); await wait(200); }
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await page.click('button[data-action="setupNext"]'); await wait(400);
    await page.click('button[data-nav="newquote"]'); await wait(200);
    await page.fill('#q_creator','Sam'); await page.fill('#q_cname','Test Customer');
    await page.click('button[data-action="wizNext"]'); await wait(150);
    await page.click('[data-action="toggleQuoteService"][data-key="turf"]'); await wait(120);
    await page.click('button[data-action="wizNext"]'); await wait(200);
    await page.fill('[data-row="0"] input[data-mf="width"]','6'); await page.fill('[data-row="0"] input[data-mf="length"]','6'); await wait(150);
    for (let i=0;i<8 && !(await page.$('#letterCapture')); i++){ await page.click('button[data-action="wizNext"]'); await wait(250); }
    const t = await page.evaluate(async ()=>{
      const T = window.__T; await T.ensurePdfLibs(); const seen = []; const o = window.html2canvas;
      window.html2canvas = async (pg, opts)=>{ seen.push({own:!!pg.querySelector('.lpage-head img.lh-own'), tag:!!pg.querySelector('.lh-tag'), foot:(pg.querySelector('.lpage-foot')||{}).innerText||''}); return o(pg, opts); };
      const cs = await T.captureLetterPages(document.getElementById('letterCapture'), 1); window.html2canvas = o;
      return {seen, png: cs[0].toDataURL('image/png')};
    });
    fs.writeFileSync('/tmp/mobiletest/letter_page_tenant_1.png', Buffer.from(t.png.split(',')[1],'base64'));
    check('other business: their logo on every page, no Infinity strapline', t.seen.every(p=>p.own && !p.tag));
    check('other business: footer is just phone and email', t.seen.every(p=>/01234 567890/.test(p.foot) && /hello@greenthumb\.test/.test(p.foot) && !/Green Thumb/.test(p.foot)));
    await page.context().close();
  }
  execSync('pdfinfo /tmp/mobiletest/letter_pages_desktop.pdf | grep -E "Pages|Page size"', {stdio:'inherit'});
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

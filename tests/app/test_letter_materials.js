// Quote letter: one consolidated "Materials allowed for" list instead of a materials line under
// each service. It sits straight after the last service (and the waste removal line that closes the
// works list), before notes, totals and the closing. A material used by more than one service is
// one line with the quantities added together. Consumables are left off. Same in the plain-text (email) version.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  let html = fs.readFileSync(require('path').resolve(__dirname,'../../app/app.html'),'utf8');
  const k = html.lastIndexOf('\n})();');
  html = html.slice(0,k) + '\nwindow.__T={buildQuoteFromDraft,quoteLetterPlainText,quoteLetterHtml,quoteMaterialsList,S:()=>S};' + html.slice(k);
  fs.writeFileSync(__dirname+'/_matlist_exposed.html', html);
  await page.goto('file://'+__dirname+'/_matlist_exposed.html');
  await page.waitForTimeout(400);
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);

  await page.fill('#f_name', 'Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ if (await page.$('#f_dayrate')) { if(!(await page.$eval('#f_dayrate',e=>e.value))) { await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); } } await page.click('button[data-action="setupNext"]'); await wait(250); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await wait(400);

  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator', 'Matt'); await page.fill('#q_cname', 'Materials List Test');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  const services = ['turf','gravel','flowerbeds'];
  for (const s of services){ await page.click(`[data-action="toggleQuoteService"][data-key="${s}"]`); await wait(120); }
  await page.click('button[data-action="wizNext"]'); await wait(200);
  // measurements for each service in turn
  for (let i=0;i<services.length;i++){
    const w = await page.$('[data-row="0"] input[data-mf="width"]');
    if (w){ await w.fill(String(4+i)); await page.fill('[data-row="0"] input[data-mf="length"]', String(5+i)); }
    else { const len = await page.$('[data-row="0"] input[data-mf="length"]'); if (len) await len.fill('6'); }
    await wait(150);
    await page.click('button[data-action="wizNext"]'); await wait(200);
  }
  // on to the review page (the quote can't be finalised without a gravel type and two prices, which
  // doesn't matter here: the letter is drawn either way)
  for (let i=0;i<6 && !(await page.$('#letterCapture')); i++){ await page.click('button[data-action="wizNext"]'); await wait(200); }
  const r = await page.evaluate(() => {
    const T = window.__T; const q = T.buildQuoteFromDraft(T.S().draft, "draft");
    // what the list should be, worked out independently from each section's own materials
    const exp = {}, order = [], perKey = {};
    q.sections.filter(s=>s.key!=="waste" && s.subtotal>0.004).forEach(s=>(s.materials||[]).filter(m=>!/^consumables$/i.test(m.name.trim())).forEach(m=>{
      const key = m.name.trim().toLowerCase()+'|'+String(m.unit).trim().toLowerCase();
      if(!(key in exp)){ exp[key]=0; order.push(key); perKey[key]=new Set(); }
      exp[key] += Number(m.qty)||0; perKey[key].add(s.key);
    }));
    const shared = order.filter(k=>perKey[k].size>1);
    const list = T.quoteMaterialsList(q);
    return {
      sections: q.sections.map(s=>({key:s.key, label:s.label, n:(s.materials||[]).length, sub:s.subtotal})),
      exp: order.map(k=>[k, Math.round(exp[k]*100)/100]), shared,
      list: list.map(m=>[m.name.trim().toLowerCase()+'|'+String(m.unit).trim().toLowerCase(), m.qty, m.name, m.unit]),
      text: T.quoteLetterPlainText(q),
      hasConsumables: q.sections.some(s=>(s.materials||[]).some(m=>/^consumables$/i.test(m.name.trim()) && m.qty>0 && m.cost>=0)),
    };
  });
  console.log('sections:', JSON.stringify(r.sections));
  console.log('shared materials:', JSON.stringify(r.shared));
  check('quote has 3 priced services', r.sections.filter(s=>s.key!=='waste' && s.sub>0).length === 3);
  check('at least one material is used by more than one service', r.shared.length >= 1);
  check('consolidated list has exactly one line per distinct material', r.list.length === r.exp.length && new Set(r.list.map(x=>x[0])).size === r.list.length);
  check('every line has the combined quantity across services', r.exp.every(([key,q]) => { const l = r.list.find(x=>x[0]===key); return l && Math.abs(l[1]-q) < 0.005; }));
  const totalPerService = r.sections.reduce((a,s)=>a+(s.key==='waste'?0:s.n),0);
  check('shared materials were merged (fewer lines than per-service lines)', r.list.length < totalPerService);

  // ---- on-screen letter (preview) ----
  const letter = await page.$eval('#letterCapture', el => el.innerText);
  const occurrences = (letter.match(/Materials allowed for/g)||[]).length;
  check('letter shows "Materials allowed for" exactly once', occurrences === 1);
  check('no per-service "Materials allowed for:" lines', !/Materials allowed for:/.test(letter));
  const iMat = letter.indexOf('Materials allowed for');
  const lastService = Math.max(...r.sections.filter(s=>s.key!=='waste').map(s=>letter.indexOf(s.label+' – ')));
  const iWaste = letter.indexOf('Waste removal & site clearance');
  check('list comes after every service section', iMat > lastService);
  check('list comes after the waste removal line that closes the works list', iWaste < 0 || iMat > iWaste);
  const iTidy = letter.indexOf('Site to be kept tidy');
  const iTotal = letter.search(/Subtotal \(ex VAT\)|\bTotal\b/);
  check('list comes before the site-tidy line and the totals', iMat < iTidy && iMat < letter.lastIndexOf('Total'));
  // each shared material appears once in the letter, with the summed quantity
  for (const key of r.shared){
    const l = r.list.find(x=>x[0]===key);
    const re = new RegExp(l[2].replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g');
    const matText = letter.slice(iMat);
    check(`"${l[2]}" (used by several services) is listed once in the materials list`, (matText.slice(0, matText.indexOf('Site to be kept tidy')).match(re)||[]).length === 1);
    check(`"${l[2]}" shows the combined quantity ${l[1]} ${l[3]}`, letter.includes(`${l[1]} ${l[3]}`));
  }
  const rows = await page.$$eval('#letterCapture table.letter-mats tr', trs => trs.length);
  check('letter table has one row per material', rows === r.list.length);
  check('consumables are left off the customer letter', !/Consumables/i.test(letter));
  check('consumables are still in the costing (only hidden from the letter)', r.hasConsumables);
  await (await page.$('#letterCapture')).screenshot({ path: __dirname+'/letter_materials.png' });

  // ---- plain-text (email) version ----
  const t = r.text;
  check('plain text: one MATERIALS ALLOWED FOR block, no per-service lines', (t.match(/MATERIALS ALLOWED FOR/g)||[]).length === 1 && !/Materials allowed for:/.test(t));
  const tMat = t.indexOf('MATERIALS ALLOWED FOR');
  check('plain text: block after the services and waste, before the totals', tMat > t.indexOf('Waste removal & site clearance') && tMat < t.indexOf('Subtotal (ex VAT)'));
  const block = t.slice(tMat).split('\n\n')[0].split('\n').slice(1);
  check('plain text: one line per material', block.length === r.list.length);
  check('plain text: no consumables line', !/Consumables/i.test(t));

  // ---- the letter HTML itself (what the PDF and the saved quote's letter are drawn from) ----
  const h = await page.evaluate(() => { const T = window.__T; return T.quoteLetterHtml(T.buildQuoteFromDraft(T.S().draft, "draft")); });
  check('letter HTML has one consolidated list and no per-service lines', (h.match(/Materials allowed for/g)||[]).length === 1 && !/Materials allowed for:/.test(h));

  console.log('ERRORS:', errors.length?errors:'none');
  if (errors.length) pass = false;
  await browser.close();
  console.log(pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

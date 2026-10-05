// Oct 2026 branding & setup: a new business starts with blank material prices/suppliers and no
// Infinity branding; setup step 3 asks VAT registered, VAT % , mark-up, running-cost VAT, working
// week & hours, and needs a day rate + running costs; a logo upload shows on the letter and
// recolours the app; the letter uses neutral, editable wording (business-level and per quote);
// setting up "Infinity Landscapes and Design" keeps Infinity's prices, logo and wording.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let pass = true; const check = (l,c)=>{ console.log((c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const errors = [];
  // a red test logo
  const png = await (async()=>{ const p = await (await browser.newContext()).newPage(); const u = await p.evaluate(()=>{ const c=document.createElement('canvas'); c.width=200; c.height=80; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,200,80); x.fillStyle='#c62828'; x.fillRect(10,10,180,60); return c.toDataURL('image/png'); }); return Buffer.from(u.split(',')[1],'base64'); })();
  fs.writeFileSync(__dirname+'/_logo_red.png', png);

  async function newBiz(name){
    const page = await (await browser.newContext({ viewport:{width:390,height:844}, timezoneId:'Europe/London' })).newPage();
    await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
    return page;
  }
  const settle = p => p.waitForTimeout(250);
  const click = async (p, sel) => { const el = await p.$(sel); if(!el) throw new Error('missing '+sel); await el.click(); await settle(p); };
  const store = p => p.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); return st[Object.keys(st).find(k=>/business$/.test(k))]; });

  // ---- a new business ----
  let page = await newBiz();
  await page.fill('#f_name', 'Green Thumb Gardens');
  await page.setInputFiles('#f_logoFile', __dirname+'/_logo_red.png'); await page.waitForTimeout(600);
  check('logo preview shown in setup', !!(await page.$('img[src^="data:image"]')));
  const primary = await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  check('app recoloured from the logo (red primary)', /^#[0-9a-f]{6}$/i.test(primary) && parseInt(primary.slice(1,3),16) > parseInt(primary.slice(3,5),16)+40);
  check('company name kept after upload', await page.$eval('#f_name', e=>e.value)==='Green Thumb Gardens');
  await click(page, 'button[data-action="setupNext"]');
  await click(page, 'button[data-action="setupNext"]');
  check('step 3 asks VAT registered, VAT %, mark-up, running-cost VAT and working week', !!(await page.$('#f_vatregistered')) && await page.$eval('#f_vatrate', e=>e.value)==='20' && !!(await page.$('#f_markup')) && !!(await page.$('#f_expensesvat')) && (await page.$$('[data-setup-workday]')).length===7 && !!(await page.$('#f_workStart')));
  check('day rate and running costs start blank', await page.$eval('#f_dayrate', e=>e.value)==='' && await page.$eval('#f_expenses', e=>e.value)==='');
  await click(page, 'button[data-action="setupNext"]');
  check('can\'t continue without day rate and running costs', /Enter your day rate/.test(await page.$eval('#App', e=>e.textContent)));
  await page.fill('#f_dayrate','180'); await page.fill('#f_expenses','90'); await page.fill('#f_markup','15'); await page.fill('#f_vatrate','20');
  await page.check('[data-setup-workday="6"]'); await page.fill('#f_workStart','08:00');
  await click(page, 'button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click(page, 'button[data-action="setupNext"]');
  let b = await store(page);
  const priced = Object.values(b.materials).filter(m=>(m.price||0)>0).length;
  const supplied = Object.values(b.materials).filter(m=>m.supplier).length;
  check('new business: no material prices or suppliers', priced===0 && supplied===0);
  check('setup answers saved (rates, mark-up 15, VAT 0.2, Sat working, 8am)', b.dayRatePerPerson===180 && b.expensesPerDay===90 && b.markupPercent===15 && b.vatRate===0.2 && b.workingDays[6]===true && b.workStart==='08:00');
  check('not flagged as Infinity; brand colour saved', b.brandInfinity===false && /^#/.test(b.brandColor||''));
  check('top bar shows their logo', !!(await page.$('.topbar img.brand-logo')));
  // quote letter: neutral wording, own logo, footer band, signer
  await page.evaluate(()=>{ const st = JSON.parse(localStorage.getItem('__mockdb__')); for (const k of Object.keys(st)){ const d = st[k]; if(d && d.materials){
    d.customServices = [{key:'custom_testbed', label:'Test beds', group:'Other services', measureType:'area_wl', v:2, lines:[{material:'Consumables', basis:'job', amount:1, per:1}], materials:[], options:[], plant:[], letter:[{text:'Beds dug and planted'}], productivityDefault:6.7}];
    d.servicesEnabled = (d.servicesEnabled||[]).concat(['custom_testbed']); d.materials['Consumables'].price = 10; } } localStorage.setItem('__mockdb__', JSON.stringify(st)); });
  await page.reload(); await page.waitForTimeout(500);
  await page.fill('#loginPin','1234'); await click(page, 'button[data-action="login"]');
  await click(page, 'button[data-nav="newquote"]');
  await page.fill('#q_creator','Sam Green'); await page.fill('#q_cname','Letter Person'); await settle(page);
  await click(page, 'button[data-action="wizNext"]');
  await click(page, '[data-action="toggleQuoteService"][data-key="custom_testbed"]');
  await click(page, 'button[data-action="wizNext"]');
  await page.fill('[data-row="0"] input[data-mf="width"]','3'); await page.fill('[data-row="0"] input[data-mf="length"]','3'); await settle(page);
  for (let i=0;i<4 && !(await page.$('button[data-action="saveSentQuote"]')); i++) await click(page, 'button[data-action="wizNext"]');
  let t = await page.$eval('.letter', e=>e.textContent);
  check('letter: neutral opening, not Infinity\'s', /Thank you for asking Green Thumb Gardens to quote/.test(t) && !/perfectionist/.test(t));
  check('letter: their logo, no Infinity footer image, footer band with their name', !!(await page.$('.letter-head img[src^="data:image/png"]')) && !(await page.$('.letter-foot-img')) && /Green Thumb Gardens/.test(await page.$eval('.letter-foot-band', e=>e.textContent)));
  check('letter: signed by the person who created the quote, hours Mon–Sat 8am', /Sam Green/.test(t) && /Monday to Saturday 8am/.test(t));
  await click(page, 'button[data-action="saveSentQuote"]');
  // per-quote edit
  await click(page, 'button[data-action="editLetter"]');
  await page.fill('[data-letter-field="intro"]', 'Hello {customer}, thanks for having us round.');
  await page.fill('[data-letter-field="section:custom_testbed"]', 'Beds dug over\nPlants supplied and planted');
  await click(page, 'button[data-action="saveLetterEdit"]');
  t = await page.$eval('.letter', e=>e.textContent);
  check('per-quote letter edits show (placeholder filled) and stick', /Hello Letter Person, thanks for having us round\./.test(t) && /Plants supplied and planted/.test(t) && /Edit letter wording \(edited\)/.test(await page.$eval('#App', e=>e.textContent)));
  // business-level wording
  await click(page, 'button[data-nav="settings"]'); await click(page, 'button[data-action="settingsTab"][data-tab="letter"]');
  await page.fill('#lt_closing', 'Cheers from {company}!');
  await click(page, 'button[data-action="saveLetterForm"]');
  await click(page, 'button[data-nav="quotes"]'); await click(page, '[data-action="openQuote"]');
  t = await page.$eval('.letter', e=>e.textContent);
  check('business-level closing wording used on the letter', /Cheers from Green Thumb Gardens!/.test(t));
  // VAT % shown in pricing
  await click(page, 'button[data-nav="settings"]'); await click(page, 'button[data-action="settingsTab"][data-tab="pricing"]');
  check('pricing tab shows VAT as 20 (%)', await page.$eval('#st_vatrate', e=>e.value)==='20');
  await page.close();

  // ---- Infinity itself ----
  page = await newBiz();
  await page.fill('#f_name', 'Infinity Landscapes and Design LTD');
  for (let i=0;i<3;i++) await click(page, 'button[data-action="setupNext"]');
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await click(page, 'button[data-action="setupNext"]');
  b = await store(page);
  check('Infinity: prices, suppliers and rates restored', Object.values(b.materials).filter(m=>(m.price||0)>0).length>80 && b.dayRatePerPerson===150 && b.expensesPerDay===515 && b.brandInfinity===true);
  check('Infinity: standard greens kept', await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())==='#56822b');
  console.log('ERRORS:', errors.length?errors:'none');
  console.log(pass && !errors.length ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  await browser.close(); process.exit(pass && !errors.length ? 0 : 1);
})();

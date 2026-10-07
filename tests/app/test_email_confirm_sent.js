// Emailing a draft quote doesn't mark it as sent any more: the email dialog has a
// "✓ I've sent it — mark as sent" button, and only that (or "Mark as sent to customer") changes it.
// Checked both with and without the Gmail connector.
const { chromium } = require('playwright');
const fs = require('fs');

async function run(mode){
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport:{width:1100,height:1000} })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  await page.addInitScript(`(()=>{
    window.__MODE__ = ${JSON.stringify(mode)};
    const orig = window.claude.use;
    window.claude.use = async (c)=>{
      if(c==='mcp'){
        if(window.__MODE__!=='gmail') return null;
        return { listTools: async()=>({servers:[{server:'Gmail',authStatus:'connected',tools:[]}]}),
                 callTool: async()=>({content:[], payload:{id:'d1', viewUrl:'https://mail.google.com/mail/u/0/#drafts?compose=d1'}}) };
      }
      return orig(c);
    };
  })();`);
  let pass = true; const check = (l,c)=>{ console.log(`[${mode}] `+(c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  const wait = ms => page.waitForTimeout(ms);
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await wait(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await wait(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await page.click('button[data-action="setupNext"]'); await wait(300);
  await page.click('button[data-nav="newquote"]'); await wait(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Confirm Sent Test'); await page.fill('#q_cemail','cust@example.com');
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.click('[data-action="toggleQuoteService"][data-key="turf"]'); await wait(150);
  await page.click('button[data-action="wizNext"]'); await wait(150);
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await wait(100);
  for (let i=0;i<6 && !(await page.$('button[data-action="saveDraftQuote"]')); i++){ await page.click('button[data-action="wizNext"]'); await wait(200); }
  await page.click('button[data-action="saveDraftQuote"]'); await wait(400);
  const status = () => page.evaluate(()=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')||'{}'); const k = Object.keys(s).find(k=>/quotes\//.test(k) && s[k].customer && s[k].customer.name==='Confirm Sent Test'); return k ? s[k].status : null; });
  check('quote saved as a draft', await status()==='draft');
  if (!(await page.$('button[data-action="emailQuote"]'))){
    const nav = await page.$('button[data-nav="quotes"]') || await page.$('button[data-nav="jobs"]');
    await nav.click(); await wait(300);
    await page.click('[data-action="openQuote"]'); await wait(300);
  }
  await page.click('button[data-action="emailQuote"]'); await wait(500);
  check('email dialog open', !!(await page.$('.modal-box')));
  check('opening the email does NOT mark it as sent', await status()==='draft');
  const box = await page.$eval('.modal-box', e=>e.innerText);
  check('dialog explains it stays a draft until confirmed', /stays a draft until you confirm/.test(box));
  check('"I\'ve sent it — mark as sent" button shown', !!(await page.$('.modal-box [data-action="modalMarkSent"]')));
  if (mode==='gmail'){
    await page.click('button[data-action="gmailDraft"]'); await wait(600);
    check('creating the Gmail draft does NOT mark it as sent', await status()==='draft');
  }
  await page.click('.modal-box [data-action="modalMarkSent"]'); await wait(400);
  check('confirming marks it as sent', await status()==='sent');
  check('dialog confirms it', /Marked as sent to the customer/.test(await page.$eval('.modal-box', e=>e.innerText)) && !(await page.$('.modal-box [data-action="modalMarkSent"]')));
  await page.click('.modal-box [data-action="modalCancel"]'); await wait(300);
  check('activity log records it', /Marked as sent to the customer/.test(await page.$eval('#app', e=>e.innerText)));
  // emailing it again: no button (already sent)
  await page.click('button[data-action="emailQuote"]'); await wait(400);
  check('no mark-as-sent button once it is already sent', !(await page.$('.modal-box [data-action="modalMarkSent"]')));
  check('no page errors', !errors.length); if (errors.length) console.log(errors);
  await browser.close(); return pass;
}
(async()=>{
  let ok = true;
  for (const m of ['plain','gmail']) ok = (await run(m)) && ok;
  console.log(ok?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(ok?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

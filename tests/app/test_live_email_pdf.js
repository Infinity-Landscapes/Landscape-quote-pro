// Own website (Firebase build): "Email quote to customer" makes a real PDF of the quote letter and
// creates a new email with it attached. Phones/tablets (Web Share with files): the share menu opens
// with the PDF, subject and covering note, and the customer's address is copied for "To".
// Browsers that can't share files (most desktops): the PDF downloads and a new email opens (email
// app, Gmail or Outlook) with To/subject/message filled in. Nothing is sent, and the quote stays a
// draft until "I've sent it" is pressed. Inside Claude the Gmail-draft dialog is unchanged.
const { chromium } = require('playwright');
const fs = require('fs');
const PLATFORM = `window.__platform = { email:()=>'matt@example.com', signOut(){}, readOnly:()=>false, explainReadOnly(){}, openAccount(){}, openPlans(){}, status:()=>({entitled:true}) };`;
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  let pass = true;
  async function run(label, vp, share){
    const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(label+' PAGEERROR: ' + e.message));
    await page.addInitScript(fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8'));
    await page.addInitScript(PLATFORM);
    await page.addInitScript(`(()=>{
      window.__opened = []; window.__copied = []; window.__shared = null; window.__shareMode = 'ok';
      document.addEventListener('click', e=>{ const a = e.target && e.target.closest && e.target.closest('a');
        if(a && /^(mailto:|https:\\/\\/mail\\.google|https:\\/\\/outlook)/.test(a.href)){ window.__opened.push(a.href); e.preventDefault(); } }, true);
      try{ Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{ writeText: async t=>{ window.__copied.push(t); } }}); }catch(e){}
      if(${share}){
        navigator.canShare = d => !!(d && d.files && d.files.every(f=>f instanceof File));
        navigator.share = async d => {
          if(window.__shareMode==='abort'){ const e = new Error('cancelled'); e.name='AbortError'; throw e; }
          if(window.__shareMode==='deny'){ const e = new Error('no'); e.name='NotAllowedError'; throw e; }
          const f = d.files[0]; const head = new TextDecoder().decode(new Uint8Array(await f.slice(0,5).arrayBuffer()));
          window.__shared = {n:d.files.length, name:f.name, type:f.type, size:f.size, head, title:d.title, text:d.text};
        };
      } else { try{ delete Navigator.prototype.share; delete Navigator.prototype.canShare; }catch(e){} navigator.share = undefined; navigator.canShare = undefined; }
    })();`);
    const check = (l,c)=>{ console.log(`[${label}] `+(c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
    const wait = ms => page.waitForTimeout(ms);
    const box = () => page.$eval('.modal-box', e=>e.innerText).catch(()=> '');
    const status = () => page.evaluate(()=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')||'{}'); const k = Object.keys(s).find(k=>/quotes\//.test(k) && s[k].customer && s[k].customer.name==='Live Email Test'); return k ? s[k].status : null; });
    await page.goto('file:///home/claude/build/app.html'); await wait(400);
    await page.fill('#f_name','Infinity Landscapes and Design');
    for (let i=0;i<3;i++){ await page.click('button[data-action="setupNext"]'); await wait(200); }
    await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
    await page.click('button[data-action="setupNext"]'); await wait(300);
    await page.click('button[data-nav="newquote"]'); await wait(200);
    await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Live Email Test'); await page.fill('#q_cemail','cust@example.com');
    await page.click('button[data-action="wizNext"]'); await wait(150);
    await page.click('[data-action="toggleQuoteService"][data-key="turf"]'); await wait(150);
    await page.click('button[data-action="wizNext"]'); await wait(150);
    await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await wait(100);
    for (let i=0;i<6 && !(await page.$('button[data-action="saveDraftQuote"]')); i++){ await page.click('button[data-action="wizNext"]'); await wait(200); }
    await page.click('button[data-action="saveDraftQuote"]'); await wait(400);
    if (!(await page.$('button[data-action="emailQuote"]'))){
      const nav = await page.$('button[data-nav="quotes"]') || await page.$('button[data-nav="jobs"]');
      await nav.click(); await wait(300); await page.click('[data-action="openQuote"]'); await wait(300);
    }
    const qn = await page.evaluate(()=>{ const s = JSON.parse(localStorage.getItem('__mockdb__')||'{}'); const k = Object.keys(s).find(k=>/quotes\//.test(k) && s[k].customer && s[k].customer.name==='Live Email Test'); return s[k].quoteNumber; });
    const fname = qn.replace(/[^\w-]+/g,'_') + '.pdf';
    await page.click('button[data-action="emailQuote"]'); await wait(300);
    check('dialog opens: "Email the customer"', /Email the customer/.test(await box()));
    check(`says it creates an email with ${fname} attached, nothing sent`, (await box()).includes(`with ${fname} attached`) && /Nothing is sent until you press Send/.test(await box()));
    check('no Gmail-draft button and no "Try opening" link on the website', !(await page.$('[data-action="gmailDraft"]')) && !/Try opening your email app/.test(await box()));
    const primarySel = share ? '[data-action="emailShare"]' : '[data-action="emailDownloadOpen"][data-via="mail"]';
    await page.waitForSelector(primarySel+':not([disabled])', {timeout:30000});
    check('PDF prepared — main button enabled', true);
    if (share){
      check('phone: main button is "Create email with PDF attached"', /Create email with PDF attached/.test(await page.$eval(primarySel, e=>e.innerText)));
      await page.click(primarySel); await wait(500);
      const sh = await page.evaluate(()=>window.__shared);
      check('share menu gets exactly one file: the quote PDF', sh && sh.n===1 && sh.name===fname && sh.type==='application/pdf' && sh.head==='%PDF-' && sh.size>20000);
      console.log('  shared PDF size:', sh && Math.round(sh.size/1024)+' KB');
      check('subject passed as the title', sh && sh.title===`Your quote from Infinity Landscapes and Design — ${qn}`);
      check('covering note passed as the text', sh && /Please find attached your quote/.test(sh.text) && /Dear Live Email Test/.test(sh.text));
      check("customer's address copied for the To line", (await page.evaluate(()=>window.__copied)).includes('cust@example.com'));
      check('dialog says the email was created', /Email created — check it in your email app and press Send/.test(await box()));
      check('creating the email does NOT mark the quote as sent', await status()==='draft');
      // closing the share menu without choosing an app: no error
      await page.evaluate(()=>{ window.__shareMode='abort'; }); await page.click(primarySel); await wait(300);
      check('cancelling the share menu shows no error', !(await page.$('.modal-box .msg-err')));
      // a browser that refuses: falls back to download + open email
      await page.evaluate(()=>{ window.__shareMode='deny'; }); await page.click(primarySel); await wait(300);
      check('share refused → explains and offers "Download PDF & open email"', /couldn't open the share menu/.test(await box()) && !(await page.$('[data-action="emailShare"]')) && /Download PDF & open email/.test(await box()));
    } else {
      check('desktop: main button is "Download PDF & open email"', /Download PDF & open email/.test(await page.$eval(primarySel, e=>e.innerText)));
      check('explains to attach the PDF from Downloads', /attach .* from your Downloads folder/.test(await box()));
    }
    // download + open email (desktop main path; phone fallback)
    const [dl] = await Promise.all([ page.waitForEvent('download', {timeout:10000}), page.click('[data-action="emailDownloadOpen"][data-via="mail"]') ]);
    check('the PDF downloads with the quote number as its name', dl.suggestedFilename()===fname);
    const p = await dl.path(); const buf = fs.readFileSync(p);
    check('the download is a real PDF', buf.slice(0,5).toString()==='%PDF-' && buf.length>20000);
    await wait(200);
    let opened = await page.evaluate(()=>window.__opened);
    const mt = opened.find(u=>u.startsWith('mailto:'));
    check('a new email opens: mailto with the customer, subject and covering note', !!mt && mt.startsWith('mailto:cust@example.com?') && decodeURIComponent(mt).includes(`subject=Your quote from Infinity Landscapes and Design — ${qn}`) && decodeURIComponent(mt).includes('Please find attached your quote'));
    check('dialog says what happened', /downloaded and a new email opened — attach the PDF/.test(await box()));
    if (!share){
      const [dl2] = await Promise.all([ page.waitForEvent('download', {timeout:10000}), page.click('[data-action="emailDownloadOpen"][data-via="gmail"]') ]);
      await wait(200); opened = await page.evaluate(()=>window.__opened);
      const g = opened.find(u=>u.startsWith('https://mail.google.com/'));
      check('"Use Gmail" downloads the PDF and opens a Gmail compose window filled in', dl2.suggestedFilename()===fname && !!g && /view=cm/.test(g) && /to=cust%40example\.com/.test(g) && decodeURIComponent(g).includes(`su=Your quote from`));
      await Promise.all([ page.waitForEvent('download', {timeout:10000}), page.click('[data-action="emailDownloadOpen"][data-via="outlook"]') ]);
      await wait(200); opened = await page.evaluate(()=>window.__opened);
      check('"Use Outlook" opens an Outlook compose window filled in', opened.some(u=>/^https:\/\/outlook\.live\.com\/mail\/0\/deeplink\/compose\?to=cust%40example\.com&subject=/.test(u)));
    }
    check('still a draft until confirmed', await status()==='draft');
    check('copy fields still there as a backup', /copy any part/.test(await box()) && (await page.$$('.modal-box [data-action="modalCopy"]')).length===3);
    await page.click('.modal-box [data-action="modalMarkSent"]'); await wait(400);
    check('"I\'ve sent it" marks it as sent', await status()==='sent');
    await page.click('.modal-box [data-action="modalCancel"]'); await wait(300);
    check('activity log notes the email was created with the PDF', new RegExp('Email created with '+fname.replace('.','\\.')+' attached').test(await page.$eval('#app', e=>e.innerText)));
    check('no sideways scrolling', await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1));
    // ---- payment plan: same option, with the payment plan PDF attached ----
    await page.click('button[data-action="showAccept"]'); await wait(300);
    await page.fill('#acceptStart','2026-11-02');
    await page.click('button[data-action="confirmAccept"]'); await wait(600);
    const pname = qn.replace(/[^\w-]+/g,'_') + '_payment_plan.pdf';
    await page.click('button[data-action="emailPaymentPlan"]'); await wait(300);
    check(`payment plan: dialog says it creates an email with ${pname} attached`, (await box()).includes(`with ${pname} attached`));
    await page.waitForSelector(primarySel+':not([disabled])', {timeout:30000});
    if (share){
      await page.evaluate(()=>{ window.__shareMode='ok'; window.__shared=null; });
      // the earlier refusal switched this dialog to the download fallback; a fresh dialog offers sharing again
      check('payment plan: phone offers "Create email with PDF attached"', !!(await page.$('[data-action="emailShare"]')));
      await page.click('[data-action="emailShare"]'); await wait(500);
      const sh = await page.evaluate(()=>window.__shared);
      check('payment plan: share menu gets the payment plan PDF', sh && sh.n===1 && sh.name===pname && sh.head==='%PDF-' && sh.size>10000);
      check('payment plan: message has the schedule and bank details', sh && /PAYMENT SCHEDULE/.test(sh.text) && /Bank details for payment/.test(sh.text) && /^Payment plan for your quote/.test(sh.title));
    } else {
      const [dl3] = await Promise.all([ page.waitForEvent('download', {timeout:10000}), page.click('[data-action="emailDownloadOpen"][data-via="mail"]') ]);
      const b3 = fs.readFileSync(await dl3.path());
      check('payment plan: the payment plan PDF downloads', dl3.suggestedFilename()===pname && b3.slice(0,5).toString()==='%PDF-');
      await wait(200); opened = await page.evaluate(()=>window.__opened);
      check('payment plan: a new email opens with the payment plan subject', opened.some(u=>u.startsWith('mailto:cust@example.com?') && decodeURIComponent(u).includes('subject=Payment plan for your quote')));
    }
    await page.screenshot({path:`/tmp/mobiletest/live_email_${label}.png`});
    await ctx.close();
  }
  await run('phone', {width:390,height:844}, true);
  await run('desktop', {width:1200,height:900}, false);
  console.log('ERRORS:', errors.length?errors:'none'); if (errors.length) pass=false;
  await browser.close();
  console.log(pass?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(pass?0:1);
})().catch(e=>{ console.error(e); process.exit(1); });

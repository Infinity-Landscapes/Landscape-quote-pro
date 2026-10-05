// "Create Gmail draft with PDF attached" on the quote email dialog (mcp capability, Gmail create_draft).
const { chromium } = require('playwright');
const fs = require('fs');
async function run(mode){
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(fs.readFileSync(__dirname+'/db_mock.js', 'utf8'));
  await page.addInitScript(`(()=>{
    window.__MODE__ = ${JSON.stringify(mode)};
    // PDF libraries stubbed so no network is needed.
    if(window.__MODE__==='big'){
      // A realistic 3-page letter: a noisy canvas so JPEG size really depends on scale/quality,
      // and a jsPDF whose output size is the images it was given (like the real one).
      window.html2canvas = async(el, o)=>{ const sc=o.scale||2; const c=document.createElement('canvas'); c.width=Math.round(794*sc); c.height=Math.round(3000*sc);
        const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); let seed=7; const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
        for(let i=0;i<9000;i++){ g.fillStyle='rgb('+(rnd()*255|0)+','+(rnd()*255|0)+','+(rnd()*255|0)+')'; g.fillRect(rnd()*c.width, rnd()*c.height, 3+rnd()*12*sc, 3+rnd()*8*sc); }
        return c; };
      window.__pages = [];
      window.jspdf = {jsPDF: function(){ let bytes=0, pages=1; return {internal:{pageSize:{getWidth:()=>210,getHeight:()=>297}}, addImage(d){ bytes += Math.round((d.length-23)*0.75); window.__pages.push(d.length); }, addPage(){ pages++; }, output:()=>{ const b = new Uint8Array(bytes+20); b.set(new TextEncoder().encode('%PDF-1.4 test')); return new Blob([b],{type:'application/pdf'}); }}; }};
    } else {
    window.html2canvas = async()=>({width:100,height:100,toDataURL:()=>'data:image/jpeg;base64,AA'});
    window.jspdf = {jsPDF: function(){ return {internal:{pageSize:{getWidth:()=>210,getHeight:()=>297}}, addImage(){}, addPage(){}, output:()=>new Blob(['%PDF-1.4 test'],{type:'application/pdf'})}; }};
    }
    const orig = window.claude.use;
    window.claude.use = async (c)=>{
      if(c==='mcp'){
        if(window.__MODE__==='none') return null;
        return {
          listTools: async()=>({servers:[{server:'Gmail',authStatus:'connected',tools:[]}], fileArgs: window.__MODE__==='file'}),
          callTool: async(server, tool, input)=>{
            window.__calls = (window.__calls||[]); window.__calls.push({server, tool, input:JSON.parse(JSON.stringify(input, (k,v)=> (v instanceof Blob) ? {blob:v.size} : v))});
            if(window.__MODE__==='notconnected') throw {code:'server_not_connected', message:'x'};
            return {content:[], payload:{id:'d1', threadId:'t1', viewUrl:'https://mail.google.com/mail/u/0/#drafts?compose=d1'}};
          },
        };
      }
      return orig(c);
    };
  })();`);
  let pass = true; const check = (l,c)=>{ console.log(`[${mode}] `+(c?'PASS':'FAIL')+' - '+l); if(!c) pass=false; };
  await page.goto('file://'+require('path').resolve(__dirname,'../../app/app.html')); await page.waitForTimeout(400);
  await page.fill('#f_name','Infinity Landscapes and Design');
  for (let i=0;i<3;i++){ await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); }
  await page.fill('#f_pin','1234'); await page.fill('#f_pin2','1234');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(300);
  await (await page.$('button[data-nav="newquote"]')).click(); await page.waitForTimeout(200);
  await page.fill('#q_creator','Matt'); await page.fill('#q_cname','Gmail Test'); await page.fill('#q_cemail','cust@example.com');
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await (await page.$('[data-action="toggleQuoteService"][data-key="turf"]')).click(); await page.waitForTimeout(150);
  await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(150);
  await page.fill('[data-row="0"] input[data-mf="width"]','10'); await page.fill('[data-row="0"] input[data-mf="length"]','10'); await page.waitForTimeout(100);
  for (let i=0;i<6 && !(await page.$('button[data-action="saveSentQuote"]')); i++){ await (await page.$('button[data-action="wizNext"]')).click(); await page.waitForTimeout(200); }
  await (await page.$('button[data-action="saveSentQuote"]')).click(); await page.waitForTimeout(300);
  await (await page.$('button[data-action="emailQuote"]')).click(); await page.waitForTimeout(400);
  const btn = await page.$('button[data-action="gmailDraft"]');
  if (mode==='none'){
    check('no Gmail button without the connector capability', !btn);
    check('old copy dialog still there', /Try opening your email app/.test(await page.$eval('.modal-box', e=>e.textContent)));
  } else {
    check('Gmail draft button shown', !!btn);
    check('says nothing is sent', /Nothing is sent/.test(await page.$eval('.modal-box', e=>e.textContent)));
    await btn.click(); await page.waitForTimeout(600);
    const calls = await page.evaluate(()=>window.__calls||[]);
    const c = calls[0] || {};
    check('called Gmail create_draft once', calls.length===1 && c.server==='Gmail' && c.tool==='create_draft');
    check('to / subject / covering note', JSON.stringify(c.input.to)==='["cust@example.com"]' && /Your quote from/.test(c.input.subject) && /Please find attached your quote/.test(c.input.body));
    const att = (c.input.attachments||[])[0]||{};
    check('PDF attached with filename + type', /\.pdf$/.test(att.filename) && att.mimeType==='application/pdf');
    if (mode==='file') check('sent as a file argument', att.content && att.content.$file && att.content.$file.name===att.filename && att.content.$file.type==='application/pdf');
    if (mode==='big'){ const n = Buffer.from(att.content||'','base64').length; console.log('  big PDF bytes attached:', n); check('big letter shrunk under 700 KB and sent inline', typeof att.content==='string' && n>0 && n<=700*1024); }
    if (mode==='inline') check('sent as inline base64', typeof att.content==='string' && Buffer.from(att.content,'base64').toString().startsWith('%PDF'));
    const t = await page.$eval('.modal-box', e=>e.textContent);
    if (mode==='notconnected'){
      check('clear message when Gmail is not connected', /Gmail isn't connected/.test(t) && !!(await page.$('button[data-action="gmailDraft"]')));
    } else {
      check('success message + Open in Gmail link', /Draft saved in your Gmail/.test(t) && !!(await page.$('.modal-box a[href^="https://mail.google.com"][target="_blank"]')));
      check('button gone after success (no double draft)', !(await page.$('button[data-action="gmailDraft"]')));
      await (await page.$('button[data-action="modalCancel"]')).click(); await page.waitForTimeout(300);
      check('activity log records the draft', /Gmail draft created with .*\.pdf attached/.test(await page.$eval('#App', e=>e.textContent)));
    }
  }
  check('no page errors', !errors.length); if (errors.length) console.log(errors);
  await browser.close(); return pass;
}
(async()=>{
  let ok = true;
  for (const m of ['inline','file','notconnected','none','big']) ok = (await run(m)) && ok;
  console.log(ok?'ALL CHECKS PASSED':'SOME CHECKS FAILED'); process.exit(ok?0:1);
})();

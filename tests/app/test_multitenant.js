const { chromium } = require('playwright');
const fs = require('fs');

const LEGACY_SETTINGS = {
  company: {
    accountNumber: "29826990",
    address: "93 Centenary Way, Witney, Oxford, OX29 7AZ",
    bankName: "Monzo",
    email: "info@infinity-landscapesdesign.co.uk",
    name: "Infinity Landscapes and Design",
    number: "15160636",
    phone: "01865 238469",
    sortCode: "04-00-03",
    vatNo: "462595763"
  },
  dayRatePerPerson: 150,
  expensesIncludeVat: true,
  expensesPerDay: 515,
  markupPercent: 10,
  materials: {
    "Turf": { price: 7.99, section: "Turf", supplier: "AWBS", unit: "m²", vatIncluded: true }
  },
  onboarded: true,
  pin: "3393",
  productivity: { turf: 50 },
  quoteCounter: 3,
  servicesEnabled: ["turf"],
  vatRate: 0.2,
  weeklyPaymentAmount: 4000
};
const LEGACY_QUOTE = {
  id: "q1", quoteNumber: "MAT001", status: "sent", createdBy: "Matt",
  createdAt: "2026-01-01T00:00:00.000Z", people: 2, startDate: null, paymentSchedule: null,
  customer: { name: "Harriet Adams", address: "1 Test Lane", email: "harriet@example.com", phone: "07000000000", knownAs: "Harriet" },
  sections: [], extras: [],
  totals: { subtotal: 1000, labour: 0, materials: 0, plantHire: 0, expenses: 0, extrasTotal: 0, vat: 200, total: 1200, totalDays: 1 }
};
const LEGACY_DRAFT = { draft: { step: "measure", note: "legacy in-progress draft" }, editingQuoteId: null, savedAt: "2026-01-02T00:00:00.000Z" };

const seedScript = `
(function(){
  try{
    if(localStorage.getItem('__mockdb__') === null){
      const store = {
        'business/settings': ${JSON.stringify(LEGACY_SETTINGS)},
        'quotes/q1': ${JSON.stringify(LEGACY_QUOTE)},
        'drafts/current': ${JSON.stringify(LEGACY_DRAFT)}
      };
      localStorage.setItem('__mockdb__', JSON.stringify(store));
    }
  }catch(e){}
})();
`;

function setUidScript(uid){
  return `window.__mockUid__ = ${JSON.stringify(uid)};`;
}

async function readStore(page){
  return await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb__') || '{}'));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR/.test(msg.text())) errors.push('CONSOLE: ' + msg.text()); });

  const mockScript = fs.readFileSync('/tmp/mobiletest/db_mock.js', 'utf8');
  await page.addInitScript(seedScript);
  await page.addInitScript(mockScript);
  // No explicit uid script yet -> db_mock.js defaults window.__mockUid__ to 'u_matt_test'.

  let pass = true;
  function check(label, cond){
    console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
    if(!cond) pass = false;
  }

  // ---- 1. First load as the existing tenant (uid u_matt_test) triggers migration ----
  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(500);

  const loginPin1 = await page.$('#loginPin');
  check('tenant A (migrated, onboarded) lands on login screen, not setup', !!loginPin1);

  let store = await readStore(page);
  check('legacy business/settings marked migratedTo u_matt_test', store['business/settings'] && store['business/settings'].migratedTo === 'u_matt_test');
  check('new tenant doc data/users/u_matt_test/business created', !!store['data/users/u_matt_test/business']);
  check('migrated settings kept real company name', store['data/users/u_matt_test/business'] && store['data/users/u_matt_test/business'].company.name === 'Infinity Landscapes and Design');
  check('migrated settings kept real pin', store['data/users/u_matt_test/business'] && store['data/users/u_matt_test/business'].pin === '3393');
  check('quote q1 copied to tenant-scoped quotes collection', !!store['data/users/u_matt_test/business/quotes/q1']);
  check('copied quote kept customer name', store['data/users/u_matt_test/business/quotes/q1'] && store['data/users/u_matt_test/business/quotes/q1'].customer.name === 'Harriet Adams');
  check('draft copied to tenant-scoped drafts/current', !!store['data/users/u_matt_test/business/drafts/current']);
  check('legacy flat quotes/q1 still present (never deleted, just superseded)', !!store['quotes/q1']);

  // ---- 2. Reload as the SAME tenant: migration must not re-run / duplicate ----
  await page.reload();
  await page.waitForTimeout(500);
  const loginPin1b = await page.$('#loginPin');
  check('tenant A still lands on login screen after reload', !!loginPin1b);
  const storeAfterReload = await readStore(page);
  const bizA = storeAfterReload['data/users/u_matt_test/business'];
  check('tenant A business doc unchanged after reload (no re-migration clobber)', bizA && bizA.company.name === 'Infinity Landscapes and Design');
  const quoteKeysA = Object.keys(storeAfterReload).filter(k => k.startsWith('data/users/u_matt_test/business/quotes/'));
  check('tenant A still has exactly 1 quote (no duplication on reload)', quoteKeysA.length === 1);

  // log in as tenant A to sanity-check the migrated data renders correctly
  await page.fill('#loginPin', '3393');
  await (await page.$('button[data-action="login"]')).click();
  await page.waitForTimeout(400);
  const brandWordA = await page.$eval('.brand-word', el => el.textContent).catch(()=>null);
  check('tenant A menu shows migrated company name', !!(brandWordA && brandWordA.includes('Infinity Landscapes and Design')));
  await page.screenshot({ path: '/tmp/mobiletest/mt_tenantA_menu.png', fullPage: true });

  // ---- 3. A brand-new second tenant, same underlying store, different uid ----
  await page.addInitScript(setUidScript('u_second_tenant'));
  await page.goto('file:///home/claude/build/app.html');
  await page.waitForTimeout(500);

  const fName = await page.$('#f_name');
  check('tenant B (fresh, never migrated) lands on setup step 1', !!fName);
  const fNameVal = fName ? await fName.inputValue() : 'N/A';
  check('tenant B setup step 1 has BLANK company name (no leaked defaults)', fNameVal === '');
  const hintText = await page.$eval('.hint', el => el.textContent).catch(()=>'');
  check('tenant B sees the "fresh tenant" copy, not the "pulled in" copy', hintText.includes('Tell us a bit about your business'));
  await page.screenshot({ path: '/tmp/mobiletest/mt_tenantB_setup_step1.png', fullPage: true });

  // Walk tenant B through setup with its own distinct company name
  await page.fill('#f_name', 'Second Tenant Gardens Ltd');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); // -> step 2
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); // -> step 3
  await page.fill('#f_dayrate','160'); await page.fill('#f_expenses','400'); // a new business enters its own rates
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(200); // -> step 4
  await page.fill('#f_pin', '5678');
  await page.fill('#f_pin2', '5678');
  await (await page.$('button[data-action="setupNext"]')).click(); await page.waitForTimeout(400); // finish -> menu
  const brandWordB = await page.$eval('.brand-word', el => el.textContent).catch(()=>null);
  check('tenant B menu shows its OWN company name after setup', !!(brandWordB && brandWordB.includes('Second Tenant Gardens Ltd')));
  await page.screenshot({ path: '/tmp/mobiletest/mt_tenantB_menu.png', fullPage: true });

  // ---- 4. Cross-tenant isolation in the underlying (shared) mock store ----
  store = await readStore(page);
  check('tenant B got its own tenant-scoped business doc', !!store['data/users/u_second_tenant/business']);
  check('tenant B business doc has its own company name', store['data/users/u_second_tenant/business'].company.name === 'Second Tenant Gardens Ltd');
  check('tenant B did NOT inherit tenant A pin', store['data/users/u_second_tenant/business'].pin === '5678');
  check('tenant B has no quotes (started fresh, did not see tenant A quote)', Object.keys(store).filter(k => k.startsWith('data/users/u_second_tenant/business/quotes/')).length === 0);
  check('legacy business/settings still only claimed by tenant A', store['business/settings'].migratedTo === 'u_matt_test');
  check('tenant A business doc untouched by tenant B setup', store['data/users/u_matt_test/business'].company.name === 'Infinity Landscapes and Design');

  check('no page errors / console errors during the whole run', errors.length === 0);
  if(errors.length){ console.log(errors.join('\\n')); }

  console.log('\\n' + (pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
  await browser.close();
  process.exit(pass ? 0 : 1);
})();

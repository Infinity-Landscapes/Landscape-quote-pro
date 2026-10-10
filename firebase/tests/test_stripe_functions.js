// Website payments (functions/index.js) against the Firestore emulator and an in-memory Stripe.
//   firebase emulators:exec --only firestore "node tests/test_stripe_functions.js"
// Covers: one-off setup (6 prices, 20% VAT, portal, webhook — and running it twice changes
// nothing), checkout (sign-in required, trial carried over, VAT, existing subscriber sent to the
// portal), webhooks fetched back from Stripe (a forged event grants nothing), trial → active →
// failed payment (7 days' grace) → cancelled at period end, and duplicates applied once.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'landscape-quote-pro';
const assert = require('assert');
const path = require('path');
const FN = path.join(__dirname, '..', 'functions');
const { getFunction: getTestFunction } = require(require.resolve('@google-cloud/functions-framework/testing', { paths:[FN] }));
const admin = require(require.resolve('firebase-admin', { paths:[FN] }));

/* ---------- in-memory Stripe ---------- */
const S = { products:{}, prices:{}, tax_rates:{}, customers:{}, subs:{}, events:{}, portal:{}, webhooks:{}, sessions:[], n:0 };
const id = p => `${p}_${++S.n}`;
function parse(body){ const o = {}; for (const [k, v] of new URLSearchParams(body || '')) o[k] = v; return o; }
global.fetch = async (url, opts) => {
  const u = new URL(url); const p = u.pathname.replace('/v1/', ''); const m = opts.method; const b = parse(opts.body);
  const ok = j => ({ ok:true, status:200, json: async () => j });
  const nf = () => ({ ok:false, status:404, json: async () => ({ error:{ message:'No such object' } }) });
  if (opts.headers.Authorization !== 'Bearer sk_test_dummy') return { ok:false, status:401, json: async()=>({error:{message:'bad key'}}) };
  if (p === 'prices' && m === 'GET') { const lk = u.searchParams.get('lookup_keys[0]'); return ok({ data: Object.values(S.prices).filter(x=>x.lookup_key===lk) }); }
  if (p === 'products' && m === 'POST') { const x = { id:id('prod'), name:b.name }; S.products[x.id] = x; return ok(x); }
  if (p.startsWith('products/') && m === 'GET') { const x = S.products[p.split('/')[1]]; return x ? ok(x) : nf(); }
  if (p.startsWith('products/') && m === 'POST') { const x = S.products[p.split('/')[1]]; if (!x) return nf(); if (b.name) x.name = b.name; return ok(x); }
  if (p === 'prices' && m === 'POST') { const x = { id:id('price'), product:b.product, unit_amount:+b.unit_amount, lookup_key:b.lookup_key, recurring:{ interval:b['recurring[interval]'] }, tax_behavior:b.tax_behavior }; S.prices[x.id] = x; return ok(x); }
  if (p === 'tax_rates' && m === 'POST') { const x = { id:id('txr'), percentage:+b.percentage, inclusive:b.inclusive==='true' }; S.tax_rates[x.id] = x; return ok(x); }
  if (p.startsWith('billing_portal/configurations')) { const x = { id: p.split('/')[2] || id('bpc'), b }; S.portal[x.id] = x; return ok(x); }
  if (p.startsWith('webhook_endpoints')) { const x = { id: p.split('/')[1] || id('we'), url:b.url }; S.webhooks[x.id] = x; return ok(x); }
  if (p === 'customers' && m === 'POST') { const x = { id:id('cus'), email:b.email, uid:b['metadata[uid]'] }; S.customers[x.id] = x; return ok(x); }
  if (p.startsWith('customers/') && m === 'GET') { const x = S.customers[p.split('/')[1]]; return x ? ok(x) : nf(); }
  if (p === 'checkout/sessions') { S.sessions.push(b); return ok({ id:id('cs'), url:'https://checkout.stripe.com/c/pay/test' }); }
  if (p === 'billing_portal/sessions') { S.lastPortal = b; return ok({ url:'https://billing.stripe.com/p/session/test' }); }
  if (p.startsWith('events/')) { const x = S.events[p.split('/')[1]]; return x ? ok(x) : nf(); }
  if (p.startsWith('subscriptions/')) { const x = S.subs[p.split('/')[1]]; return x ? ok(JSON.parse(JSON.stringify(x))) : nf(); }
  throw new Error('unmocked Stripe call ' + m + ' ' + p);
};

const fns = require(FN);
Object.getPrototypeOf(admin.auth()).verifyIdToken = async t => { if (!/^tok_/.test(t)) throw new Error('bad'); const uid = t.slice(4); return { uid, email: uid + '@example.com' }; };
const db = admin.firestore();

function call(name, body, token){
  return new Promise((resolve, reject) => {
    const req = { method:'POST', body: body || {}, get: h => h === 'Authorization' ? (token ? 'Bearer ' + token : '') : h === 'Origin' ? 'https://landscape-quote-pro.web.app' : '' };
    const res = { _s:200, status(s){ this._s = s; return this; }, set(){ return this; }, json(j){ resolve({ status:this._s, body:j }); } };
    Promise.resolve(getTestFunction(name)(req, res)).catch(reject);
  });
}
let pass = true;
const check = (l, c) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + l); if (!c) pass = false; };
const now = () => Math.floor(Date.now() / 1000);
function makeSub(uid, cus, priceId, status, extra){
  const s = Object.assign({ id: id('sub'), customer: cus, status, metadata: { uid }, cancel_at_period_end:false, current_period_end: now() + 30*86400,
    items: { data: [{ price: S.prices[priceId], current_period_end: now() + 30*86400 }] } }, extra || {});
  S.subs[s.id] = s; return s;
}
function event(type, obj){ const e = { id: id('evt'), type, data: { object: obj } }; S.events[e.id] = e; return e; }
const acct = async uid => (await db.doc('accounts/' + uid).get()).data() || {};

(async () => {
  // ---- not set up yet ----
  let r = await call('checkout', { plan:'solo', period:'monthly' }, 'tok_u1');
  check('before setup, checkout says payments are not set up yet', r.status === 503 && /not set up/.test(r.body.error));

  // ---- setup ----
  r = await call('admin', { action:'setup', webhookUrl:'https://landscape-quote-pro.web.app/api/stripe-webhook' });
  check('setup creates 6 prices with lookup keys', r.status === 200 && Object.keys(r.body.prices).length === 6 && Object.values(S.prices).every(p=>/^lqp_(solo|team|business)_(monthly|yearly)$/.test(p.lookup_key)));
  check('prices: £30 / £45 / £70 monthly, £300 / £450 / £700 yearly, VAT on top', ['solo_monthly:3000','team_monthly:4500','business_monthly:7000','solo_yearly:30000','team_yearly:45000','business_yearly:70000'].every(x=>{ const [k,a] = x.split(':'); return S.prices[r.body.prices[k]].unit_amount === +a && S.prices[r.body.prices[k]].tax_behavior === 'exclusive'; }));
  check('a 20% VAT rate, added on top', S.tax_rates[r.body.taxRateId].percentage === 20 && !S.tax_rates[r.body.taxRateId].inclusive);
  check('customer portal: cancel at period end, switch plans, update card', S.portal[r.body.portalConfigId].b['features[subscription_cancel][mode]'] === 'at_period_end' && S.portal[r.body.portalConfigId].b['features[subscription_update][enabled]'] === 'true' && S.portal[r.body.portalConfigId].b['features[payment_method_update][enabled]'] === 'true');
  check('products are named "Landscape Quote Pro — Solo / Team / Business"', Object.values(S.products).map(p=>p.name).sort().join('|') === 'Landscape Quote Pro — Business|Landscape Quote Pro — Solo|Landscape Quote Pro — Team');
  check('changing plan during the free trial keeps the trial', S.portal[r.body.portalConfigId].b['features[subscription_update][trial_update_behavior]'] === 'continue_trial');
  check('webhook endpoint registered', !!r.body.webhookId && S.webhooks[r.body.webhookId].url.endsWith('/api/stripe-webhook'));
  const cfg = r.body;
  const nPrices = Object.keys(S.prices).length;
  r = await call('admin', { action:'setup', webhookUrl:'https://landscape-quote-pro.web.app/api/stripe-webhook' });
  check('running setup again creates nothing new', Object.keys(S.prices).length === nPrices && Object.keys(S.tax_rates).length === 1 && r.body.portalConfigId === cfg.portalConfigId);

  // ---- checkout ----
  r = await call('checkout', { plan:'team', period:'monthly' });
  check('checkout needs a signed-in user', r.status === 401);
  await db.doc('accounts/u1').set({ createdAt: admin.firestore.Timestamp.now() });
  r = await call('checkout', { plan:'team', period:'monthly' }, 'tok_u1');
  const cs = S.sessions[S.sessions.length-1];
  check('checkout returns a Stripe page', r.status === 200 && /checkout\.stripe\.com/.test(r.body.url));
  check('…for the Team monthly price, a subscription, VAT rate applied, VAT number collected', cs['line_items[0][price]'] === cfg.prices.team_monthly && cs.mode === 'subscription' && cs['subscription_data[default_tax_rates][0]'] === cfg.taxRateId && cs['tax_id_collection[enabled]'] === 'true');
  const a1 = await acct('u1');
  const te = +cs['subscription_data[trial_end]'], want = fns.endOfUkDay(new Date((a1.createdAt.seconds + 7*86400)*1000));
  check('during the free trial, billing starts at the end of the trial\'s last day (UK time)', te === Math.floor(want.getTime()/1000) && te > a1.createdAt.seconds + 7*86400 && te < a1.createdAt.seconds + 8*86400);
  check('end of a UK day: 23:59 London time in summer and winter', fns.endOfUkDay(new Date('2026-07-01T10:00:00Z')).toISOString()==='2026-07-01T22:59:00.000Z' && fns.endOfUkDay(new Date('2026-12-01T10:00:00Z')).toISOString()==='2026-12-01T23:59:00.000Z');
  check('the account remembers its Stripe customer', /^cus_/.test(a1.stripeCustomerId) && cs.customer === a1.stripeCustomerId && cs.client_reference_id === 'u1');
  await db.doc('accounts/u2').set({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 20*86400000) });
  await call('checkout', { plan:'solo', period:'yearly' }, 'tok_u2');
  check('trial already over: no trial on the subscription', S.sessions[S.sessions.length-1]['subscription_data[trial_end]'] === undefined);
  await db.doc('accounts/u3').set({ createdAt: admin.firestore.Timestamp.now(), freeForever: true });
  r = await call('checkout', { plan:'solo', period:'monthly' }, 'tok_u3');
  check('a free account is never sold a plan', r.status === 409);
  await db.doc('accounts/u4').set({ createdAt: admin.firestore.Timestamp.now(), store:'app_store', tier:'solo', periodEnd: admin.firestore.Timestamp.fromMillis(Date.now()+20*86400000) });
  r = await call('checkout', { plan:'team', period:'monthly' }, 'tok_u4');
  check('an App Store subscriber is never sold a second plan here', r.status === 409);

  // ---- webhooks ----
  r = await call('webhook', { id:'evt_forged123', type:'customer.subscription.created', data:{ object:{ id:'sub_x', metadata:{ uid:'u2' } } } });
  check('a forged event (not known to Stripe) is refused and grants nothing', r.status === 400 && !(await acct('u2')).periodEnd);
  const trialEnd = a1.createdAt.seconds + 7*86400;
  const sub = makeSub('u1', a1.stripeCustomerId, cfg.prices.team_monthly, 'trialing', { trial_end: trialEnd });
  const e1 = event('checkout.session.completed', { id:'cs_1', subscription: sub.id, client_reference_id:'u1' });
  r = await call('webhook', { id: e1.id });
  let a = await acct('u1');
  check('checkout completed (in trial): Team plan through Stripe, paid to the trial end', r.status === 200 && a.tier === 'team' && a.store === 'stripe' && a.billingPeriod === 'monthly' && Math.abs(a.periodEnd.seconds - (trialEnd + 86400)) < 2);
  r = await call('webhook', { id: e1.id });
  check('the same event twice is applied once', r.body.duplicate === true);
  Object.assign(S.subs[sub.id], { status:'active', current_period_end: now() + 30*86400 });
  await call('webhook', { id: event('invoice.paid', { id:'in_1', subscription: sub.id }).id });
  a = await acct('u1');
  check('first payment: paid to the period end (+1 day leeway)', Math.abs(a.periodEnd.seconds - (S.subs[sub.id].current_period_end + 86400)) < 2 && a.stripeStatus === 'active');
  // existing subscriber pressing a plan → portal to switch
  r = await call('checkout', { plan:'business', period:'monthly' }, 'tok_u1');
  check('an existing subscriber changing plan goes to the portal (prorated switch)', /billing\.stripe\.com/.test(r.body.url) && S.lastPortal['flow_data[type]'] === 'subscription_update');
  // failed renewal
  Object.assign(S.subs[sub.id], { status:'past_due', current_period_end: now() - 3600 });
  await db.doc('accounts/u1').update({ periodEnd: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  await call('webhook', { id: event('invoice.payment_failed', { id:'in_2', subscription: sub.id }).id });
  a = await acct('u1');
  const g1 = a.graceUntil && a.graceUntil.toMillis();
  check('failed payment: 7 days\' grace', g1 && Math.abs(g1 - (Date.now() + 7*86400000)) < 60000);
  await call('webhook', { id: event('invoice.payment_failed', { id:'in_3', subscription: sub.id }).id });
  check('a second failed retry doesn\'t restart the 7 days', (await acct('u1')).graceUntil.toMillis() === g1);
  Object.assign(S.subs[sub.id], { status:'active', current_period_end: now() + 30*86400 });
  await call('webhook', { id: event('invoice.paid', { id:'in_4', subscription: sub.id }).id });
  a = await acct('u1');
  check('paying clears the grace and restores the paid period', !a.graceUntil && a.periodEnd.toMillis() > Date.now() + 29*86400000);
  // cancel at period end
  Object.assign(S.subs[sub.id], { cancel_at_period_end:true });
  await call('webhook', { id: event('customer.subscription.updated', { id: sub.id }).id });
  a = await acct('u1');
  check('cancelling keeps access to the end of the paid period', a.cancelAtPeriodEnd === true && a.periodEnd.toMillis() > Date.now() + 29*86400000);
  const end = S.subs[sub.id].current_period_end;
  Object.assign(S.subs[sub.id], { status:'canceled', ended_at: end });
  await call('webhook', { id: event('customer.subscription.deleted', { id: sub.id }).id });
  a = await acct('u1');
  check('when it ends, access stops at the period end (no extra time)', a.periodEnd.seconds === end && a.cancelAtPeriodEnd === false);
  // portal
  r = await call('portal', {}, 'tok_u1');
  check('Manage subscription opens the Stripe portal', /billing\.stripe\.com/.test(r.body.url));
  // a billing record left over from Stripe's test mode (ids unknown here): buying starts afresh
  await db.doc('accounts/u7').set({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30*86400000), store:'stripe', tier:'business', stripeStatus:'active', stripeSubscriptionId:'sub_fromtestmode', stripeCustomerId:'cus_fromtestmode', periodEnd: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  r = await call('checkout', { plan:'solo', period:'monthly' }, 'tok_u7');
  check('a leftover test-mode subscription is ignored: a new checkout with a new customer', /checkout\.stripe\.com/.test(r.body.url) && (await acct('u7')).stripeCustomerId !== 'cus_fromtestmode');
  await db.doc('accounts/u8').set({ createdAt: admin.firestore.Timestamp.now(), stripeCustomerId:'cus_fromtestmode' });
  r = await call('portal', {}, 'tok_u8');
  check('portal with a leftover test-mode customer says there is no subscription', r.status === 404);
  r = await call('portal', {}, 'tok_u9');
  check('no website subscription: portal says so', r.status === 404);

  console.log(pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

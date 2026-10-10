/* Landscape Quote Pro — website payments (Stripe).
 *
 * Four small HTTP functions (Cloud Functions, europe-west2), reached through the website at
 * /api/... (Firebase Hosting rewrites), so they're same-origin and need no CORS:
 *   checkout  POST /api/checkout   signed-in user → a Stripe Checkout page for a plan
 *   portal    POST /api/portal     signed-in user → Stripe's customer portal (card, invoices,
 *                                  change plan, cancel)
 *   webhook   POST /api/stripe-webhook   Stripe → keeps accounts/{uid} in step with the
 *                                  subscription (tier, period end, grace, cancellation)
 *   admin     private (not public): one-off setup — creates the products/prices, the 20% VAT
 *                                  rate, the customer-portal settings and the webhook endpoint
 *
 * Access in the app comes only from accounts/{uid} (see firestore.rules entitled()), whichever
 * system took the payment. Only this server (admin SDK) writes the paid fields.
 *
 * Webhook events are never trusted as sent: each one is fetched back from Stripe by its id with
 * the secret key, so a forged request can't grant a subscription.
 *
 * Policies (Matt, Oct 2026): 7-day free trial (card not needed to start; if they subscribe during
 * the trial they aren't charged until it ends); a failed payment gives 7 days' grace before the
 * app goes read-only; cancelling keeps access to the end of the period paid for.
 */
const functions = require('@google-cloud/functions-framework');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const STRIPE_VERSION = '2024-06-20';      // pinned: subscription.current_period_end lives here
const TRIAL_DAYS = 7, GRACE_DAYS = 7;
const PLANS = {
  solo:     { name: 'Solo',     devices: 2,  monthly: 3000, yearly: 30000 },
  team:     { name: 'Team',     devices: 5,  monthly: 4500, yearly: 45000 },
  business: { name: 'Business', devices: 10, monthly: 7000, yearly: 70000 },
};
const SITE = 'https://landscape-quote-pro.web.app';
const ORIGINS = [SITE, 'https://landscape-quote-pro.firebaseapp.com', 'https://landscapequotepro.co.uk', 'https://www.landscapequotepro.co.uk'];

/* ---------------- Stripe REST (no SDK needed) ---------------- */
function key(){
  const k = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!/^(sk|rk)_(test|live)_/.test(k)) throw httpError(503, 'Payments are not set up yet.');
  return k;
}
function mode(){ return /_live_/.test(key()) ? 'live' : 'test'; }
function form(obj, prefix, out){
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object') ? form(x, `${name}[${i}]`, out) : out.push([`${name}[${i}]`, String(x)]));
    else if (typeof v === 'object') form(v, name, out);
    else out.push([name, String(v)]);
  }
  return out;
}
async function stripe(method, path, params){
  const body = params && method !== 'GET' ? new URLSearchParams(form(params)).toString() : undefined;
  const qs = params && method === 'GET' ? '?' + new URLSearchParams(form(params)).toString() : '';
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method, body,
    headers: { Authorization: `Bearer ${key()}`, 'Stripe-Version': STRIPE_VERSION, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error((j.error && j.error.message) || `Stripe ${r.status}`); e.status = r.status; e.stripe = j.error; throw e; }
  return j;
}

/* ---------------- helpers ---------------- */
function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function send(res, status, obj){ res.status(status).set('Cache-Control', 'no-store').json(obj); }
async function userFrom(req){
  const m = String(req.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw httpError(401, 'Please sign in again.');
  try { return await admin.auth().verifyIdToken(m[1]); }
  catch (e) { throw httpError(401, 'Please sign in again.'); }
}
function originOf(req, body){
  const o = (body && body.origin) || req.get('Origin') || '';
  return ORIGINS.includes(o) ? o : SITE;
}
const cfgRef = () => db.doc(`admin/stripe_${mode()}`);
async function config(){
  const s = await cfgRef().get();
  if (!s.exists || !s.data().prices) throw httpError(503, 'Payments are not set up yet.');
  return s.data();
}
function trialEndOf(a){
  const created = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date();
  let end = new Date(created.getTime() + TRIAL_DAYS * 86400000);
  const extra = a.trialUntil && a.trialUntil.toDate ? a.trialUntil.toDate() : null;
  if (extra && extra > end) end = extra;
  return end;
}
function wrap(fn){
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (!e.status || e.status >= 500) console.error(e && e.stack || e);
      send(res, e.status && e.status < 500 ? e.status : (e.status === 503 ? 503 : 500), { error: e.status && e.status !== 500 ? e.message : 'Something went wrong — please try again.' });
    }
  };
}

/* ---------------- account sync (the only place paid fields are written) ---------------- */
function planFromSub(sub){
  const item = sub.items && sub.items.data && sub.items.data[0];
  const price = item && item.price;
  const lk = (price && price.lookup_key) || '';
  const m = lk.match(/^lqp_(solo|team|business)_(monthly|yearly)$/);
  if (m) return { tier: m[1], period: m[2] };
  const md = sub.metadata || {};
  return { tier: PLANS[md.plan] ? md.plan : 'solo', period: md.period === 'yearly' ? 'yearly' : (price && price.recurring && price.recurring.interval === 'year' ? 'yearly' : 'monthly') };
}
async function uidForSub(sub){
  if (sub.metadata && sub.metadata.uid) return sub.metadata.uid;
  const q = await db.collection('accounts').where('stripeCustomerId', '==', sub.customer).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}
async function syncSubscription(sub){
  const uid = await uidForSub(sub);
  if (!uid) { console.warn('No account for subscription', sub.id); return; }
  const ref = db.doc(`accounts/${uid}`);
  const a = (await ref.get()).data() || {};
  const { tier, period } = planFromSub(sub);
  const item = sub.items && sub.items.data && sub.items.data[0];
  const cpe = sub.current_period_end || (item && item.current_period_end);
  const DAY = 86400;
  const up = {
    store: 'stripe', tier, billingPeriod: period,
    stripeCustomerId: sub.customer, stripeSubscriptionId: sub.id, stripeStatus: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    billingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (sub.status === 'trialing' || sub.status === 'active') {
    // Paid (or in the free trial) up to the period end; one day's leeway so a renewal that's
    // still being processed never locks anyone out.
    const end = (sub.status === 'trialing' && sub.trial_end) ? sub.trial_end : cpe;
    up.periodEnd = Timestamp.fromMillis((end + DAY) * 1000);
    up.graceUntil = admin.firestore.FieldValue.delete();
  } else if (sub.status === 'past_due') {
    // A payment failed: 7 days to sort it before the app goes read-only (kept, not restarted,
    // when Stripe retries and fails again).
    const already = a.graceUntil && a.graceUntil.toMillis && a.graceUntil.toMillis() > Date.now();
    if (!already) up.graceUntil = Timestamp.fromMillis(Date.now() + GRACE_DAYS * DAY * 1000);
  } else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
    up.graceUntil = admin.firestore.FieldValue.delete();
    const ended = sub.ended_at || cpe || Math.floor(Date.now() / 1000);
    // Access runs to the end of what was paid for, never longer.
    const cur = a.periodEnd && a.periodEnd.toMillis ? a.periodEnd.toMillis() : 0;
    up.periodEnd = Timestamp.fromMillis(Math.min(cur || ended * 1000, ended * 1000));
    up.cancelAtPeriodEnd = false;
  } else {
    // incomplete / paused: nothing granted until Stripe says it's paid.
    delete up.tier; delete up.billingPeriod; delete up.store;
  }
  // Someone already paying through Apple/Google keeps that as their billing record.
  if (a.store && a.store !== 'stripe' && a.periodEnd && a.periodEnd.toMillis() > Date.now() && !['trialing', 'active'].includes(sub.status)) {
    await ref.set({ stripeCustomerId: sub.customer, stripeSubscriptionId: sub.id, stripeStatus: sub.status }, { merge: true });
    return;
  }
  await ref.set(up, { merge: true });
}

/* ---------------- checkout ---------------- */
functions.http('checkout', wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const user = await userFrom(req);
  const body = req.body || {};
  const plan = PLANS[body.plan] ? body.plan : null;
  const period = body.period === 'yearly' ? 'yearly' : 'monthly';
  if (!plan) throw httpError(400, 'Pick a plan.');
  const cfg = await config();
  const ref = db.doc(`accounts/${user.uid}`);
  const a = (await ref.get()).data() || {};
  if (a.freeForever) throw httpError(409, "This account is free — there's nothing to pay.");
  const origin = originOf(req, body);
  const paidElsewhere = a.store && a.store !== 'stripe' && a.periodEnd && a.periodEnd.toMillis() > Date.now();
  if (paidElsewhere) throw httpError(409, 'Your plan is already paid through the app store — change it there.');
  // Already subscribed on the website: changes go through the customer portal (it prorates).
  if (a.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(a.stripeStatus)) {
    const p = await stripe('POST', 'billing_portal/sessions', { customer: a.stripeCustomerId, return_url: origin + '/', configuration: cfg.portalConfigId,
      flow_data: { type: 'subscription_update', subscription_update: { subscription: a.stripeSubscriptionId }, after_completion: { type: 'redirect', redirect: { return_url: origin + '/?billing=updated' } } } });
    return send(res, 200, { url: p.url });
  }
  let customer = a.stripeCustomerId;
  if (customer) { try { const c = await stripe('GET', `customers/${customer}`); if (c.deleted) customer = null; } catch (e) { customer = null; } }
  if (!customer) {
    const c = await stripe('POST', 'customers', { email: user.email, metadata: { uid: user.uid }, preferred_locales: ['en-GB'] });
    customer = c.id;
    await ref.set({ stripeCustomerId: customer }, { merge: true });
  }
  // Still in the free trial: billing starts when it ends (Stripe needs that to be 2+ days away).
  const trialEnd = trialEndOf(a);
  const trialSecs = Math.floor(trialEnd.getTime() / 1000);
  const subData = { metadata: { uid: user.uid, plan, period }, default_tax_rates: [cfg.taxRateId] };
  if (!a.stripeSubscriptionId && trialSecs > Math.floor(Date.now() / 1000) + 2 * 86400 + 600) subData.trial_end = trialSecs;
  const s = await stripe('POST', 'checkout/sessions', {
    mode: 'subscription', customer, client_reference_id: user.uid, locale: 'en-GB',
    line_items: [{ price: cfg.prices[`${plan}_${period}`], quantity: 1 }],
    subscription_data: subData,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    success_url: origin + '/?billing=success',
    cancel_url: origin + '/?billing=cancelled',
  });
  send(res, 200, { url: s.url });
}));

/* ---------------- customer portal ---------------- */
functions.http('portal', wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const user = await userFrom(req);
  const cfg = await config();
  const a = (await db.doc(`accounts/${user.uid}`).get()).data() || {};
  if (!a.stripeCustomerId) throw httpError(404, "There's no website subscription on this account yet.");
  const p = await stripe('POST', 'billing_portal/sessions', { customer: a.stripeCustomerId, return_url: originOf(req, req.body) + '/', configuration: cfg.portalConfigId });
  send(res, 200, { url: p.url });
}));

/* ---------------- webhook ---------------- */
const SUB_EVENTS = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed'];
const INVOICE_EVENTS = ['invoice.paid', 'invoice.payment_failed', 'invoice.payment_succeeded'];
functions.http('webhook', wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const id = req.body && req.body.id;
  if (!/^evt_[A-Za-z0-9]+$/.test(String(id || ''))) return send(res, 400, { error: 'bad event' });
  let ev;
  try { ev = await stripe('GET', `events/${id}`); }
  catch (e) { if (e.status === 404) return send(res, 400, { error: 'unknown event' }); throw e; }
  // Each event is applied once.
  const seen = db.doc(`admin/stripe_${mode()}/events/${ev.id}`);
  if ((await seen.get()).exists) return send(res, 200, { ok: true, duplicate: true });
  const obj = ev.data && ev.data.object;
  if (SUB_EVENTS.includes(ev.type)) {
    // Always the latest state, in case events arrive out of order.
    await syncSubscription(await stripe('GET', `subscriptions/${obj.id}`));
  } else if (ev.type === 'checkout.session.completed' && obj.subscription) {
    const sub = await stripe('GET', `subscriptions/${obj.subscription}`);
    if (!(sub.metadata && sub.metadata.uid) && obj.client_reference_id) sub.metadata = Object.assign({}, sub.metadata, { uid: obj.client_reference_id });
    await syncSubscription(sub);
  } else if (INVOICE_EVENTS.includes(ev.type) && obj.subscription) {
    await syncSubscription(await stripe('GET', `subscriptions/${obj.subscription}`));
  }
  await seen.set({ type: ev.type, at: admin.firestore.FieldValue.serverTimestamp() });
  send(res, 200, { ok: true });
}));

/* ---------------- one-off setup (private) ---------------- */
async function findPrice(lookupKey){
  const r = await stripe('GET', 'prices', { lookup_keys: [lookupKey], active: true, limit: 1 });
  return r.data && r.data[0];
}
functions.http('admin', wrap(async (req, res) => {
  // Not public: Cloud Run only lets the project's own admin account call this.
  const body = req.body || {};
  const action = body.action || 'status';
  const ref = cfgRef();
  if (action === 'status') {
    const s = await ref.get();
    return send(res, 200, { mode: mode(), config: s.exists ? s.data() : null });
  }
  if (action !== 'setup') throw httpError(400, 'unknown action');
  const cfg = (await ref.get()).data() || {};
  // Products and prices (found again by lookup key, so running setup twice changes nothing).
  const prices = Object.assign({}, cfg.prices);
  const products = Object.assign({}, cfg.products);
  for (const [id, pl] of Object.entries(PLANS)) {
    for (const period of ['monthly', 'yearly']) {
      const lk = `lqp_${id}_${period}`;
      let price = await findPrice(lk);
      if (!price) {
        if (!products[id]) {
          const p = await stripe('POST', 'products', { name: `Landscape Quote Pro — ${pl.name}`, description: `Use on up to ${pl.devices} devices. Every feature included.`, metadata: { plan: id }, tax_code: 'txcd_10103001' });
          products[id] = p.id;
        }
        price = await stripe('POST', 'prices', { product: products[id], currency: 'gbp', unit_amount: pl[period], tax_behavior: 'exclusive',
          recurring: { interval: period === 'yearly' ? 'year' : 'month' }, lookup_key: lk, nickname: `${pl.name} ${period}`, metadata: { plan: id, period } });
      }
      products[id] = typeof price.product === 'string' ? price.product : price.product.id;
      // Keep the product's name in step with the app's name (it shows at checkout and on invoices).
      const want = `Landscape Quote Pro — ${pl.name}`;
      const prod = await stripe('GET', `products/${products[id]}`);
      if (prod.name !== want) await stripe('POST', `products/${products[id]}`, { name: want });
      prices[`${id}_${period}`] = price.id;
    }
  }
  // 20% UK VAT, added on top of the price.
  let taxRateId = cfg.taxRateId;
  if (!taxRateId) {
    const t = await stripe('POST', 'tax_rates', { display_name: 'VAT', percentage: 20, inclusive: false, country: 'GB', jurisdiction: 'United Kingdom', tax_type: 'vat', description: 'UK VAT 20%' });
    taxRateId = t.id;
  }
  // Customer portal: update card, see invoices, switch plan (prorated), cancel at period end.
  const portalParams = {
    business_profile: { headline: 'Landscape Quote Pro — manage your subscription', privacy_policy_url: SITE + '/privacy', terms_of_service_url: SITE + '/terms' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations',
        products: Object.keys(PLANS).map(id => ({ product: products[id], prices: [prices[`${id}_monthly`], prices[`${id}_yearly`]] })) },
    },
    default_return_url: SITE + '/',
  };
  const portal = cfg.portalConfigId ? await stripe('POST', `billing_portal/configurations/${cfg.portalConfigId}`, portalParams) : await stripe('POST', 'billing_portal/configurations', portalParams);
  // Webhook endpoint (events are fetched back from Stripe, so its signing secret isn't needed).
  let webhookId = cfg.webhookId;
  if (body.webhookUrl) {
    const events = SUB_EVENTS.concat(INVOICE_EVENTS, ['checkout.session.completed']);
    if (webhookId) { try { await stripe('POST', `webhook_endpoints/${webhookId}`, { url: body.webhookUrl, enabled_events: events }); } catch (e) { webhookId = null; } }
    if (!webhookId) { const w = await stripe('POST', 'webhook_endpoints', { url: body.webhookUrl, enabled_events: events, api_version: STRIPE_VERSION, description: 'Quote Pro: keeps app accounts in step with subscriptions' }); webhookId = w.id; }
  }
  const out = { mode: mode(), prices, products, taxRateId, portalConfigId: portal.id, webhookId: webhookId || null, setupAt: admin.firestore.FieldValue.serverTimestamp() };
  await ref.set(out, { merge: true });
  send(res, 200, Object.assign({}, out, { setupAt: new Date().toISOString() }));
}));

module.exports = { syncSubscription, form, planFromSub, trialEndOf };

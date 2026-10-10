/* Infinity Landscape Quote Pro — own-website platform layer (Firebase).
 *
 * The app itself (app/app.html) is written against a tiny storage/identity API:
 *   claude.use("db")   -> doc(path).get/set/update/delete, doc.collection(name), collection.orderBy/limit/get
 *   claude.use("user") -> { id() }
 * On claude.ai that API comes from the artifact runtime. Here the same API is provided by
 * Firebase Auth + Cloud Firestore, so the app's code is identical in both places.
 *
 * This file also owns everything that only exists on the real product:
 *  - sign-in / sign-up / password reset
 *  - the device limit (2 / 5 / 10 by plan) and the monthly swap limit
 *  - trial / subscription status, and read-only mode once it has ended
 *  - the Account panel (plan, devices, download my data, delete account, sign out)
 *  - the plans screen (purchases are handed to window.__purchases — the phone apps' store
 *    billing via RevenueCat; on the website it explains where to subscribe)
 *  - working offline (local cache; writes are queued and sync when the signal returns)
 *
 * Firestore layout:
 *   businesses/{uid}/...            the app's own data (settings doc + quotes, calendarEntries, drafts, branding)
 *   accounts/{uid}                  createdAt (trial start) + plan fields written only by the server
 *   accounts/{uid}/private/devices  { devices: {id: {name, addedAt, lastSeen}}, swapMonth, swapsUsed }
 * firestore.rules enforces: own data only; writes only while entitled; device count <= plan
 * limit; at most 2 device removals per calendar month.
 */
(function(){
  "use strict";

  /* ======================================================================
     Constants
     ====================================================================== */
  var TRIAL_DAYS = 7;
  var MAX_SWAPS = 2;
  var PLANS = [
    { id:"solo", name:"Solo", devices:2, monthly:30, yearly:300, storeMonthly:"£35.99", storeYearly:"£359.99" },
    { id:"team", name:"Team", devices:5, monthly:45, yearly:450, storeMonthly:"£54.99", storeYearly:"£539.99", popular:true },
    { id:"business", name:"Business", devices:10, monthly:70, yearly:700, storeMonthly:"£83.99", storeYearly:"£839.99" },
  ];
  var SUPPORT_EMAIL = "support@landscapequotepro.co.uk";
  var BUSINESS_COLLECTIONS = ["quotes", "calendarEntries", "drafts", "branding"];

  /* ======================================================================
     Firebase
     ====================================================================== */
  firebase.initializeApp(window.__FIREBASE_CONFIG__);
  var auth = firebase.auth();
  var fs = firebase.firestore();
  var params = new URLSearchParams(location.search);
  var useEmu = params.get("emulator") === "1" || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && params.get("emulator") !== "0");
  fs.settings({ ignoreUndefinedProperties: true, merge: true });
  if (useEmu) {
    auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
    fs.useEmulator("127.0.0.1", 8080);
  }
  // Offline: keep a local copy so quotes open and save with no signal (synced later).
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function(){}); } catch(e) {}
  var serverTime = firebase.firestore.FieldValue.serverTimestamp;

  /* ======================================================================
     Small helpers
     ====================================================================== */
  function esc(t){ return String(t==null?"":t).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
  function toDate(ts){ if (!ts) return null; if (ts.toDate) return ts.toDate(); if (ts.seconds != null) return new Date(ts.seconds*1000); var d = new Date(ts); return isNaN(d) ? null : d; }
  function fmtDate(d){ return d ? d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : ""; }
  function daysLeft(d){ return d ? Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000)) : 0; }
  function monthKey(d){ d = d || new Date(); return d.getUTCFullYear()*100 + (d.getUTCMonth()+1); }
  function firstOfNextMonth(){ var d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1)); }
  function el(id){ return document.getElementById(id); }
  // Screens stack in the order they were opened: one being opened (not just redrawn) goes on top.
  var zTop = 100000;
  function overlay(id, cls){
    var o = el(id);
    if (!o) { o = document.createElement("div"); o.id = id; document.body.appendChild(o); }
    if (o.style.display !== "flex") o.style.zIndex = String(++zTop);
    o.className = "pf-overlay" + (cls ? " " + cls : "");
    o.style.display = "flex";
    return o;
  }
  function hide(id){ var o = el(id); if (o) o.style.display = "none"; }
  function deviceId(){
    var k = "lqp_device_id", id = null;
    try { id = localStorage.getItem(k); } catch(e) {}
    if (!id) {
      id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(k, id); } catch(e) {}
    }
    return id;
  }
  function deviceName(){
    var ua = navigator.userAgent || "";
    var dev = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
      : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Linux/.test(ua) ? "Linux computer" : "Device";
    var br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    if (window.__NATIVE_DEVICE_NAME__) return String(window.__NATIVE_DEVICE_NAME__);
    return br ? dev + " · " + br : dev;
  }

  /* ======================================================================
     The db API the app expects (with nested-array encoding + offline-friendly writes)
     ====================================================================== */
  function enc(v){
    if (Array.isArray(v)) return v.map(function(x){ return Array.isArray(x) ? { __arr: enc(x) } : enc(x); });
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function(k){ if (v[k] !== undefined) o[k] = enc(v[k]); }); return o; }
    return v;
  }
  function dec(v){
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === "object") {
      var keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "__arr" && Array.isArray(v.__arr)) return dec(v.__arr);
      var o = {}; keys.forEach(function(k){ o[k] = dec(v[k]); }); return o;
    }
    return v;
  }
  // With no signal Firestore applies a write locally at once but only settles the promise when
  // the server confirms. The app awaits its saves, so settle after a short wait instead; a write
  // the server later refuses is reported in the banner.
  var failedSync = 0;
  function writeSoon(p){
    p.catch(function(e){
      // While read-only the rules refuse writes by design (the app may still try a background
      // save on start-up) — that's not a failure worth flagging.
      if (e && e.code === "permission-denied" && account && !status().entitled) return;
      failedSync++; console.warn("A change could not be saved:", e && e.code); refreshBanner();
    });
    return Promise.race([p, new Promise(function(res){ setTimeout(function(){ res(); }, navigator.onLine ? 8000 : 400); })]);
  }
  function snap(s){ var d = s && s.exists ? dec(s.data()) : undefined; return { id: s ? s.id : "", exists: !!(s && s.exists), data: function(){ return d; } }; }
  var EMPTY_DOC = { get: function(){ return Promise.resolve({ id:"", exists:false, data:function(){ return undefined; } }); },
    set: function(){ return Promise.reject(new Error("not available")); }, update: function(){ return Promise.reject(new Error("not available")); },
    delete: function(){ return Promise.resolve(); }, collection: function(){ return EMPTY_COLL; } };
  var EMPTY_QUERY = { orderBy: function(){ return EMPTY_QUERY; }, limit: function(){ return EMPTY_QUERY; }, where: function(){ return EMPTY_QUERY; },
    get: function(){ return Promise.resolve({ docs: [], empty: true, size: 0 }); } };
  var EMPTY_COLL = Object.assign({ doc: function(){ return EMPTY_DOC; } }, EMPTY_QUERY);
  function wrapDoc(ref){
    return {
      id: ref.id, path: ref.path,
      get: function(){ return ref.get().then(snap); },
      set: function(data){ return writeSoon(ref.set(enc(data))); },
      update: function(data){ return writeSoon(ref.update(enc(data))); },
      delete: function(){ return writeSoon(ref.delete()); },
      collection: function(name){ return wrapColl(ref.collection(name)); },
      onSnapshot: function(fn, err){ return ref.onSnapshot(function(s){ fn(snap(s)); }, err); },
    };
  }
  function wrapQuery(q){
    return {
      orderBy: function(f, dir){ return wrapQuery(q.orderBy(f, dir)); },
      limit: function(n){ return wrapQuery(q.limit(n)); },
      where: function(f, op, v){ return wrapQuery(q.where(f, op, v)); },
      get: function(){ return q.get().then(function(qs){ var docs = qs.docs.map(snap); return { docs: docs, empty: !docs.length, size: docs.length }; }); },
    };
  }
  function wrapColl(c){ var w = wrapQuery(c); w.doc = function(id){ return wrapDoc(c.doc(id)); }; return w; }
  function mapPath(p){
    var m = /^data\/users\/([^/]+)\/business(\/.*)?$/.exec(String(p||""));
    return m ? "businesses/" + m[1] + (m[2] || "") : null;
  }
  var dbApi = {
    doc: function(p){ var mp = mapPath(p); return mp ? wrapDoc(fs.doc(mp)) : EMPTY_DOC; },
    collection: function(p){ var mp = mapPath(p); return mp ? wrapColl(fs.collection(mp)) : EMPTY_COLL; },
  };

  /* ======================================================================
     Account state: trial, plan, entitlement
     ====================================================================== */
  var user = null, account = null, devicesDoc = null;
  var myDevice = deviceId();
  function acctRef(){ return fs.doc("accounts/" + user.uid); }
  function devRef(){ return fs.doc("accounts/" + user.uid + "/private/devices"); }
  function planOf(id){ for (var i=0;i<PLANS.length;i++) if (PLANS[i].id === id) return PLANS[i]; return PLANS[0]; }
  // Mirrors entitled()/tierLimit() in firestore.rules.
  function status(){
    var a = account || {};
    var created = toDate(a.createdAt) || new Date();
    var trialEnd = new Date(created.getTime() + TRIAL_DAYS*86400000);
    // A longer one-off trial given to a particular account (set by the server/admin only).
    var trialUntil = toDate(a.trialUntil);
    if (trialUntil && trialUntil.getTime() > trialEnd.getTime()) trialEnd = trialUntil;
    var periodEnd = toDate(a.periodEnd), graceUntil = toDate(a.graceUntil), now = Date.now();
    var s = { tier: a.tier || null, plan: a.tier ? planOf(a.tier) : null, store: a.store || null, period: a.billingPeriod || null,
      trialEnd: trialEnd, periodEnd: periodEnd, graceUntil: graceUntil, cancelled: !!a.cancelAtPeriodEnd, freeForever: !!a.freeForever };
    if (s.freeForever) { s.state = "free"; s.limit = 10; }
    else if (periodEnd && periodEnd.getTime() > now) { s.state = "active"; }
    else if (graceUntil && graceUntil.getTime() > now) { s.state = "grace"; }
    else if (trialEnd.getTime() > now) { s.state = "trial"; }
    else { s.state = "lapsed"; }
    if (!s.limit) s.limit = (a.tier === "business") ? 10 : (a.tier === "team") ? 5 : 2;
    s.entitled = s.state !== "lapsed";
    return s;
  }

  /* ======================================================================
     Sign-in screen
     ====================================================================== */
  var mode = "signin", busy = false, msg = "", msgKind = "err", typedEmail = "";
  try { var carried = sessionStorage.getItem("lqp_signout_msg"); if (carried) { msg = carried; msgKind = "warn"; sessionStorage.removeItem("lqp_signout_msg"); } } catch(e) {}
  function errText(e){
    var c = (e && e.code) || "";
    if (c === "auth/invalid-email") return "That email address doesn't look right.";
    if (c === "auth/missing-password") return "Enter your password.";
    if (c === "auth/weak-password") return "Choose a password of at least 8 characters.";
    if (c === "auth/email-already-in-use") return "There's already an account with that email — sign in instead.";
    if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-login-credentials") return "That email and password don't match. Try again, or reset your password.";
    if (c === "auth/too-many-requests") return "Too many attempts — wait a few minutes, or reset your password.";
    if (c === "auth/network-request-failed") return "No internet connection — check your signal and try again.";
    if (c === "auth/requires-recent-login") return "For your security, please sign in again first.";
    return "Something went wrong (" + (c || (e && e.message) || "unknown") + "). Please try again.";
  }
  function drawGate(){
    var o = overlay("authGate", "pf-centre");
    if (!o._wired) {
      o._wired = true;
      o.addEventListener("submit", function(e){ e.preventDefault(); submitGate(); });
      o.addEventListener("click", function(e){
        var a = e.target.closest("[data-auth]"); if (!a) return; e.preventDefault();
        var k = a.getAttribute("data-auth");
        if (k === "signin" || k === "signup" || k === "reset") { mode = k; msg = ""; drawGate(); }
      });
    }
    var title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in";
    var sub = mode === "signup" ? "Start your free " + TRIAL_DAYS + "-day trial. One account per business." : mode === "reset" ? "We'll email you a link to choose a new password." : "Welcome back.";
    o.innerHTML =
      '<div class="pf-box"><div class="pf-brand">Infinity Landscape <b>Quote Pro</b></div>' +
      '<h1>' + title + '</h1><p class="pf-sub">' + sub + '</p>' +
      (msg ? '<div class="pf-msg ' + msgKind + '">' + esc(msg) + '</div>' : '') +
      '<form novalidate>' +
      '<label>Email<input id="agEmail" type="email" autocomplete="email" required></label>' +
      (mode !== "reset" ? '<label>Password<input id="agPass" type="password" autocomplete="' + (mode === "signup" ? "new-password" : "current-password") + '" required></label>' : '') +
      (mode === "signup" ? '<label>Confirm password<input id="agPass2" type="password" autocomplete="new-password" required></label>' : '') +
      '<button type="submit" class="pf-btn ag-btn" ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Please wait…' : mode === "signup" ? 'Create account' : mode === "reset" ? 'Send reset link' : 'Sign in') + '</button>' +
      '</form><div class="pf-links">' +
      (mode === "signin" ? '<a href="#" data-auth="reset">Forgotten your password?</a><a href="#" data-auth="signup">New here? Create an account</a>' :
       '<a href="#" data-auth="signin">Back to sign in</a>') +
      '</div>' +
      (mode === "signup" ? '<p class="pf-fine">By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener">terms of service</a> and <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>' : '') +
      '</div>';
    var em = el("agEmail"); if (em) { em.value = typedEmail; em.focus(); }
  }
  function submitGate(){
    if (busy) return;
    var email = ((el("agEmail") || {}).value || "").trim();
    typedEmail = email;
    var pass = (el("agPass") || {}).value || "", pass2 = (el("agPass2") || {}).value || "";
    msg = ""; msgKind = "err";
    if (!email) { msg = "Enter your email address."; return drawGate(); }
    if (mode === "signup") {
      if (pass.length < 8) { msg = "Choose a password of at least 8 characters."; return drawGate(); }
      if (pass !== pass2) { msg = "The two passwords don't match."; return drawGate(); }
    }
    busy = true; drawGate();
    var resetMsg = "If there's an account for that email, a reset link is on its way.";
    var p = mode === "signup" ? auth.createUserWithEmailAndPassword(email, pass).then(function(c){ try { c.user.sendEmailVerification(); } catch(e){} })
          : mode === "reset" ? auth.sendPasswordResetEmail(email).then(function(){ msg = resetMsg; msgKind = "ok"; mode = "signin"; })
          : auth.signInWithEmailAndPassword(email, pass);
    p.catch(function(e){
      // A reset request never reveals whether the email has an account.
      if (mode === "reset" && e && e.code === "auth/user-not-found") { msg = resetMsg; msgKind = "ok"; mode = "signin"; }
      else { msg = errText(e); msgKind = "err"; }
    }).then(function(){ busy = false; if (!user) drawGate(); });
  }

  /* ======================================================================
     Devices: register this device; if the plan's limit is reached, pick one to sign out
     ====================================================================== */
  var devicesUnsub = null;
  function deviceList(){
    var d = (devicesDoc && devicesDoc.devices) || {};
    return Object.keys(d).map(function(id){ var v = d[id] || {}; return { id:id, name:v.name || "Device", addedAt:toDate(v.addedAt), lastSeen:toDate(v.lastSeen) }; })
      .sort(function(a,b){ return (b.lastSeen||0) - (a.lastSeen||0); });
  }
  function swapsLeft(){
    var dd = devicesDoc || {};
    var used = dd.swapMonth === monthKey() ? (dd.swapsUsed || 0) : 0;
    return Math.max(0, MAX_SWAPS - used);
  }
  // Writes the whole registry doc in the shape the rules check.
  function writeDevices(devices, removedCount){
    var dd = devicesDoc || {};
    var prevUsed = dd.swapMonth === monthKey() ? (dd.swapsUsed || 0) : 0;
    var data = { devices: devices, swapMonth: monthKey(), swapsUsed: prevUsed + (removedCount || 0) };
    return devRef().set(data);
  }
  function plainDevices(){
    var src = (devicesDoc && devicesDoc.devices) || {}, out = {};
    Object.keys(src).forEach(function(k){ out[k] = src[k]; });
    return out;
  }
  function registerThisDevice(){
    return devRef().get().then(function(s){
      devicesDoc = s.exists ? s.data() : null;
      var devs = plainDevices();
      var st = status();
      if (devs[myDevice]) {
        // Known device: refresh "last used" at most every 6 hours.
        var last = toDate(devs[myDevice].lastSeen);
        if (!last || Date.now() - last.getTime() > 6*3600000) {
          devs[myDevice] = { name: devs[myDevice].name || deviceName(), addedAt: devs[myDevice].addedAt || serverTime(), lastSeen: serverTime() };
          return writeDevices(devs, 0).catch(function(){}).then(function(){ return true; });
        }
        return true;
      }
      if (Object.keys(devs).length < st.limit) {
        devs[myDevice] = { name: deviceName(), addedAt: serverTime(), lastSeen: serverTime() };
        return writeDevices(devs, 0).then(function(){ return true; });
      }
      return false; // full — ask which device to sign out
    });
  }
  function drawDevicePicker(note){
    var st = status(), list = deviceList(), left = swapsLeft();
    var o = overlay("pfDevices", "pf-centre");
    var plan = st.plan ? st.plan.name + " plan" : (st.state === "trial" ? "free trial" : "plan");
    var rows = list.map(function(d){
      return '<div class="pf-row"><div class="pf-grow"><div class="pf-name">' + esc(d.name) + '</div><div class="pf-meta">' +
        (d.lastSeen ? "Last used " + fmtDate(d.lastSeen) : "") + '</div></div>' +
        (left > 0 ? '<button class="pf-btn pf-small pf-ghost" data-pf="kick" data-id="' + esc(d.id) + '">Sign out</button>' : '') + '</div>';
    }).join("");
    o.innerHTML = '<div class="pf-box"><div class="pf-brand">Infinity Landscape <b>Quote Pro</b></div>' +
      '<h1>Too many devices</h1>' +
      '<p class="pf-sub">Your ' + esc(plan) + ' can be used on ' + st.limit + ' device' + (st.limit === 1 ? '' : 's') + ' at once. ' +
      (left > 0 ? 'To use it here, sign one of these out. You can swap devices ' + MAX_SWAPS + ' times a month — ' + left + ' swap' + (left === 1 ? '' : 's') + ' left this month.'
               : 'You\'ve used both device swaps this month. You can swap again on ' + fmtDate(firstOfNextMonth()) + '.') + '</p>' +
      (note ? '<div class="pf-msg err">' + esc(note) + '</div>' : '') +
      '<div>' + rows + '</div>' +
      (left > 0 ? '' : '<div class="pf-msg warn">Lost or broken phone? Email <a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a> and we\'ll reset it for you.</div>') +
      (st.limit < 10 ? '<button class="pf-btn pf-ghost" data-pf="plans">More devices: change plan</button>' : '') +
      '<button class="pf-btn pf-ghost" data-pf="signout">Sign out of this device instead</button></div>';
    if (!o._wired) {
      o._wired = true;
      o.addEventListener("click", function(e){
        var b = e.target.closest("[data-pf]"); if (!b) return;
        var k = b.getAttribute("data-pf");
        if (k === "kick") kickThenJoin(b.getAttribute("data-id"));
        else if (k === "signout") auth.signOut();
        else if (k === "plans") openPlans();
      });
    }
  }
  function kickThenJoin(id){
    var devs = plainDevices();
    if (!devs[id]) return drawDevicePicker();
    delete devs[id];
    devs[myDevice] = { name: deviceName(), addedAt: serverTime(), lastSeen: serverTime() };
    writeDevices(devs, 1).then(function(){ hide("pfDevices"); startApp(); })
      .catch(function(e){ devRef().get().then(function(s){ devicesDoc = s.exists ? s.data() : null; drawDevicePicker("That didn't work (" + (e && e.code || "error") + "). Please try again."); }); });
  }
  // Another device removed this one: sign out here.
  function watchDevices(){
    if (devicesUnsub) devicesUnsub();
    devicesUnsub = devRef().onSnapshot(function(s){
      devicesDoc = s.exists ? s.data() : null;
      if (appStarted && devicesDoc && devicesDoc.devices && !devicesDoc.devices[myDevice] && !s.metadata.hasPendingWrites) {
        try { sessionStorage.setItem("lqp_signout_msg", "This device was signed out from another device on your account."); } catch(e) {}
        auth.signOut();
      }
      if (el("pfAccount") && el("pfAccount").style.display !== "none") drawAccount();
    }, function(){});
  }

  /* ======================================================================
     Banner: trial days left, payment problem, read-only, offline
     ====================================================================== */
  function refreshBanner(){
    if (!appStarted) return;
    var b = el("pfBanner");
    if (!b) { b = document.createElement("div"); b.id = "pfBanner"; document.body.insertBefore(b, document.body.firstChild); }
    var st = status(), html = "";
    if (!navigator.onLine) html = '<div class="pf-b warn">You\'re offline — you can carry on; changes will sync when you\'re back online.</div>';
    else if (failedSync) html = '<div class="pf-b err">Some changes couldn\'t be saved. <button data-pf="account">Check account</button></div>';
    if (st.state === "lapsed") html += '<div class="pf-b err">Your ' + (account && account.periodEnd ? 'subscription' : 'free trial') + ' has ended — you can view and download your quotes, but not create or change anything. <button data-pf="plans">Choose a plan</button></div>';
    else if (st.state === "grace" && inStoreApp() && st.store && !isAppStoreBilling(st.store)) html += '<div class="pf-b warn">There\'s a problem with this account\'s payment — it needs sorting by ' + fmtDate(st.graceUntil) + ' to keep using the app.</div>';
    else if (st.state === "grace") html += '<div class="pf-b warn">There\'s a problem with your payment — please update it by ' + fmtDate(st.graceUntil) + ' to keep using the app. <button data-pf="manage">Fix payment</button></div>';
    else if (st.state === "trial") { var dl = daysLeft(st.trialEnd); html += '<div class="pf-b info">Free trial: ' + dl + ' day' + (dl === 1 ? '' : 's') + ' left. <button data-pf="plans">Choose a plan</button></div>'; }
    b.innerHTML = html;
    if (!b._wired) {
      b._wired = true;
      b.addEventListener("click", function(e){
        var x = e.target.closest("[data-pf]"); if (!x) return;
        var k = x.getAttribute("data-pf");
        if (k === "plans") openPlans(); else if (k === "manage") manageSubscription(); else if (k === "account") openAccount();
      });
    }
  }
  window.addEventListener("online", function(){ refreshBanner(); });
  window.addEventListener("offline", function(){ refreshBanner(); });

  /* ======================================================================
     Plans screen (Solo / Team / Business, monthly or yearly)
     ====================================================================== */
  var planPeriod = "monthly", planMsg = "", planBusy = false;
  function purchases(){ return window.__purchases || null; }
  /* Which billing system this screen sells through: the phone's own store in the iPhone/Android
     apps, the website (Stripe, once added) otherwise. A subscription bought through a DIFFERENT
     system is never sold again here (no double paying), and inside the phone apps a plan paid
     outside the app stores is never pointed at — no link, no mention of where it was paid
     (Apple 3.1.3(b) / Google Play payments policy). Access itself never depends on this: it
     comes from the account record alone (see status()). */
  function storeHere(){
    var p = purchases();
    if (!p) return "stripe";
    if (p.store) return p.store;
    var n = String(p.storeName || "");
    return /apple|app store|ios/i.test(n) ? "app_store" : /google|play/i.test(n) ? "play_store" : "unknown";
  }
  function inStoreApp(){ return !!purchases(); }
  function isAppStoreBilling(store){ return store === "app_store" || store === "play_store"; }
  function storeLabel(store){ return store === "app_store" ? "the App Store (Apple)" : store === "play_store" ? "Google Play" : "the website"; }
  // A paid plan billed through some other system than the one this screen uses.
  function billedElsewhere(st){
    st = st || status();
    return (st.state === "active" || st.state === "grace") && !!st.store && st.store !== storeHere();
  }
  // What to say instead of offering to sell a plan; null when selling is fine.
  function noSaleNote(st){
    if (st.state === "free") return "This account is free — there's nothing to pay.";
    if (!billedElsewhere(st)) return null;
    var plan = st.plan ? st.plan.name + " plan" : "plan";
    // Inside a phone app, a plan paid outside the app stores is just acknowledged — never named or linked.
    if (inStoreApp() && !isAppStoreBilling(st.store)) return "Your " + plan + " is already active on this account — there's nothing to pay here. Carry on using the app.";
    var where = st.store === "app_store" ? "the Apple device it was bought on (Settings → your name → Subscriptions)"
      : st.store === "play_store" ? "the Google Play Store on an Android device" : storeLabel(st.store);
    return "Your " + plan + " is billed through " + storeLabel(st.store) + ", so there's nothing to pay here. To change or cancel it, use " + where + ".";
  }
  function openPlans(){ planMsg = ""; drawPlans(); }
  function drawPlans(){
    var st = status(), p = purchases(), yearly = planPeriod === "yearly";
    var o = overlay("pfPlans");
    var noSale = noSaleNote(st);
    var cards = PLANS.map(function(pl){
      var current = st.tier === pl.id && (st.state === "active" || st.state === "grace");
      var price = p && p.priceFor ? p.priceFor(pl.id, planPeriod) : null;
      var shown = price ? esc(price) + ' <small>' + (yearly ? '/ year' : '/ month') + '</small>'
        : '£' + (yearly ? pl.yearly : pl.monthly) + ' <small>+ VAT ' + (yearly ? '/ year' : '/ month') + '</small>';
      return '<div class="pf-plan' + (current ? ' current' : '') + '">' + (pl.popular ? '<span class="pf-popular">Most popular</span>' : '') +
        '<div class="pf-pname">' + pl.name + (current ? '<span class="pf-tag">Your plan</span>' : '') + '</div>' +
        '<div class="pf-price">' + shown + '</div>' +
        (yearly ? '<div class="pf-meta" style="font-size:13px;color:var(--pf-muted)">2 months free</div>' : '') +
        '<ul><li>Use on up to <b>' + pl.devices + '</b> devices</li><li>Unlimited quotes &amp; jobs</li><li>Payment plans, calendar &amp; job finance</li></ul>' +
        (current ? '<button class="pf-btn pf-ghost" disabled>Current plan</button>'
          : noSale ? ''
          : '<button class="pf-btn" data-pf="buy" data-plan="' + pl.id + '" ' + (planBusy ? 'disabled' : '') + '>' +
            (st.state === "trial" || st.state === "lapsed" ? 'Choose ' + pl.name : 'Switch to ' + pl.name) + '</button>') +
        '</div>';
    }).join("");
    var webNote = noSale ? '<div class="pf-msg ok">' + esc(noSale) + '</div>'
      : (!p && st.state === "trial" && daysLeft(st.trialEnd) > 2) ? '<div class="pf-msg ok">Choose a plan now and you won\'t be charged until your free trial ends on ' + fmtDate(st.trialEnd) + '.</div>' : '';
    o.innerHTML = '<div class="pf-box pf-wide"><button class="pf-close" data-pf="close" aria-label="Close">×</button>' +
      '<div class="pf-brand">Infinity Landscape <b>Quote Pro</b></div><h1>Choose your plan</h1>' +
      '<p class="pf-sub">One subscription covers your whole business. Every plan has every feature — the difference is how many devices can be signed in at once.' +
      (st.state === "trial" ? ' Your free trial ends ' + fmtDate(st.trialEnd) + '.' : '') + '</p>' +
      (planMsg ? '<div class="pf-msg ' + (planMsg.ok ? 'ok' : 'err') + '">' + esc(planMsg.text) + '</div>' : '') + webNote +
      '<div class="pf-toggle"><button data-pf="period" data-period="monthly" class="' + (yearly ? '' : 'on') + '">Monthly</button>' +
      '<button data-pf="period" data-period="yearly" class="' + (yearly ? 'on' : '') + '">Yearly — 2 months free</button></div>' +
      '<div class="pf-plans">' + cards + '</div>' +
      (p && p.restore ? '<button class="pf-btn pf-ghost" data-pf="restore" style="margin-top:14px">Restore purchases</button>' : '') +
      '<p class="pf-fine">' + (p ? 'Payment is taken by ' + esc(p.storeName || 'your app store') + ' when you confirm. Subscriptions renew automatically until cancelled; you can cancel any time in your ' + esc(p.storeName || 'store') + ' account settings at least 24 hours before the renewal date. '
        : 'Prices exclude VAT, which is added at 20%. Payment is taken securely by Stripe — we never see your card details. Your subscription renews automatically; cancel any time from Account → Manage subscription and you keep access until the end of the period you\'ve paid for. You get a VAT invoice by email each time you pay. ') +
      'See the <a href="/terms" target="_blank" rel="noopener">terms</a> and <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p></div>';
    if (!o._wired) {
      o._wired = true;
      o.addEventListener("click", function(e){
        var b = e.target.closest("[data-pf]"); if (!b) return;
        var k = b.getAttribute("data-pf");
        if (k === "close") hide("pfPlans");
        else if (k === "period") { planPeriod = b.getAttribute("data-period"); drawPlans(); }
        else if (k === "buy") buy(b.getAttribute("data-plan"));
        else if (k === "restore") restore();
      });
    }
  }
  function buy(planId){
    var p = purchases();
    var ns = noSaleNote(status());
    if (ns) { planMsg = { ok:true, text:ns }; return drawPlans(); }
    if (!p) return webBilling("checkout", { plan: planId, period: planPeriod });
    planBusy = true; drawPlans();
    Promise.resolve(p.purchase(planId, planPeriod)).then(function(r){
      planMsg = r && r.cancelled ? "" : { ok:true, text:"Thanks — your " + planOf(planId).name + " plan is active." };
    }).catch(function(e){ planMsg = { ok:false, text:"The purchase didn't go through: " + ((e && e.message) || "please try again") + "." }; })
      .then(function(){ planBusy = false; drawPlans(); });
  }
  function restore(){
    var p = purchases(); if (!p || !p.restore) return;
    planBusy = true; drawPlans();
    Promise.resolve(p.restore()).then(function(){ planMsg = { ok:true, text:"Purchases restored." }; })
      .catch(function(e){ planMsg = { ok:false, text:"Couldn't restore purchases: " + ((e && e.message) || "please try again") + "." }; })
      .then(function(){ planBusy = false; drawPlans(); });
  }
  /* Website payments (Stripe): our server makes a Stripe Checkout or customer-portal page for
     this account and we go there; Stripe brings the customer back to /?billing=… afterwards. */
  function webBilling(what, body){
    if (planBusy) return;
    planBusy = true; planMsg = ""; if (el("pfPlans") && el("pfPlans").style.display !== "none") drawPlans();
    var done = function(text){ planBusy = false; planMsg = text ? { ok:false, text:text } : ""; if (what === "portal" && text) { acctMsg = { kind:"err", text:text }; if (el("pfAccount") && el("pfAccount").style.display !== "none") drawAccount(); } if (el("pfPlans") && el("pfPlans").style.display !== "none") drawPlans(); };
    if (!navigator.onLine) return done("You're offline — connect to the internet to subscribe or manage your plan.");
    user.getIdToken().then(function(tok){
      return fetch("/api/" + what, { method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + tok }, body: JSON.stringify(Object.assign({ origin: location.origin }, body || {})) });
    }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(x){
        if (x.ok && x.j.url && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(x.j.url)) {
          location.href = x.j.url;
          // If the page is kept (back button, or the browser didn't leave), make the buttons usable again.
          setTimeout(function(){ planBusy = false; if (el("pfPlans") && el("pfPlans").style.display !== "none") drawPlans(); }, 4000);
          return;
        }
        done((x.j && x.j.error) || "Couldn't reach the payment page — please try again.");
      }).catch(function(){ done("Couldn't reach the payment page — check your connection and try again."); });
  }
  window.addEventListener("pageshow", function(e){ if (e.persisted && planBusy) { planBusy = false; if (el("pfPlans") && el("pfPlans").style.display !== "none") drawPlans(); } });
  // Back from Stripe: say what happened, then tidy the address bar.
  (function(){
    var b = params.get("billing"); if (!b) return;
    try { history.replaceState(null, "", location.pathname); } catch(e) {}
    var text = b === "success" ? "Thanks — your subscription is set up. It can take a few seconds to show here."
      : b === "updated" ? "Your plan has been changed." : b === "cancelled" ? "No payment was taken — choose a plan whenever you're ready." : "";
    // (after start-up has run, once the app is open)
    if (text) setTimeout(function(){ ready.then(function(){ planMsg = { ok:true, text:text }; drawPlans(); }); }, 0);
  })();
  function manageSubscription(){
    var p = purchases(), st = status();
    if (!inStoreApp() && st.store === "stripe") return webBilling("portal");
    if (p && p.manage && (!st.store || st.store === storeHere())) return p.manage();
    // Inside a phone app, a plan paid outside the app stores: acknowledge it, never link out.
    if (inStoreApp() && st.store && !isAppStoreBilling(st.store)) return openPlans();
    var url = st.store === "app_store" ? "https://apps.apple.com/account/subscriptions"
      : st.store === "play_store" ? "https://play.google.com/store/account/subscriptions" : null;
    if (url) window.open(url, "_blank", "noopener"); else openPlans();
  }

  /* ======================================================================
     Account panel: plan, devices, download data, delete account, sign out
     ====================================================================== */
  var acctMsg = null, acctBusy = false;
  function openAccount(){ acctMsg = null; drawAccount(); }
  function statusLine(st){
    if (st.state === "free") return "Free account (no subscription needed)";
    if (st.state === "trial") return "Free trial — ends " + fmtDate(st.trialEnd) + " (" + daysLeft(st.trialEnd) + " days left)";
    if (st.state === "active") return (st.plan ? st.plan.name : "Paid") + " plan" + (st.period ? " (" + st.period + ")" : "") + " — " + (st.cancelled ? "ends " : "renews ") + fmtDate(st.periodEnd);
    if (st.state === "grace") return (st.plan ? st.plan.name + " plan — " : "") + "payment problem, please update by " + fmtDate(st.graceUntil);
    return "Not subscribed — the app is read-only";
  }
  function drawAccount(){
    var st = status(), list = deviceList(), left = swapsLeft();
    var o = overlay("pfAccount");
    var devRows = list.map(function(d){
      var me = d.id === myDevice;
      return '<div class="pf-row"><div class="pf-grow"><div class="pf-name">' + esc(d.name) + (me ? '<span class="pf-tag">This device</span>' : '') + '</div>' +
        '<div class="pf-meta">' + (d.lastSeen ? 'Last used ' + fmtDate(d.lastSeen) : '') + '</div></div>' +
        (me ? '' : left > 0 ? '<button class="pf-btn pf-small pf-ghost" data-pf="remove" data-id="' + esc(d.id) + '">Remove</button>' : '') + '</div>';
    }).join("");
    o.innerHTML = '<div class="pf-box"><button class="pf-close" data-pf="close" aria-label="Close">×</button>' +
      '<div class="pf-brand">Infinity Landscape <b>Quote Pro</b></div><h1>Account</h1>' +
      '<p class="pf-sub">Signed in as <b>' + esc(user ? user.email : "") + '</b></p>' +
      (acctMsg ? '<div class="pf-msg ' + acctMsg.kind + '">' + esc(acctMsg.text) + '</div>' : '') +
      '<h2>Plan</h2><p class="pf-sub" style="margin-bottom:8px">' + esc(statusLine(st)) + '</p>' +
      (st.state === "free" ? '' : (st.state === "active" || st.state === "grace")
        ? ((inStoreApp() && st.store && !isAppStoreBilling(st.store)) ? '' : billedElsewhere(st)
            ? '<div class="pf-fine" style="margin:0 0 8px">' + esc(noSaleNote(st)) + '</div>'
            : '<button class="pf-btn pf-ghost" data-pf="manage">Manage subscription</button><button class="pf-btn pf-ghost" data-pf="plans">Change plan</button>')
        : '<button class="pf-btn" data-pf="plans">Choose a plan</button>') +
      '<h2>Devices (' + list.length + ' of ' + st.limit + ')</h2>' +
      '<div>' + (devRows || '<p class="pf-sub">No devices yet.</p>') + '</div>' +
      '<p class="pf-fine">Removing a device signs it out. You can remove ' + MAX_SWAPS + ' devices a month — ' + left + ' left this month' +
      (left > 0 ? '' : ' (you can again on ' + fmtDate(firstOfNextMonth()) + ')') + '. Changing your password signs out every other device.</p>' +
      '<h2>Your data</h2>' +
      '<button class="pf-btn pf-ghost" data-pf="export" ' + (acctBusy ? 'disabled' : '') + '>Download all my data</button>' +
      '<button class="pf-btn pf-ghost" data-pf="password">Change password</button>' +
      '<button class="pf-btn pf-ghost" data-pf="signout">Sign out of this device</button>' +
      '<h2>Delete account</h2><p class="pf-fine" style="margin-top:0">Permanently deletes your business settings, quotes, jobs, calendar and logo, and your login. This can\'t be undone. ' +
      'If you pay through the App Store or Google Play, cancel the subscription there too.</p>' +
      '<button class="pf-btn pf-danger" data-pf="delete">Delete my account…</button>' +
      '<p class="pf-fine">Help: <a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p></div>';
    if (!o._wired) {
      o._wired = true;
      o.addEventListener("click", function(e){
        var b = e.target.closest("[data-pf]"); if (!b) return;
        var k = b.getAttribute("data-pf");
        if (k === "close") hide("pfAccount");
        else if (k === "plans") openPlans();
        else if (k === "manage") manageSubscription();
        else if (k === "remove") removeDevice(b.getAttribute("data-id"));
        else if (k === "export") exportData();
        else if (k === "password") changePassword();
        else if (k === "signout") auth.signOut();
        else if (k === "delete") drawDelete();
      });
    }
  }
  function removeDevice(id){
    var d = deviceList().filter(function(x){ return x.id === id; })[0];
    if (!d) return;
    if (!window.confirm("Sign out \"" + d.name + "\"? This uses one of your " + MAX_SWAPS + " device swaps this month.")) return;
    var devs = plainDevices(); delete devs[id];
    writeDevices(devs, 1).then(function(){ acctMsg = { kind:"ok", text:"\"" + d.name + "\" has been signed out." }; })
      .catch(function(e){ acctMsg = { kind:"err", text:"Couldn't remove that device (" + ((e && e.code) || "error") + ")." }; })
      .then(drawAccount);
  }
  function changePassword(){
    auth.sendPasswordResetEmail(user.email).then(function(){
      acctMsg = { kind:"ok", text:"We've emailed " + user.email + " a link to choose a new password. Once changed, your other devices are signed out." };
    }).catch(function(e){ acctMsg = { kind:"err", text: errText(e) }; }).then(drawAccount);
  }

  /* ---------- Download all my data (JSON) ---------- */
  function collectData(){
    var base = fs.doc("businesses/" + user.uid);
    var out = { exportedAt: new Date().toISOString(), account: { email: user.email }, business: null };
    return base.get().then(function(s){
      out.business = s.exists ? dec(s.data()) : null;
      return Promise.all(BUSINESS_COLLECTIONS.map(function(c){
        return base.collection(c).get().then(function(qs){ out[c] = qs.docs.map(function(d){ return Object.assign({ id: d.id }, dec(d.data())); }); });
      }));
    }).then(function(){ return out; });
  }
  function exportData(){
    acctBusy = true; drawAccount();
    collectData().then(function(data){
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var name = "quote-pro-data-" + new Date().toISOString().slice(0,10) + ".json";
      if (window.__saveFile) return window.__saveFile(name, blob);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    }).then(function(){ acctMsg = { kind:"ok", text:"Your data has been downloaded as a file." }; })
      .catch(function(e){ acctMsg = { kind:"err", text:"Couldn't download your data (" + ((e && e.code) || (e && e.message) || "error") + ")." }; })
      .then(function(){ acctBusy = false; drawAccount(); });
  }

  /* ---------- Delete account ---------- */
  var delMsg = "", delBusy = false;
  function drawDelete(){
    var o = overlay("pfDelete", "pf-centre");
    o.innerHTML = '<div class="pf-box"><button class="pf-close" data-pf="close" aria-label="Close">×</button>' +
      '<h1>Delete your account?</h1><p class="pf-sub">This permanently deletes your business settings, every quote and job, your calendar, logo and login. It can\'t be undone — consider downloading your data first.</p>' +
      ((status().store === "stripe" && (status().state === "active" || status().state === "grace") && !status().cancelled && !inStoreApp())
        ? '<div class="pf-msg warn">You still have a subscription paid on the website. Cancel it first (Account → Manage subscription), or you\'ll keep being charged.</div>'
        : '<div class="pf-msg warn">If you subscribed through the App Store or Google Play, deleting your account does not cancel the subscription — cancel it in your store account settings.</div>') +
      (delMsg ? '<div class="pf-msg err">' + esc(delMsg) + '</div>' : '') +
      '<label>Type DELETE to confirm<input type="text" id="pfDelConfirm" autocomplete="off"></label>' +
      '<label>Your password<input type="password" id="pfDelPass" autocomplete="current-password"></label>' +
      '<button class="pf-btn pf-danger" data-pf="confirm" ' + (delBusy ? 'disabled' : '') + '>' + (delBusy ? 'Deleting…' : 'Permanently delete my account') + '</button>' +
      '<button class="pf-btn pf-ghost" data-pf="close">Keep my account</button></div>';
    if (!o._wired) {
      o._wired = true;
      o.addEventListener("click", function(e){
        var b = e.target.closest("[data-pf]"); if (!b) return;
        var k = b.getAttribute("data-pf");
        if (k === "close") { delMsg = ""; hide("pfDelete"); }
        else if (k === "confirm") deleteAccount();
      });
    }
  }
  function deleteAccount(){
    if (delBusy) return;
    var typed = ((el("pfDelConfirm") || {}).value || "").trim();
    var pass = (el("pfDelPass") || {}).value || "";
    if (typed !== "DELETE") { delMsg = "Type DELETE (in capitals) to confirm."; return drawDelete(); }
    if (!pass) { delMsg = "Enter your password to confirm it's you."; return drawDelete(); }
    delBusy = true; delMsg = ""; drawDelete();
    var cred = firebase.auth.EmailAuthProvider.credential(user.email, pass);
    var base = fs.doc("businesses/" + user.uid);
    user.reauthenticateWithCredential(cred).then(function(){
      return Promise.all(BUSINESS_COLLECTIONS.map(function(c){
        return base.collection(c).get().then(function(qs){ return Promise.all(qs.docs.map(function(d){ return d.ref.delete(); })); });
      }));
    }).then(function(){ return base.delete(); })
      .then(function(){ if (devicesUnsub) devicesUnsub(); devicesUnsub = null; return user.delete(); })
      .then(function(){
        try { sessionStorage.setItem("lqp_signout_msg", "Your account and all its data have been deleted."); } catch(e) {}
        location.reload();
      })
      .catch(function(e){ delBusy = false; delMsg = errText(e); drawDelete(); });
  }

  /* ======================================================================
     Start-up: sign in → account doc → device check → hand over to the app
     ====================================================================== */
  var resolveReady, ready = new Promise(function(r){ resolveReady = r; });
  var appStarted = false, acctUnsub = null;
  function startApp(){
    if (appStarted) return;
    appStarted = true;
    hide("authGate"); hide("pfDevices");
    resolveReady(user);
    refreshBanner();
    setInterval(refreshBanner, 60000);
  }
  function ensureAccount(){
    return acctRef().get().then(function(s){
      if (s.exists) return s.data();
      return acctRef().set({ createdAt: serverTime() }).then(function(){ return acctRef().get(); }).then(function(s2){ return s2.data(); });
    });
  }
  function afterSignIn(){
    ensureAccount().then(function(a){
      account = a;
      acctUnsub = acctRef().onSnapshot(function(s){
        var wasLapsed = account && status().state === "lapsed";
        account = s.data() || account;
        if (wasLapsed && status().entitled) failedSync = 0;
        refreshBanner();
        if (el("pfAccount") && el("pfAccount").style.display !== "none") drawAccount();
        if (el("pfPlans") && el("pfPlans").style.display !== "none") drawPlans();
        // A plan just started: re-render so the app is editable again.
        if (wasLapsed && status().entitled && window.__appRerender) window.__appRerender();
      }, function(){});
      return registerThisDevice();
    }).then(function(ok){
      watchDevices();
      if (ok) startApp(); else drawDevicePicker();
    }).catch(function(e){
      // No signal on a device already set up: let the app open from its local copy.
      if (e && (e.code === "unavailable" || e.code === "failed-precondition")) { watchDevices(); startApp(); return; }
      msg = "Couldn't open your account (" + ((e && e.code) || "error") + "). Please try again."; msgKind = "err";
      auth.signOut();
    });
  }
  auth.onAuthStateChanged(function(u){
    if (u) {
      if (user && user.uid === u.uid) return;
      if (user) { location.reload(); return; }
      user = u;
      hide("authGate");
      afterSignIn();
    } else {
      if (user) { location.reload(); return; }
      drawGate();
    }
  });

  /* ======================================================================
     What the app sees
     ====================================================================== */
  window.__platform = {
    email: function(){ return user ? user.email : ""; },
    signOut: function(){ return auth.signOut(); },
    readOnly: function(){ return appStarted && account != null && !status().entitled; },
    explainReadOnly: function(){
      if (window.confirm("Your " + (account && account.periodEnd ? "subscription" : "free trial") + " has ended, so the app is read-only — you can still view, download and print your quotes.\n\nChoose a plan to carry on creating and editing quotes?")) openPlans();
    },
    openAccount: openAccount,
    openPlans: openPlans,
    status: status,
  };
  window.claude = {
    use: function(name){
      if (name === "db") return ready.then(function(){ return dbApi; });
      if (name === "user") return ready.then(function(u){ return { id: function(){ return Promise.resolve(u.uid); }, me: function(){ return Promise.resolve({ id: u.uid, email: u.email }); } }; });
      return Promise.resolve(null);
    },
  };
})();

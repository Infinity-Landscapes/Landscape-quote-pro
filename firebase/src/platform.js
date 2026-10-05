/* Infinity Landscape Quote Pro — own-website platform layer (Firebase).
 *
 * The app itself (app.html) is written against a tiny storage/identity API:
 *   claude.use("db")   -> doc(path).get/set/update/delete, doc.collection(name), collection.orderBy/limit/get
 *   claude.use("user") -> { id() }
 * On claude.ai that API is provided by the artifact runtime. Here the same API is provided by
 * Firebase Auth + Cloud Firestore, so the app's code is identical in both places.
 *
 * Differences handled here:
 *  - Each business lives at businesses/{uid} (the app asks for data/users/{uid}/business).
 *  - Firestore can't store an array directly inside another array, so nested arrays are wrapped
 *    as {__arr:[...]} on the way in and unwrapped on the way out.
 *  - Nothing is reachable until someone signs in: this file shows the sign-in screen first.
 */
(function(){
  "use strict";
  var cfg = window.__FIREBASE_CONFIG__;
  var app = firebase.initializeApp(cfg);
  var auth = firebase.auth();
  var fs = firebase.firestore();
  fs.settings({ ignoreUndefinedProperties: true, merge: true });
  var params = new URLSearchParams(location.search);
  var useEmu = params.get("emulator") === "1" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && params.get("emulator") !== "0";
  if (useEmu) {
    auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
    fs.useEmulator("127.0.0.1", 8080);
  }

  /* ---------- nested-array encoding ---------- */
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

  /* ---------- the db API the app expects ---------- */
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
      set: function(data){ return ref.set(enc(data)); },
      update: function(data){ return ref.update(enc(data)); },
      delete: function(){ return ref.delete(); },
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

  /* ---------- sign-in screen ---------- */
  var signedIn = null, resolveReady;
  var ready = new Promise(function(r){ resolveReady = r; });
  var mode = "signin", busy = false, msg = "", msgOk = false;
  var gate;
  function esc(t){ return String(t==null?"":t).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
  function errText(e){
    var c = (e && e.code) || "";
    if (c === "auth/invalid-email") return "That email address doesn't look right.";
    if (c === "auth/missing-password") return "Enter your password.";
    if (c === "auth/weak-password") return "Choose a password of at least 8 characters.";
    if (c === "auth/email-already-in-use") return "There's already an account with that email — sign in instead.";
    if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-login-credentials") return "That email and password don't match. Try again, or reset your password.";
    if (c === "auth/too-many-requests") return "Too many attempts — wait a few minutes, or reset your password.";
    if (c === "auth/network-request-failed") return "No internet connection — check your signal and try again.";
    return "Something went wrong (" + (c || (e && e.message) || "unknown") + "). Please try again.";
  }
  function drawGate(){
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "authGate";
      document.body.appendChild(gate);
      gate.addEventListener("submit", function(e){ e.preventDefault(); submit(); });
      gate.addEventListener("click", function(e){
        var a = e.target.closest("[data-auth]"); if (!a) return; e.preventDefault();
        var k = a.getAttribute("data-auth");
        if (k === "signin" || k === "signup" || k === "reset") { mode = k; msg = ""; drawGate(); }
      });
    }
    var title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in";
    var sub = mode === "signup" ? "Start your free 7-day trial. One account per business." : mode === "reset" ? "We'll email you a link to choose a new password." : "Welcome back.";
    gate.innerHTML =
      '<div class="ag-box"><div class="ag-brand">Infinity Landscape <b>Quote Pro</b></div>' +
      '<h1>' + title + '</h1><p class="ag-sub">' + sub + '</p>' +
      (msg ? '<div class="ag-msg ' + (msgOk ? 'ok' : 'err') + '">' + esc(msg) + '</div>' : '') +
      '<form novalidate>' +
      '<label>Email<input id="agEmail" type="email" autocomplete="email" required></label>' +
      (mode !== "reset" ? '<label>Password<input id="agPass" type="password" autocomplete="' + (mode === "signup" ? "new-password" : "current-password") + '" required></label>' : '') +
      (mode === "signup" ? '<label>Confirm password<input id="agPass2" type="password" autocomplete="new-password" required></label>' : '') +
      '<button type="submit" class="ag-btn" ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Please wait…' : mode === "signup" ? 'Create account' : mode === "reset" ? 'Send reset link' : 'Sign in') + '</button>' +
      '</form><div class="ag-links">' +
      (mode === "signin" ? '<a href="#" data-auth="reset">Forgotten your password?</a><a href="#" data-auth="signup">New here? Create an account</a>' :
       '<a href="#" data-auth="signin">Back to sign in</a>') +
      '</div></div>';
    gate.style.display = "flex";
    var em = document.getElementById("agEmail"); if (em) { em.value = drawGate._email || ""; em.focus(); }
  }
  function submit(){
    if (busy) return;
    var email = (document.getElementById("agEmail") || {}).value || "";
    drawGate._email = email.trim();
    var pass = (document.getElementById("agPass") || {}).value || "";
    var pass2 = (document.getElementById("agPass2") || {}).value || "";
    msg = ""; msgOk = false;
    if (!email.trim()) { msg = "Enter your email address."; return drawGate(); }
    if (mode === "signup") {
      if (pass.length < 8) { msg = "Choose a password of at least 8 characters."; return drawGate(); }
      if (pass !== pass2) { msg = "The two passwords don't match."; return drawGate(); }
    }
    busy = true; drawGate();
    var p = mode === "signup" ? auth.createUserWithEmailAndPassword(email.trim(), pass).then(function(c){ try { c.user.sendEmailVerification(); } catch(e){} })
          : mode === "reset" ? auth.sendPasswordResetEmail(email.trim()).then(function(){ msg = "If there's an account for that email, a reset link is on its way."; msgOk = true; mode = "signin"; })
          : auth.signInWithEmailAndPassword(email.trim(), pass);
    p.catch(function(e){
      // A reset request never reveals whether the email has an account.
      if (mode === "reset" && e && e.code === "auth/user-not-found") { msg = "If there's an account for that email, a reset link is on its way."; msgOk = true; mode = "signin"; }
      else { msg = errText(e); msgOk = false; }
    }).then(function(){ busy = false; if (!signedIn) drawGate(); });
  }

  auth.onAuthStateChanged(function(u){
    if (u) {
      var first = !signedIn;
      signedIn = u;
      if (gate) gate.style.display = "none";
      resolveReady(u);
      if (!first) location.reload();
    } else {
      if (signedIn) { location.reload(); return; }
      drawGate();
    }
  });

  window.__platform = {
    email: function(){ return signedIn ? signedIn.email : ""; },
    signOut: function(){ return auth.signOut(); },
  };
  window.claude = {
    use: function(name){
      if (name === "db") return ready.then(function(){ return dbApi; });
      if (name === "user") return ready.then(function(u){ return { id: function(){ return Promise.resolve(u.uid); }, me: function(){ return Promise.resolve({ id: u.uid, email: u.email }); } }; });
      return Promise.resolve(null);
    },
  };
})();

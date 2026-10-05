window.__NO_AUTO_TOUR__ = true; // the first-login walkthrough is tested on its own in test_tour.js
// Mock "db" capability backed by localStorage so it survives a page reload,
// mimicking the real artifact db capability's persistence + merge semantics
// (recursive merge for update(), full replace for set()) closely enough to
// test resume-after-reload behavior locally.
(function(){
  const LS_KEY = '__mockdb__';
  function loadStore(){
    try{ return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }catch(e){ return {}; }
  }
  function saveStore(store){
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  }
  function deepMerge(target, src){
    if(target===null || typeof target!=='object' || Array.isArray(target)) target = {};
    for(const k of Object.keys(src)){
      const sv = src[k];
      if(sv && typeof sv==='object' && !Array.isArray(sv)){
        target[k] = deepMerge(target[k] && typeof target[k]==='object' ? target[k] : {}, sv);
      } else {
        target[k] = sv;
      }
    }
    return target;
  }
  // The real store takes plain-JSON bodies only — reject Date objects (and other non-plain
  // objects) the way it does, so a write that would fail live fails here too.
  function assertPlain(v, at){
    if(v instanceof Date) throw {code:'invalid_argument', message:'non-JSON value (Date) at '+at};
    if(v && typeof v==='object'){
      const proto = Object.getPrototypeOf(v);
      if(!Array.isArray(v) && proto!==Object.prototype && proto!==null) throw {code:'invalid_argument', message:'non-plain object at '+at};
      for(const k of Object.keys(v)) assertPlain(v[k], at+'.'+k);
    }
    if(typeof v==='number' && !isFinite(v)) throw {code:'invalid_argument', message:'non-finite number at '+at};
  }
  function docRef(path){
    return {
      async get(){
        const store = loadStore();
        const data = store[path];
        return { exists: data !== undefined, data: () => data===undefined?undefined:JSON.parse(JSON.stringify(data)) };
      },
      async set(data){
        if(window.__failWrites) throw {code:'unavailable', message:'simulated failure'};
        assertPlain(data, path);
        const store = loadStore();
        store[path] = JSON.parse(JSON.stringify(data));
        saveStore(store);
      },
      async update(data){
        if(window.__failWrites) throw {code:'unavailable', message:'simulated failure'};
        assertPlain(data, path);
        const store = loadStore();
        if(store[path]===undefined) throw {code:'invalid_argument', message:'doc does not exist'};
        store[path] = deepMerge(store[path], JSON.parse(JSON.stringify(data)));
        saveStore(store);
      },
      async delete(){
        const store = loadStore();
        delete store[path];
        saveStore(store);
      },
      collection(name){ return collectionRef(path + '/' + name); }
    };
  }
  function collectionRef(base){
    return {
      doc(id){ return docRef(base + '/' + id); },
      orderBy(field, dir){
        return {
          limit(n){
            return {
              async get(){
                const store = loadStore();
                const prefix = base + '/';
                let docs = Object.keys(store).filter(k=>k.startsWith(prefix)).map(k=>({ id: k.slice(prefix.length), data: ()=>JSON.parse(JSON.stringify(store[k])) }));
                docs.sort((a,b)=>{
                  const av = a.data()[field], bv = b.data()[field];
                  if(av===bv) return 0;
                  const cmp = av < bv ? -1 : 1;
                  return dir==='desc' ? -cmp : cmp;
                });
                return { docs: docs.slice(0, n) };
              }
            };
          }
        };
      }
    };
  }
  window.claude = window.claude || {};
  // Tests set window.__mockUid__ before the app's loadAll() runs to simulate
  // a particular signed-in viewer. Defaults to a stable id so existing
  // single-tenant tests (which never set this) keep behaving exactly as
  // before — same uid every run, same as "the one real business".
  if(window.__mockUid__ === undefined) window.__mockUid__ = 'u_matt_test';
  window.claude.use = async function(capability){
    if(capability==='db'){
      return {
        doc: (path)=>docRef(path),
        collection: (path)=>collectionRef(path),
      };
    }
    if(capability==='downloads'){
      return { save: async ()=>{} };
    }
    if(capability==='user'){
      return {
        id: async ()=> window.__mockUid__,
        isOwner: async ()=> true,
        canEdit: async ()=> true,
        can: async ()=> null,
        me: async ()=> ({ id: window.__mockUid__, name:'', avatarUrl:'', color:'#888', email:null, isOwner:true, canEdit:true }),
        profiles: async ()=> ({}),
      };
    }
    throw new Error('capability not mocked: ' + capability);
  };
})();

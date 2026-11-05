// Local storage on the phone (IndexedDB): journal entries + a cache for AI model files.
const DB_NAME = 'little-stuff';
const VERSION = 1;
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('modelcache')) db.createObjectStore('modelcache');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let out;
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const entries = {
  all: () => run('entries', 'readonly', (s) => s.getAll()),
  put: (e) => run('entries', 'readwrite', (s) => s.put(e)),
  remove: (id) => run('entries', 'readwrite', (s) => s.delete(id)),
};

// transformers.js normally caches models with the Cache API, which only exists on https.
// On plain http (iPhone opening the Mac over Wi-Fi) we cache in IndexedDB instead,
// so the ~150 MB of models download only once.
const keyOf = (req) => (typeof req === 'string' ? req : req.url);
export const modelCache = {
  async match(req) {
    const v = await run('modelcache', 'readonly', (s) => s.get(keyOf(req)));
    if (!v) return undefined;
    return new Response(v.blob, { headers: { 'content-type': v.type, 'content-length': String(v.blob.size) } });
  },
  async put(req, resp) {
    const blob = await resp.blob();
    await run('modelcache', 'readwrite', (s) => s.put({ blob, type: resp.headers.get('content-type') || '' }, keyOf(req)));
  },
};

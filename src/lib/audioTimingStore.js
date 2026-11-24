// A separate append-only diagnostic store avoids rewriting configuration or audio.
const DB_NAME = 'heartbeat-timing-v2';
const STORE = 'events';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 50000;

function request(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function done(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Timing storage transaction aborted')); });
}
export function createAudioTimingStore({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  let database;
  async function open() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('Timing storage unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); store.createIndex('atMs', 'atMs'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Timing storage unavailable'));
      req.onblocked = () => reject(new Error('Timing storage is blocked'));
    }).catch((error) => { database = null; throw error; });
    return database;
  }
  function prune(store) {
    const old = store.index('atMs').openKeyCursor(globalThis.IDBKeyRange.upperBound(now() - RETENTION_MS, true));
    old.onsuccess = () => { const cursor = old.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } else {
      const count = store.count(); count.onsuccess = () => { let excess = Math.max(0, count.result - MAX_RECORDS); if (!excess) return; const first = store.openCursor(); first.onsuccess = () => { const c = first.result; if (c && excess > 0) { c.delete(); excess--; c.continue(); } }; };
    } };
  }
  return {
    async append(event) { const db = await open(); const tx = db.transaction(STORE, 'readwrite'); const completed = done(tx); const store = tx.objectStore(STORE); store.add(event); prune(store); await completed; },
    async prune() { const db = await open(); const tx = db.transaction(STORE, 'readwrite'); const completed = done(tx); prune(tx.objectStore(STORE)); await completed; },
    async list(limit) {
      const db = await open(); const tx = db.transaction(STORE, 'readonly'); const completed = done(tx); const store = tx.objectStore(STORE);
      if (!limit) { const values = await request(store.getAll()); await completed; return values; }
      const values = []; const cursor = store.openCursor(null, 'prev');
      cursor.onsuccess = () => { const c = cursor.result; if (c && values.length < limit) { values.push(c.value); c.continue(); } };
      await completed; return values.reverse();
    },
    async clear() { const db = await open(); const tx = db.transaction(STORE, 'readwrite'); const completed = done(tx); tx.objectStore(STORE).clear(); await completed; }
  };
}

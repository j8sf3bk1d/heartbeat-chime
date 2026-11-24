export const AUDIO_DB_NAME = "heartbeat-audio-v1";
export const AUDIO_DB_VERSION = 2;
export const PACK_STORE = "packs";
export const PRESET_STORE = "presets";
export const PROFILE_STORE = "profiles";
export const ASSET_STORE = "assets";

export function isIndexedDbAvailable() {
  return "indexedDB" in window;
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function ensureIndexedDb() {
  if (!isIndexedDbAvailable()) {
    throw new Error("IndexedDB is unavailable in this browser.");
  }
}

export async function openAudioDb() {
  ensureIndexedDb();
  const openReq = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
  openReq.onupgradeneeded = () => {
    const db = openReq.result;

    if (!db.objectStoreNames.contains(PACK_STORE)) {
      db.createObjectStore(PACK_STORE, { keyPath: "id" });
    }

    let presetStore = null;
    if (!db.objectStoreNames.contains(PRESET_STORE)) {
      presetStore = db.createObjectStore(PRESET_STORE, { keyPath: "id" });
      presetStore.createIndex("packId", "packId", { unique: false });
    } else {
      presetStore = openReq.transaction.objectStore(PRESET_STORE);
      if (!presetStore.indexNames.contains("packId")) {
        presetStore.createIndex("packId", "packId", { unique: false });
      }
    }
    if (presetStore && !presetStore.indexNames.contains("assetId")) {
      presetStore.createIndex("assetId", "assetId", { unique: false });
    }

    if (!db.objectStoreNames.contains(PROFILE_STORE)) {
      const profileStore = db.createObjectStore(PROFILE_STORE, { keyPath: "id" });
      profileStore.createIndex("packId", "packId", { unique: false });
    } else {
      const profileStore = openReq.transaction.objectStore(PROFILE_STORE);
      if (!profileStore.indexNames.contains("packId")) {
        profileStore.createIndex("packId", "packId", { unique: false });
      }
    }

    let assetStore = null;
    if (!db.objectStoreNames.contains(ASSET_STORE)) {
      assetStore = db.createObjectStore(ASSET_STORE, { keyPath: "id" });
    } else {
      assetStore = openReq.transaction.objectStore(ASSET_STORE);
    }
    if (assetStore && !assetStore.indexNames.contains("hash")) {
      assetStore.createIndex("hash", "hash", { unique: true });
    }
  };
  return requestToPromise(openReq);
}

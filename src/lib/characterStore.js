import { validateCharacterPack } from "./characterPack.js";

const DB = "heartbeat-characters-v1";
const STORE = "packs";
const SELECTED = "heartbeat.character.selected.v1";
export const CHARACTER_REVISION_KEY = "heartbeat.character.revision.v1";
const MAX_FILE = 64 * 1024 * 1024;
const request = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || new Error("Character storage failed.")); });

async function openDb() {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, {keyPath:"id"}); };
  return request(req);
}
async function transact(mode, operation) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const done = new Promise((resolve,reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("Character storage failed.")); });
    done.catch(() => {});
    const result = await request(operation(tx.objectStore(STORE)));
    await done; return result;
  } finally { db.close(); }
}
export async function listCharacterPacks() { return (await transact("readonly", store => store.getAll())).map(({id,pack}) => ({id,name:pack.name})); }
export async function readCharacterLibrary() { return transact("readonly", store => store.getAll()); }
export async function getCharacterPack(id) { if (!/^character:[a-f0-9-]{36}$/.test(id || "")) return null; return (await transact("readonly", store => store.get(id)))?.pack || null; }
export async function validateCharacterImages(pack) {
  for (const frame of Object.values(pack.frames)) for (const data of Object.values(frame)) {
    await new Promise((resolve,reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error("A character image could not be decoded.")); image.src = data; });
  }
}
// Restores are additive. Always assign fresh IDs so no existing character is
// overwritten and the selected ID can be remapped unambiguously.
export async function restoreCharacterLibrary(characters) {
  if (!characters) return null; // Version 1 has no character selection.
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = new Promise((resolve,reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("Character restore failed.")); });
    done.catch(() => {});
    const map = new Map();
    try {
      for (const record of characters.packs) {
        if (!crypto.randomUUID) throw new Error("Secure character IDs are unavailable.");
        const id = `character:${crypto.randomUUID()}`;
        map.set(record.id, id); tx.objectStore(STORE).add({id,pack:record.pack});
      }
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
    await done;
    return characters.selectedId === "builtin" ? "builtin" : map.get(characters.selectedId);
  } finally { db.close(); }
}
async function readValidatedCharacterFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size > MAX_FILE) throw new Error("Character pack is missing or exceeds 64 MiB.");
  let raw; try { raw = JSON.parse(await file.text()); } catch { throw new Error("Character pack is not valid JSON."); }
  const pack = validateCharacterPack(raw);
  // Decode before writing: invalid or damaged files cannot replace any data.
  await validateCharacterImages(pack);
  return pack;
}
export async function importCharacterPack(file) {
  const pack = await readValidatedCharacterFile(file);
  if (!crypto.randomUUID) throw new Error("Secure character IDs are unavailable.");
  const id = `character:${crypto.randomUUID()}`;
  await transact("readwrite", store => store.add({id,pack}));
  return {id,name:pack.name};
}
// Validate before opening a single transaction, then replace only an existing
// record. The stable ID keeps selection and backup references intact.
export async function replaceCharacterPack(id, file) {
  if (!/^character:[a-f0-9-]{36}$/.test(id || "")) throw new Error("Select an imported character to update.");
  const pack = await readValidatedCharacterFile(file);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("Character storage failed.")); });
    done.catch(() => {});
    const store = tx.objectStore(STORE);
    const existing = await request(store.get(id));
    if (!existing) { tx.abort(); await done.catch(() => {}); throw new Error("The selected character no longer exists."); }
    await request(store.put({id, pack}));
    await done;
  } finally { db.close(); }
  // This lightweight cross-window signal also lets the overlay detect a missed
  // storage event when a cue arrives. The pack itself stays in IndexedDB.
  let refreshSignaled = true;
  try { localStorage.setItem(CHARACTER_REVISION_KEY, crypto.randomUUID()); }
  catch { refreshSignaled = false; }
  return {id, name: pack.name, refreshSignaled};
}
export function selectedCharacter() { try { const id = localStorage.getItem(SELECTED); return /^character:[a-f0-9-]{36}$/.test(id || "") ? id : "builtin"; } catch { return "builtin"; } }
export function selectedCharacterForBackup() {
  const id = localStorage.getItem(SELECTED);
  if (id === null || id === "builtin") return "builtin";
  if (!/^character:[a-f0-9-]{36}$/.test(id)) throw new Error("The saved character selection is invalid.");
  return id;
}
export function selectCharacter(id) {
  if (id !== "builtin" && !/^character:[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid character selection.");
  localStorage.setItem(SELECTED, id);
}

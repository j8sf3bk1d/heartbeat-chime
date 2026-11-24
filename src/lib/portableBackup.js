import { ASSET_STORE, PACK_STORE, PRESET_STORE, PROFILE_STORE, openAudioDb, requestToPromise, txDone } from "./audioStoreDb.js";
import { serializeState } from "./stateSerializer.js";
import { readCharacterLibrary, selectedCharacterForBackup, validateCharacterImages } from "./characterStore.js";
import { validateCharacterPack } from "./characterPack.js";

const FORMAT = "heartbeat-portable-backup";
const VERSION = 2;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CHARACTER_BYTES = 128 * 1024 * 1024;
const MAX_CHARACTERS = 64;
const MAX_RECORDS = 10000;
const STORES = [PACK_STORE, PRESET_STORE, PROFILE_STORE, ASSET_STORE];

function fail(message) { throw new Error(message); }
function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function randomId() {
  if (!globalThis.crypto?.getRandomValues) fail("Secure randomness is unavailable; the backup cannot be restored safely.");
  return [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
async function digest(blob) {
  if (!globalThis.crypto?.subtle) fail("Secure hashing is unavailable; use Heartbeat in a secure context.");
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function encodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function decodeBytes(value) {
  if (typeof value !== "string" || value.length % 4 !== 0) fail("Invalid audio encoding in backup.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding)) || (padding && value.length < 4)) fail("Invalid audio encoding in backup.");
  let binary;
  try { binary = atob(value); } catch { fail("Invalid audio encoding in backup."); }
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return result;
}
function validateRecords(name, records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail(`Invalid ${name} in backup.`);
  const ids = new Set();
  for (const record of records) {
    if (!object(record) || !validId(record.id) || ids.has(record.id)) fail(`Invalid or duplicate ${name} ID in backup.`);
    ids.add(record.id);
  }
  return ids;
}
function validText(value, optional = false) {
  return (optional && (value === undefined || value === null)) || (typeof value === "string" && value.length <= 16384);
}
function checkCustomReferences(state, presetIds, profileIds) {
  if (!object(state) || !Array.isArray(state.intervals) || !Array.isArray(state.oneShots) || state.intervals.length > 128 || state.oneShots.length > MAX_RECORDS) fail("Invalid settings in backup.");
  const intervalIds = new Set();
  for (const cue of state.intervals) {
    if (!object(cue) || !["interval-1", "interval-5", "interval-10", "interval-15", "interval-30", "interval-60"].includes(cue.id) || intervalIds.has(cue.id)) fail("Unknown or duplicate chime in backup.");
    intervalIds.add(cue.id);
  }
  const timerIds = new Set();
  for (const timer of state.oneShots) {
    if (!object(timer) || !validId(timer.id) || timerIds.has(timer.id) || !Number.isFinite(timer.targetAtMs) || !validText(timer.label, true)) fail("Invalid or duplicate timer in backup.");
    timerIds.add(timer.id);
  }
  const requirePreset = (id) => {
    if (typeof id === "string" && id.startsWith("custom:") && !presetIds.has(id)) fail(`Backup is missing assigned sound: ${id}`);
  };
  for (const cue of [...state.intervals, ...state.oneShots]) {
    if (!object(cue) || !validId(cue.id) || (cue.presetId !== undefined && !validId(cue.presetId)) || (cue.presetIds !== undefined && (!Array.isArray(cue.presetIds) || cue.presetIds.length > MAX_RECORDS || cue.presetIds.some((id) => !validId(id)))) || (cue.presetWeights !== undefined && !object(cue.presetWeights))) fail("Invalid timer or chime in backup.");
    requirePreset(cue.presetId);
    if (Array.isArray(cue.presetIds)) cue.presetIds.forEach(requirePreset);
    if (object(cue.presetWeights)) {
      for (const [id, weight] of Object.entries(cue.presetWeights)) {
        if (!validId(id) || !Number.isFinite(weight) || weight <= 0) fail("Invalid sound weight in backup.");
        requirePreset(id);
      }
    }
  }
  if (state.soundIntervalTags !== undefined && !object(state.soundIntervalTags)) fail("Invalid sound tags in backup.");
  if (object(state.soundIntervalTags)) {
    for (const [id, tags] of Object.entries(state.soundIntervalTags)) {
      if (!validId(id) || !Array.isArray(tags) || tags.length > 10080 || tags.some((tag) => !Number.isInteger(tag) || tag < 1 || tag > 10080)) fail("Invalid sound tags in backup.");
      requirePreset(id);
    }
  }
  if (typeof state.selectedProfileId === "string" && state.selectedProfileId.startsWith("custom:") && !profileIds.has(state.selectedProfileId)) fail("Backup is missing its selected sound profile.");
}
function validateStructure(data) {
  if (!object(data) || data.format !== FORMAT || ![1, VERSION].includes(data.version) || !object(data.library)) fail("This is not a supported Heartbeat portable backup.");
  const { packs, presets, profiles, assets } = data.library;
  const packIds = validateRecords("pack", packs);
  const presetIds = validateRecords("sound", presets);
  const profileIds = validateRecords("profile", profiles);
  const assetIds = validateRecords("audio", assets);
  for (const pack of packs) {
    if (!validText(pack.label) || !validText(pack.description, true) || (pack.importedAtMs !== undefined && !Number.isFinite(pack.importedAtMs))) fail(`Invalid metadata for pack ${pack.id}.`);
  }
  for (const preset of presets) {
    if (!packIds.has(preset.packId) || !preset.id.startsWith(`custom:${preset.packId}:`) || !assetIds.has(preset.assetId) || !validText(preset.label) || !validText(preset.description, true) || !validText(preset.sourceFileName, true) || (preset.tags !== undefined && (!Array.isArray(preset.tags) || preset.tags.length > 1000 || preset.tags.some((tag) => !validText(tag))))) fail(`Invalid metadata, pack or audio for sound ${preset.id}.`);
  }
  for (const profile of profiles) {
    if (!packIds.has(profile.packId) || !profile.id.startsWith(`custom:${profile.packId}:`) || !validText(profile.label) || !validText(profile.description, true) || (profile.intervalPresetByMinutes !== undefined && !object(profile.intervalPresetByMinutes))) fail(`Invalid metadata or pack for profile ${profile.id}.`);
    const refs = [profile.relativeDefaultPresetId, profile.absoluteDefaultPresetId, ...Object.values(object(profile.intervalPresetByMinutes) ? profile.intervalPresetByMinutes : {})];
    if (refs.some((id) => typeof id !== "string" || !presetIds.has(id))) fail(`Missing sound in profile ${profile.id}.`);
  }
  checkCustomReferences(data.state, presetIds, profileIds);
  if (data.version === 2) {
    const characters = data.characters;
    if (!object(characters) || !Array.isArray(characters.packs) || characters.packs.length > MAX_CHARACTERS) fail("Invalid character library in backup.");
    const ids = new Set();
    for (const record of characters.packs) {
      if (!object(record) || typeof record.id !== "string" || !/^character:[a-f0-9-]{36}$/.test(record.id) || ids.has(record.id) || !/^[a-f0-9]{64}$/.test(record.sha256 || "")) fail("Invalid character record in backup.");
      ids.add(record.id);
    }
    if (characters.selectedId !== "builtin" && !ids.has(characters.selectedId)) fail("Backup is missing its selected character.");
  }
}
async function readRecords() {
  const db = await openAudioDb();
  try {
    const tx = db.transaction(STORES, "readonly");
    const done = txDone(tx);
    const [packs, presets, profiles, assets] = await Promise.all(STORES.map((name) => requestToPromise(tx.objectStore(name).getAll())));
    await done;
    return { packs, presets, profiles, assets };
  } finally { db.close(); }
}

export async function createPortableBackup(state) {
  const library = await readRecords();
  const characterRecords = await readCharacterLibrary();
  if (characterRecords.length > MAX_CHARACTERS) fail("Too many character packs to back up.");
  const characterPacks = [];
  let characterBytes = 0;
  for (const record of characterRecords) {
    const pack = validateCharacterPack(record.pack);
    await validateCharacterImages(pack);
    const blob = new Blob([JSON.stringify(pack)], {type:"application/json"});
    characterBytes += blob.size;
    if (characterBytes > MAX_CHARACTER_BYTES) fail("Character packs exceed the 128 MiB backup limit.");
    characterPacks.push({id:record.id,pack,sha256:await digest(blob)});
  }
  const characters = {packs:characterPacks,selectedId:selectedCharacterForBackup()};
  // Old stores may contain audio inline on presets instead of in assets.
  const assets = new Map(library.assets.map((asset) => [asset.id, asset]));
  const presets = library.presets.map((entry) => ({ ...entry }));
  for (const preset of presets) {
    if (!preset.assetId && preset.blob instanceof Blob) {
      const id = `legacy:${randomId()}`;
      assets.set(id, { id, blob: preset.blob, mimeType: preset.blob.type, byteSize: preset.blob.size });
      preset.assetId = id;
    }
    delete preset.blob;
  }
  const used = new Set(presets.map((preset) => preset.assetId));
  const encodedAssets = [];
  let total = 0;
  for (const id of used) {
    const asset = assets.get(id);
    if (!asset || !(asset.blob instanceof Blob) || !asset.blob.size) fail(`Cannot create a complete backup: audio for ${id || "a sound"} is missing.`);
    total += asset.blob.size;
    if (total > MAX_AUDIO_BYTES) fail("Imported audio exceeds the 128 MiB backup limit.");
    encodedAssets.push({ id, mimeType: asset.blob.type || asset.mimeType || "application/octet-stream", byteSize: asset.blob.size, sha256: await digest(asset.blob), data: encodeBytes(new Uint8Array(await asset.blob.arrayBuffer())) });
  }
  const backup = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), state: serializeState(state), library: { packs: library.packs, presets, profiles: library.profiles, assets: encodedAssets }, characters };
  validateStructure(backup);
  // Match downloadJsonFile's pretty-printed JSON, including UTF-8 byte length.
  if (new Blob([JSON.stringify(backup, null, 2)]).size > MAX_FILE_BYTES) fail("Backup exceeds the 256 MiB file limit.");
  return backup;
}

export async function parsePortableBackup(file) {
  if (!file || typeof file.text !== "function" || !Number.isFinite(file.size) || file.size > MAX_FILE_BYTES) fail("Backup is missing or exceeds the 256 MiB file limit.");
  let data;
  try { data = JSON.parse(await file.text()); } catch { fail("Backup is not valid JSON."); }
  validateStructure(data);
  if (data.version === 2) {
    let characterBytes = 0;
    for (const record of data.characters.packs) {
      const pack = validateCharacterPack(record.pack);
      const blob = new Blob([JSON.stringify(pack)], {type:"application/json"});
      characterBytes += blob.size;
      if (characterBytes > MAX_CHARACTER_BYTES) fail("Character packs exceed the 128 MiB backup limit.");
      if (await digest(blob) !== record.sha256) fail("A character failed its integrity check; the backup may be damaged.");
      await validateCharacterImages(pack);
      record.pack = pack;
    }
  }
  let total = 0;
  for (const asset of data.library.assets) {
    if (!Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0 || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) || typeof asset.mimeType !== "string" || asset.mimeType.length > 256 || typeof asset.data !== "string") fail("Invalid audio record in backup.");
    total += asset.byteSize;
    if (total > MAX_AUDIO_BYTES || asset.data.length > Math.ceil(asset.byteSize / 3) * 4) fail("Imported audio exceeds the backup size limit or has invalid length.");
    const bytes = decodeBytes(asset.data);
    if (bytes.length !== asset.byteSize) fail("Audio size does not match backup metadata.");
    const blob = new Blob([bytes], { type: asset.mimeType });
    if (await digest(blob) !== asset.sha256) fail("Audio failed its integrity check; the backup may be damaged.");
    delete asset.data;
    asset.blob = blob;
  }
  return data;
}
function remapCue(cue, presetMap) {
  if (presetMap.has(cue.presetId)) cue.presetId = presetMap.get(cue.presetId);
  if (Array.isArray(cue.presetIds)) cue.presetIds = cue.presetIds.map((id) => presetMap.get(id) || id);
  if (object(cue.presetWeights)) cue.presetWeights = Object.fromEntries(Object.entries(cue.presetWeights).map(([id, weight]) => [presetMap.get(id) || id, weight]));
}
function cloneData(data) { return JSON.parse(JSON.stringify(data)); }

export async function restorePortableLibrary(backup) {
  // Decoded Blob instances are supplied only by parsePortableBackup.
  if (!backup?.library?.assets?.every((asset) => asset.blob instanceof Blob)) fail("Validate the backup before restoring it.");
  const library = backup.library;
  const state = cloneData(backup.state);
  const db = await openAudioDb();
  let tx;
  let done;
  try {
    tx = db.transaction(STORES, "readwrite");
    done = txDone(tx);
    // A validation failure can abort before the normal await below.
    done.catch(() => {});
    const [existingPacks, existingPresets, existingProfiles, existingAssets] = await Promise.all(STORES.map((name) => requestToPromise(tx.objectStore(name).getAllKeys())));
    const usedPacks = new Set(existingPacks), usedPresets = new Set(existingPresets), usedProfiles = new Set(existingProfiles), usedAssets = new Set(existingAssets);
    const packMap = new Map(), presetMap = new Map(), profileMap = new Map(), assetMap = new Map();
    const unique = (set, prefix) => { let id; do { id = `${prefix}${randomId()}`; } while (set.has(id)); set.add(id); return id; };
    for (const pack of library.packs) {
      const conflict = usedPacks.has(pack.id) || library.presets.some((p) => p.packId === pack.id && usedPresets.has(p.id)) || library.profiles.some((p) => p.packId === pack.id && usedProfiles.has(p.id));
      const id = conflict ? unique(usedPacks, "restored-") : pack.id;
      usedPacks.add(id); packMap.set(pack.id, id);
    }
    for (const preset of library.presets) {
      const oldPrefix = `custom:${preset.packId}:`;
      const id = `custom:${packMap.get(preset.packId)}:${preset.id.slice(oldPrefix.length)}`;
      if (usedPresets.has(id)) fail("Restored sound ID conflicts with existing data. Please retry.");
      usedPresets.add(id); presetMap.set(preset.id, id);
    }
    for (const profile of library.profiles) {
      const oldPrefix = `custom:${profile.packId}:`;
      const id = `custom:${packMap.get(profile.packId)}:${profile.id.slice(oldPrefix.length)}`;
      if (usedProfiles.has(id)) fail("Restored profile ID conflicts with existing data. Please retry.");
      usedProfiles.add(id); profileMap.set(profile.id, id);
    }
    for (const asset of library.assets) assetMap.set(asset.id, unique(usedAssets, "asset:restore:"));
    for (const asset of library.assets) {
      const id = assetMap.get(asset.id);
      tx.objectStore(ASSET_STORE).add({ id, hash: `restore:${id}`, mimeType: asset.mimeType, byteSize: asset.byteSize, blob: asset.blob, updatedAtMs: Date.now() });
    }
    for (const pack of library.packs) tx.objectStore(PACK_STORE).add({ ...pack, id: packMap.get(pack.id) });
    for (const preset of library.presets) tx.objectStore(PRESET_STORE).add({ ...preset, id: presetMap.get(preset.id), packId: packMap.get(preset.packId), assetId: assetMap.get(preset.assetId) });
    for (const profile of library.profiles) {
      const copy = { ...profile, id: profileMap.get(profile.id), packId: packMap.get(profile.packId), relativeDefaultPresetId: presetMap.get(profile.relativeDefaultPresetId), absoluteDefaultPresetId: presetMap.get(profile.absoluteDefaultPresetId) };
      if (object(profile.intervalPresetByMinutes)) copy.intervalPresetByMinutes = Object.fromEntries(Object.entries(profile.intervalPresetByMinutes).map(([key, id]) => [key, presetMap.get(id)]));
      tx.objectStore(PROFILE_STORE).add(copy);
    }
    for (const cue of [...state.intervals, ...state.oneShots]) remapCue(cue, presetMap);
    if (object(state.soundIntervalTags)) state.soundIntervalTags = Object.fromEntries(Object.entries(state.soundIntervalTags).map(([id, tags]) => [presetMap.get(id) || id, tags]));
    if (profileMap.has(state.selectedProfileId)) state.selectedProfileId = profileMap.get(state.selectedProfileId);
    await done;
    return { state, remapped: [...packMap].filter(([oldId, newId]) => oldId !== newId).length };
  } catch (error) {
    try { tx?.abort(); } catch { /* transaction already finished */ }
    if (done) await done.catch(() => {});
    throw error;
  } finally { db.close(); }
}

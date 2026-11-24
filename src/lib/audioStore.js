import {
  ASSET_STORE,
  PACK_STORE,
  PRESET_STORE,
  PROFILE_STORE,
  isIndexedDbAvailable,
  openAudioDb,
  requestToPromise,
  txDone
} from "./audioStoreDb.js";
import {
  buildUniqueAssetMap,
  preparePresetAssets,
  resolvePresetBlobWithinTx,
  upsertAssetsWithinTx
} from "./audioAssetRepo.js";
import { deletePackWithinTx, loadLibraryWithinTx, savePackBundleWithinTx } from "./audioPackRepo.js";

export function isAudioStoreAvailable() {
  return isIndexedDbAvailable();
}

export class SoundPackConflictError extends Error {
  constructor(pack) {
    super(`A sound pack with ID "${pack.id}" already exists.`);
    this.name = "SoundPackConflictError";
    this.packId = pack.id;
    this.packLabel = typeof pack.label === "string" ? pack.label : pack.id;
  }
}

export async function saveSoundPack(bundle, { replaceExisting = false } = {}) {
  const preparedPresets = await preparePresetAssets(bundle.presets);
  const uniqueAssets = buildUniqueAssetMap(preparedPresets);

  const db = await openAudioDb();
  const tx = db.transaction([PACK_STORE, PRESET_STORE, PROFILE_STORE, ASSET_STORE], "readwrite");
  // Check within the write transaction: a separate UI preflight can race
  // another import and must not silently overwrite a newly created pack.
  const existingPack = await requestToPromise(tx.objectStore(PACK_STORE).get(bundle.pack.id));
  if (existingPack && !replaceExisting) {
    tx.abort();
    db.close();
    throw new SoundPackConflictError(existingPack);
  }
  await deletePackWithinTx(tx, bundle.pack.id);

  const { newAssetCount, reusedExistingAssetCount } = await upsertAssetsWithinTx(tx, uniqueAssets);

  savePackBundleWithinTx(tx, { bundle, preparedPresets });

  await txDone(tx);
  db.close();

  const uniqueAssetCount = uniqueAssets.size;
  return {
    newAssetCount,
    reusedExistingAssetCount,
    dedupedWithinImportCount: preparedPresets.length - uniqueAssetCount,
    presetReferenceCount: preparedPresets.length
  };
}

export async function loadSoundLibrary() {
  const db = await openAudioDb();
  const tx = db.transaction([PACK_STORE, PRESET_STORE, PROFILE_STORE], "readonly");
  const library = await loadLibraryWithinTx(tx);
  await txDone(tx);
  db.close();
  return library;
}

export async function deleteSoundPack(packId) {
  const db = await openAudioDb();
  const tx = db.transaction([PACK_STORE, PRESET_STORE, PROFILE_STORE, ASSET_STORE], "readwrite");
  await deletePackWithinTx(tx, packId);
  await txDone(tx);
  db.close();
}

export async function getSoundPresetBlob(presetId) {
  const db = await openAudioDb();
  const tx = db.transaction([PRESET_STORE, ASSET_STORE], "readonly");
  const presetStore = tx.objectStore(PRESET_STORE);
  const presetRecord = await requestToPromise(presetStore.get(presetId));

  const resolvedBlob = await resolvePresetBlobWithinTx(tx, presetRecord);

  await txDone(tx);
  db.close();
  return resolvedBlob;
}

import { PACK_STORE, PRESET_STORE, PROFILE_STORE, requestToPromise } from "./audioStoreDb.js";
import { cleanupUnreferencedAssets } from "./audioAssetRepo.js";

export async function deletePackWithinTx(tx, packId) {
  const presetStore = tx.objectStore(PRESET_STORE);
  const profileStore = tx.objectStore(PROFILE_STORE);
  const presetRecords = await requestToPromise(presetStore.index("packId").getAll(packId));
  const profileIds = await requestToPromise(profileStore.index("packId").getAllKeys(packId));

  const assetIds = [...new Set(presetRecords.map((record) => record.assetId).filter((assetId) => typeof assetId === "string" && assetId.trim()))];
  for (const presetRecord of presetRecords) {
    presetStore.delete(presetRecord.id);
  }
  for (const profileId of profileIds) {
    profileStore.delete(profileId);
  }
  tx.objectStore(PACK_STORE).delete(packId);

  await cleanupUnreferencedAssets(tx, assetIds);
}

export function savePackBundleWithinTx(tx, { bundle, preparedPresets }) {
  tx.objectStore(PACK_STORE).put({
    ...bundle.pack,
    importedAtMs: Date.now()
  });

  for (const entry of preparedPresets) {
    const preset = entry.preset;
    tx.objectStore(PRESET_STORE).put({
      id: preset.id,
      packId: preset.packId,
      label: preset.label,
      description: preset.description,
      tags: preset.tags,
      sourceFileName: preset.sourceFileName,
      assetId: entry.asset.id
    });
  }

  for (const profile of bundle.profiles) {
    tx.objectStore(PROFILE_STORE).put(profile);
  }
}

export async function loadLibraryWithinTx(tx) {
  const packRecords = await requestToPromise(tx.objectStore(PACK_STORE).getAll());
  const presetRecords = await requestToPromise(tx.objectStore(PRESET_STORE).getAll());
  const profileRecords = await requestToPromise(tx.objectStore(PROFILE_STORE).getAll());

  return {
    packs: packRecords.sort((a, b) => (a.label || "").localeCompare(b.label || "")),
    presets: presetRecords.map((record) => ({
      id: record.id,
      label: record.label,
      description: record.description,
      tags: Array.isArray(record.tags) ? record.tags : [],
      packId: record.packId
    })),
    profiles: profileRecords.sort((a, b) => (a.label || "").localeCompare(b.label || ""))
  };
}

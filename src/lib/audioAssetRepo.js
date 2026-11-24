import { ASSET_STORE, PRESET_STORE, requestToPromise } from "./audioStoreDb.js";

function supportsSubtleHashing() {
  return typeof crypto !== "undefined" && crypto && crypto.subtle && typeof crypto.subtle.digest === "function";
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

async function computeBlobHash(blob) {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new Error("Audio file blob is missing");
  }
  if (!supportsSubtleHashing()) {
    // In insecure browser contexts SubtleCrypto may be unavailable even though
    // secure random numbers are supported. Do not deduplicate in that case:
    // MIME type and length do not identify the contents and can overwrite a
    // different sound. Existing IDs continue to resolve unchanged.
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
      throw new Error("Cannot safely import audio: secure random numbers are unavailable. Open Heartbeat in a secure context.");
    }
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    return `random:${bytesToHex(randomBytes)}`;
  }
  const arrayBuffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return `sha256:${bytesToHex(digest)}`;
}

function buildAssetId(hash) {
  return `asset:${hash}`;
}

export async function preparePresetAssets(presets) {
  const prepared = [];
  for (const preset of presets) {
    if (!preset?.file || typeof preset.file.arrayBuffer !== "function") {
      throw new Error(`Missing audio file for preset "${preset?.id || "unknown"}"`);
    }
    const hash = await computeBlobHash(preset.file);
    const assetId = buildAssetId(hash);
    prepared.push({
      preset,
      asset: {
        id: assetId,
        hash,
        mimeType: typeof preset.file.type === "string" ? preset.file.type : "application/octet-stream",
        byteSize: Number(preset.file.size) || 0,
        blob: preset.file,
        updatedAtMs: Date.now()
      }
    });
  }
  return prepared;
}

export function buildUniqueAssetMap(preparedPresets) {
  const uniqueAssets = new Map();
  for (const entry of preparedPresets) {
    if (!uniqueAssets.has(entry.asset.id)) {
      uniqueAssets.set(entry.asset.id, entry.asset);
    }
  }
  return uniqueAssets;
}

export async function upsertAssetsWithinTx(tx, uniqueAssets) {
  const assetStore = tx.objectStore(ASSET_STORE);
  let reusedExistingAssetCount = 0;
  let newAssetCount = 0;
  for (const asset of uniqueAssets.values()) {
    const existing = await requestToPromise(assetStore.get(asset.id));
    if (existing) {
      reusedExistingAssetCount += 1;
    } else {
      newAssetCount += 1;
    }
    assetStore.put(asset);
  }
  return { newAssetCount, reusedExistingAssetCount };
}

export async function cleanupUnreferencedAssets(tx, candidateAssetIds) {
  if (!candidateAssetIds.length) {
    return;
  }
  const presetStore = tx.objectStore(PRESET_STORE);
  const assetStore = tx.objectStore(ASSET_STORE);
  const assetIndex = presetStore.index("assetId");
  for (const assetId of candidateAssetIds) {
    const references = await requestToPromise(assetIndex.count(assetId));
    if (!references) {
      assetStore.delete(assetId);
    }
  }
}

export async function resolvePresetBlobWithinTx(tx, presetRecord) {
  if (!presetRecord) {
    return null;
  }
  if (presetRecord.assetId) {
    const assetRecord = await requestToPromise(tx.objectStore(ASSET_STORE).get(presetRecord.assetId));
    return assetRecord?.blob || null;
  }
  if (presetRecord.blob) {
    return presetRecord.blob;
  }
  return null;
}

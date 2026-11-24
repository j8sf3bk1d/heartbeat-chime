import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUniqueAssetMap, cleanupUnreferencedAssets, preparePresetAssets, resolvePresetBlobWithinTx } from "../../src/lib/audioAssetRepo.js";
import { ASSET_STORE, PRESET_STORE } from "../../src/lib/audioStoreDb.js";

function requestWithResult(result) {
  const request = { result };
  queueMicrotask(() => {
    if (typeof request.onsuccess === "function") {
      request.onsuccess();
    }
  });
  return request;
}

describe("audio asset repo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps same-sized audio distinct when content hashing is unavailable", async () => {
    let counter = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes) {
        bytes.fill(++counter);
        return bytes;
      }
    });
    const first = new Blob(["one"], { type: "audio/wav" });
    const second = new Blob(["two"], { type: "audio/wav" });
    const prepared = await preparePresetAssets([{ id: "first", file: first }, { id: "second", file: second }]);
    const assets = buildUniqueAssetMap(prepared);

    expect(assets.size).toBe(2);
    expect(prepared[0].asset.id).not.toBe(prepared[1].asset.id);
    expect(assets.get(prepared[0].asset.id).blob).toBe(first);
    expect(assets.get(prepared[1].asset.id).blob).toBe(second);
  });

  it("rejects imports without hashing or secure random numbers", async () => {
    vi.stubGlobal("crypto", {});
    await expect(preparePresetAssets([{ id: "first", file: new Blob(["one"]) }]))
      .rejects.toThrow("Cannot safely import audio");
  });

  it("continues resolving legacy fallback IDs without rewriting them", async () => {
    const legacyId = "asset:fallback:audio/wav:3";
    const blob = new Blob(["old"], { type: "audio/wav" });
    const tx = { objectStore: () => ({ get: (id) => requestWithResult(id === legacyId ? { blob } : null) }) };

    await expect(resolvePresetBlobWithinTx(tx, { assetId: legacyId })).resolves.toBe(blob);
  });

  it("deletes only unreferenced assets during cleanup", async () => {
    const countsByAssetId = {
      "asset:used": 2,
      "asset:orphan": 0,
      "asset:also-used": 1
    };
    const deleted = [];
    const tx = {
      objectStore(name) {
        if (name === PRESET_STORE) {
          return {
            index(indexName) {
              expect(indexName).toBe("assetId");
              return {
                count(assetId) {
                  return requestWithResult(countsByAssetId[assetId] ?? 0);
                }
              };
            }
          };
        }
        if (name === ASSET_STORE) {
          return {
            delete(assetId) {
              deleted.push(assetId);
            }
          };
        }
        throw new Error(`Unexpected object store: ${name}`);
      }
    };

    await cleanupUnreferencedAssets(tx, Object.keys(countsByAssetId));

    expect(deleted).toEqual(["asset:orphan"]);
  });

  it("resolves preset blob from asset records first and supports legacy preset blobs", async () => {
    const assetBlob = new Blob(["asset"], { type: "audio/wav" });
    const legacyBlob = new Blob(["legacy"], { type: "audio/wav" });
    const tx = {
      objectStore(name) {
        if (name !== ASSET_STORE) {
          throw new Error(`Unexpected object store: ${name}`);
        }
        return {
          get(assetId) {
            expect(assetId).toBe("asset:abc");
            return requestWithResult({ id: assetId, blob: assetBlob });
          }
        };
      }
    };

    await expect(resolvePresetBlobWithinTx(tx, { assetId: "asset:abc" })).resolves.toBe(assetBlob);
    await expect(resolvePresetBlobWithinTx(tx, { blob: legacyBlob })).resolves.toBe(legacyBlob);
    await expect(resolvePresetBlobWithinTx(tx, null)).resolves.toBeNull();
  });
});

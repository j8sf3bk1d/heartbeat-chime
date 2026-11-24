import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

test("pack ID collisions preserve old audio until replacement is explicitly accepted", async ({ page }) => {
  await page.goto("/#sounds");
  await openDetails(page.locator(".pack-admin"));
  const originalAudio = createSineWavBuffer({ frequency: 440 });
  const replacementAudio = createSineWavBuffer({ frequency: 880 });
  async function selectPack(label, audio) {
    const manifest = { packId: "collision", label, sounds: [{ id: "cue", label, file: "cue.wav" }] };
    await page.locator("#pack-files").setInputFiles([
      { name: "pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(manifest)) },
      { name: "cue.wav", mimeType: "audio/wav", buffer: audio }
    ]);
  }
  async function storedBlobBytes() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("heartbeat-audio-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const get = (store, id) => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const preset = await get("presets", "custom:collision:cue");
      const asset = await get("assets", preset.assetId);
      const bytes = [...new Uint8Array(await asset.blob.arrayBuffer())];
      db.close();
      return bytes;
    });
  }
  await selectPack("Original", originalAudio);
  await page.locator("#pack-import-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".pack-title", { hasText: "Original" })).toBeVisible();
  expect(await storedBlobBytes()).toEqual([...originalAudio]);

  await selectPack("Replacement", replacementAudio);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#pack-import-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#log-list")).toContainText("existing pack kept");
  await page.reload();
  await openDetails(page.locator(".pack-admin"));
  await expect(page.locator(".pack-title", { hasText: "Original" })).toBeVisible();
  expect(await storedBlobBytes()).toEqual([...originalAudio]);

  await selectPack("Replacement", replacementAudio);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#pack-import-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".pack-title", { hasText: "Replacement" })).toBeVisible();
  expect(await storedBlobBytes()).toEqual([...replacementAudio]);
});

test("concurrent imports cannot silently replace a pack created after preflight", async ({ page }) => {
  await page.goto("/#sounds");
  const results = await page.evaluate(async () => {
    const { saveSoundPack } = await import("/src/lib/audioStore.js");
    function makeBundle(label) {
      return {
        pack: { id: "racing-pack", label },
        presets: [{ id: "custom:racing-pack:cue", packId: "racing-pack", label, file: new File([label], "cue.wav") }],
        profiles: []
      };
    }
    return Promise.allSettled([saveSoundPack(makeBundle("one")), saveSoundPack(makeBundle("two"))]);
  });
  expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
});

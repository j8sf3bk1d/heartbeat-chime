import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

const storageKey = "heartbeat-state-v1";

async function makeBackup(page) {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Portable voices");
  await page.locator("#quick-pack-files").setInputFiles([
    { name: "voice-one.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 617, durationMs: 360 }) },
    { name: "voice-two.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 420, durationMs: 450 }) }
  ]);
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 2 clips");
  await openDetails(page.locator("#sound-library-browser"));
  const first = page.locator(".preset-item").filter({ has: page.locator(".preset-title", { hasText: "Voice One" }) });
  await first.locator(".preset-interval-input").fill("5, 23");
  await first.locator(".preset-interval-input").blur();
  await page.goto("/#chimes");
  const row = page.locator('.interval-row[data-interval-id="interval-5"]');
  await row.locator(".interval-enabled").check();
  await row.locator(".interval-preset").selectOption({ label: "Voice One" });
  const firstId = await row.locator(".interval-preset").inputValue();
  await row.locator(".interval-advanced summary").click();
  const secondId = await row.locator('.interval-preset-set option', { hasText: "Voice Two" }).getAttribute("value");
  await row.locator(".interval-preset-set").selectOption([firstId, secondId]);
  await row.locator(".interval-playback-mode").selectOption("weighted-random");
  await row.locator(`[data-preset-weight-for="${firstId}"]`).fill("7");
  await row.locator(`[data-preset-weight-for="${firstId}"]`).dispatchEvent("change");
  await page.goto("/#settings");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup-export").click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return { bytes: Buffer.concat(chunks), firstId, secondId };
}

async function loadBackup(page, bytes, accept = true) {
  await page.locator("#backup-import-file").setInputFiles({ name: "portable.json", mimeType: "application/json", buffer: bytes });
  await page.getByRole("dialog").getByRole("button", {name: accept ? "Restore backup" : "Cancel"}).click();
}

test("portable backup restores audio, assignments, tags and weights on a fresh profile", async ({ browser, page }) => {
  const { bytes, firstId, secondId } = await makeBackup(page);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.addInitScript(() => {
    window.__backupPlaybackDurations = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) window.__backupPlaybackDurations.push(this.buffer.duration);
      return start.apply(this, args);
    };
  });
  await fresh.goto("/#settings");
  await loadBackup(fresh, bytes);
  await expect(fresh.locator("#backup-status")).toContainText("Backup restored");
  await fresh.reload();
  const state = await fresh.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const cue = state.intervals.find((item) => item.id === "interval-5");
  expect(cue.presetIds).toEqual(expect.arrayContaining([firstId, secondId]));
  expect(cue.presetWeights[firstId]).toBe(7);
  expect(state.soundIntervalTags[firstId]).toEqual([5, 23]);
  await fresh.goto("/#chimes");
  const row = fresh.locator('.interval-row[data-interval-id="interval-5"]');
  await expect(row.locator(".interval-preset")).toHaveValue(firstId);
  await row.locator(".interval-preview").click();
  await expect.poll(() => fresh.evaluate(() => window.__backupPlaybackDurations.length)).toBeGreaterThan(0);
  await context.close();
});

test("cancel leaves settings and library unchanged and a damaged file is rejected", async ({ page }) => {
  const { bytes } = await makeBackup(page);
  const before = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await loadBackup(page, bytes, false);
  await expect(page.locator("#backup-status")).toContainText("Restore canceled");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(before);
  await page.locator("#backup-import-file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{bad") });
  await expect(page.locator("#backup-status")).toContainText("not valid JSON");
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const prior = JSON.parse(before);
  // Reporting a failed import appends a log entry; durable settings remain.
  delete after.log;
  delete prior.log;
  expect(after).toEqual(prior);
});

test("same-profile restore remaps conflicting sound IDs and retains weights", async ({ page }) => {
  const { bytes, firstId, secondId } = await makeBackup(page);
  await loadBackup(page, bytes);
  await expect(page.locator("#backup-status")).toContainText("Backup restored");
  await page.reload();
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const cue = state.intervals.find((item) => item.id === "interval-5");
  expect(cue.presetId).not.toBe(firstId);
  expect(cue.presetIds).not.toContain(secondId);
  expect(cue.presetWeights[cue.presetId]).toBe(7);
  expect(state.soundIntervalTags[cue.presetId]).toEqual([5, 23]);
  await page.goto("/#sounds");
  await openDetails(page.locator("#sound-library-browser"));
  await expect(page.locator(".preset-item").filter({ has: page.locator(".preset-title", { hasText: "Voice One" }) })).toHaveCount(2);
});

test("a settings write failure reports the partial library addition and preserves live settings", async ({ page }) => {
  const { bytes, firstId } = await makeBackup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "heartbeat-state-v1") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await loadBackup(page, bytes);
  await expect(page.locator("#backup-status")).toContainText("Some sounds were added, but settings could not be restored");
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(state.intervals.find((item) => item.id === "interval-5").presetId).toBe(firstId);
});

test("restoring while running loads restored sounds before chimes restart", async ({ page }) => {
  const { bytes } = await makeBackup(page);
  await page.goto("/#overview");
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.goto("/#settings");
  await loadBackup(page, bytes);
  await expect(page.locator("#backup-status")).toContainText("Backup restored");
  await expect(page.locator("#status-text")).toHaveText("Running");
});

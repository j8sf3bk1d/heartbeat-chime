import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

const STORAGE_KEY = "heartbeat-state-v1";

async function readSavedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function importConfig(page, state) {
  await page.locator("#config-import-file").setInputFiles({
    name: "isolated-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, state }))
  });
}

test("exported configuration restores settings, recurring playback, and timers after replacement and reload", async ({ page }) => {
  await page.goto("/#settings");
  await importConfig(page, { themeMode: "light", themePaletteId: "dawn" });
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "lilac");
  await expect.poll(async () => (await readSavedState(page)).themePaletteMigrationVersion).toBe(1);
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption("wood_tick");
  await openDetails(interval.locator(".interval-advanced"));
  await interval.locator(".interval-preset-set").selectOption(["wood_tick", "bright_ping"]);
  await interval.locator(".interval-playback-mode").selectOption("weighted-random");

  await page.goto("/#timers");
  await page.locator("#relative-label").fill("Roundtrip reminder");
  await page.locator("#relative-minutes").fill("37");
  await page.locator("#relative-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".timer-title")).toHaveText("Roundtrip reminder");

  await page.goto("/#settings");
  await page.locator("#theme-mode").selectOption("dark");
  // A deliberate post-migration Dawn choice must survive subsequent imports.
  await page.locator("#theme-palette").selectOption("dawn");
  await openDetails(page.locator("#tts-settings-panel"));
  await page.locator("#tts-custom-text").fill("Roundtrip voice cue");
  await page.locator("#tts-custom-text").dispatchEvent("change");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#config-export").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.state).not.toHaveProperty("running");
  expect(exported.state.oneShots).toHaveLength(1);
  expect(exported.state.ttsCustomText).toBe("Roundtrip voice cue");
  expect(exported.state.themePaletteId).toBe("dawn");
  expect(exported.state.themePaletteMigrationVersion).toBe(1);

  await importConfig(page, { masterVolume: 0.2, themeMode: "light", themePaletteId: "ember", themePaletteMigrationVersion: 1, intervals: [], oneShots: [] });
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "ember");
  await expect.poll(async () => (await readSavedState(page)).oneShots.length).toBe(0);
  await page.locator("#config-import-file").setInputFiles({
    name: "roundtrip.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported))
  });
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "dawn");
  await page.reload();
  const restored = await readSavedState(page);
  // Activity log changes during import; compare durable configuration independently.
  const { log: exportedLog, ...expectedConfig } = exported.state;
  const { log: restoredLog, ...restoredConfig } = restored;
  expect(restoredConfig).toEqual(expectedConfig);
  await expect(page.locator("#status-text")).toHaveText("Paused");
  await expect(page.locator("body")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "dawn");
  await page.goto("/#chimes");
  await expect(interval.locator(".interval-enabled")).toBeChecked();
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveCount(2);
  await expect(interval.locator(".interval-playback-mode")).toHaveValue("weighted-random");
  await page.goto("/#timers");
  await expect(page.locator(".timer-title")).toHaveText("Roundtrip reminder");
});

test("imported audio survives reload and previews its decoded buffer while startup stays paused", async ({ page }) => {
  // Observe the native buffer playback path without replacing decoding, IndexedDB,
  // or audio output. A success log alone cannot prove the imported blob was loaded.
  await page.addInitScript(() => {
    window.__persistedAudioStarts = [];
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        const samples = this.buffer.getChannelData(0);
        window.__persistedAudioStarts.push({
          duration: this.buffer.duration,
          peak: samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0)
        });
      }
      return originalStart.apply(this, args);
    };
  });
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Persisted voice");
  await page.locator("#quick-pack-files").setInputFiles({
    name: "persisted-voice.wav", mimeType: "audio/wav",
    buffer: createSineWavBuffer({ frequency: 617, durationMs: 360, amplitude: 0.25 })
  });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption({ label: "Persisted Voice" });
  const presetId = await interval.locator(".interval-preset").inputValue();
  expect(presetId).toMatch(/^custom:/);
  await page.goto("/#overview");
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.reload();
  await expect(page.locator("#status-text")).toHaveText("Paused");
  await page.goto("/#chimes");
  await expect(interval.locator(".interval-preset")).toHaveValue(presetId);
  await expect(interval.locator(".interval-preset option:checked")).toHaveText("Persisted Voice");
  await expect(interval.locator(".interval-enabled")).toBeChecked();
  await interval.locator(".interval-preview").click();
  await expect.poll(() => page.evaluate(() => window.__persistedAudioStarts.length)).toBe(1);
  const [playback] = await page.evaluate(() => window.__persistedAudioStarts);
  expect(playback.duration).toBeCloseTo(0.36, 2);
  expect(playback.peak).toBeGreaterThan(0.2);
  await expect(page.locator("#status-text")).toHaveText("Paused");
});

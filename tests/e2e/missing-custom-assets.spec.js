import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";

const key = "heartbeat-state-v1";

test("missing imported assignments survive hydration and can be repaired", async ({ page }) => {
  await page.goto("/#chimes");
  await page.locator('[data-interval-id="interval-5"] .interval-enabled').check();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey));
    state.selectedProfileId = "custom:missing-profile";
    const cue = state.intervals.find((entry) => entry.id === "interval-5");
    Object.assign(cue, {
      enabled: true,
      presetId: "custom:missing-sound",
      presetIds: ["custom:missing-sound"],
      playbackMode: "weighted-random",
      presetWeights: { "custom:missing-sound": 3 }
    });
    state.oneShots = [{ id: "missing-timer", label: "Saved timer", targetAtMs: Date.now() + 600000,
      createdAtMs: Date.now(), presetId: "custom:missing-timer-sound", presetIds: ["custom:missing-timer-sound"],
      presetWeights: { "custom:missing-timer-sound": 2 }, playbackMode: "weighted-random", active: false }];
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.reload();
  const interval = page.locator('[data-interval-id="interval-5"]');
  await expect(interval.locator(".interval-preset option:checked")).toContainText("Missing");
  await expect(page.locator("#sound-profile option:checked")).toContainText("Missing");
  await interval.locator(".interval-advanced summary").click();
  await expect(interval.locator(".interval-preset-set option:checked")).toContainText("Missing");
  const saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.selectedProfileId).toBe("custom:missing-profile");
  const cue = saved.intervals.find((entry) => entry.id === "interval-5");
  expect(cue.presetIds).toEqual(["custom:missing-sound"]);
  expect(cue.presetWeights).toEqual({ "custom:missing-sound": 3 });
  expect(saved.oneShots[0].presetIds).toEqual(["custom:missing-timer-sound"]);
  expect(saved.oneShots[0].presetWeights).toEqual({ "custom:missing-timer-sound": 2 });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#scheduler-error")).toContainText("missing");
  await expect(page.locator("#status-text")).toHaveText("Paused");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await interval.locator(".interval-preset").selectOption("soft_chime");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.reload();
  const repaired = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(repaired.intervals.find((entry) => entry.id === "interval-5").presetIds).toEqual(["soft_chime"]);
  expect(repaired.selectedProfileId).toBe("custom:missing-profile");
});

test("deleting a sound pack preserves its assignment and blocks playback", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Temporary pack");
  await page.locator("#quick-pack-files").setInputFiles({
    name: "tone.wav", mimeType: "audio/wav", buffer: createSineWavBuffer()
  });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const interval = page.locator('[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption({ label: "Tone" });
  const assignedId = await interval.locator(".interval-preset").inputValue();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  await page.locator(".pack-admin summary").click();
  await page.locator(".pack-delete").click();
  await expect(page.locator("#pack-list")).toContainText("No imported packs");
  await expect(page.locator("#status-text")).toHaveText("Paused");
  expect((await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key)).schedulerRequested).toBe(true);
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await expect(interval.locator(".interval-preset")).toHaveValue(assignedId);
  await expect(interval.locator(".interval-preset option:checked")).toContainText("Missing");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#scheduler-error")).toContainText("missing");
  await page.reload();
  const saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.intervals.find((entry) => entry.id === "interval-5").presetId).toBe(assignedId);
  expect(saved.schedulerRequested).toBe(true);
});

test("a preset whose audio blob is missing is preserved and blocked", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Partial pack");
  await page.locator("#quick-pack-files").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: createSineWavBuffer() });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const interval = page.locator('[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption({ label: "Tone" });
  const assignedId = await interval.locator(".interval-preset").inputValue();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("heartbeat-audio-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(interval.locator(".interval-preset option:checked")).toContainText("Missing audio");
  await expect(interval.locator(".interval-preset")).toHaveValue(assignedId);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#scheduler-error")).toContainText("missing");
});

test("starting checks an imported sound selected after hydration", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Corrupt pack");
  await page.locator("#quick-pack-files").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: createSineWavBuffer() });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("heartbeat-audio-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const interval = page.locator('[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption({ label: "Tone" });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Paused");
  await expect(page.locator("#scheduler-error")).toContainText("missing");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await expect(interval.locator(".interval-preset option:checked")).toContainText("Missing");
});

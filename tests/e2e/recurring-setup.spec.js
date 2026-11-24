import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";

test("import a voice clip, assign it to an interval, and return to the saved setup", async ({ page }) => {
  await page.goto("/#sounds");
  await expect(page.locator("#quick-pack-form")).toBeVisible();
  await page.locator("#quick-pack-label").fill("Voice clips");
  await page.locator("#quick-pack-files").setInputFiles({
    name: "time-check.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 440 })
  });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip into Voice clips");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await interval.locator(".interval-enabled").check();
  await interval.locator(".interval-preset").selectOption({ label: "Time Check" });
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveCount(1);
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveText("Time Check");
  await interval.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Start Chimes" }).click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.reload();
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await expect(interval.locator(".interval-enabled")).toBeChecked();
  await expect(interval.locator(".interval-preset option:checked")).toHaveText("Time Check");
});

test("shows an import error beside the form", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Invalid selection");
  await page.locator("#quick-pack-files").setInputFiles({
    name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not audio")
  });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Import failed: No audio files selected");
});

test("choosing a voice from the default set selects that voice alone", async ({ page }) => {
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  const set = interval.locator(".interval-preset-set");
  const selected = await set.locator("option:checked").evaluateAll((options) => options.map((option) => option.value));
  expect(selected.length).toBeGreaterThanOrEqual(10);
  await interval.locator(".interval-preset").selectOption(selected[1]);
  await expect(set.locator("option:checked")).toHaveCount(1);
  await expect(set.locator("option:checked")).toHaveValue(selected[1]);
});

test("an original saved default voice set still behaves like a default after the library expands", async ({ page }) => {
  const legacyIds = [1, 2, 3, 4, 5].flatMap((n) => {
    const id = `laura-five-minute-0${n}`;
    return [id, `${id}-b`];
  });
  await page.addInitScript((ids) => {
    localStorage.setItem("heartbeat-state-v1", JSON.stringify({
      selectedProfileId: "dry_time_checks",
      // Deliberately retained via import or re-selection after migration.
      voiceCoverageMigrationVersion: 1,
      intervals: [{ id: "interval-5", enabled: true, presetId: ids[0], presetIds: ids, playbackMode: "random", presetWeights: {} }]
    }));
  }, legacyIds);
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveCount(10);
  await interval.locator(".interval-preset").selectOption("wood_tick");
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveCount(1);
  await expect(interval.locator(".interval-preset-set option:checked")).toHaveValue("wood_tick");
});

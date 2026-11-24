import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

function createManifestBuffer(manifest) {
  return Buffer.from(JSON.stringify(manifest), "utf8");
}

test("quick and manifest imports expose presets and profiles", async ({ page }) => {
  const importedPresetWarnings = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" && msg.text().includes("Unable to play imported preset")) {
      importedPresetWarnings.push(msg.text());
    }
  });

  await page.goto("/#sounds");
  await openDetails(page.locator(".pack-admin"));

  const lineABuffer = createSineWavBuffer({ frequency: 610 });
  const lineBBuffer = createSineWavBuffer({ frequency: 660 });
  const lineCBuffer = createSineWavBuffer({ frequency: 720 });

  await page.locator("#quick-pack-label").fill("Voice Lines");
  await page.locator("#quick-pack-files").setInputFiles([
    { name: "line-a.wav", mimeType: "audio/wav", buffer: lineABuffer },
    { name: "line-b.wav", mimeType: "audio/wav", buffer: lineBBuffer },
    { name: "line-c.wav", mimeType: "audio/wav", buffer: lineCBuffer }
  ]);
  await page.locator("#quick-pack-form").evaluate((form) => {
    form.requestSubmit();
  });
  await expect(page.locator(".pack-title", { hasText: "Voice Lines" })).toBeVisible();
  await expect(page.locator("#relative-preset option", { hasText: "Line A" })).toHaveCount(1);

  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  let oneMinuteRow = page.locator(".interval-row").filter({ hasText: "1 minute" }).first();
  await openDetails(oneMinuteRow.locator(".interval-advanced"));
  await oneMinuteRow.locator(".interval-preset-set").selectOption([{ label: "Line A" }, { label: "Line B" }, { label: "Line C" }]);

  let fiveMinuteRow = page.locator(".interval-row").filter({ hasText: "5 minutes" }).first();
  await openDetails(fiveMinuteRow.locator(".interval-advanced"));
  await fiveMinuteRow.locator(".interval-preset-set").selectOption([{ label: "Line A" }, { label: "Line B" }]);

  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  await page.locator("#quick-pack-label").fill("Voice Lines Reuse");
  await page.locator("#quick-pack-files").setInputFiles([
    { name: "line-a-copy.wav", mimeType: "audio/wav", buffer: lineABuffer },
    { name: "line-b-copy.wav", mimeType: "audio/wav", buffer: lineBBuffer },
    { name: "line-c-copy.wav", mimeType: "audio/wav", buffer: lineCBuffer }
  ]);
  await page.locator("#quick-pack-form").evaluate((form) => {
    form.requestSubmit();
  });
  await expect(page.locator(".pack-title", { hasText: "Voice Lines Reuse" })).toBeVisible();
  await expect(page.locator(".log-item span:last-child").filter({ hasText: "Voice Lines Reuse" }).first()).toContainText("reused");

  const customManifest = {
    packId: "anime_pack",
    label: "Anime Pack",
    description: "Local imported theme pack.",
    sounds: [
      { id: "tick", label: "Tick", file: "tick.wav" },
      { id: "bell", label: "Bell", file: "bell.wav" }
    ],
    profiles: [
      {
        id: "focus_mode",
        label: "Anime Focus",
        description: "Imported profile for local theme sounds.",
        intervalPresetByMinutes: { 1: "tick", 5: "tick", 10: "bell", 15: "bell", 30: "bell", 60: "bell" },
        relativeDefaultSoundId: "tick",
        absoluteDefaultSoundId: "bell"
      }
    ]
  };

  await page.locator("#pack-files").setInputFiles([
    { name: "pack.json", mimeType: "application/json", buffer: createManifestBuffer(customManifest) },
    { name: "tick.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 540 }) },
    { name: "bell.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 760 }) }
  ]);
  await page.locator("#pack-import-form").evaluate((form) => {
    form.requestSubmit();
  });
  await expect(page.locator(".pack-title", { hasText: "Anime Pack" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('select#sound-profile option[value="custom:anime_pack:focus_mode"]')).toHaveCount(1);
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await page.getByLabel("Sound mode").selectOption("custom:anime_pack:focus_mode");
  await expect(page.getByText("Imported profile for local theme sounds.")).toBeVisible();
  await expect(page.locator("#relative-preset option[value='custom:anime_pack:tick']")).toHaveCount(1);
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await page.locator(".interval-row").first().getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(250);
  expect(importedPresetWarnings).toEqual([]);

  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await page.getByLabel("Sound mode").selectOption("focus");
  await expect(page.getByText("Low-distraction cues with subdued short intervals.")).toBeVisible();
});

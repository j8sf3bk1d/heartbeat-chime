import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

test("timer and imported sound metadata render as text, including after reload", async ({ page }) => {
  const payload = '<img src=x onerror="window.injected=1">';
  await page.goto("/#timers");
  await page.locator("#relative-label").fill(payload);
  await page.locator("#relative-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".timer-title")).toHaveText(payload);
  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  await openDetails(page.locator(".pack-admin"));
  const manifest = { packId: "safe-test", label: payload, description: payload, sounds: [{ id: "sound", label: payload, description: payload, tags: [payload], file: "tone.wav" }], profiles: [{ id: "profile", label: payload }] };
  await page.locator("#pack-files").setInputFiles([
    { name: "pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(manifest)) },
    { name: "tone.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 440 }) }
  ]);
  await page.locator("#pack-import-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".pack-title")).toHaveText(payload);
  await page.reload();
  await page.getByRole("link", { name: "Timers", exact: true }).click();
  await expect(page.locator(".timer-title")).toHaveText(payload);
  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  await openDetails(page.locator(".pack-admin"));
  await expect(page.locator(".pack-title")).toHaveText(payload);
  await openDetails(page.locator("#sound-library-browser"));
  await expect(page.locator(".preset-title").filter({ hasText: payload })).toHaveCount(1);
  await expect(page.locator('img[src="x"], [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

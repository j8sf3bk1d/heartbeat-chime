import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";

test("tag an imported clip, filter without losing selections, and restore tags after reload", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#quick-pack-label").fill("Tags");
  await page.locator("#quick-pack-files").setInputFiles({ name: "mystery.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 420 }) });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.locator("#sound-library-browser summary").click();
  const card = page.locator(".preset-item").filter({ has: page.locator(".preset-title", { hasText: "Mystery" }) });
  await card.locator(".preset-interval-input").fill("5, 23");
  await card.locator(".preset-interval-input").blur();
  await page.locator("#preset-interval-filter").selectOption("23");
  await expect(card).toBeVisible();
  await expect(page.locator(".preset-item")).toHaveCount(1);
  await page.reload();
  await expect(card.locator(".preset-interval-input")).toHaveValue("5, 23");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const row = page.locator('.interval-row[data-interval-id="interval-5"]');
  await row.locator(".interval-advanced summary").click();
  const before = await row.locator(".interval-preset-set option:checked").evaluateAll((nodes) => nodes.map((node) => node.value));
  await row.locator(".interval-clip-filter").selectOption("matching");
  await expect(row.locator(".interval-preset-set option", { hasText: "Mystery" })).toHaveCount(1);
  expect(await row.locator(".interval-preset-set option:checked").evaluateAll((nodes) => nodes.map((node) => node.value))).toEqual(before);
  await expect(row.locator(".interval-preset-set option", { hasText: "A whole hour" })).toHaveCount(0);
});

test("bundled tags can be cleared and restored across reload", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#sound-library-browser summary").click();
  const input = page.locator('.preset-interval-input[data-preset-id="laura-minute-01"]');
  await expect(input).toHaveValue("1");
  await input.fill("");
  await input.blur();
  await page.reload();
  await expect(input).toHaveValue("");
  await input.fill("1, 5");
  await input.blur();
  await page.reload();
  await expect(input).toHaveValue("1, 5");
});

test("filtering and editing a weighted selection retains unrelated selections and weights", async ({ page }) => {
  await page.goto("/#chimes");
  const row = page.locator('.interval-row[data-interval-id="interval-5"]');
  await row.locator(".interval-advanced summary").click();
  await row.locator(".interval-preset-set").selectOption(["soft_chime", "laura-five-minute-01"]);
  await row.locator(".interval-playback-mode").selectOption("weighted-random");
  await row.locator('[data-preset-weight-for="soft_chime"]').fill("3");
  await row.locator('[data-preset-weight-for="soft_chime"]').dispatchEvent("change");
  await row.locator(".interval-clip-filter").selectOption("matching");
  await expect(row.locator('.interval-preset-set option[value="soft_chime"]')).toBeAttached();
  await row.locator(".interval-preset-set").selectOption(["soft_chime", "laura-five-minute-01", "laura-five-minute-02"]);
  await row.locator(".interval-clip-filter").selectOption("all");
  await expect(row.locator('[data-preset-weight-for="soft_chime"]')).toHaveValue("3");
  const ids = await row.locator(".interval-preset-set option:checked").evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(ids).toEqual(expect.arrayContaining(["soft_chime", "laura-five-minute-01", "laura-five-minute-02"]));
});

test("interval tags survive actual config export and import", async ({ page }) => {
  await page.goto("/#sounds");
  await page.locator("#sound-library-browser summary").click();
  const input = page.locator('.preset-interval-input[data-preset-id="laura-minute-01"]');
  await input.fill("5, 23");
  await input.blur();
  await page.goto("/#settings");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#config-export").click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.state.soundIntervalTags["laura-minute-01"]).toEqual([5, 23]);
  await page.locator("#config-import-file").setInputFiles({ name: "reset.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, state: {} })) });
  await page.locator("#config-import-file").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await page.reload();
  await page.goto("/#sounds");
  await expect(input).toHaveValue("5, 23");
});

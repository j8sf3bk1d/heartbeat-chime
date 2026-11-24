import { expect, test } from "@playwright/test";
import { openDetails } from "./helpers/ui.js";

test("interval advanced playback config persists after reload", async ({ page }) => {
  await page.goto("/#chimes");

  let firstInterval = page.locator(".interval-row").first();
  await openDetails(firstInterval.locator(".interval-advanced"));
  await firstInterval.locator(".interval-preset-set").selectOption(["wood_tick", "bright_ping"]);

  firstInterval = page.locator(".interval-row").first();
  await openDetails(firstInterval.locator(".interval-advanced"));
  await firstInterval.locator(".interval-playback-mode").selectOption("weighted-random");

  firstInterval = page.locator(".interval-row").first();
  await openDetails(firstInterval.locator(".interval-advanced"));
  await firstInterval.getByRole("button", { name: "Spotlight 1st" }).click();

  firstInterval = page.locator(".interval-row").first();
  await openDetails(firstInterval.locator(".interval-advanced"));
  await firstInterval.locator(".interval-weight-simulate").click();
  await expect(firstInterval.locator(".interval-weight-sim-output")).toContainText("Sim 100:");

  await page.reload();
  const firstIntervalAfterReload = page.locator(".interval-row").first();
  await expect(firstIntervalAfterReload.locator(".interval-playback-mode")).toHaveValue("weighted-random");

  const selectedPresetIds = await firstIntervalAfterReload.locator(".interval-preset-set").evaluate((select) =>
    [...select.selectedOptions].map((option) => option.value)
  );
  expect([...selectedPresetIds].sort()).toEqual(["bright_ping", "wood_tick"]);

  const weightsByPreset = await firstIntervalAfterReload.locator(".interval-preset-weight-input").evaluateAll((inputs) =>
    Object.fromEntries(
      inputs.map((input) => [input.getAttribute("data-preset-weight-for"), Number(input.value)])
    )
  );
  expect(weightsByPreset[selectedPresetIds[0]]).toBe(4);
  expect(weightsByPreset[selectedPresetIds[1]]).toBe(1);
});

test("changing the primary sound preserves an explicitly configured multi-clip set", async ({ page }) => {
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await openDetails(interval.locator(".interval-advanced"));
  await interval.locator(".interval-preset-set").selectOption(["wood_tick", "bright_ping"]);
  await interval.locator(".interval-preset").selectOption("grand_bell");
  const selected = await interval.locator(".interval-preset-set option:checked").evaluateAll((options) => options.map((option) => option.value));
  expect(selected.sort()).toEqual(["bright_ping", "grand_bell", "wood_tick"]);
});

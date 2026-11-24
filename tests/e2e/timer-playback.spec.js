import { expect, test } from "@playwright/test";
import { openDetails } from "./helpers/ui.js";

test("one-shot timer creation, editing, and replay sequencing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Chimes" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Timers", exact: true }).click();

  await page.locator("#relative-label").fill("Playwright timer");
  await page.locator("#relative-minutes").fill("1");
  await openDetails(page.locator("#relative-form .form-advanced"));
  await page.locator("#relative-playback-mode").selectOption("sequential");
  await page.locator("#relative-preset-set").selectOption(["soft_chime", "bright_ping"]);
  await page.getByRole("button", { name: "Add Relative Timer" }).click();

  await expect(page.getByText("Playwright timer")).toBeVisible();
  await expect(page.getByText("Playback: Sequential | Clips: 2")).toBeVisible();
  await expect(page.locator("[data-timer-progress-for]").first()).toBeVisible();

  const timerCard = page.locator(".timer-item", { hasText: "Playwright timer" }).first();
  await timerCard.getByText("Edit sound").click();
  await timerCard.locator(".timer-edit-preset").selectOption("bright_ping");
  await timerCard.locator(".timer-edit-preset-set").selectOption(["bright_ping", "wood_tick"]);
  await timerCard.locator(".timer-edit-playback-mode").selectOption("sequential");
  await timerCard.locator(".timer-edit-preset-weight-input").nth(0).fill("1");
  await timerCard.locator(".timer-edit-preset-weight-input").nth(1).fill("1");
  await timerCard.getByRole("button", { name: "Save sound" }).click();

  await timerCard.getByRole("button", { name: "Replay" }).click();
  await timerCard.getByRole("button", { name: "Replay" }).click();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const replayLogs = page.locator(".log-item span:last-child").filter({ hasText: "Playwright timer (Replay)" });
  const replayTexts = [
    await replayLogs.nth(0).innerText(),
    await replayLogs.nth(1).innerText()
  ].join(" | ");
  expect(replayTexts).toContain("Bright Ping");
  expect(replayTexts).toContain("Wood Tick");
});

test("target timer supports quick now fill and creation-time sound preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Chimes" }).click();
  await page.getByRole("link", { name: "Timers", exact: true }).click();

  await page.locator("#absolute-now").click();
  const whenRaw = await page.locator("#absolute-when").inputValue();
  expect(whenRaw).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  const targetAtMs = new Date(whenRaw).getTime();
  expect(Number.isFinite(targetAtMs)).toBeTruthy();
  expect(targetAtMs).toBeGreaterThan(Date.now());
  expect(targetAtMs - Date.now()).toBeLessThan(2 * 60 * 1000 + 1000);

  await page.locator("#absolute-preview").click();

  await page.locator("#absolute-label").fill("Quick now target");
  await page.getByRole("button", { name: "Add Target Timer" }).click();
  await expect(page.getByText("Quick now target")).toBeVisible();
});

for (const kind of ["relative", "absolute"]) {
  test(`${kind} timer sound controls keep weights and simulation in sync`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Timers", exact: true }).click();
    await openDetails(page.locator(`#${kind}-form .form-advanced`));
    await page.locator(`#${kind}-preset-set`).selectOption(["soft_chime", "bright_ping"]);
    await page.locator(`#${kind}-playback-mode`).selectOption("weighted-random");
    const weights = page.locator(`#${kind}-preset-weight-controls .form-preset-weight-input`);
    await expect(weights).toHaveCount(2);
    await page.locator(`#${kind}-weight-preset-actions`).getByRole("button", { name: "Spotlight 1st" }).click();
    await expect(weights.nth(0)).not.toHaveValue(await weights.nth(1).inputValue());
    await page.locator(`#${kind}-weight-simulate`).click();
    await expect(page.locator(`#${kind}-weight-sim-output`)).not.toBeEmpty();
    await weights.nth(0).fill("7");
    await weights.nth(0).dispatchEvent("change");
    await expect(page.locator(`#${kind}-weight-sim-output`)).toBeEmpty();
    await page.locator(`#${kind}-label`).fill(`${kind} weighted test`);
    if (kind === "absolute") await page.locator("#absolute-now").click();
    await page.locator(`#${kind}-form button[type=submit]`).click();
    const card = page.locator(".timer-item", { hasText: `${kind} weighted test` });
    await card.getByText("Edit sound").click();
    await expect(card.locator(".timer-edit-playback-mode")).toHaveValue("weighted-random");
    await expect(card.locator(".timer-edit-preset-weight-input").first()).toHaveValue("7");
    await page.reload();
    await page.getByRole("link", { name: "Timers", exact: true }).click();
    const restored = page.locator(".timer-item", { hasText: `${kind} weighted test` });
    await restored.getByText("Edit sound").click();
    await expect(restored.locator(".timer-edit-preset-weight-input").first()).toHaveValue("7");
  });
}

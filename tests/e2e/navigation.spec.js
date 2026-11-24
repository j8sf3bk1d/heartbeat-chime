import { expect, test } from "@playwright/test";

test("task screens support navigation, history, keyboard and live status", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#overview-count")).toHaveText("No recurring chimes enabled");
  await expect(page.locator("#quick-pack-form")).toBeHidden();
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await expect(page.locator("#recurring-chimes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recurring Chimes" })).toBeFocused();
  await page.locator('.interval-row[data-interval-id="interval-5"] .interval-enabled').check();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.locator("#overview-count")).toHaveText("1 recurring chime enabled");
  await page.getByRole("button", { name: "Start Chimes" }).click();
  await expect(page.locator("#overview-message")).toContainText("running");
  await page.goBack();
  await expect(page.locator("#recurring-chimes")).toBeVisible();
  await page.reload();
  await expect(page.locator('.interval-row[data-interval-id="interval-5"] .interval-enabled')).toBeChecked();
});

test("legacy section links still open their task screen", async ({ page }) => {
  await page.goto("/#sound-library");
  await expect(page.locator("#sound-library")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sounds", exact: true })).toHaveAttribute("aria-current", "page");
});

test("existing theme preference is preserved with the new screen layout", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("heartbeat-state-v1", JSON.stringify({ themeMode: "light", themePaletteId: "dawn", themePaletteMigrationVersion: 1 }));
  });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "dawn");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Theme palette")).toHaveValue("dawn");
});

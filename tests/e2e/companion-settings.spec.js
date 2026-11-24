import { test, expect } from "@playwright/test";

test("desktop companion settings are discoverable and safely unavailable in a browser", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Visual novel companion/ })).toBeVisible();
  await expect(page.getByLabel("Show companion for chimes")).toBeDisabled();
  await expect(page.getByLabel("Animate character")).toBeChecked();
  await expect(page.getByLabel("Animate character")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Preview companion" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Size", exact: true })).toBeDisabled();
  await expect(page.locator("#companion-status")).toContainText("desktop app");
  await page.getByText("Audio timing diagnostics", { exact: true }).click();
  await expect(page.getByLabel("Show diagnostic display")).toBeDisabled();
});

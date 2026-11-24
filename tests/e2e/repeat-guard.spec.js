import { test, expect } from "@playwright/test";
import { openDetails } from "./helpers/ui.js";

test("random repeat preference defaults on and survives reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "Avoid repeating the same line or sound for each random recurring chime" });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.reload();
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  await expect(checkbox).not.toBeChecked();
});

test("recurring simulation respects the no-repeat setting", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-1"]');
  await interval.locator("summary").click();
  await interval.getByRole("button", { name: "Sim 100" }).click();
  const output = interval.locator(".interval-weight-sim-output");
  await expect(output).toContainText("50%");
  await page.getByRole("checkbox", { name: "Avoid repeating the same line or sound for each random recurring chime" }).uncheck();
  await interval.getByRole("button", { name: "Sim 100" }).click();
  await expect(output).toContainText("100%");
});

test("recurring simulation avoids either take of the previous spoken line", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/#chimes");
  const interval = page.locator('.interval-row[data-interval-id="interval-1"]');
  await openDetails(interval.locator(".interval-advanced"));
  await interval.locator(".interval-preset-set").selectOption(["laura-minute-01", "laura-minute-01-b", "laura-minute-02"]);
  await openDetails(interval.locator(".interval-advanced"));
  await interval.getByRole("button", { name: "Sim 100" }).click();
  const output = interval.locator(".interval-weight-sim-output");
  await expect(output).toContainText("Another minute gone. No refunds. · Take 1 50%");
  await expect(output).toContainText("Another minute gone. No refunds. · Take 2 0%");
  await expect(output).toContainText("One minute. Still working on that? · Take 1 50%");
});

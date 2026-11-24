import { expect, test } from "@playwright/test";

test("overview status button starts and pauses chimes and keeps volume accessible", async ({ page }) => {
  await page.goto("/");
  const control = page.locator("#toggle-engine");
  await expect(control).toHaveAccessibleName("Start Chimes");
  await control.focus();
  await page.keyboard.press("Enter");
  await expect(control).toHaveAccessibleName("Pause Chimes");
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.keyboard.press("Space");
  await expect(control).toHaveAccessibleName("Start Chimes");
  await expect(page.locator("#status-text")).toHaveText("Paused");

  const volume = page.getByLabel("Master volume");
  await volume.fill("0.4");
  await expect(page.locator("#master-volume-value")).toHaveText("40%");
  await page.reload();
  await expect(volume).toHaveValue("0.4");
  await expect(page.locator("#master-volume-value")).toHaveText("40%");
});

test("overview clock follows the app font and controls fit a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const fonts = await page.evaluate(() => ({
    clock: getComputedStyle(document.getElementById("clock")).fontFamily,
    app: getComputedStyle(document.body).fontFamily,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(fonts.clock).toBe(fonts.app);
  expect(fonts.pageWidth).toBe(fonts.viewportWidth);
  await expect(page.getByRole("button", { name: "Start Chimes" })).toBeVisible();
  await expect(page.getByLabel("Master volume")).toBeVisible();
});

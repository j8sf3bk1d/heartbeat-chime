import { test, expect } from "@playwright/test";

test("overlay keeps long imported labels bounded while bundled captions remain readable", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 270 });
  await page.goto("/overlay.html");
  const text = page.locator("#dialogue-text");
  await text.evaluate((element) => { element.textContent = "long imported name ".repeat(30); });
  const longGeometry = await page.locator(".dialogue").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const name = element.querySelector(".character-name").getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, nameTop: name.top, height: bounds.height };
  });
  expect(longGeometry.top).toBeGreaterThanOrEqual(0);
  expect(longGeometry.nameTop).toBeGreaterThanOrEqual(0);
  expect(longGeometry.bottom).toBeLessThanOrEqual(270);
  await text.evaluate((element) => { element.textContent = "Another minute gone. No refunds."; });
  expect(await text.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
});

test("overlay text and portrait scale with the window without clipping captions", async ({ page }) => {
  const sizes = [{ width: 450, height: 203, font: 12 }, { width: 600, height: 270, font: 16 }, { width: 900, height: 405, font: 24 }];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/overlay.html");
    const text = page.locator("#dialogue-text");
    await text.evaluate((element) => { element.textContent = "Another minute gone. No refunds."; });
    const info = await text.evaluate((element) => {
      const bounds = element.closest(".dialogue").getBoundingClientRect();
      return { font: parseFloat(getComputedStyle(element).fontSize), fits: element.scrollHeight <= element.clientHeight, top: bounds.top, bottom: bounds.bottom };
    });
    expect(info.font).toBeCloseTo(size.font, 0);
    expect(info.fits).toBe(true);
    expect(info.top).toBeGreaterThanOrEqual(0);
    expect(info.bottom).toBeLessThanOrEqual(size.height);
    await text.evaluate((element) => { element.textContent = "long imported sound name ".repeat(30); });
    const long = await page.locator(".dialogue").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, nameTop: element.querySelector(".character-name").getBoundingClientRect().top };
    });
    expect(long.top).toBeGreaterThanOrEqual(0);
    expect(long.nameTop).toBeGreaterThanOrEqual(0);
    expect(long.bottom).toBeLessThanOrEqual(size.height);
  }
});

import { expect, test } from "@playwright/test";

for (const width of [375, 1200]) {
  test(`selected clip weights stay readable and editable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#chimes");
    const interval = page.locator('.interval-row[data-interval-id="interval-1"]');
    await interval.locator("summary").click();
    const editor = interval.locator(".weight-editor");
    const controls = editor.locator(".weight-control");
    const selectedCount = await interval.locator(".interval-preset-set option:checked").count();
    expect(selectedCount).toBeGreaterThanOrEqual(16);
    await expect(controls).toHaveCount(selectedCount);

    // Labels and inputs must stay inside their own control and never overlap.
    const geometry = await controls.evaluateAll((labels) => labels.map((label) => {
      const box = label.getBoundingClientRect();
      const text = label.querySelector("span").getBoundingClientRect();
      const input = label.querySelector("input").getBoundingClientRect();
      return { left: box.left, right: box.right, textRight: text.right, inputLeft: input.left, inputRight: input.right };
    }));
    for (const item of geometry) {
      expect(item.textRight).toBeLessThanOrEqual(item.inputLeft + 0.5);
      expect(item.inputRight).toBeLessThanOrEqual(item.right + 0.5);
      expect(item.inputLeft).toBeGreaterThanOrEqual(item.left - 0.5);
    }

    const firstInput = controls.first().locator("input");
    await expect(firstInput).toHaveAccessibleName(/./);
    await firstInput.fill("2.5");
    await firstInput.press("Tab");
    await page.reload();
    await interval.locator("summary").click();
    await expect(interval.locator(".weight-control input").first()).toHaveValue("2.5");
  });
}

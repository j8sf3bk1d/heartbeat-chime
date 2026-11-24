import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";
import { openDetails } from "./helpers/ui.js";

test("configuration strings cannot break out of timer attributes or log text", async ({ page }) => {
  const text = `\"><img src=x onerror="window.injected=1"> & 'quoted'`;
  const timerId = `timer\" onpointerover=\"window.injected=1\" data-extra=\"`;
  await page.goto("/#settings");
  await page.locator("#config-import-file").setInputFiles({
    name: "untrusted-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      oneShots: [{ id: timerId, label: text, targetAtMs: Date.now() + 60_000, active: true }],
      log: [{ atMs: Date.now(), message: text }]
    }))
  });
  await expect(page.locator(".log-item").filter({ hasText: "Imported config" })).toHaveCount(1);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await page.getByRole("link", { name: "Timers", exact: true }).click();
    const timer = page.locator(".timer-item");
    await expect(timer.locator(".timer-title")).toHaveText(text);
    await expect(timer).toHaveAttribute("data-timer-id", timerId);
    await expect(timer).not.toHaveAttribute("onpointerover");
    await expect(timer).not.toHaveAttribute("data-extra");
    await expect(timer.locator("[data-timer-progress-for]")).toHaveAttribute("data-timer-progress-for", timerId);
    await expect(page.locator(".log-item span:last-child").filter({ hasText: text })).toHaveCount(1);
    await expect(page.locator('img[src="x"], [onerror], [onpointerover]')).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  }
  // Escaping must preserve the identifier used by delegated timer actions.
  await page.locator(".timer-item").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".timer-item")).toHaveClass(/timer-finished/);
});

test("pack metadata stays text in options, groups, tags, descriptions and weight editors", async ({ page }) => {
  const text = `\"><svg onload="window.injected=1"></svg> & 'quoted'`;
  await page.goto("/#sounds");
  await openDetails(page.locator(".pack-admin"));
  await page.locator("#pack-files").setInputFiles([
    { name: "pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      packId: "security-contexts", label: text, description: text,
      sounds: [{ id: "tone", label: text, description: text, tags: [text], file: "tone.wav" }],
      profiles: [{ id: "profile", label: text, description: text }]
    })) },
    { name: "tone.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 440 }) }
  ]);
  await page.locator("#pack-import-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".pack-title")).toHaveText(text);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await openDetails(page.locator("#sound-library-browser"));
    await expect(page.locator(".preset-tag").filter({ hasText: text })).toHaveText(text);
    await expect(page.locator(".preset-item").filter({ hasText: text }).locator(".preset-meta")).toContainText(text);
    await expect(page.locator('#relative-preset option[value="custom:security-contexts:tone"]')).toHaveText(text);
    await expect(page.locator("#relative-preset optgroup").filter({ has: page.locator('[value="custom:security-contexts:tone"]') })).toHaveAttribute("label", `Imported: ${text}`);
    await page.getByRole("link", { name: "Chimes", exact: true }).click();
    await page.locator("#sound-profile").selectOption("custom:security-contexts:profile");
    await page.locator("#sound-profile-apply").click();
    const first = page.locator(".interval-row").first();
    await openDetails(first.locator(".interval-advanced"));
    await expect(first.locator(".weight-control span")).toHaveText(text);
    await expect(page.locator("[onload], [onerror], .preset-item svg")).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    await page.getByRole("link", { name: "Sounds", exact: true }).click();
  }
});

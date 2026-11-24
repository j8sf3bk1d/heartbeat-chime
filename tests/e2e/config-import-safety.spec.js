import { expect, test } from "@playwright/test";

const key = "heartbeat-state-v1";

async function importConfig(page, state) {
  await page.locator("#config-import-file").setInputFiles({
    name: "config.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, state }))
  });
}

test("import preserves this installation's launch and running intent", async ({ page }) => {
  await page.goto("/#overview");
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.goto("/#settings");
  await importConfig(page, { launchAtLogin: true, schedulerRequested: false, masterVolume: 0.4 });
  await expect(page.locator("#log-list")).toContainText("Imported config");
  await expect(page.locator("#status-text")).toHaveText("Running");
  const saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.launchAtLogin).toBe(false);
  expect(saved.schedulerRequested).toBe(true);
  expect(saved.masterVolume).toBe(0.4);
});

test("a failed config save leaves running settings intact", async ({ page }) => {
  await page.goto("/#overview");
  await page.locator("#toggle-engine").click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.goto("/#settings");
  const before = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === "heartbeat-state-v1") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, storageKey, value);
    };
  });
  await importConfig(page, { masterVolume: 0.123 });
  await expect(page.locator("#log-list")).toContainText("Config import failed");
  await expect(page.locator("#status-text")).toHaveText("Running");
  const after = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(after.masterVolume).toBe(before.masterVolume);
  expect(after.schedulerRequested).toBe(before.schedulerRequested);
});

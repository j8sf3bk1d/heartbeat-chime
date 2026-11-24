import { expect, test } from "@playwright/test";

test("an unreadable configuration can be downloaded after startup and reload", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("recovery-fixture-seeded")) {
      localStorage.setItem("heartbeat-state-v1", "{damaged configuration");
      sessionStorage.setItem("recovery-fixture-seeded", "yes");
    }
  });
  await page.goto("/");
  await expect(page.locator("#storage-warning")).toContainText("recovery copy was preserved");
  await page.reload();
  await expect(page.locator("#storage-warning")).toContainText("unreadable configuration was preserved");
  const pendingDownload = page.waitForEvent("download");
  await page.locator("#storage-recovery-download").click();
  const download = await pendingDownload;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("{damaged configuration");
  await page.locator("#storage-recovery-dismiss").click();
  await expect(page.locator("#storage-warning")).toBeHidden();
  await page.reload();
  await expect(page.locator("#storage-warning")).toBeHidden();
  const copies = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("heartbeat-state-v1-recovery-")).map((key) => localStorage.getItem(key)));
  expect(copies).toContain("{damaged configuration");
});

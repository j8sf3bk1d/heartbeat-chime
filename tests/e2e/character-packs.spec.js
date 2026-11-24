import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("imported characters survive restart, export, and swap without changing chimes", async ({page}) => {
  await page.goto("/#settings");
  const png = await readFile("examples/character/neutral.png");
  const pack = {format:"heartbeat-character-prototype",version:1,name:"Test character",masks:{"eye-x":50,"eye-y":33,"eye-w":23,"eye-h":9,"mouth-x":50,"mouth-y":42,"mouth-w":8,"mouth-h":4},frames:{neutral:{base:`data:image/png;base64,${png.toString("base64")}`}}};
  await page.locator("#character-file").setInputFiles({name:"test.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(pack))});
  await expect(page.locator("#companion-status")).toContainText("imported");
  await expect(page.locator("#companion-character")).toHaveValue(/^character:/);
  await page.reload();
  await expect(page.locator("#companion-character")).toHaveValue(/^character:/);
  const download = page.waitForEvent("download");
  await page.getByRole("button",{name:"Export character"}).click();
  expect(JSON.parse(await readFile(await (await download).path(), "utf8")).name).toBe("Test character");
  await page.locator("#companion-character").selectOption("builtin");
  await expect(page.locator("#companion-character")).toHaveValue("builtin");
  await page.reload();
  await expect(page.locator("#companion-character")).toHaveValue("builtin");
});

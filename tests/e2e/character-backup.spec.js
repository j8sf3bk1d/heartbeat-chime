import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const masks = {"eye-x":50,"eye-y":33,"eye-w":23,"eye-h":9,"mouth-x":50,"mouth-y":42,"mouth-w":8,"mouth-h":4};
async function makePack(name) {
  const png = await readFile("examples/character/neutral.png");
  return {format:"heartbeat-character-prototype",version:1,name,masks,frames:{neutral:{base:`data:image/png;base64,${png.toString("base64")}`}}};
}
async function addCharacter(page, pack) {
  await page.locator("#character-file").setInputFiles({name:"character.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(pack))});
  await expect(page.locator("#companion-status")).toContainText("imported");
}
async function exportBackup(page) {
  const download = page.waitForEvent("download");
  await page.locator("#backup-export").click();
  return readFile(await (await download).path());
}
async function restore(page, bytes) {
  await page.locator("#backup-import-file").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:bytes});
  await page.getByRole("dialog").getByRole("button",{name:"Restore backup"}).click({timeout:60_000});
}

test("full backup restores all characters and selection in a fresh profile, then handles collisions", async ({browser,page}) => {
  await page.goto("/#settings");
  await addCharacter(page, await makePack("First"));
  await addCharacter(page, await makePack("Second"));
  const backup = await exportBackup(page);
  const data = JSON.parse(backup.toString());
  expect(data.version).toBe(2);
  expect(data.characters.packs.map(x => x.pack.name).sort()).toEqual(["First","Second"]);
  expect(data.characters.packs.find(x => x.id === data.characters.selectedId).pack.name).toBe("Second");
  const context = await browser.newContext(); const fresh = await context.newPage();
  await fresh.goto("/#settings"); await restore(fresh, backup);
  await expect(fresh.locator("#backup-status")).toContainText("Backup restored");
  await expect(fresh.locator("#companion-character option:checked")).toHaveText("Second");
  await fresh.reload();
  await expect(fresh.locator("#companion-character option:checked")).toHaveText("Second");
  await restore(fresh, backup);
  await expect(fresh.locator("#backup-status")).toContainText("Backup restored");
  await expect(fresh.locator('#companion-character option')).toHaveCount(5);
  await expect(fresh.locator("#companion-character option:checked")).toHaveText("Second");
  await context.close();
});

test("old backups preserve the current character and damaged character data is rejected before restore", async ({page}) => {
  await page.goto("/#settings"); await addCharacter(page, await makePack("Current"));
  const original = await page.locator("#companion-character").inputValue();
  const data = JSON.parse((await exportBackup(page)).toString());
  const legacy = {...data,version:1}; delete legacy.characters;
  await restore(page, Buffer.from(JSON.stringify(legacy)));
  await expect(page.locator("#backup-status")).toContainText("Backup restored");
  await expect(page.locator("#companion-character")).toHaveValue(original);
  data.characters.packs[0].pack.name = "Tampered";
  await page.locator("#backup-import-file").setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator("#backup-status")).toContainText("integrity check");
  await expect(page.locator("#companion-character")).toHaveValue(original);
  await expect(page.locator('#companion-character option')).toHaveCount(2);
});

test("restore confirmation can be dismissed with Escape without changing the selected character", async ({page}) => {
  await page.goto("/#settings"); await addCharacter(page, await makePack("Kept"));
  const original = await page.locator("#companion-character").inputValue();
  const backup = await exportBackup(page);
  await page.locator("#backup-import-file").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:backup});
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#backup-status")).toContainText("Restore canceled");
  await expect(page.locator("#companion-character")).toHaveValue(original);
});

test("failed settings commit keeps the current character and reports added copies", async ({page}) => {
  await page.goto("/#settings"); await addCharacter(page, await makePack("Kept"));
  const original = await page.locator("#companion-character").inputValue();
  const backup = await exportBackup(page);
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) { if (key === "heartbeat-state-v1") throw new DOMException("Storage full", "QuotaExceededError"); return save.call(this,key,value); };
  });
  await restore(page,backup);
  await expect(page.locator("#backup-status")).toContainText("Some sounds and characters were added, but settings could not be restored");
  await expect(page.locator("#companion-character")).toHaveValue(original);
});

test("selection write failure reports restored settings and retained prior selection", async ({page}) => {
  await page.goto("/#settings"); await addCharacter(page, await makePack("Kept"));
  const original = await page.locator("#companion-character").inputValue();
  const backup = await exportBackup(page);
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) { if (key === "heartbeat.character.selected.v1") throw new DOMException("Storage full", "QuotaExceededError"); return save.call(this,key,value); };
  });
  await restore(page,backup);
  await expect(page.locator("#backup-status")).toContainText("Character selection could not be saved");
  expect(await page.evaluate(() => localStorage.getItem("heartbeat.character.selected.v1"))).toBe(original);
});

test("full 24-frame character pack survives a complete backup roundtrip", async ({browser,page}) => {
  test.setTimeout(120_000);
  const names = ["neutral","smug","flustered","hmph","caring","impressed","exasperated","delighted"];
  const pack = {format:"heartbeat-character-prototype",version:1,name:"Example Character",masks,frames:{}};
  for (const name of names) {
    pack.frames[name] = {};
    for (const [mode,suffix] of [["base",""],["blink","-blink"],["talk","-talk"]]) {
      const data = await readFile("examples/character/neutral.png");
      pack.frames[name][mode] = `data:image/png;base64,${data.toString("base64")}`;
    }
  }
  await page.goto("/#settings"); await addCharacter(page, pack);
  const bytes = await exportBackup(page);
  const context = await browser.newContext(); const fresh = await context.newPage();
  await fresh.goto("/#settings"); await restore(fresh, bytes);
  await expect(fresh.locator("#backup-status")).toContainText("Backup restored",{timeout:60_000});
  await fresh.reload(); await expect(fresh.locator("#companion-character option:checked")).toHaveText("Example Character");
  const exported = fresh.waitForEvent("download"); await fresh.locator("#character-export").click();
  const restored = JSON.parse(await readFile(await (await exported).path(), "utf8"));
  expect(Object.keys(restored.frames)).toHaveLength(8);
  expect(Object.values(restored.frames).every(x => x.base && x.blink && x.talk)).toBe(true);
  expect(restored.frames.delighted.talk).toBe(pack.frames.delighted.talk);
  await context.close();
});

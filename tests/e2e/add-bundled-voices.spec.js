import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const voiceManifest = JSON.parse(readFileSync(new URL("../../src/assets/voices/laura/manifest.json", import.meta.url), "utf8"));

const key = "heartbeat-state-v1";
const original = (prefix) => [1, 2, 3, 4, 5].flatMap((n) => {
  const id = `laura-${prefix}-0${n}`;
  return [id, `${id}-b`];
});

test("adding bundled voices preserves a custom profile, current weights and other intervals", async ({ page }) => {
  const minute = original("minute");
  const five = original("five-minute");
  const weights = Object.fromEntries(minute.map((id) => [id, 1]));
  await page.addInitScript(({ storageKey, oldMinute, oldFive, oldWeights }) => {
    if (sessionStorage.getItem("add-voices-fixture")) return;
    sessionStorage.setItem("add-voices-fixture", "1");
    localStorage.setItem(storageKey, JSON.stringify({
      selectedProfileId: "clocktower", voiceCoverageMigrationVersion: 1,
      intervals: [
        { id: "interval-1", enabled: true, presetId: oldMinute[0], presetIds: oldMinute, playbackMode: "random", presetWeights: oldWeights, volume: 0.35 },
        { id: "interval-5", enabled: true, presetId: oldFive[0], presetIds: oldFive, playbackMode: "sequential", presetWeights: {}, volume: 0.42 }
      ]
    }));
  }, { storageKey: key, oldMinute: minute, oldFive: five, oldWeights: weights });
  await page.goto("/#chimes");
  const row = page.locator('.interval-row[data-interval-id="interval-1"]');
  await row.locator("summary").click();
  const allMinute = voiceManifest.clips.filter((clip) => clip.intervalMinutes === 1).map((clip) => clip.id);
  await expect(row.locator(".interval-add-bundled-voices")).toHaveText(`Add ${allMinute.length - minute.length} bundled voices`);
  await row.locator(".interval-add-bundled-voices").click();
  let saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.selectedProfileId).toBe("clocktower");
  const first = saved.intervals.find((item) => item.id === "interval-1");
  expect(first.presetIds.slice(0, minute.length)).toEqual(minute);
  expect(new Set(first.presetIds)).toEqual(new Set(allMinute));
  expect(first.presetWeights).toEqual(weights);
  expect(first.presetId).toBe(minute[0]);
  expect(first.playbackMode).toBe("random");
  expect(first.volume).toBe(0.35);
  expect(saved.intervals.find((item) => item.id === "interval-5").presetIds).toEqual(five);
  await expect(row.locator(".interval-add-bundled-voices")).toHaveCount(0);
  await page.reload();
  saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.intervals.find((item) => item.id === "interval-1").presetIds).toEqual(first.presetIds);
  expect(saved.intervals.find((item) => item.id === "interval-1").presetWeights).toEqual(weights);
});

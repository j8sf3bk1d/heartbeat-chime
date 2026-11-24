import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const voiceManifest = JSON.parse(readFileSync(new URL("../../src/assets/voices/laura/manifest.json", import.meta.url), "utf8"));

const key = "heartbeat-state-v1";
const original = (prefix) => [1, 2, 3, 4, 5].flatMap((n) => {
  const id = `laura-${prefix}-0${n}`;
  return [id, `${id}-b`];
});
const cue = (minutes, ids, extra = {}) => ({
  id: `interval-${minutes}`, enabled: true, presetId: ids[0], presetIds: ids,
  playbackMode: "random", presetWeights: {}, ...extra
});

test("startup upgrades only untouched legacy defaults and persists the marker", async ({ page }) => {
  const minute = original("minute");
  const five = original("five-minute");
  await page.addInitScript(({ storageKey, oldMinute, oldFive }) => {
    if (sessionStorage.getItem("voice-migration-fixture")) return;
    sessionStorage.setItem("voice-migration-fixture", "1");
    localStorage.setItem(storageKey, JSON.stringify({
      selectedProfileId: "dry_time_checks", masterVolume: 0.43,
      intervals: [
        { id: "interval-1", enabled: true, presetId: oldMinute[0], presetIds: oldMinute, playbackMode: "random", presetWeights: { [oldMinute[0]]: 3 } },
        { id: "interval-5", enabled: true, presetId: oldFive[0], presetIds: oldFive, playbackMode: "random", presetWeights: {}, volume: 0.32 }
      ]
    }));
  }, { storageKey: key, oldMinute: minute, oldFive: five });
  await page.goto("/#chimes");
  const fiveSet = page.locator('.interval-row[data-interval-id="interval-5"] .interval-preset-set option:checked');
  const expectedFiveCount = voiceManifest.clips.filter((clip) => clip.intervalMinutes === 5).length;
  await expect(fiveSet).toHaveCount(expectedFiveCount);
  await expect.poll(() => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)).voiceCoverageMigrationVersion, key)).toBe(voiceManifest.frequencyCoverageVersion === 2 ? 2 : 1);
  const saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.masterVolume).toBe(0.43);
  expect(saved.intervals.find((item) => item.id === "interval-1").presetIds).toEqual(minute);
  expect(saved.intervals.find((item) => item.id === "interval-1").presetWeights[minute[0]]).toBe(3);
  expect(saved.intervals.find((item) => item.id === "interval-5").volume).toBe(0.32);
  await page.reload();
  await expect(fiveSet).toHaveCount(expectedFiveCount);
});

test("explicit import retains its legacy selection through restart", async ({ page }) => {
  const ids = original("five-minute");
  await page.goto("/#settings");
  await page.locator("#config-import-file").setInputFiles({ name: "legacy.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, state: { selectedProfileId: "dry_time_checks", intervals: [cue(5, ids)] } })) });
  await expect(page.locator("#log-list")).toContainText("Imported config");
  await page.reload();
  const saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.voiceCoverageMigrationVersion).toBe(2);
  expect(saved.intervals.find((item) => item.id === "interval-5").presetIds).toEqual(ids);
});

test("frequency expansion upgrades only exact previous defaults once", async ({ page }) => {
  test.skip(voiceManifest.frequencyCoverageVersion !== 2, "Full frequency-expanded bank has not yet been promoted");
  const baseline = (minutes) => voiceManifest.clips
    .filter((clip) => clip.intervalMinutes === minutes && clip.collection !== "frequency-v2")
    .map((clip) => clip.id);
  const oldMinute = baseline(1);
  const oldFive = baseline(5);
  expect(oldMinute).toHaveLength(22);
  expect(oldFive).toHaveLength(22);
  await page.addInitScript(({ storageKey, first, second }) => {
    if (sessionStorage.getItem("frequency-migration-fixture")) return;
    sessionStorage.setItem("frequency-migration-fixture", "1");
    localStorage.setItem(storageKey, JSON.stringify({
      selectedProfileId: "dry_time_checks", voiceCoverageMigrationVersion: 1,
      intervals: [
        { id: "interval-1", enabled: true, presetId: first[0], presetIds: first, playbackMode: "random", presetWeights: {}, volume: 0.31 },
        { id: "interval-5", enabled: true, presetId: second[0], presetIds: second, playbackMode: "random", presetWeights: { [second[0]]: 2 } }
      ]
    }));
  }, { storageKey: key, first: oldMinute, second: oldFive });
  await page.goto("/#chimes");
  await expect.poll(() => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)).voiceCoverageMigrationVersion, key)).toBe(2);
  let saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  const one = saved.intervals.find((item) => item.id === "interval-1");
  expect(one.presetIds).toEqual(voiceManifest.clips.filter((clip) => clip.intervalMinutes === 1).map((clip) => clip.id));
  expect(one.volume).toBe(0.31);
  expect(saved.intervals.find((item) => item.id === "interval-5").presetIds).toEqual(oldFive);
  expect(saved.intervals.find((item) => item.id === "interval-5").presetWeights[oldFive[0]]).toBe(2);
  await page.reload();
  saved = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
  expect(saved.intervals.find((item) => item.id === "interval-1").presetIds).toEqual(one.presetIds);
});

import { describe, expect, it } from "vitest";
import { migrateLegacyVoiceDefaults } from "../../src/lib/voiceCoverageMigration.js";
import { serializeState } from "../../src/lib/stateSerializer.js";

const legacy = Array.from({ length: 10 }, (_, index) => `legacy-${index}`);
const expanded = [...legacy, "new-1", "new-2"];
const set = { hasCompleteExpressionCoverage: true, legacyIntervalPresetByMinutes: { 5: legacy }, intervalPresetByMinutes: { 5: expanded } };
const savedCue = { id: "interval-5", minutes: 5, presetId: legacy[0], presetIds: legacy, playbackMode: "random", presetWeights: {}, volume: 0.3, enabled: true };
const saved = { selectedProfileId: "dry_time_checks", intervals: [savedCue] };

describe("expanded voice default migration", () => {
  it("expands only an untouched old default without changing other settings", () => {
    const result = migrateLegacyVoiceDefaults(saved, [savedCue], set, { migrate: true });
    expect(result).toEqual({ intervals: [{ ...savedCue, presetIds: expanded }], version: 1 });
    expect(savedCue.presetIds).toEqual(legacy);
    expect(migrateLegacyVoiceDefaults({ ...saved, voiceCoverageMigrationVersion: result.version }, result.intervals, set, { migrate: true })).toEqual(result);
  });

  it("preserves edited, weighted, sequential, partial and other-profile settings", () => {
    for (const change of [
      { presetIds: legacy.slice(1) }, { presetWeights: { [legacy[0]]: 2 } },
      { playbackMode: "sequential" }, { presetId: "custom-choice" }
    ]) {
      const cue = { ...savedCue, ...change };
      expect(migrateLegacyVoiceDefaults({ ...saved, intervals: [cue] }, [cue], set, { migrate: true }).intervals).toEqual([cue]);
    }
    expect(migrateLegacyVoiceDefaults({ ...saved, selectedProfileId: "clocktower" }, [savedCue], set, { migrate: true }).intervals).toEqual([savedCue]);
    expect(migrateLegacyVoiceDefaults(saved, [savedCue], { ...set, hasCompleteExpressionCoverage: false }, { migrate: true })).toEqual({ intervals: [savedCue], version: 0 });
  });

  it("keeps imported backup assignments exact across later reloads", () => {
    const imported = migrateLegacyVoiceDefaults(saved, [savedCue], set, { explicitImport: true });
    expect(imported).toEqual({ intervals: [savedCue], version: 2 });
    expect(serializeState({ voiceCoverageMigrationVersion: imported.version }).voiceCoverageMigrationVersion).toBe(2);
    expect(migrateLegacyVoiceDefaults({ ...saved, voiceCoverageMigrationVersion: imported.version }, imported.intervals, set, { migrate: true })).toEqual(imported);
  });
});

describe("frequent voice pool expansion", () => {
  const baseline = Array.from({ length: 22 }, (_, index) => `base-${index}`);
  const full = [...baseline, ...Array.from({ length: 44 }, (_, index) => `v2-${index}`)];
  const setV2 = { hasCompleteExpressionCoverage: true, hasCompleteFrequencyCoverage: true,
    legacyIntervalPresetByMinutes: { 1: legacy }, frequencyBaseIntervalPresetByMinutes: { 1: baseline },
    intervalPresetByMinutes: { 1: full } };
  const baseCue = { ...savedCue, id: "interval-1", minutes: 1, presetId: baseline[0], presetIds: baseline };
  const baseSaved = { selectedProfileId: "dry_time_checks", voiceCoverageMigrationVersion: 1, intervals: [baseCue] };

  it("expands exactly the prior unweighted random default once and preserves other fields", () => {
    const result = migrateLegacyVoiceDefaults(baseSaved, [baseCue], setV2, { migrate: true });
    expect(result).toEqual({ intervals: [{ ...baseCue, presetIds: full }], version: 2 });
    expect(baseCue.presetIds).toEqual(baseline);
    expect(migrateLegacyVoiceDefaults({ ...baseSaved, voiceCoverageMigrationVersion: 2 }, result.intervals, setV2, { migrate: true })).toEqual(result);
  });

  it("preserves user-customized pools, weights, playback modes and other profiles", () => {
    for (const change of [
      { presetIds: baseline.slice(1) }, { presetIds: [...baseline, "custom"] },
      { presetWeights: { [baseline[0]]: 2 } }, { playbackMode: "sequential" }, { presetId: "custom-choice" }
    ]) {
      const cue = { ...baseCue, ...change };
      const result = migrateLegacyVoiceDefaults({ ...baseSaved, intervals: [cue] }, [cue], setV2, { migrate: true });
      expect(result).toEqual({ intervals: [cue], version: 2 });
    }
    expect(migrateLegacyVoiceDefaults({ ...baseSaved, selectedProfileId: "clocktower" }, [baseCue], setV2, { migrate: true })).toEqual({ intervals: [baseCue], version: 2 });
  });

  it("does not consume the migration marker until the entire v2 bank is validated", () => {
    const unavailable = { ...setV2, hasCompleteFrequencyCoverage: false };
    expect(migrateLegacyVoiceDefaults(baseSaved, [baseCue], unavailable, { migrate: true })).toEqual({ intervals: [baseCue], version: 1 });
    expect(migrateLegacyVoiceDefaults({ ...baseSaved, voiceCoverageMigrationVersion: 1 }, [baseCue], setV2, { migrate: true }).intervals[0].presetIds).toEqual(full);
  });

  it("upgrades original v0 defaults directly but keeps an explicit old backup exact", () => {
    const oldCue = { ...baseCue, presetId: legacy[0], presetIds: legacy };
    const oldState = { selectedProfileId: "dry_time_checks", intervals: [oldCue] };
    expect(migrateLegacyVoiceDefaults(oldState, [oldCue], setV2, { migrate: true })).toEqual({ intervals: [{ ...oldCue, presetIds: full }], version: 2 });
    const imported = migrateLegacyVoiceDefaults(oldState, [oldCue], setV2, { explicitImport: true });
    expect(imported).toEqual({ intervals: [oldCue], version: 2 });
    expect(migrateLegacyVoiceDefaults({ ...oldState, voiceCoverageMigrationVersion: 2 }, imported.intervals, setV2, { migrate: true })).toEqual(imported);
  });
});

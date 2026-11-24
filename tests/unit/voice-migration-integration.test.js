import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const legacy = Array.from({ length: 10 }, (_, index) => `voice-old-${index}`);
  const expanded = [...legacy, "voice-new-1", "voice-new-2"];
  return { legacy, expanded, set: {
    hasCompleteExpressionCoverage: true,
    presets: expanded.map((id) => ({ id, label: id })),
    legacyIntervalPresetByMinutes: { 5: legacy },
    intervalPresetByMinutes: { 5: expanded }
  } };
});
vi.mock("../../src/lib/builtInVoices.js", () => ({
  BUILT_IN_VOICE_SET: fixtures.set,
  getBuiltInVoiceUrl: () => null,
  isKnownBuiltInVoiceId: (id) => fixtures.expanded.includes(id)
}));

import { createStatePersistence } from "../../src/lib/configState.js";
import { prepareConfigImport } from "../../src/lib/configImport.js";
import { createDefaultState, normalizeState, serializeState } from "../../src/lib/state.js";
import { PRESETS, SOUND_PROFILES } from "../../src/lib/soundProfiles.js";

function store(initial) {
  const records = new Map(Object.entries(initial));
  return { getItem: (key) => records.has(key) ? records.get(key) : null,
    setItem: (key, value) => records.set(key, String(value)), removeItem: (key) => records.delete(key) };
}
function load(storage) {
  return createStatePersistence({ storageKey: "state", getStorage: () => storage }).load({
    createDefaultState, normalizeState, presets: PRESETS, soundProfiles: SOUND_PROFILES
  });
}
function oldState(change = {}) {
  return { selectedProfileId: "dry_time_checks", masterVolume: 0.42, intervals: [{
    id: "interval-5", enabled: true, presetId: fixtures.legacy[0], presetIds: fixtures.legacy,
    playbackMode: "random", presetWeights: {}, ...change
  }] };
}
const cue = (state) => state.intervals.find((interval) => interval.id === "interval-5");

describe("voice migration storage and import wiring", () => {
  beforeEach(() => { fixtures.set.hasCompleteExpressionCoverage = true; });

  it("migrates an old saved default once and persists the marker", () => {
    const storage = store({ state: JSON.stringify(oldState()) });
    const first = load(storage);
    expect(cue(first).presetIds).toEqual(fixtures.expanded);
    expect(first.masterVolume).toBe(0.42);
    expect(first.voiceCoverageMigrationVersion).toBe(1);
    storage.setItem("state", JSON.stringify(serializeState(first)));
    expect(cue(load(storage)).presetIds).toEqual(fixtures.expanded);
  });

  it("does not mutate edited or weighted legacy assignments", () => {
    for (const change of [{ presetWeights: { [fixtures.legacy[0]]: 3 } }, { playbackMode: "sequential" }, { presetIds: fixtures.legacy.slice(0, 9) }]) {
      const result = cue(load(store({ state: JSON.stringify(oldState(change)) })));
      expect(result.presetIds).toEqual(change.presetIds || fixtures.legacy);
      expect(result.playbackMode).toBe(change.playbackMode || "random");
      if (change.presetWeights) expect(result.presetWeights).toEqual(change.presetWeights);
    }
  });

  it("retries on later startup when the full pack was unavailable", () => {
    const storage = store({ state: JSON.stringify(oldState()) });
    fixtures.set.hasCompleteExpressionCoverage = false;
    const first = load(storage);
    expect(cue(first).presetIds).toEqual(fixtures.legacy);
    expect(first.voiceCoverageMigrationVersion).toBe(0);
    storage.setItem("state", JSON.stringify(serializeState(first)));
    fixtures.set.hasCompleteExpressionCoverage = true;
    expect(cue(load(storage)).presetIds).toEqual(fixtures.expanded);
  });

  it("preserves a deliberate old config or backup import across restart", () => {
    const candidate = prepareConfigImport({ state: oldState() }, {
      state: { launchAtLogin: false, schedulerRequested: false }, createDefaultState, normalizeState,
      presets: PRESETS, profileIds: SOUND_PROFILES.map(({ id }) => id)
    });
    expect(candidate.voiceCoverageMigrationVersion).toBe(2);
    expect(cue(candidate).presetIds).toEqual(fixtures.legacy);
    expect(cue(load(store({ state: JSON.stringify(serializeState(candidate)) }))).presetIds).toEqual(fixtures.legacy);
  });
});

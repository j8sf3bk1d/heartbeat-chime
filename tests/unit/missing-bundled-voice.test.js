import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/builtInVoices.js", () => ({
  BUILT_IN_VOICE_SET: null,
  isKnownBuiltInVoiceId: (id) => ["laura-minute-01", "laura-minute-01-b"].includes(id),
  getBuiltInVoiceUrl: () => null
}));
import { PRESETS, SOUND_PROFILES } from "../../src/lib/soundProfiles.js";
import { createDefaultState, normalizeState } from "../../src/lib/state.js";
import { createCueSoundHelpers } from "../../src/lib/cueSoundHelpers.js";
import { isKnownBuiltInVoiceId } from "../../src/lib/builtInVoices.js";

describe("incomplete bundled voice set", () => {
  it("keeps known saved IDs, weights and profile without exposing the profile", () => {
    expect(SOUND_PROFILES.some((profile) => profile.id === "dry_time_checks")).toBe(false);
    const saved = { selectedProfileId: "dry_time_checks", intervals: [{ id: "interval-1", enabled: true,
      presetId: "laura-minute-01", presetIds: ["laura-minute-01", "laura-minute-01-b"],
      presetWeights: { "laura-minute-01-b": 2 }, playbackMode: "weighted-random" }] };
    const restored = normalizeState(saved, createDefaultState(), PRESETS, SOUND_PROFILES.map((profile) => profile.id));
    const cue = restored.intervals[0];
    const helper = createCueSoundHelpers({ hasPresetId: (id) => PRESETS.some((preset) => preset.id === id) || isKnownBuiltInVoiceId(id), getPresetLabel: (id) => id });
    helper.normalizeCueSoundConfig(cue);
    expect(restored.selectedProfileId).toBe("dry_time_checks");
    expect(cue).toMatchObject({ presetId: "laura-minute-01", presetIds: ["laura-minute-01", "laura-minute-01-b"], presetWeights: { "laura-minute-01-b": 2 }, playbackMode: "weighted-random" });
    expect(isKnownBuiltInVoiceId("laura-unknown")).toBe(false);
  });
});

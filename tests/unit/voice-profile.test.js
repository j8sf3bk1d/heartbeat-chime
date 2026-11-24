import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/builtInVoices.js", () => ({
  BUILT_IN_VOICE_SET: {
    presets: [1, 5, 15, 60].flatMap((m) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: `voice-${m}-${n}`, label: `Voice ${m}-${n}` }))),
    intervalPresetByMinutes: Object.fromEntries([1, 5, 15, 60].map((m) => [m, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `voice-${m}-${n}`)]))
  },
  getBuiltInVoiceUrl: () => null
}));
import { PRESETS, SOUND_PROFILES } from "../../src/lib/soundProfiles.js";
import { createDefaultState, normalizeState } from "../../src/lib/state.js";

describe("voice profile", () => {
  it("defaults new users to varied interval sets", () => {
    const state = createDefaultState();
    expect(state.selectedProfileId).toBe("dry_time_checks");
    for (const minutes of [1, 5, 15, 60]) {
      const cue = state.intervals.find((item) => item.minutes === minutes);
      expect(cue.presetIds).toHaveLength(10);
      expect(cue.playbackMode).toBe("random");
    }
    expect(state.intervals.find((item) => item.minutes === 10).presetId).toBe("soft_chime");
  });

  it("preserves an existing profile and saved sound sets", () => {
    const defaults = createDefaultState();
    const previous = { selectedProfileId: "clocktower", intervals: [{ id: "interval-1", presetId: "wood_tick", presetIds: ["wood_tick", "soft_chime"], playbackMode: "sequential", enabled: true }] };
    const restored = normalizeState(previous, defaults, PRESETS, SOUND_PROFILES.map(({ id }) => id));
    expect(restored.selectedProfileId).toBe("clocktower");
    expect(restored.intervals[0]).toMatchObject({ presetId: "wood_tick", presetIds: ["wood_tick", "soft_chime"], playbackMode: "sequential", enabled: true });
  });
});

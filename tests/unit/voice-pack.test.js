import { describe, expect, it } from "vitest";
import manifest from "../../src/assets/voices/laura/manifest.json";
import { BUILT_IN_VOICE_SET, getVoiceCoverageGaps } from "../../src/lib/builtInVoices.js";
import { createDefaultState } from "../../src/lib/state.js";

describe("bundled voice pack", () => {
  it("exposes both distinct completed recordings of every bundled line", () => {
    expect(BUILT_IN_VOICE_SET).not.toBeNull();
    expect(manifest.clips.length).toBeGreaterThanOrEqual(40);
    for (const minutes of [1, 5, 15, 60]) {
      const clips = manifest.clips.filter((clip) => clip.intervalMinutes === minutes);
      expect(clips.length).toBeGreaterThanOrEqual(10);
      for (const lineId of new Set(clips.map((clip) => clip.lineId))) {
        const takes = clips.filter((clip) => clip.lineId === lineId);
        expect(takes.map((clip) => clip.generation).sort()).toEqual([1, 2]);
        expect(takes[0].sha256).not.toBe(takes[1].sha256);
        expect(takes.every((clip) => BUILT_IN_VOICE_SET.getUrl(clip.id))).toBe(true);
      }
      const cue = createDefaultState().intervals.find((interval) => interval.minutes === minutes);
      expect(cue.presetIds).toEqual(clips.map((clip) => clip.id));
      expect(cue.playbackMode).toBe("random");
    }
  });

  // The legacy 40-clip pack predates the matrix. Promotion of the expanded
  // manifest marks this version, making complete coverage mandatory.
  it.skipIf(manifest.expressionCoverageVersion !== 1)("requires every interval/expression pair in the expanded release", () => {
    expect(getVoiceCoverageGaps(manifest)).toEqual([]);
  });

  it.skipIf(manifest.frequencyCoverageVersion !== 2)("ships a complete tripled one-minute and doubled five-minute bank", () => {
    expect(BUILT_IN_VOICE_SET?.hasCompleteFrequencyCoverage).toBe(true);
    expect(BUILT_IN_VOICE_SET.frequencyBaseIntervalPresetByMinutes[1]).toHaveLength(22);
    expect(BUILT_IN_VOICE_SET.frequencyBaseIntervalPresetByMinutes[5]).toHaveLength(22);
    expect(BUILT_IN_VOICE_SET.intervalPresetByMinutes[1]).toHaveLength(66);
    expect(BUILT_IN_VOICE_SET.intervalPresetByMinutes[5]).toHaveLength(44);
    expect(BUILT_IN_VOICE_SET.presets).toHaveLength(150);
  });
});

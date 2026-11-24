import { describe, expect, it } from "vitest";
import { normalizePlaybackMode, resolveCuePresetId, simulateCuePresetPicks } from "../../src/lib/presetPlayback.js";

describe("preset playback helper", () => {
  it("normalizes playback mode with safe fallback", () => {
    expect(normalizePlaybackMode("random")).toBe("random");
    expect(normalizePlaybackMode("sequential")).toBe("sequential");
    expect(normalizePlaybackMode("weighted-random")).toBe("weighted-random");
    expect(normalizePlaybackMode("unknown")).toBe("sequential");
  });

  it("advances sequential playback cursor deterministically", () => {
    const cue = {
      presetIds: ["soft_chime", "bright_ping", "grand_bell"],
      playbackMode: "sequential",
      playbackCursor: 0
    };

    expect(resolveCuePresetId(cue)).toBe("soft_chime");
    expect(cue.playbackCursor).toBe(1);
    expect(resolveCuePresetId(cue)).toBe("bright_ping");
    expect(cue.playbackCursor).toBe(2);
    expect(resolveCuePresetId(cue)).toBe("grand_bell");
    expect(cue.playbackCursor).toBe(0);
  });

  it("supports random mode without mutating cursor", () => {
    const cue = {
      presetIds: ["soft_chime", "bright_ping"],
      playbackMode: "random",
      playbackCursor: 1
    };
    const picked = resolveCuePresetId(cue, { random: () => 0.75 });
    expect(picked).toBe("bright_ping");
    expect(cue.playbackCursor).toBe(1);
  });

  it("supports weighted random mode", () => {
    const cue = {
      presetIds: ["soft_chime", "bright_ping", "grand_bell"],
      playbackMode: "weighted-random",
      presetWeights: {
        soft_chime: 1,
        bright_ping: 5,
        grand_bell: 1
      },
      playbackCursor: 0
    };
    expect(resolveCuePresetId(cue, { random: () => 0.02 })).toBe("soft_chime");
    expect(resolveCuePresetId(cue, { random: () => 0.4 })).toBe("bright_ping");
    expect(resolveCuePresetId(cue, { random: () => 0.98 })).toBe("grand_bell");
    expect(cue.playbackCursor).toBe(0);
  });

  it("excludes the previous sound only when another random choice exists", () => {
    const cue = { presetIds: ["a", "b", "c"], playbackMode: "random" };
    expect(resolveCuePresetId(cue, { excludePresetId: "a", random: () => 0 })).toBe("b");
    expect(resolveCuePresetId(cue, { excludePresetId: "b", random: () => 0.99 })).toBe("c");
    expect(resolveCuePresetId(cue, { excludePresetId: "missing", random: () => 0 })).toBe("a");
    expect(resolveCuePresetId({ presetIds: ["a"], playbackMode: "random" }, { excludePresetId: "a" })).toBe("a");
  });

  it("preserves relative weights among the remaining choices", () => {
    const cue = { presetIds: ["a", "b", "c"], playbackMode: "weighted-random", presetWeights: { a: 100, b: 1, c: 3 } };
    expect(resolveCuePresetId(cue, { excludePresetId: "a", random: () => 0.24 })).toBe("b");
    expect(resolveCuePresetId(cue, { excludePresetId: "a", random: () => 0.25 })).toBe("c");
    expect(resolveCuePresetId({ ...cue, presetIds: ["a"] }, { excludePresetId: "a" })).toBe("a");
    expect(resolveCuePresetId({ ...cue, playbackMode: "sequential", playbackCursor: 0 }, { excludePresetId: "a" })).toBe("a");
  });

  it("avoids both takes of the prior line while retaining weights on other lines", () => {
    const groups = { a1: "line-a", a2: "line-a", b1: "line-b", b2: "line-b", custom: "custom" };
    const getRepeatGroup = (id) => groups[id] || id;
    const cue = { presetIds: ["a1", "a2", "b1", "b2", "custom"], playbackMode: "weighted-random", presetWeights: { a1: 100, a2: 100, b1: 1, b2: 3, custom: 4 } };
    expect(resolveCuePresetId(cue, { excludePresetId: "a1", getRepeatGroup, random: () => 0 })).toBe("b1");
    expect(resolveCuePresetId(cue, { excludePresetId: "a1", getRepeatGroup, random: () => 0.2 })).toBe("b2");
    expect(resolveCuePresetId(cue, { excludePresetId: "a1", getRepeatGroup, random: () => 0.75 })).toBe("custom");
    // The previous take can have been removed from the pool; its paired take
    // is still excluded when another line exists.
    expect(resolveCuePresetId({ ...cue, presetIds: ["a2", "custom"] }, { excludePresetId: "a1", getRepeatGroup, random: () => 0 })).toBe("custom");
  });

  it("falls back to another take when the pool has only one line", () => {
    const getRepeatGroup = () => "same-line";
    const cue = { presetIds: ["a1", "a2"], playbackMode: "random" };
    expect(resolveCuePresetId(cue, { excludePresetId: "a1", getRepeatGroup, random: () => 0 })).toBe("a2");
    expect(resolveCuePresetId({ ...cue, presetIds: ["a1"] }, { excludePresetId: "a1", getRepeatGroup })).toBe("a1");
    expect(resolveCuePresetId({ ...cue, playbackMode: "sequential", playbackCursor: 0 }, { excludePresetId: "a1", getRepeatGroup })).toBe("a1");
  });

  it("simulates the same line-level rule as real playback", () => {
    const groups = { a1: "a", a2: "a", b1: "b", b2: "b" };
    const cue = { presetIds: ["a1", "a2", "b1", "b2"], playbackMode: "random" };
    expect(simulateCuePresetPicks(cue, { iterations: 4, random: () => 0, avoidRepeat: true, previousPresetId: "a1", getRepeatGroup: (id) => groups[id] })).toEqual({ b1: 2, a1: 2 });
    expect(simulateCuePresetPicks(cue, { iterations: 2, random: () => 0, avoidRepeat: false, previousPresetId: "a1", getRepeatGroup: (id) => groups[id] })).toEqual({ a1: 2 });
  });

  it("falls back to single preset id when set is not provided", () => {
    const cue = {
      presetId: "wood_tick",
      playbackMode: "sequential",
      playbackCursor: 7
    };
    expect(resolveCuePresetId(cue)).toBe("wood_tick");
    expect(cue.playbackCursor).toBe(0);
  });

  it("simulates cue picks deterministically with injected random source", () => {
    const randomSequence = [0.1, 0.6, 0.95];
    let randomIndex = 0;
    const counts = simulateCuePresetPicks(
      {
        presetIds: ["soft_chime", "bright_ping", "grand_bell"],
        playbackMode: "weighted-random",
        presetWeights: {
          soft_chime: 1,
          bright_ping: 2,
          grand_bell: 1
        }
      },
      {
        iterations: 6,
        random: () => {
          const value = randomSequence[randomIndex % randomSequence.length];
          randomIndex += 1;
          return value;
        }
      }
    );

    expect(counts).toEqual({
      soft_chime: 2,
      bright_ping: 2,
      grand_bell: 2
    });
  });

  it("simulates sequential picks using cursor rotation", () => {
    const counts = simulateCuePresetPicks(
      {
        presetIds: ["wood_tick", "soft_chime", "bright_ping"],
        playbackMode: "sequential",
        playbackCursor: 0
      },
      { iterations: 5 }
    );

    expect(counts).toEqual({
      wood_tick: 2,
      soft_chime: 2,
      bright_ping: 1
    });
  });

  it("simulates the actual no-repeat policy without changing the cue", () => {
    const cue = { presetIds: ["a", "b"], playbackMode: "weighted-random", presetWeights: { a: 100, b: 1 } };
    expect(simulateCuePresetPicks(cue, { iterations: 100, random: () => 0, avoidRepeat: true })).toEqual({ a: 50, b: 50 });
    expect(simulateCuePresetPicks(cue, { iterations: 3, random: () => 0, avoidRepeat: true, previousPresetId: "a" })).toEqual({ b: 2, a: 1 });
    expect(simulateCuePresetPicks(cue, { iterations: 100, random: () => 0, avoidRepeat: false })).toEqual({ a: 100 });
    expect(cue).toEqual({ presetIds: ["a", "b"], playbackMode: "weighted-random", presetWeights: { a: 100, b: 1 } });
  });
});

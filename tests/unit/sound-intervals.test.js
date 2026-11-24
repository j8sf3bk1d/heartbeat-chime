import { describe, expect, it } from "vitest";
import { createDefaultState, normalizeState, serializeState } from "../../src/lib/state.js";
import { normalizeSoundIntervalOverrides, parseSoundIntervalInput, soundIntervalTags } from "../../src/lib/soundIntervals.js";

describe("sound interval tags", () => {
  it("normalizes custom values and permits clearing a built-in suggestion", () => {
    expect(parseSoundIntervalInput("23, 5, 23")).toEqual([5, 23]);
    expect(parseSoundIntervalInput("5, nope")).toBeNull();
    expect(parseSoundIntervalInput("0")).toBeNull();
    expect(soundIntervalTags({ id: "voice", intervalMinutes: 5 }, {})).toEqual([5]);
    expect(soundIntervalTags({ id: "voice", intervalMinutes: 5 }, { voice: [] })).toEqual([]);
    expect(normalizeSoundIntervalOverrides({ x: [3, -1, "5", 3], y: [] })).toEqual({ x: [3], y: [] });
  });

  it("preserves overrides in serialized and normalized configuration", () => {
    const defaults = createDefaultState();
    defaults.soundIntervalTags = { custom: [23, 5], voice: [] };
    const saved = JSON.parse(JSON.stringify(serializeState(defaults)));
    const restored = normalizeState(saved, createDefaultState(), []);
    expect(restored.soundIntervalTags).toEqual({ custom: [5, 23], voice: [] });
  });
});

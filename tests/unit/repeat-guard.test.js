import { describe, expect, it, vi } from "vitest";
import { createCueActions } from "../../src/lib/cueActions.js";
import { createDefaultState, normalizeState, serializeState } from "../../src/lib/state.js";
import { resolveCuePresetId } from "../../src/lib/presetPlayback.js";
import { createCueSoundHelpers, getPresetRepeatGroup } from "../../src/lib/cueSoundHelpers.js";

describe("recurring random repeat guard", () => {
  it("does not advance sequential rotation until a prepared cue starts", () => {
    const cue = { id: 'minute', presetIds: ['a', 'b'], playbackMode: 'sequential', playbackCursor: 0 };
    let prepared;
    const actions = createCueActions({ state: { log: [] }, saveState: vi.fn(), renderLog: vi.fn(), renderIntervals: vi.fn(), renderTimers: vi.fn(), ttsSpeaker: { supported: false }, shouldSpeakCue: vi.fn(), resolveTtsText: vi.fn(), resolveCuePresetForPlayback: resolveCuePresetId, soundEngine: { playPreset: vi.fn(() => true) }, getPresetLabel: (id) => id, deliverCue: (payload) => { prepared = payload; } });
    actions.fireCue({ label: 'Minute', cue, volume: 1, cueType: 'recurring', scheduledAtMs: Date.now() + 1000 });
    expect(cue.playbackCursor).toBe(0);
    expect(prepared.presetId).toBe('a');
    prepared.play();
    expect(cue.playbackCursor).toBe(1);
  });
  it("defaults on for existing settings and preserves an explicit choice in exports", () => {
    const defaults = createDefaultState();
    expect(normalizeState({}, defaults, {}).avoidConsecutiveRandomSounds).toBe(true);
    const restored = normalizeState({ avoidConsecutiveRandomSounds: false }, defaults, {});
    expect(restored.avoidConsecutiveRandomSounds).toBe(false);
    expect(serializeState(restored).avoidConsecutiveRandomSounds).toBe(false);
  });

  it("tracks each recurring chime independently and ignores previews and one-shot timers", async () => {
    const state = { avoidConsecutiveRandomSounds: true, log: [], masterVolume: 1 };
    const played = [];
    const actions = createCueActions({ state, saveState: vi.fn(), renderLog: vi.fn(), renderIntervals: vi.fn(), renderTimers: vi.fn(),
      ttsSpeaker: { supported: false }, shouldSpeakCue: vi.fn(), resolveTtsText: vi.fn(),
      resolveCuePresetForPlayback: (cue, options) => resolveCuePresetId(cue, { ...options, random: () => 0 }),
      soundEngine: { playPreset: (id) => played.push(id), unlock: async () => {}, setMasterVolume: vi.fn() },
      getPresetLabel: (id) => id });
    const first = { id: "1", presetIds: ["a", "b"], playbackMode: "random" };
    const second = { id: "5", presetIds: ["a", "b"], playbackMode: "random" };
    const fire = (cue, cueType = "recurring") => actions.fireCue({ label: "test", cue, volume: 1, cueType });
    fire(first); fire(second);
    await actions.previewCue({ label: "test", cue: first, volume: 1, cueType: "recurring" });
    fire(first, "one-shot"); fire(first); fire(second);
    expect(played).toEqual(["a", "a", "a", "a", "b", "b"]);
    state.avoidConsecutiveRandomSounds = false;
    fire(first); fire(first);
    expect(played.slice(-2)).toEqual(["a", "a"]);
  });

  it("applies bundled line identities to actual recurring choices and simulation, leaving custom sounds independent", () => {
    const a = "laura-minute-01";
    const aTake2 = "laura-minute-01-b";
    const b = "laura-minute-02";
    const custom = "custom:one";
    expect(getPresetRepeatGroup(a)).toBe(getPresetRepeatGroup(aTake2));
    expect(getPresetRepeatGroup(a)).not.toBe(getPresetRepeatGroup(b));
    expect(getPresetRepeatGroup(custom)).toBe("preset:custom:one");
    const helper = createCueSoundHelpers({ hasPresetId: () => true, getPresetLabel: (id) => id });
    const cue = { id: "interval-1", presetIds: [a, aTake2, b, custom], playbackMode: "random" };
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(helper.resolveCuePresetForPlayback(cue, { excludePresetId: a })).toBe(b);
      expect(helper.runSimulationPreview({ presetIds: [a, aTake2, b], playbackMode: "random", iterations: 4, avoidRepeat: true, previousPresetId: a })).toContain(`${b} 50%`);
      const played = [];
      const actions = createCueActions({ state: { avoidConsecutiveRandomSounds: true, log: [] }, saveState: vi.fn(), renderLog: vi.fn(), renderIntervals: vi.fn(), renderTimers: vi.fn(), ttsSpeaker: { supported: false }, shouldSpeakCue: vi.fn(), resolveTtsText: vi.fn(), resolveCuePresetForPlayback: helper.resolveCuePresetForPlayback, soundEngine: { playPreset: (id) => played.push(id) }, getPresetLabel: (id) => id });
      actions.fireCue({ label: "Minute", cue, volume: 1, cueType: "recurring" });
      actions.fireCue({ label: "Minute", cue, volume: 1, cueType: "recurring" });
      expect(played).toEqual([a, b]);
    } finally {
      random.mockRestore();
    }
  });
});

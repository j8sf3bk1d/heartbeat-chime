import { describe, expect, it, vi } from "vitest";
import { companionCueForPreset, createCompanionController, createCompanionPreviewPicker, expressionForDirection, expressionForVoice, prewarmCompanionIfEnabled } from "../../src/lib/companion.js";
import { createDefaultState, normalizeState, serializeState } from "../../src/lib/state.js";
import { PRESETS } from "../../src/lib/soundProfiles.js";
import { createCueActions } from "../../src/lib/cueActions.js";

const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe("companion preview selection", () => {
  it("randomly chooses bundled takes while avoiding the previous utterance", () => {
    const pick = createCompanionPreviewPicker({ presetIds: ["a1", "a2", "b1", "b2"], getRepeatGroup: (id) => id[0], random: () => 0 });
    expect([pick(), pick(), pick()]).toEqual(["a1", "b1", "a1"]);
    const last = createCompanionPreviewPicker({ presetIds: ["a1", "a2", "b1", "b2"], getRepeatGroup: (id) => id[0], random: () => 0.99 });
    expect(last()).toBe("b2");
    expect(createCompanionPreviewPicker({ presetIds: [] })()).toBeNull();
  });
});

describe("visual novel companion", () => {
  it("prewarms only enabled desktop companions and reports real failures", async () => {
    const state = { companionEnabled: false };
    const prewarm = vi.fn().mockResolvedValue(true);
    const onError = vi.fn();
    const options = { state, isDesktopRuntime: () => true, prewarm, onError };
    expect(await prewarmCompanionIfEnabled(options)).toBe(false);
    expect(prewarm).not.toHaveBeenCalled();
    state.companionEnabled = true;
    expect(await prewarmCompanionIfEnabled({ ...options, isDesktopRuntime: () => false })).toBe(false);
    expect(prewarm).not.toHaveBeenCalled();
    expect(await prewarmCompanionIfEnabled(options)).toBe(true);
    prewarm.mockRejectedValueOnce(new Error("display unavailable"));
    expect(await prewarmCompanionIfEnabled(options)).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "display unavailable" }));
  });
  it("does not display a stale prewarm error after the user disables the companion", async () => {
    const state = { companionEnabled: true };
    const pending = defer();
    const onError = vi.fn();
    const result = prewarmCompanionIfEnabled({ state, isDesktopRuntime: () => true, prewarm: () => pending.promise, onError });
    state.companionEnabled = false;
    pending.resolve(false);
    expect(await result).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
  it("uses metadata for the actual selected take and maps directions deterministically", () => {
    const first = companionCueForPreset("laura-minute-01", () => "wrong label");
    expect(first.text).toBe("Another minute gone. No refunds.");
    expect(first.expression).toBe("smug");
    expect(companionCueForPreset("laura-hour-03", () => "wrong").expression).toBe("flustered");
    expect(expressionForDirection("warm, reluctant")).toBe("neutral");
    expect(companionCueForPreset("custom:test", () => "My imported voice").text).toBe("My imported voice");
  });
  it("prefers curated expressions while retaining legacy and safe fallback behavior", () => {
    for (const expression of ["neutral", "smug", "flustered", "hmph", "caring", "impressed", "exasperated", "delighted"]) {
      expect(expressionForVoice({ expression, direction: "dry, teasing" })).toBe(expression);
    }
    expect(expressionForVoice({ direction: "shy, teasing" })).toBe("flustered");
    expect(expressionForVoice({ expression: "invalid", direction: "dry" })).toBe("neutral");
    expect(expressionForVoice(null)).toBe("neutral");
  });
  it("identifies the actual selected voice and expression without letting diagnostics interrupt playback", async () => {
    const onCue = vi.fn(() => { throw new Error("diagnostic failure"); });
    const show = vi.fn().mockResolvedValue(true), play = vi.fn().mockResolvedValue(true);
    const controller = createCompanionController({state:{companionEnabled:true}, isDesktopRuntime:() => true, show, hide:vi.fn(), getPresetLabel:() => "fallback", leadMs:0, onCue});
    expect(await controller.playWithIntro({presetId:"laura-minute-exasperated-01-b", play})).toBe(true);
    expect(onCue).toHaveBeenCalledWith(expect.objectContaining({presetId:"laura-minute-exasperated-01-b", cue:expect.objectContaining({expression:"exasperated", text:"One minute and you're still fussing with that?"})}));
    expect(play).toHaveBeenCalledOnce();
  });
  it("persists validated settings and remains opt-in for existing users", () => {
    const defaults = createDefaultState();
    const old = normalizeState({}, defaults, PRESETS);
    expect(old.companionEnabled).toBe(false);
    expect(old.companionSize).toBe(100);
    const next = normalizeState({ companionEnabled: true, companionCorner: "top-left", companionMonitorId: "screen 2", companionSize: 150 }, defaults, PRESETS);
    expect(serializeState(next)).toMatchObject({ companionEnabled: true, companionCorner: "top-left", companionMonitorId: "screen 2", companionSize: 150 });
    expect(normalizeState({ companionSize: 999 }, defaults, PRESETS).companionSize).toBe(100);
    expect(normalizeState({ companionCorner: "bogus" }, defaults, PRESETS).companionCorner).toBe("bottom-right");
  });
  it("shows the chosen cue before playing its exact sound", async () => {
    const state = { companionEnabled: true, companionMonitorId: "primary", companionCorner: "top-left", companionSize: 125 };
    const show = vi.fn().mockResolvedValue(true);
    const play = vi.fn().mockResolvedValue(true);
    const controller = createCompanionController({ state, isDesktopRuntime: () => true, show, hide: vi.fn(), getPresetLabel: () => "fallback", leadMs: 200 });
    const result = controller.playWithIntro({ presetId: "laura-hour-03", play });
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(play).not.toHaveBeenCalled();
    expect(await result).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(show.mock.calls[0][0]).toMatchObject({ text: "An hour... I was not watching you. Obviously.", expression: "flustered", corner: "top-left", size: 125 });
  });
  it("reports current audio timing even when character motion is disabled", async () => {
    const state = { companionEnabled: true, companionCharacterMotion: false };
    const sendTiming = vi.fn();
    const sendSpeech = vi.fn();
    const controller = createCompanionController({ state, isDesktopRuntime: () => true, show: async () => true, hide: vi.fn(), sendTiming, sendSpeech, getPresetLabel: () => "x", leadMs: 1 });
    const timing = { startedAtMs: Date.now() + 3000, durationMs: 4000 };
    let callback;
    await controller.playWithIntro({ presetId: "laura-minute-01", play: (speech, audioTiming) => { expect(speech).toBeUndefined(); callback = audioTiming; audioTiming(timing); return true; } });
    await Promise.resolve();
    expect(sendTiming).toHaveBeenCalledWith(expect.objectContaining(timing));
    expect(sendSpeech).not.toHaveBeenCalled();
    await controller.dismiss();
    callback(timing);
    await Promise.resolve();
    expect(sendTiming).toHaveBeenCalledTimes(1);
  });
  it("sends speech motion only for a shown current cue after its audio schedules", async () => {
    const state = { companionEnabled: true, companionMonitorId: "primary", companionCorner: "bottom-right" };
    const show = vi.fn().mockResolvedValue(true);
    const sendSpeech = vi.fn().mockResolvedValue(true);
    const controller = createCompanionController({ state, isDesktopRuntime: () => true, show, hide: vi.fn(), sendSpeech, getPresetLabel: () => "x", leadMs: 1 });
    const speech = { startedAtMs: Date.now(), frameMs: 40, levels: [0, 0.8, 0] };
    const play = vi.fn(async (notify) => { notify(speech); return true; });
    expect(await controller.playWithIntro({ presetId: "laura-minute-01", play })).toBe(true);
    await vi.waitFor(() => expect(sendSpeech).toHaveBeenCalledOnce());
    expect(sendSpeech).toHaveBeenCalledWith({ ...speech, generation: show.mock.calls[0][0].generation });
    await controller.dismiss();
    play.mock.calls[0][0](speech);
    await Promise.resolve();
    expect(sendSpeech).toHaveBeenCalledTimes(1);
  });
  it("skips speech envelope work when character motion or reduced motion disables it", async () => {
    for (const options of [
      { state: { companionEnabled: true, companionCharacterMotion: false }, shouldAnimateSpeech: () => true },
      { state: { companionEnabled: true, companionCharacterMotion: true }, shouldAnimateSpeech: () => false }
    ]) {
      const play = vi.fn(async (notify) => { expect(notify).toBeUndefined(); return true; });
      const controller = createCompanionController({ ...options, isDesktopRuntime: () => true, show: vi.fn().mockResolvedValue(true), hide: vi.fn(), getPresetLabel: () => "x", leadMs: 1 });
      expect(await controller.playWithIntro({ presetId: "voice", play })).toBe(true);
      expect(play).toHaveBeenCalledOnce();
    }
  });
  it("keeps a scheduled sound successful even when the animation event fails", async () => {
    const onError = vi.fn();
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true,
      show: vi.fn().mockResolvedValue(true), hide: vi.fn(), getPresetLabel: () => "x", leadMs: 1,
      sendSpeech: vi.fn().mockRejectedValue(new Error("overlay disconnected")), onError });
    const play = vi.fn(async (notify) => { notify({ startedAtMs: Date.now(), frameMs: 40, levels: [0.5] }); return true; });
    expect(await controller.playWithIntro({ presetId: "voice", play })).toBe(true);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(play).toHaveBeenCalledOnce();
  });
  it("hides immediately during a slow show and sends a newer generation", async () => {
    const state = { companionEnabled: true, companionMonitorId: "primary", companionCorner: "bottom-right" };
    const pendingShow = defer();
    const calls = [];
    const show = vi.fn((request) => { calls.push(["show", request.generation]); return pendingShow.promise; });
    const hide = vi.fn((generation) => { calls.push(["hide", generation]); return Promise.resolve(); });
    const controller = createCompanionController({ state, isDesktopRuntime: () => true, show, hide, getPresetLabel: () => "x" });
    const play = vi.fn();
    const playing = controller.playWithIntro({ presetId: "laura-minute-01", play });
    await vi.waitFor(() => expect(show).toHaveBeenCalled());
    state.companionEnabled = false;
    const dismiss = controller.dismiss();
    await dismiss;
    expect(calls.map(([name]) => name)).toEqual(["show", "hide"]);
    expect(calls[1][1]).toBeGreaterThan(calls[0][1]);
    pendingShow.resolve(true);
    expect(await playing).toBe("cancelled");
    expect(play).not.toHaveBeenCalled();
    expect(calls.map(([name]) => name)).toEqual(["show", "hide"]);
  });
  it("falls back to sound when a show fails or times out, and disables without silencing the cue", async () => {
    const state = { companionEnabled: true, companionMonitorId: "primary", companionCorner: "bottom-right" };
    const pendingShow = defer();
    const show = vi.fn().mockReturnValue(pendingShow.promise);
    const hide = vi.fn().mockResolvedValue(true);
    const play = vi.fn().mockResolvedValue(true);
    const controller = createCompanionController({ state, isDesktopRuntime: () => true, show, hide, getPresetLabel: () => "x", showTimeoutMs: 20 });
    expect(await controller.playWithIntro({ presetId: "laura-minute-01", play })).toBe(true);
    expect(hide).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    const playing = controller.playWithIntro({ presetId: "laura-minute-01", play });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    state.companionEnabled = false;
    await controller.dismiss({ cancelPlayback: false });
    expect(await playing).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
    pendingShow.resolve(false);
  });
  it("skips the overlay when preparation fails, but still attempts the sound", async () => {
    const show = vi.fn();
    const play = vi.fn().mockResolvedValue(false);
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show, hide: vi.fn(), getPresetLabel: () => "x" });
    expect(await controller.playWithIntro({ presetId: "missing", prepare: () => false, play })).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });
  it("cancels the pending audio on pause after the overlay is shown", async () => {
    const show = vi.fn().mockResolvedValue(true);
    const hide = vi.fn().mockResolvedValue(true);
    const play = vi.fn().mockResolvedValue(true);
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show, hide, getPresetLabel: () => "x", leadMs: 1000 });
    const playing = controller.playWithIntro({ presetId: "laura-minute-01", play });
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    await controller.dismiss();
    expect(await playing).toBe("cancelled");
    expect(play).not.toHaveBeenCalled();
  });
  it("hides competing captions and plays both sounds when cues overlap", async () => {
    const events = [];
    const show = vi.fn(async () => { events.push("show A"); return true; });
    const hide = vi.fn(async () => { events.push("hide"); });
    const playA = vi.fn(async () => { events.push("play A"); return true; });
    const playB = vi.fn(async () => { events.push("play B"); return true; });
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show, hide, getPresetLabel: () => "x", leadMs: 1000 });
    const a = controller.playWithIntro({ presetId: "a", play: playA });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    const b = controller.playWithIntro({ presetId: "b", play: playB });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(show).toHaveBeenCalledOnce();
    expect(events.indexOf("hide")).toBeLessThan(events.indexOf("play A"));
    expect(events.indexOf("hide")).toBeLessThan(events.indexOf("play B"));
    expect(playA).toHaveBeenCalledOnce();
    expect(playB).toHaveBeenCalledOnce();
  });
  it("passes the exact single selected sound and its playback callback to the companion", () => {
    const playback = Promise.resolve(true);
    const playPreset = vi.fn(() => playback);
    const deliverCue = vi.fn(({ play }) => play());
    const resolver = vi.fn(() => "laura-hour-03");
    const actions = createCueActions({
      state: { log: [], avoidConsecutiveRandomSounds: true }, saveState: vi.fn(), renderLog: vi.fn(),
      renderIntervals: vi.fn(), renderTimers: vi.fn(), ttsSpeaker: { supported: false },
      shouldSpeakCue: vi.fn(), resolveTtsText: vi.fn(), resolveCuePresetForPlayback: resolver,
      soundEngine: { playPreset }, getPresetLabel: () => "label", deliverCue
    });
    actions.fireCue({ label: "15 minute", cue: { id: "interval-15" }, volume: 0.5, cueType: "recurring" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(playPreset).toHaveBeenCalledTimes(1);
    expect(deliverCue).toHaveBeenCalledWith({ presetId: "laura-hour-03", play: expect.any(Function) });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeScheduler } from "../../src/lib/runtimeScheduler.js";
import { createDefaultState } from "../../src/lib/state.js";
import { clamp } from "../../src/lib/stateCoercion.js";
import { computeNextAligned, computeRecurringCatchUp, selectRecurringEntries } from "../../src/lib/timing.js";
import { createCompanionController } from "../../src/lib/companion.js";

function setup({ desktop = true, ready = true, validateRequiredSounds, onSchedulerStop } = {}) {
  const state = createDefaultState();
  const runtime = { intervalHandle: null, nextByIntervalId: new Map() };
  const dependencies = {
    state, runtime,
    soundEngine: { unlock: vi.fn(async () => ready), getContextState: () => ready ? "running" : "suspended", ensureReady: vi.fn(async () => ready), setMasterVolume: vi.fn() },
    renderClock: vi.fn(), renderSession: vi.fn(), renderTimers: vi.fn(), addLog: vi.fn(), fireCue: vi.fn(), saveState: vi.fn(),
    computeNextAligned, computeRecurringCatchUp, selectRecurringEntries, clamp,
    isDesktopRuntime: () => desktop,
    getLaunchAtLoginEnabled: vi.fn(async () => false),
    listenForTrayCommands: vi.fn(async () => () => {}),
    toggleLaunchAtLogin: vi.fn(async () => true), emitTrayStatus: vi.fn(async () => true), validateRequiredSounds, onSchedulerStop
  };
  return { ...dependencies, scheduler: createRuntimeScheduler(dependencies) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T12:00:10Z"));
  global.window = { setInterval };
});
afterEach(() => { vi.useRealTimers(); delete global.window; });

describe("desktop scheduler startup", () => {
  it("notifies the companion when the scheduler pauses", async () => {
    const onSchedulerStop = vi.fn();
    const env = setup({ onSchedulerStop });
    await env.scheduler.startScheduler();
    env.scheduler.stopScheduler();
    expect(onSchedulerStop).toHaveBeenCalledOnce();
  });
  it("starts paused by default even when OS login startup is on", async () => {
    const env = setup();
    env.state.launchAtLogin = true;
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
    expect(env.state.running).toBe(false);
  });

  it("resumes desktop only after opt-in and saved Start intent", async () => {
    const env = setup();
    env.state.resumeOnLaunch = true;
    env.state.schedulerRequested = true;
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.running).toBe(true);
    expect(env.runtime.audioReady).toBe(true);
    expect(env.runtime.intervalHandle).not.toBeNull();
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.soundEngine.unlock).toHaveBeenCalledTimes(1);
  });

  it("never attempts automatic browser audio or changes saved desktop intent", async () => {
    const env = setup({ desktop: false });
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true, launchAtLogin: true });
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
    expect(env.state.launchAtLogin).toBe(true);
    expect(env.state.schedulerRequested).toBe(true);
  });

  it("retains Pause across desktop relaunch and persists explicit changes", async () => {
    const env = setup();
    await env.scheduler.startScheduler();
    env.scheduler.setResumeOnLaunch(true);
    expect(env.state.schedulerRequested).toBe(true);
    env.scheduler.stopScheduler();
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.running).toBe(false);
    expect(env.state.schedulerRequested).toBe(false);
    expect(env.state.resumeOnLaunch).toBe(true);
    expect(env.saveState).toHaveBeenCalled();
  });

  it("does not interpret opting in while paused as Start", async () => {
    const env = setup();
    env.scheduler.setResumeOnLaunch(true);
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.schedulerRequested).toBe(false);
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
  });

  it("keeps blocked automatic audio paused, shows a recovery action and preserves intent", async () => {
    const env = setup({ ready: false });
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true });
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.running).toBe(false);
    expect(env.runtime.schedulerStarting).toBe(false);
    expect(env.runtime.intervalHandle).toBeNull();
    expect(env.runtime.schedulerError).toContain("press Start");
    expect(env.state.schedulerRequested).toBe(true);
  });

  it("a pending Start cannot override a later Pause", async () => {
    const env = setup();
    let release;
    env.soundEngine.unlock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const start = env.scheduler.startScheduler();
    env.scheduler.stopScheduler();
    release(true);
    await start;
    expect(env.state.running).toBe(false);
    expect(env.state.schedulerRequested).toBe(false);
    expect(env.runtime.intervalHandle).toBeNull();
  });

  it("preserves OS startup intent and shows failed status reads", async () => {
    const env = setup();
    env.state.launchAtLogin = true;
    env.getLaunchAtLoginEnabled.mockRejectedValue(new Error("permission denied"));
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.launchAtLogin).toBe(true);
    expect(env.runtime.desktopAutostartError).toBe("permission denied");
    expect(env.runtime.desktopAutostartSyncedAtMs).toBeNull();
  });

  it("blocks imported cues after library failure without changing unresolved IDs", async () => {
    const env = setup();
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true });
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "custom:pack:voice" });
    await env.scheduler.hydrateDesktopRuntime({ libraryReady: false });
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
    expect(env.runtime.schedulerError).toContain("Imported sounds could not load");
    expect(env.state.intervals[0].presetId).toBe("custom:pack:voice");
    expect(env.state.schedulerRequested).toBe(true);
    await expect(env.scheduler.startScheduler()).rejects.toThrow("Imported sounds could not load");
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
    env.runtime.libraryReady = true;
    await env.scheduler.startScheduler();
    expect(env.state.running).toBe(true);
  });

  it("can resume built-in cues when optional imported storage fails", async () => {
    const env = setup();
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true });
    await env.scheduler.hydrateDesktopRuntime({ libraryReady: false });
    expect(env.state.running).toBe(true);
  });

  it("blocks missing active custom sounds after an otherwise successful metadata load", async () => {
    const env = setup();
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true });
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "custom:pack:missing", presetIds: ["custom:pack:missing"], presetWeights: { "custom:pack:missing": 4 } });
    env.runtime.missingCustomPresetIds = new Set(["custom:pack:missing"]);
    await env.scheduler.hydrateDesktopRuntime({ libraryReady: true });
    expect(env.state.running).toBe(false);
    expect(env.runtime.schedulerError).toContain("configured sound is missing");
    await expect(env.scheduler.startScheduler()).rejects.toThrow("configured sound is missing");
    expect(env.state.intervals[0].presetWeights).toEqual({ "custom:pack:missing": 4 });
    expect(env.soundEngine.unlock).not.toHaveBeenCalled();
    env.runtime.missingCustomPresetIds.clear();
    await env.scheduler.startScheduler();
    expect(env.state.running).toBe(true);
  });

  it("does not block built-in active cues for a missing inactive custom sound", async () => {
    const env = setup();
    Object.assign(env.state, { resumeOnLaunch: true, schedulerRequested: true });
    Object.assign(env.state.intervals[0], { enabled: false, presetId: "custom:pack:missing" });
    env.runtime.missingCustomPresetIds = new Set(["custom:pack:missing"]);
    await env.scheduler.hydrateDesktopRuntime();
    expect(env.state.running).toBe(true);
  });

  it("does not mark running when on-demand asset validation fails", async () => {
    const validate = vi.fn(async () => false);
    const env = setup({ validateRequiredSounds: validate });
    await expect(env.scheduler.startScheduler()).rejects.toThrow("configured sound could not be loaded");
    expect(env.state.running).toBe(false);
    expect(env.runtime.intervalHandle).toBeNull();
    expect(env.state.schedulerRequested).toBe(true);
    expect(validate).toHaveBeenCalledOnce();
  });

  it("bounds unresponsive asset verification without a false running state", async () => {
    const env = setup({ validateRequiredSounds: () => new Promise(() => {}) });
    const start = env.scheduler.startScheduler();
    const assertion = expect(start).rejects.toThrow("verification timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(env.state.running).toBe(false);
    expect(env.runtime.schedulerStarting).toBe(false);
  });

  it("allows a larger parallel sound preflight to finish beyond three seconds", async () => {
    const env = setup({ validateRequiredSounds: () => new Promise((resolve) => setTimeout(() => resolve(true), 5_000)) });
    const start = env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(env.runtime.schedulerStarting).toBe(true);
    expect(env.state.running).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await start).toBe(true);
    expect(env.state.running).toBe(true);
  });

  it("pauses before consuming a timer with a newly selected uncached voice", async () => {
    const env = setup();
    env.soundEngine.builtInVoiceUrl = (id) => id === "voice:new" ? "/voice.mp3" : null;
    env.soundEngine.builtInBufferCache = new Map();
    await env.scheduler.startScheduler();
    env.state.oneShots.push({ id: "voice-timer", active: true, targetAtMs: Date.now(), presetId: "voice:new", presetIds: ["voice:new"] });
    await vi.advanceTimersByTimeAsync(500);
    expect(env.state.running).toBe(false);
    expect(env.state.schedulerRequested).toBe(true);
    expect(env.runtime.schedulerError).toContain("Press Start");
    expect(env.state.oneShots[0].active).toBe(true);
    expect(env.fireCue).not.toHaveBeenCalled();
    env.soundEngine.builtInBufferCache.set("voice:new", {});
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(500);
    expect(env.fireCue).toHaveBeenCalledOnce();
    expect(env.state.oneShots[0].active).toBe(false);
  });

  it("leaves synth changes and cached or inactive voices running", async () => {
    const env = setup();
    env.soundEngine.builtInVoiceUrl = (id) => id?.startsWith("voice:") ? "/voice.mp3" : null;
    env.soundEngine.builtInBufferCache = new Map([["voice:cached", {}]]);
    await env.scheduler.startScheduler();
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "wood_tick", presetIds: ["wood_tick", "voice:cached"] });
    Object.assign(env.state.intervals[1], { enabled: false, presetId: "voice:not-needed", presetIds: ["voice:not-needed"] });
    await vi.advanceTimersByTimeAsync(500);
    expect(env.state.running).toBe(true);
    expect(env.runtime.schedulerError).toBe("");
  });

  it("does not start if a voice changes while the sound preflight is pending", async () => {
    let finishValidation;
    const env = setup({ validateRequiredSounds: () => new Promise((resolve) => { finishValidation = resolve; }) });
    env.soundEngine.builtInVoiceUrl = (id) => id === "voice:new" ? "/voice.mp3" : null;
    env.soundEngine.builtInBufferCache = new Map();
    const start = env.scheduler.startScheduler();
    await Promise.resolve();
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "voice:new", presetIds: ["voice:new"] });
    finishValidation(true);
    await expect(start).rejects.toThrow("configured voice is not ready");
    expect(env.state.running).toBe(false);
    expect(env.state.schedulerRequested).toBe(true);
  });

  it("pauses a live schedule when its sound is removed, preserving Start intent", async () => {
    const env = setup();
    await env.scheduler.startScheduler();
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "custom:missing" });
    env.runtime.missingCustomPresetIds = new Set(["custom:missing"]);
    expect(env.scheduler.reconcileSoundAvailability()).toBe(false);
    expect(env.state.running).toBe(false);
    expect(env.state.schedulerRequested).toBe(true);
    expect(env.runtime.schedulerError).toContain("configured sound is missing");
  });

  it("does not let an older audio health check erase a later missing-sound pause", async () => {
    const env = setup();
    let finishHealth;
    env.soundEngine.ensureReady.mockImplementation(() => new Promise((resolve) => { finishHealth = resolve; }));
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(500);
    Object.assign(env.state.intervals[0], { enabled: true, presetId: "custom:missing" });
    env.runtime.missingCustomPresetIds = new Set(["custom:missing"]);
    env.scheduler.reconcileSoundAvailability();
    finishHealth(true);
    await Promise.resolve();
    expect(env.state.running).toBe(false);
    expect(env.runtime.schedulerError).toContain("configured sound is missing");
  });

  it("leaves paused timers pending, then fires an overdue timer once after Start", async () => {
    const env = setup();
    const targetAtMs = Date.now() + 1_000;
    env.state.oneShots.push({ id: "timer", active: true, targetAtMs, label: "Break", volume: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(env.fireCue).not.toHaveBeenCalled();
    expect(env.state.oneShots[0].active).toBe(true);
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(env.fireCue).toHaveBeenCalledTimes(1);
    expect(env.state.oneShots[0].active).toBe(false);
    expect(env.saveState).toHaveBeenCalled();
  });

  it("re-arms a one-shot canceled by pause during companion lead-in", async () => {
    const env = setup();
    let finish;
    env.fireCue.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const timer = { id: "timer", active: true, targetAtMs: Date.now() + 500, label: "Break", volume: 1 };
    env.state.oneShots.push(timer);
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(500);
    expect(timer.active).toBe(false);
    env.scheduler.stopScheduler();
    finish("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    expect(timer.active).toBe(true);
    expect(timer.firedAtMs).toBeNull();
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(500);
    expect(env.fireCue).toHaveBeenCalledTimes(2);
    expect(timer.active).toBe(false);
  });

  it("drops a long sleep backlog once and suppresses only its fresh shared boundary", async () => {
    const env = setup();
    for (const cue of env.state.intervals) cue.enabled = [1, 5, 15].includes(cue.minutes);
    await env.scheduler.startScheduler();
    vi.setSystemTime(new Date("2026-11-16T13:30:00.100Z"));
    await vi.advanceTimersByTimeAsync(500);
    expect(env.fireCue).toHaveBeenCalledTimes(1);
    expect(env.fireCue.mock.calls[0][0].cue.minutes).toBe(15);
    expect(env.runtime.nextByIntervalId.get("interval-1")).toBe(Date.parse("2026-11-16T13:31:00Z"));
    expect(env.runtime.nextByIntervalId.get("interval-5")).toBe(Date.parse("2026-11-16T13:35:00Z"));
    expect(env.runtime.nextByIntervalId.get("interval-15")).toBe(Date.parse("2026-11-16T13:45:00Z"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.fireCue).toHaveBeenCalledTimes(1);
    expect(env.addLog.mock.calls.filter(([message]) => message.startsWith("Skipped "))).toHaveLength(1);
  });

  it("skips stale recurring cues after sleep while retaining overdue one-shot delivery", async () => {
    const env = setup();
    env.state.intervals[0].enabled = true;
    env.state.oneShots.push({ id: "overdue", active: true, targetAtMs: Date.now() + 1_000, label: "Break", presetId: "soft_chime", volume: 1 });
    await env.scheduler.startScheduler();
    vi.setSystemTime(new Date("2026-11-16T13:30:40Z"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(env.fireCue).toHaveBeenCalledTimes(1);
    expect(env.fireCue.mock.calls[0][0].cueType).toBe("one-shot");
    expect(env.state.oneShots[0].active).toBe(false);
    expect(env.runtime.nextByIntervalId.get("interval-1")).toBe(Date.parse("2026-11-16T13:31:00Z"));
  });

  it("with suppression off, emits at most one fresh cue per interval after sleep", async () => {
    const env = setup();
    env.state.suppressLowerIntervalsOnCollision = false;
    for (const cue of env.state.intervals) cue.enabled = [1, 5, 15].includes(cue.minutes);
    await env.scheduler.startScheduler();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.fireCue).toHaveBeenCalledTimes(3);
    expect(env.fireCue.mock.calls.map(([entry]) => entry.cue.minutes)).toEqual([1, 5, 15]);
  });

  it("keeps due timers pending during audio loss and fires once after recovery", async () => {
    const env = setup();
    let audioState = "running";
    env.soundEngine.getContextState = () => audioState;
    env.soundEngine.ensureReady.mockImplementation(async () => audioState === "running");
    env.state.oneShots.push({ id: "timer", active: true, targetAtMs: Date.now() + 1_000, label: "Break", volume: 1 });
    await env.scheduler.startScheduler();
    audioState = "interrupted";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(env.fireCue).not.toHaveBeenCalled();
    expect(env.state.oneShots[0].active).toBe(true);
    expect(env.runtime.audioReady).toBe(false);
    expect(env.runtime.schedulerError).toContain("Audio is unavailable");
    audioState = "running";
    await vi.advanceTimersByTimeAsync(15_000);
    expect(env.fireCue).toHaveBeenCalledTimes(1);
    expect(env.runtime.schedulerError).toBe("");
  });
});

describe('target-timed preparation', () => {
  it('coordinates scheduler, entrance and audio at a shared target', async () => {
    const env = setup(); env.state.companionEnabled = true; env.state.intervals[0].enabled = true;
    const show = vi.fn(async () => true), play = vi.fn(async () => true);
    const companion = createCompanionController({ state: env.state, isDesktopRuntime: () => true, show, hide: async () => true, getPresetLabel: () => 'cue' });
    env.fireCue.mockImplementation(({ scheduledAtMs, isCurrent, maxLatenessMs }) => companion.playWithIntro({ presetId: 'voice', targetAtMs: scheduledAtMs, isCurrent, maxLatenessMs, play }));
    await env.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(48_000); expect(env.fireCue).toHaveBeenCalledOnce(); expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000); expect(show).toHaveBeenCalledOnce(); expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000); expect(play).toHaveBeenCalledOnce(); expect(env.fireCue).toHaveBeenCalledOnce();
    expect(Date.now()).toBe(Date.parse('2026-11-16T12:01:00Z'));
    await vi.advanceTimersByTimeAsync(1_000); expect(play).toHaveBeenCalledOnce();
  });
  it('reserves a recurring cue ahead of its boundary without dispatching twice', async () => {
    const env = setup();
    env.state.companionEnabled = true;
    env.state.intervals[0].enabled = true;
    let finish;
    env.fireCue.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await env.scheduler.startScheduler();
    const target = Date.parse('2026-11-16T12:01:00Z');
    await vi.advanceTimersByTimeAsync(48_000);
    expect(env.fireCue).toHaveBeenCalledOnce();
    const call = env.fireCue.mock.calls[0][0];
    expect(call.scheduledAtMs).toBe(target);
    expect(call.isCurrent()).toBe(true);
    expect(env.runtime.nextByIntervalId.get(env.state.intervals[0].id)).toBe(target);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(env.fireCue).toHaveBeenCalledOnce();
    finish(true); await vi.advanceTimersByTimeAsync(0);
    expect(env.runtime.nextByIntervalId.get(env.state.intervals[0].id)).toBe(target + 60_000);
  });
  it('suppresses colliding intervals before the entrance as well as at the boundary', async () => {
    vi.setSystemTime(new Date('2026-11-16T12:04:57Z'));
    const env = setup(); env.state.companionEnabled = true;
    for (const cue of env.state.intervals) cue.enabled = [1, 5].includes(cue.minutes);
    env.fireCue.mockImplementation(() => new Promise(() => {}));
    await env.scheduler.startScheduler(); await vi.advanceTimersByTimeAsync(3_500);
    expect(env.fireCue).toHaveBeenCalledOnce();
    expect(env.fireCue.mock.calls[0][0].cue.minutes).toBe(5);
  });
  it('keeps an early one-shot active until playback and retries after a pause', async () => {
    const env = setup(); env.state.companionEnabled = true;
    const target = Date.now() + 2_000;
    const timer = { id: 'early', active: true, targetAtMs: target, label: 'Break', volume: 1 };
    env.state.oneShots.push(timer);
    let finish;
    env.fireCue.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await env.scheduler.startScheduler(); await vi.advanceTimersByTimeAsync(500);
    expect(env.fireCue).toHaveBeenCalledOnce(); expect(timer.active).toBe(true);
    const call = env.fireCue.mock.calls[0][0];
    env.scheduler.stopScheduler(); expect(call.isCurrent()).toBe(false);
    finish('cancelled'); await vi.advanceTimersByTimeAsync(0);
    expect(timer.active).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000); await env.scheduler.startScheduler(); await vi.advanceTimersByTimeAsync(500);
    expect(env.fireCue).toHaveBeenCalledTimes(2); expect(timer.active).toBe(false);
  });
  it('does not play a prepared timer whose target was edited', async () => {
    const env = setup(); env.state.companionEnabled = true;
    const timer = { id: 'early', active: true, targetAtMs: Date.now() + 2_000, label: 'Break', volume: 1 };
    env.state.oneShots.push(timer);
    let finish; env.fireCue.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await env.scheduler.startScheduler(); await vi.advanceTimersByTimeAsync(500);
    const call = env.fireCue.mock.calls[0][0]; timer.targetAtMs += 10_000;
    expect(call.isCurrent()).toBe(false); finish('cancelled'); await vi.advanceTimersByTimeAsync(2_000);
    expect(timer.active).toBe(true); expect(env.fireCue).toHaveBeenCalledOnce();
  });
  it('keeps a one-shot pending and reports a failed playback instead of consuming it', async () => {
    const env = setup(); env.state.companionEnabled = true;
    const timer = { id: 'early', active: true, targetAtMs: Date.now() + 2_000, label: 'Break', volume: 1 };
    env.state.oneShots.push(timer);
    env.fireCue.mockResolvedValue(false);
    await env.scheduler.startScheduler(); await vi.advanceTimersByTimeAsync(2_000);
    expect(timer.active).toBe(true); expect(env.state.running).toBe(false);
    expect(env.runtime.schedulerError).toContain('timer sound could not start');
  });
});

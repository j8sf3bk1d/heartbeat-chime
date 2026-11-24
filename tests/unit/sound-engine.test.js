import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundEngine, estimateOutputStartMs, speechEnvelope } from "../../src/lib/soundEngine.js";

class FakeAudioContext {
  constructor(options = {}) {
    this.state = options.initialState || "suspended";
    this.currentTime = 1;
    this.destination = {};
    this.resumeShouldThrow = Boolean(options.resumeShouldThrow);
    this.listeners = new Map();
    this.resumeCallCount = 0;
    this.createdOscillatorCount = 0;
  }

  addEventListener(eventType, handler) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(handler);
  }

  emitStateChange() {
    const handlers = this.listeners.get("statechange") || [];
    for (const handler of handlers) {
      handler();
    }
  }

  async resume() {
    this.resumeCallCount += 1;
    if (this.resumeShouldThrow) {
      throw new Error("resume-failed");
    }
    this.state = "running";
    this.emitStateChange();
  }

  createOscillator() {
    if (this.state === "closed") {
      throw new Error("audio-context-closed");
    }
    this.createdOscillatorCount += 1;
    return {
      type: "sine",
      frequency: { setValueAtTime() {} },
      detune: { setValueAtTime() {} },
      connect(target) {
        return target;
      },
      start() {},
      stop() {}
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {}
      },
      connect(target) {
        return target;
      }
    };
  }

  createBufferSource() {
    const source = {
      connect(target) {
        return target;
      },
      start() {}
    };
    this.lastBufferSource = source;
    return source;
  }

  async close() { this.state = "closed"; this.emitStateChange(); }

  async decodeAudioData() {
    return {};
  }
}

function createAudioWindow(options = {}) {
  return {
    AudioContext: class extends FakeAudioContext {
      constructor() {
        super(options);
      }
    }
  };
}

afterEach(() => {
  delete global.window;
  vi.restoreAllMocks();
});

describe("sound engine recovery", () => {
  it("plays an imported cue natively and anchors companion timing to the native request", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const player = vi.fn(async () => ({ startedAtMs: 123456, durationMs: 2100 }));
    const engine = new SoundEngine({ customBlobLoader: async () => new Blob(["sample"]), nativeClipPlayer: player });
    await engine.unlock();
    const timing = vi.fn(), lifecycle = vi.fn();
    expect(await engine.playPreset("custom:test", 0.8, { native: true, onAudioTiming: timing, trace: { lifecycle } })).toBe(true);
    expect(Array.from(player.mock.calls[0][0])).toEqual(Array.from(new TextEncoder().encode("sample")));
    expect(player.mock.calls[0][1]).toBeCloseTo(0.6);
    expect(timing).toHaveBeenCalledWith({ startedAtMs: 123456, durationMs: 2100 });
    expect(lifecycle).toHaveBeenCalledWith("source-start", { startedAtMs: 123456, backend: "native" });
    expect(engine.ctx.lastBufferSource).toBeUndefined();
  });
  it("does not play a native clip after a pending cue is cancelled", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const player = vi.fn();
    const engine = new SoundEngine({ customBlobLoader: async () => new Blob(["sample"]), nativeClipPlayer: player });
    await engine.unlock();
    expect(await engine.playPreset("custom:test", 1, { native: true, shouldPlay: () => false })).toBe("cancelled");
    expect(player).not.toHaveBeenCalled();
  });
  it("refreshes after 30 minutes only when idle, retaining decoded buffers", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow({ initialState: "running" });
      const engine = new SoundEngine({}); await engine.unlock();
      const old = engine.ctx, buffer = {}; engine.builtInBufferCache.set('voice', buffer);
      const refresh = vi.fn(); engine.onAudioContextRefresh = refresh;
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
      expect(await engine.refreshContextIfDue()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      engine.activeSources = 1; expect(await engine.refreshContextIfDue()).toBe(false); expect(engine.ctx).toBe(old);
      engine.activeSources = 0; expect(await engine.refreshContextIfDue()).toBe(true);
      expect(engine.ctx).not.toBe(old); expect(old.state).toBe('closed');
      expect(engine.builtInBufferCache.get('voice')).toBe(buffer);
      expect(refresh).toHaveBeenCalledWith(engine.ctx, 'success');
      const second = engine.ctx; await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(await engine.refreshContextIfDue()).toBe(true); expect(engine.ctx).not.toBe(second);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("retains the old running context if a replacement cannot resume", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow({ initialState: "running" });
      const engine = new SoundEngine({}); await engine.unlock(); const old = engine.ctx;
      global.window = createAudioWindow({ initialState: "suspended", resumeShouldThrow: true });
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      const refresh = vi.fn(); engine.onAudioContextRefresh = refresh;
      expect(await engine.refreshContextIfDue()).toBe(false);
      expect(engine.ctx).toBe(old); expect(old.state).toBe('running');
      expect(refresh).toHaveBeenCalledWith(old, 'failed');
    } finally { vi.useRealTimers(); }
  });
  it("does not swap contexts if playback begins while the replacement resumes", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow({ initialState: "running" });
      const engine = new SoundEngine({}); await engine.unlock(); const old = engine.ctx;
      let resume;
      global.window.AudioContext = class extends FakeAudioContext {
        constructor() { super({ initialState: 'suspended' }); }
        resume() { return new Promise((resolve) => { resume = () => { this.state = 'running'; resolve(); }; }); }
      };
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      const pending = engine.refreshContextIfDue();
      engine.pendingPlays = 1; resume();
      expect(await pending).toBe(false); expect(engine.ctx).toBe(old); expect(old.state).toBe('running');
    } finally { vi.useRealTimers(); }
  });
  it("reports overdue graph playback and delayed completion without recording audio content", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow({ initialState: "running" });
      const engine = new SoundEngine({}); await engine.unlock();
      const diagnostics = vi.fn(); engine.onAudioPlaybackDiagnostic = diagnostics;
      const buffer = { duration: 2, sampleRate: 48_000, length: 96_000, numberOfChannels: 1, filename: 'private.wav' };
      expect(engine.playBuffer(buffer, 1)).toBe(true);
      const source = engine.ctx.lastBufferSource;
      await vi.advanceTimersByTimeAsync(3510);
      expect(diagnostics).toHaveBeenCalledWith(engine.ctx, expect.objectContaining({ stage: 'overdue', wallElapsedMs: expect.closeTo(3510, 0), audioProgressMs: 0, expectedMs: expect.closeTo(2010, 0) }));
      engine.ctx.currentTime = 3.01;
      source.onended();
      expect(diagnostics).toHaveBeenLastCalledWith(engine.ctx, expect.objectContaining({ stage: 'ended', callbackLagMs: expect.closeTo(0, 0) }));
      expect(JSON.stringify(diagnostics.mock.calls.map((args) => args[1]))).not.toContain('private');
    } finally { vi.useRealTimers(); }
  });
  it("does not record normal graph completion or allow monitoring to break playback", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow({ initialState: "running" });
      const engine = new SoundEngine({}); await engine.unlock();
      engine.onAudioPlaybackDiagnostic = vi.fn();
      const lifecycle = vi.fn();
      expect(engine.playBuffer({ duration: 2 }, 1, undefined, undefined, { lifecycle })).toBe(true);
      await vi.advanceTimersByTimeAsync(2010); engine.ctx.currentTime = 3.01; engine.ctx.lastBufferSource.onended();
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.onAudioPlaybackDiagnostic).not.toHaveBeenCalled();
      expect(lifecycle.mock.calls.map(([stage]) => stage)).toEqual(['source-start', 'source-ended']);
      engine.onAudioPlaybackDiagnostic = () => { throw new Error('optional'); };
      expect(engine.playBuffer({ duration: 2 }, 1)).toBe(true);
      await vi.advanceTimersByTimeAsync(4000); expect(() => engine.ctx.lastBufferSource.onended()).not.toThrow();
    } finally { vi.useRealTimers(); }
  });
  it("does not start audio if a cue is cancelled while readiness or decoding is pending", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const engine = new SoundEngine({ builtInVoiceUrl: () => '/voice.mp3' });
    await engine.unlock();
    let releaseReady;
    engine.ensureReady = () => new Promise((resolve) => { releaseReady = resolve; });
    let current = true;
    const tone = engine.playPreset('soft_chime', 1, { shouldPlay: () => current });
    current = false; releaseReady(true);
    expect(await tone).toBe('cancelled'); expect(engine.ctx.createdOscillatorCount).toBe(0);
    let releaseBuffer;
    engine.ensureReady = async () => true;
    engine.prepareBuiltInVoice = () => new Promise((resolve) => { releaseBuffer = resolve; });
    current = true;
    const voice = engine.playPreset('voice', 1, { shouldPlay: () => current });
    await Promise.resolve(); await Promise.resolve();
    current = false; releaseBuffer({});
    expect(await voice).toBe('cancelled');
  });
  it("reports diagnostic timing for generated tones without changing playback", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const engine = new SoundEngine({});
    await engine.unlock();
    engine.onAudioDiagnostic = vi.fn();
    const onAudioTiming = vi.fn();
    expect(await engine.playPreset("soft_chime", 1, { onAudioTiming })).toBe(true);
    expect(engine.onAudioDiagnostic).toHaveBeenCalledWith(engine.ctx, expect.any(Number), expect.any(Number), expect.objectContaining({ estimator: "schedule-only", readyMs: expect.any(Number) }));
    expect(onAudioTiming).toHaveBeenCalledWith({ startedAtMs: expect.any(Number), durationMs: 1500 });
  });
  it("validates imported bytes without playing and rejects missing or undecodable clips", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const loader = vi.fn(async () => new Blob(["test"]));
    const engine = new SoundEngine({ customBlobLoader: loader });
    await engine.unlock();
    expect(await engine.prepareCustomPreset("custom:valid")).toEqual({});
    expect(engine.ctx.createdOscillatorCount).toBe(0);
    expect(loader).toHaveBeenCalledTimes(1);
    loader.mockResolvedValue(null);
    expect(await engine.playPresetWhenReady("custom:missing", 1)).toBe(false);
    loader.mockResolvedValue(new Blob(["corrupt"]));
    engine.ctx.decodeAudioData = async () => { throw new Error("decode failed"); };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await engine.prepareCustomPreset("custom:corrupt")).toBeNull();
    expect(await engine.playPresetWhenReady("custom:corrupt", 1)).toBe(false);
  });
  it("creates and resumes a suspended context", async () => {
    global.window = createAudioWindow({ initialState: "suspended" });
    const engine = new SoundEngine({});

    const ready = await engine.ensureReady({ createIfMissing: true });

    expect(ready).toBe(true);
    expect(engine.getContextState()).toBe("running");
  });

  it("reports unsuccessful unlock truthfully when resume resolves without running", async () => {
    global.window = createAudioWindow();
    const engine = new SoundEngine({});
    engine.createContext();
    engine.ctx.resume = async () => {};
    expect(await engine.unlock()).toBe(false);
    expect(engine.hasUnlocked).toBe(false);
  });

  it("bounds blocked autoplay and allows a subsequent gesture to retry", async () => {
    vi.useFakeTimers();
    try {
      global.window = createAudioWindow();
      const engine = new SoundEngine({});
      engine.createContext();
      engine.ctx.resume = () => new Promise(() => {});
      const pending = engine.unlock();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toBe(false);
      engine.ctx.resume = async () => { engine.ctx.state = "running"; };
      expect(await engine.unlock()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recreates a closed context after prior unlock", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const engine = new SoundEngine({});

    await engine.unlock();
    engine.ctx.state = "closed";

    const ready = await engine.ensureReady({ createIfMissing: false });

    expect(ready).toBe(true);
    expect(engine.getContextState()).toBe("running");
  });

  it("returns false instead of throwing when playback cannot recover", async () => {
    global.window = createAudioWindow({ initialState: "suspended", resumeShouldThrow: true });
    const engine = new SoundEngine({});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.hasUnlocked = true;

    const played = await engine.playPresetWhenReady("soft_chime", 0.8);

    expect(played).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("bundled voice playback", () => {
  it("maps scheduled context time to the output clock without double-counting latency", () => {
    const ctx = { currentTime: 100, baseLatency: 0.1, outputLatency: 0.2,
      getOutputTimestamp: () => ({ contextTime: 99.8, performanceTime: 10_000 }) };
    expect(estimateOutputStartMs(ctx, 100.01, { wallNow: () => 2_000_000, monotonicNow: () => 10_005 }))
      .toBeCloseTo(2_000_205, 6);
  });

  it("handles several seconds of output buffering without treating the timestamp as stale", () => {
    const times = { wallNow: () => 2_000_000, monotonicNow: () => 10_005 };
    const ctx = { currentTime: 100, getOutputTimestamp: () => ({ contextTime: 97, performanceTime: 10_000 }) };
    expect(estimateOutputStartMs(ctx, 100.01, times)).toBeCloseTo(2_003_005, 6);
    expect(estimateOutputStartMs({ currentTime: 100, outputLatency: 2.75 }, 100.01, times)).toBeCloseTo(2_002_760, 6);
  });

  it("falls back safely for absent, zero, stale, invalid or throwing output timestamps", () => {
    const times = { wallNow: () => 2_000_000, monotonicNow: () => 10_000 };
    const ctx = { currentTime: 10, baseLatency: 0.02, outputLatency: 0.1 };
    const expected = 2_000_130;
    for (const getOutputTimestamp of [undefined, () => ({ contextTime: 0, performanceTime: 0 }),
      () => ({ contextTime: 9.9, performanceTime: 8_000 }),
      () => ({ contextTime: NaN, performanceTime: 10_000 }), () => { throw new Error("unsupported"); }]) {
      expect(estimateOutputStartMs({ ...ctx, getOutputTimestamp }, 10.01, times)).toBeCloseTo(expected, 6);
    }
    expect(estimateOutputStartMs({ currentTime: 10 }, 10.01, times)).toBeCloseTo(2_000_010, 6);
    expect(estimateOutputStartMs({ currentTime: 10, baseLatency: Infinity, outputLatency: -1 }, 10.01, times)).toBeCloseTo(2_000_010, 6);
    const throwingLatency = { currentTime: 10, get outputLatency() { throw new Error("unavailable"); } };
    expect(estimateOutputStartMs(throwingLatency, 10.01, times)).toBeCloseTo(2_000_010, 6);
  });

  it("re-evaluates changing device latency for each cue without accumulating offsets", () => {
    const times = { wallNow: () => 10_000, monotonicNow: () => 1_000 };
    const ctx = { currentTime: 20, outputLatency: 0.05 };
    expect(estimateOutputStartMs(ctx, 20.01, times)).toBeCloseTo(10_060, 6);
    ctx.outputLatency = 0.4;
    expect(estimateOutputStartMs(ctx, 20.01, times)).toBeCloseTo(10_410, 6);
    expect(estimateOutputStartMs(ctx, 20.01, times)).toBeCloseTo(10_410, 6);
  });

  it("reanchors each cue after wall clock changes", () => {
    const ctx = { currentTime: 20, getOutputTimestamp: () => ({ contextTime: 19.9, performanceTime: 1_000 }) };
    for (const now of [1_000_000, 100_000, 8_000_000]) {
      expect(estimateOutputStartMs(ctx, 20.01, { wallNow: () => now, monotonicNow: () => 1_005 }))
        .toBeCloseTo(now + 105, 6);
    }
  });

  it("derives bounded speech motion only from the scheduled buffer and never breaks playback", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const engine = new SoundEngine({});
    await engine.unlock();
    const samples = new Float32Array(4_800);
    samples.fill(0.1, 1_920, 3_840);
    const buffer = { sampleRate: 48_000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
    const motion = vi.fn();
    const timing = vi.fn();
    engine.ctx.outputLatency = 0.012345;
    expect(engine.playBuffer(buffer, 0.7, motion, timing)).toBe(true);
    expect(timing).toHaveBeenCalledWith({ startedAtMs: expect.any(Number), durationMs: 100 });
    expect(motion).toHaveBeenCalledWith(expect.objectContaining({ frameMs: 40, levels: [0, expect.closeTo(0.8, 3), 0] }));
    const serialized = JSON.stringify(motion.mock.calls[0][0]);
    expect(Number.isInteger(JSON.parse(serialized).startedAtMs)).toBe(true);
    expect(serialized).toMatch(/"startedAtMs":\d+[,}]/);
    expect(engine.playBuffer(buffer, 0, motion)).toBe(true);
    expect(motion).toHaveBeenCalledTimes(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(engine.playBuffer(buffer, 0.5, () => { throw new Error("overlay failed"); })).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(engine.playBuffer(buffer, 0.5, undefined, () => { throw new Error("timing failed"); })).toBe(true);
    engine.onAudioDiagnostic = () => { throw new Error("diagnostic failed"); };
    expect(engine.playBuffer(buffer, 0.5)).toBe(true);
  });

  it("caps visual samples for long files", () => {
    const samples = new Float32Array(48_000 * 30);
    samples.fill(0.03);
    const envelope = speechEnvelope({ sampleRate: 48_000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples }, 1);
    expect(envelope.levels).toHaveLength(600);
    expect(envelope.levels[0]).toBeCloseTo(0.24, 4);
    let reads = 0;
    const sparse = new Proxy({ length: 384_000 * 30 }, { get(target, key) { if (key === "length") return target.length; reads++; return 0.1; } });
    const highRate = speechEnvelope({ sampleRate: 384_000, length: sparse.length, numberOfChannels: 8, getChannelData: () => sparse }, 1);
    expect(highRate.levels).toHaveLength(600);
    expect(reads).toBeLessThanOrEqual(600 * 64 * 2);
  });
  it("decodes and caches an offline asset and reports fetch or decode failures", async () => {
    global.window = createAudioWindow({ initialState: "running" });
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.stubGlobal("fetch", fetchMock);
    const engine = new SoundEngine({ builtInVoiceUrl: (id) => id === "voice" ? "/assets/voice.mp3" : null });
    await engine.unlock();
    const decode = vi.spyOn(engine.ctx, "decodeAudioData");
    expect(await engine.prepareBuiltInVoice("voice")).toEqual({});
    expect(await engine.playPresetWhenReady("voice", 0.5)).toBe(true);
    expect(await engine.playPresetWhenReady("voice", 0.5)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
    engine.builtInBufferCache.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await engine.prepareBuiltInVoice("voice")).toBeNull();
    expect(await engine.playPresetWhenReady("voice", 0.5)).toBe(false);
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    decode.mockRejectedValue(new Error("invalid audio"));
    expect(await engine.prepareBuiltInVoice("voice")).toBeNull();
    expect(await engine.playPresetWhenReady("voice", 0.5)).toBe(false);
    vi.unstubAllGlobals();
  });
});

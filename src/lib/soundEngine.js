import { clamp } from "./state.js";
import { getBuiltInVoiceUrl } from "./builtInVoices.js";

function isRecoverableAudioState(state) {
  return state === "suspended" || state === "interrupted";
}

// Map a scheduled AudioContext time onto an estimated output-device time.
// getOutputTimestamp() already accounts for the output path; never add the
// separately reported latencies to that estimate. Browsers may return zeros
// before the graph renders or stale/invalid timestamps after interruptions.
// Fall back to reported latencies (when present) or the original render-time
// estimate. These are estimates, not proof that a speaker produced sound.
export function estimateOutputTiming(ctx, scheduledTime, {
  wallNow = () => Date.now(),
  monotonicNow = () => globalThis.performance?.now?.()
} = {}) {
  const nowMs = wallNow();
  const currentTime = Number(ctx?.currentTime);
  const scheduledDelayMs = Number.isFinite(scheduledTime) && Number.isFinite(currentTime)
    ? Math.max(0, (scheduledTime - currentTime) * 1000)
    : 0;
  const bounded = (value) => Math.min(5000, Math.max(0, value));

  try {
    const nowPerf = monotonicNow();
    const timestamp = typeof ctx?.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
    const contextTime = timestamp?.contextTime;
    const performanceTime = timestamp?.performanceTime;
    if (Number.isFinite(nowPerf) && Number.isFinite(contextTime) && Number.isFinite(performanceTime) &&
        contextTime >= 0 && performanceTime > 0 && Math.abs(nowPerf - performanceTime) <= 1000 &&
        Number.isFinite(scheduledTime) && scheduledTime >= contextTime && scheduledTime - contextTime <= 5) {
      const delay = performanceTime + (scheduledTime - contextTime) * 1000 - nowPerf;
      if (Number.isFinite(delay) && delay >= -50 && delay <= 5000) return { startedAtMs: nowMs + bounded(delay), estimator: 'output-timestamp' };
    }
  } catch {
    // Timing metadata is optional and must never interfere with audio.
  }

  const latency = (name) => {
    try {
      const value = ctx?.[name];
      return Number.isFinite(value) && value >= 0 && value <= 5 ? value : 0;
    } catch {
      return 0;
    }
  };
  const base = latency("baseLatency"), output = latency("outputLatency");
  return { startedAtMs: nowMs + bounded(scheduledDelayMs + (base + output) * 1000), estimator: base || output ? 'reported-latency' : 'schedule-only' };
}
export function estimateOutputStartMs(ctx, scheduledTime, options) { return estimateOutputTiming(ctx, scheduledTime, options).startedAtMs; }

// A short, bounded, coarse envelope keeps the companion reactive to the
// actual decoded clip without adding a second audio graph or microphone.
export function speechEnvelope(buffer, amplitude) {
  if (!buffer || amplitude <= 0 || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      !Number.isInteger(buffer.length) || buffer.length <= 0 || !Number.isInteger(buffer.numberOfChannels) ||
      buffer.numberOfChannels < 1 || typeof buffer.getChannelData !== "function") return null;
  const frameMs = 40;
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * frameMs / 1000));
  const stride = Math.max(32, Math.ceil(frameSize / 64));
  const count = Math.min(600, Math.ceil(buffer.length / frameSize));
  // Sampling at most two channels at a fixed coarse stride caps work even for
  // long/multichannel files. This is visual approximation, not audio analysis.
  const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, i) => buffer.getChannelData(i));
  const levels = [];
  for (let frame = 0; frame < count; frame++) {
    const end = Math.min(buffer.length, (frame + 1) * frameSize);
    let squares = 0, samples = 0;
    for (const data of channels) for (let i = frame * frameSize; i < end && i < data.length; i += stride) {
      const sample = data[i];
      const value = Number.isFinite(sample) ? sample : 0;
      squares += value * value;
      samples++;
    }
    levels.push(samples ? Math.min(1, Math.sqrt(squares / samples) * 8) : 0);
  }
  return { frameMs, levels };
}

function playTone(ctx, options) {
  const {
    startTime,
    frequency,
    type = "sine",
    gain = 0.2,
    attack = 0.005,
    sustain = 0.08,
    release = 0.25,
    detune = 0
  } = options;
  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.detune.setValueAtTime(detune, startTime);
  amp.gain.setValueAtTime(0.0001, startTime);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), startTime + attack);
  amp.gain.setValueAtTime(Math.max(0.0001, gain), startTime + attack + sustain);
  amp.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + sustain + release);
  oscillator.connect(amp).connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + attack + sustain + release + 0.02);
}

function playGrandBell(ctx, startTime, gain) {
  playTone(ctx, { startTime, frequency: 440, type: "sine", gain: gain * 0.42, sustain: 0.1, release: 1.2 });
  playTone(ctx, { startTime, frequency: 660, type: "triangle", gain: gain * 0.2, sustain: 0.08, release: 0.9 });
  playTone(ctx, { startTime, frequency: 880, type: "sine", gain: gain * 0.15, sustain: 0.05, release: 0.6 });
}

function playSoftChime(ctx, startTime, gain) {
  playTone(ctx, { startTime, frequency: 523.25, type: "sine", gain: gain * 0.3, sustain: 0.06, release: 0.5 });
  playTone(ctx, {
    startTime: startTime + 0.15,
    frequency: 659.26,
    type: "sine",
    gain: gain * 0.2,
    sustain: 0.05,
    release: 0.45
  });
  playTone(ctx, {
    startTime: startTime + 0.3,
    frequency: 783.99,
    type: "triangle",
    gain: gain * 0.18,
    sustain: 0.04,
    release: 0.4
  });
}

function playWoodTick(ctx, startTime, gain) {
  playTone(ctx, { startTime, frequency: 220, type: "square", gain: gain * 0.28, attack: 0.001, sustain: 0.01, release: 0.08 });
  playTone(ctx, {
    startTime: startTime + 0.025,
    frequency: 330,
    type: "triangle",
    gain: gain * 0.14,
    attack: 0.001,
    sustain: 0.006,
    release: 0.05
  });
}

function playBrightPing(ctx, startTime, gain) {
  playTone(ctx, { startTime, frequency: 1046.5, type: "triangle", gain: gain * 0.22, sustain: 0.04, release: 0.24 });
  playTone(ctx, { startTime, frequency: 1396.9, type: "sine", gain: gain * 0.18, sustain: 0.035, release: 0.2 });
}

export class SoundEngine {
  constructor({ customBlobLoader, builtInVoiceUrl = getBuiltInVoiceUrl, nativeClipPlayer = null }) {
    this.ctx = null;
    this.masterVolume = 0.75;
    this.customBlobLoader = customBlobLoader;
    this.builtInVoiceUrl = builtInVoiceUrl;
    this.nativeClipPlayer = nativeClipPlayer;
    this.encodedClipCache = new Map();
    this.builtInBufferCache = new Map();
    this.customBufferCache = new Map();
    this.readyPromise = null;
    this.hasUnlocked = false;
    this.lastKnownContextState = "none";
    this.contextCreatedAt = 0;
    this.contextRefreshPromise = null;
    this.contextRefreshRetryAt = 0;
    this.activeSources = 0;
    this.pendingPlays = 0;
    this.toneBusyUntil = 0;
  }

  createContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    this.ctx = new AudioContextCtor();
    this.contextCreatedAt = performance.now();
    try { this.onAudioContextCreated?.(this.ctx); } catch { /* Optional diagnostics. */ }
    this.lastKnownContextState = this.ctx.state || "unknown";
    if (typeof this.ctx.addEventListener === "function") {
      this.ctx.addEventListener("statechange", () => {
        this.lastKnownContextState = this.ctx?.state || "unknown";
      });
    }
  }

  getContextState() {
    if (!this.ctx) {
      return "missing";
    }
    return this.ctx.state || this.lastKnownContextState || "unknown";
  }

  async ensureReady({ createIfMissing = true } = {}) {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      if (!this.ctx) {
        if (!createIfMissing) {
          return false;
        }
        this.createContext();
      }

      this.lastKnownContextState = this.getContextState();
      if (this.getContextState() === "closed") {
        if (!createIfMissing && !this.hasUnlocked) {
          return false;
        }
        this.createContext();
      }

      if (!this.ctx) {
        return false;
      }

      const currentState = this.getContextState();
      if (isRecoverableAudioState(currentState)) {
        // Autoplay blocking can leave resume() pending until a later gesture.
        // Release the readiness promise so that a real Start click can retry.
        let timeout;
        try {
          await Promise.race([
            this.ctx.resume(),
            new Promise((resolve) => { timeout = setTimeout(resolve, 2_000); })
          ]);
        } finally {
          clearTimeout(timeout);
        }
      }

      this.lastKnownContextState = this.getContextState();
      return this.getContextState() === "running";
    })().finally(() => {
      this.readyPromise = null;
    });

    return this.readyPromise;
  }

  // Refresh before cue preparation, after 30 minutes of actual monotonic time.
  // Retain the old context if the replacement cannot run without a gesture.
  async refreshContextIfDue() {
    const now = performance.now();
    if (!this.ctx || !this.hasUnlocked || now - this.contextCreatedAt < 30 * 60 * 1000 || now < this.contextRefreshRetryAt || this.activeSources || this.pendingPlays || now < this.toneBusyUntil) return false;
    if (this.contextRefreshPromise) return this.contextRefreshPromise;
    const old = this.ctx;
    this.contextRefreshPromise = (async () => {
      let candidate, timer;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        candidate = new Ctor();
        if (candidate.state !== "running") {
          await Promise.race([candidate.resume(), new Promise((resolve) => { timer = setTimeout(resolve, 2000); })]);
        }
        if (candidate.state !== "running" || this.ctx !== old || this.activeSources || this.pendingPlays || performance.now() < this.toneBusyUntil) throw new Error("replacement unavailable or audio busy");
        this.ctx = candidate;
        this.contextCreatedAt = performance.now();
        this.contextRefreshRetryAt = 0;
        this.lastKnownContextState = candidate.state;
        candidate.addEventListener?.("statechange", () => { if (this.ctx === candidate) this.lastKnownContextState = candidate.state || "unknown"; });
        try { this.onAudioContextCreated?.(candidate); this.onAudioContextRefresh?.(candidate, "success"); } catch { /* Optional diagnostics. */ }
        try { void Promise.resolve(old.close()).catch(() => {}); } catch { /* Old audio may already be closed. */ }
        return true;
      } catch {
        this.contextRefreshRetryAt = performance.now() + 60_000;
        try { this.onAudioContextRefresh?.(old, "failed"); } catch { /* Optional diagnostics. */ }
        if (candidate && candidate !== this.ctx) { try { void Promise.resolve(candidate.close()).catch(() => {}); } catch {} }
        return false;
      } finally { clearTimeout(timer); }
    })().finally(() => { this.contextRefreshPromise = null; });
    return this.contextRefreshPromise;
  }

  async unlock() {
    const ready = await this.ensureReady({ createIfMissing: true });
    this.lastKnownContextState = this.getContextState();
    this.hasUnlocked = this.hasUnlocked || ready;
    return ready;
  }

  setMasterVolume(volume) {
    this.masterVolume = clamp(volume, 0, 1);
  }

  clearCustomBufferCache() {
    this.customBufferCache.clear();
    this.encodedClipCache.clear();
  }

  playPreset(presetId, volume = 1, { onBufferScheduled, onAudioTiming, trace, shouldPlay, native = false } = {}) {
    const amplitude = clamp(volume * this.masterVolume, 0, 1);
    this.pendingPlays++;
    return this.playPresetWhenReady(presetId, amplitude, { onBufferScheduled, onAudioTiming, trace, shouldPlay, native }).finally(() => { this.pendingPlays--; });
  }

  async preparePresetForPlayback(presetId) {
    await this.refreshContextIfDue();
    if (!this.ctx || this.getContextState() !== "running") return false;
    if (["grand_bell", "soft_chime", "wood_tick", "bright_ping"].includes(presetId)) return true;
    if (this.builtInVoiceUrl(presetId)) return Boolean(await this.prepareBuiltInVoice(presetId));
    return Boolean(await this.prepareCustomPreset(presetId));
  }

  async playPresetWhenReady(presetId, amplitude, { onBufferScheduled, onAudioTiming, trace = {}, shouldPlay, native = false } = {}) {
    try {
      const requestedAt = performance.now();
      const shouldCreate = Boolean(this.ctx) || this.hasUnlocked;
      const ready = await this.ensureReady({ createIfMissing: shouldCreate });
      trace = { ...trace, readyMs: performance.now() - requestedAt };
      if (typeof shouldPlay === "function" && !shouldPlay()) return "cancelled";
      if (!ready || !this.ctx) {
        return false;
      }
      if (native && this.nativeClipPlayer && !["grand_bell", "soft_chime", "wood_tick", "bright_ping"].includes(presetId)) {
        return await this.playNativePreset(presetId, amplitude, onBufferScheduled, onAudioTiming, trace, shouldPlay);
      }
      const startTime = this.ctx.currentTime + 0.01;
      switch (presetId) {
        case "grand_bell":
          playGrandBell(this.ctx, startTime, amplitude);
          break;
        case "soft_chime":
          playSoftChime(this.ctx, startTime, amplitude);
          break;
        case "wood_tick":
          playWoodTick(this.ctx, startTime, amplitude);
          break;
        case "bright_ping":
          playBrightPing(this.ctx, startTime, amplitude);
          break;
        default: {
          if (this.builtInVoiceUrl(presetId)) return await this.playBuiltInVoice(presetId, amplitude, onBufferScheduled, onAudioTiming, trace, shouldPlay);
          return await this.playCustomPreset(presetId, amplitude, onBufferScheduled, onAudioTiming, trace, shouldPlay);
        }
      }
      this.toneBusyUntil = performance.now() + 2500;
      try {
        const output = estimateOutputTiming(this.ctx, startTime);
        try { this.onAudioDiagnostic?.(this.ctx, startTime, output.startedAtMs, { ...trace, estimator: output.estimator }); } catch { /* Optional diagnostics. */ }
        try { onAudioTiming?.({ startedAtMs: Math.round(output.startedAtMs), durationMs: 1500 }); } catch { /* Visual timing is optional. */ }
      } catch { /* Optional timing metadata. */ }
      return true;
    } catch (error) {
      console.warn(`Unable to play preset "${presetId}"`, error);
      return false;
    }
  }

  async prepareBuiltInVoice(presetId) {
    const url = this.builtInVoiceUrl(presetId);
    if (!url || !this.ctx) return null;
    try {
      let buffer = this.builtInBufferCache.get(presetId);
      if (!buffer) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (this.nativeClipPlayer && bytes.byteLength <= 8 * 1024 * 1024) this.encodedClipCache.set(presetId, bytes.slice(0));
        buffer = await this.ctx.decodeAudioData(bytes);
        this.builtInBufferCache.set(presetId, buffer);
      }
      return buffer;
    } catch (error) {
      console.warn(`Unable to load built-in voice "${presetId}"`, error);
      return null;
    }
  }

  async playNativePreset(presetId, amplitude, onBufferScheduled, onAudioTiming, trace, shouldPlay) {
    const builtIn = Boolean(this.builtInVoiceUrl(presetId));
    const buffer = builtIn ? await this.prepareBuiltInVoice(presetId) : await this.prepareCustomPreset(presetId);
    if (typeof shouldPlay === "function" && !shouldPlay()) return "cancelled";
    const bytes = this.encodedClipCache.get(presetId);
    // Large clips retain the established Web Audio path.
    if (!buffer || !bytes) return this.playBuffer(buffer, amplitude, onBufferScheduled, onAudioTiming, trace);
    let result;
    try { result = await this.nativeClipPlayer(new Uint8Array(bytes), amplitude); }
    catch (error) { console.warn("Native playback failed:", error); return false; }
    if (!result || !Number.isFinite(result.startedAtMs)) return false;
    trace.lifecycle?.("source-start", { startedAtMs: result.startedAtMs, backend: "native" });
    try { onAudioTiming?.({ startedAtMs: result.startedAtMs, durationMs: result.durationMs }); } catch { /* Optional visual timing. */ }
    try { const envelope = speechEnvelope(buffer, amplitude); if (envelope) onBufferScheduled?.({ ...envelope, startedAtMs: result.startedAtMs }); } catch { /* Optional speech motion. */ }
    return true;
  }

  async playBuiltInVoice(presetId, amplitude, onBufferScheduled, onAudioTiming, trace = {}, shouldPlay) {
    try {
      const start = performance.now();
      const buffer = await this.prepareBuiltInVoice(presetId);
      if (typeof shouldPlay === "function" && !shouldPlay()) return "cancelled";
      return this.playBuffer(buffer, amplitude, onBufferScheduled, onAudioTiming, { ...trace, bufferMs: performance.now() - start });
    } catch (error) {
      console.warn(`Unable to play built-in voice "${presetId}"`, error);
      return false;
    }
  }

  playBuffer(buffer, amplitude, onBufferScheduled, onAudioTiming, trace = {}) {
    if (!buffer || !this.ctx) return false;
    let envelope = null;
    if (typeof onBufferScheduled === "function") {
      try { envelope = speechEnvelope(buffer, amplitude); } catch (error) { console.warn("Unable to prepare companion speech motion:", error); }
    }
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    source.buffer = buffer;
    gainNode.gain.setValueAtTime(Math.max(0.0001, amplitude), ctx.currentTime);
    source.connect(gainNode).connect(ctx.destination);
    const audioAtStart = ctx.currentTime;
    const scheduledTime = audioAtStart + 0.01;
    source.start(scheduledTime);
    this.activeSources++;
    source.onended = () => { this.activeSources = Math.max(0, this.activeSources - 1); };
    try {
      const estimated = estimateOutputTiming(ctx, scheduledTime);
      trace.lifecycle?.('source-start', { scheduledAudioTimeMs: scheduledTime * 1000, estimatedOutputOffsetMs: estimated.startedAtMs - Date.now() });
    } catch { /* Optional diagnostics. */ }
    const monitor = this.onAudioPlaybackDiagnostic;
    const duration = Number.isFinite(buffer.duration) ? buffer.duration : buffer.length / buffer.sampleRate;
    if (typeof monitor === "function" && Number.isFinite(duration) && duration > 0 && duration <= 600) {
      try {
        const startedAt = performance.now();
        const expectedMs = (scheduledTime - audioAtStart + duration) * 1000;
        let ended = false;
        const report = (stage) => {
          try {
            const wallElapsedMs = performance.now() - startedAt;
            const audioProgressMs = (ctx.currentTime - audioAtStart) * 1000;
            if (![wallElapsedMs, audioProgressMs, expectedMs].every(Number.isFinite)) return;
            const callbackLagMs = Math.max(0, (ctx.currentTime - scheduledTime - duration) * 1000);
            trace.lifecycle?.(stage === "ended" ? "source-ended" : "source-overdue", { wallElapsedMs, audioProgressMs, expectedMs, callbackLagMs });
            if (stage === "ended" && wallElapsedMs - expectedMs < 300 && callbackLagMs < 300 && Math.abs(wallElapsedMs - audioProgressMs) < 300) return;
            monitor(ctx, { stage, wallElapsedMs, audioProgressMs, expectedMs, callbackLagMs });
          } catch { /* Optional monitoring must never interfere with playback. */ }
        };
        const watchdog = setTimeout(() => { if (!ended) report("overdue"); }, expectedMs + 1500);
        const release = source.onended;
        source.onended = () => { release(); ended = true; clearTimeout(watchdog); report("ended"); };
      } catch { /* Optional monitoring must never interfere with playback. */ }
    }
    if (envelope || typeof onAudioTiming === "function" || typeof this.onAudioDiagnostic === "function") {
      try {
        // The native IPC contract uses an integer millisecond timestamp.
        const output = estimateOutputTiming(this.ctx, scheduledTime);
        const startedAtMs = Math.round(output.startedAtMs);
        try { this.onAudioDiagnostic?.(this.ctx, scheduledTime, startedAtMs, { ...trace, estimator: output.estimator }); } catch { /* Optional diagnostics. */ }
        if (typeof onAudioTiming === "function") {
          try {
            const seconds = Number.isFinite(buffer.duration) ? buffer.duration : buffer.length / buffer.sampleRate;
            if (Number.isFinite(seconds) && seconds >= 0) onAudioTiming({ startedAtMs, durationMs: Math.ceil(seconds * 1000) });
          } catch (error) { console.warn("Unable to send companion audio timing:", error); }
        }
        if (envelope) onBufferScheduled({ ...envelope, startedAtMs });
      } catch (error) { console.warn("Unable to send companion speech motion:", error); }
    }
    return true;
  }

  async prepareCustomPreset(presetId) {
    if (!this.ctx || !this.customBlobLoader) {
      return null;
    }
    try {
      let buffer = this.customBufferCache.get(presetId);
      if (!buffer) {
        const blob = await this.customBlobLoader(presetId);
        if (!blob) {
          return null;
        }
        const arrayBuffer = await blob.arrayBuffer();
        if (this.nativeClipPlayer && arrayBuffer.byteLength <= 8 * 1024 * 1024) this.encodedClipCache.set(presetId, arrayBuffer.slice(0));
        buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
        this.customBufferCache.set(presetId, buffer);
      }
      return buffer;
    } catch (error) {
      console.warn(`Unable to load imported preset "${presetId}"`, error);
      return null;
    }
  }

  async playCustomPreset(presetId, amplitude, onBufferScheduled, onAudioTiming, trace = {}, shouldPlay) {
    try {
      const start = performance.now();
      const buffer = await this.prepareCustomPreset(presetId);
      if (typeof shouldPlay === "function" && !shouldPlay()) return "cancelled";
      return this.playBuffer(buffer, amplitude, onBufferScheduled, onAudioTiming, { ...trace, bufferMs: performance.now() - start });
    } catch (error) {
      console.warn(`Unable to play imported preset "${presetId}"`, error);
      return false;
    }
  }
}

// Session-only, opt-in metadata. Never inspect the buffer, name, or cue text.
export function createAudioDiagnostics({ now = () => performance.now(), onChange = () => {}, limit = 100 } = {}) {
  let enabled = false;
  let samples = [];
  let nextContextId = 1;
  const contexts = new WeakMap();
  const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const read = (fn) => { try { return fn(); } catch { return null; } };

  function noteContext(ctx) {
    if (ctx && !contexts.has(ctx)) contexts.set(ctx, { id: nextContextId++, createdAt: now() });
  }

  function record(ctx, scheduledTime, estimatedStartMs) {
    if (!enabled || !ctx) return;
    try {
      noteContext(ctx);
      const performanceMs = now();
      const timestamp = read(() => ctx.getOutputTimestamp?.());
      const info = contexts.get(ctx);
      const sample = {
        contextId: info.id,
        contextAgeMs: finite(performanceMs - info.createdAt),
        performanceMs: finite(performanceMs),
        contextTimeSec: finite(read(() => ctx.currentTime)),
        outputContextTimeSec: finite(timestamp?.contextTime),
        outputPerformanceMs: finite(timestamp?.performanceTime),
        baseLatencySec: finite(read(() => ctx.baseLatency)),
        outputLatencySec: finite(read(() => ctx.outputLatency)),
        scheduledTimeSec: finite(scheduledTime),
        estimatedStartDelayMs: finite(estimatedStartMs - Date.now()),
        state: ["running", "suspended", "interrupted", "closed"].includes(ctx.state) ? ctx.state : "unknown"
      };
      // Keep the first sample as a baseline as well as the latest observations.
      samples.push(sample);
      if (samples.length > limit) samples.splice(1, samples.length - limit);
      onChange(samples.length);
    } catch {
      // Diagnostics must never interfere with playback.
    }
  }

  return {
    noteContext,
    record,
    setEnabled(value) { enabled = Boolean(value); if (!enabled) samples = []; onChange(samples.length); },
    getText() { return JSON.stringify({ version: 1, samples }, null, 2); }
  };
}

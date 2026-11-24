import { createAudioTimingStore } from './audioTimingStore.js';

// A compact diagnostic timeline, with no cue text, filenames or audio.
// Clock progress gaps compare consecutive observations, not a permanent baseline.
export function createAudioAnomalies({ store = createAudioTimingStore(), getStorage = () => window.localStorage, now = () => performance.now(), wallNow = () => Date.now(), onChange = () => {}, appendFile = null, onEvent = () => {}, enabled = true } = {}) {
  const legacyKey = 'heartbeat.audio-timing-anomalies.v1';
  const contexts = new WeakMap();
  const sessionId = `${Math.round(wallNow())}-${Math.random().toString(36).slice(2, 10)}`;
  let nextContextId = 0, nextCueId = 0, events = [], legacy = [], error = '', fileError = '', queue = Promise.resolve(), generation = 0, pending = 0, enabledRevision = 0;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const round = (v) => finite(v) ? Math.round(v) : null;
  const read = (fn) => { try { return fn(); } catch { return null; } };
  try {
    const data = JSON.parse(getStorage().getItem(legacyKey) || '[]');
    if (Array.isArray(data)) legacy = data.filter((x) => x && ['output-delay', 'output-clock-offset', 'stale-output-clock', 'clock-divergence', 'context-state'].includes(x.reason) && finite(x.atMs) && finite(x.valueMs)).slice(-100).map(({reason, atMs, valueMs}) => ({reason, atMs, valueMs}));
  } catch { /* Legacy data remains untouched if inaccessible. */ }
  const notify = () => { try { onChange(); } catch { /* Diagnostics are optional. */ } };
  const load = () => { queue = queue.then(async () => { await store.prune?.(); events = await store.list(200); error = ''; notify(); }).catch(() => { error = 'Timing history is unavailable on this device.'; notify(); }); return queue; };
  load();
  function write(event) {
    if (!enabled) return;
    try { onEvent(event); } catch { /* Display is optional. */ }
    if (pending >= 256) { fileError = 'Timing log queue is full; some observations were not saved.'; notify(); return; }
    pending++;
    const writeGeneration = generation;
    queue = queue.then(async () => {
      if (writeGeneration !== generation) return;
      if (appendFile) { try { await appendFile(event); } catch { fileError = 'Could not write timing log file; the file may be incomplete.'; } }
      try { await store.append(event); events = await store.list(200); error = ''; } catch { error = 'Could not save the local timing preview; playback is unaffected.'; }
    }).catch(() => { error = 'Could not save timing history; playback is unaffected.'; }).finally(() => { pending--; notify(); });
  }
  function noteContext(ctx) {
    if (!ctx || contexts.has(ctx)) return;
    const context = { id: ++nextContextId, last: null, lastCheckpoint: -Infinity, active: new Map() };
    contexts.set(ctx, context);
    if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', () => {
      try {
        const state = read(() => ctx.state);
        context.last = null;
        context.active.clear();
        if (['running', 'suspended', 'interrupted', 'closed'].includes(state)) write({ version: 2, atMs: Math.round(wallNow()), sessionId, contextId: context.id, kind: 'context-state', contextState: state });
      } catch { /* Best-effort metadata only. */ }
    });
  }
  function record(ctx, scheduledTime, estimatedStartMs, timing = {}) {
    try {
      if (!enabled || !ctx) return;
      const perf = now(), atMs = wallNow(), current = read(() => ctx.currentTime), state = read(() => ctx.state);
      if (!finite(perf) || !finite(atMs) || !finite(current)) return;
      noteContext(ctx);
      const context = contexts.get(ctx);
      if (context.enabledRevision !== enabledRevision) { context.last = null; context.active.clear(); context.enabledRevision = enabledRevision; }
      const previous = context.last;
      // A known interruption resets the comparison. A gap between observations
      // is evidence of clock progress, not proof of a device or speaker delay.
      const gap = previous && state === 'running' && previous.state === 'running' && perf >= previous.perf && current >= previous.current
        ? (perf - previous.perf) - (current - previous.current) * 1000 : null;
      context.last = { perf, current, state };
      const timestamp = read(() => ctx.getOutputTimestamp?.());
      const age = finite(timestamp?.performanceTime) && timestamp.performanceTime > 0 ? perf - timestamp.performanceTime : null;
      const raw = finite(age) && finite(timestamp?.contextTime) && finite(scheduledTime) ? timestamp.performanceTime + (scheduledTime - timestamp.contextTime) * 1000 - perf : null;
      const outputDelay = finite(estimatedStartMs) ? estimatedStartMs - atMs : null;
      const targetOffset = finite(estimatedStartMs) && finite(timing.targetAtMs) ? estimatedStartMs - timing.targetAtMs : null;
      const flags = new Map();
      if (finite(gap) && Math.abs(gap) > 750) flags.set('clock-progress-gap', gap);
      if (finite(outputDelay) && outputDelay > 500) flags.set('estimated-output-delay', outputDelay);
      if (finite(age) && Math.abs(age) > 1000) flags.set('stale-output-timestamp', age);
      if (finite(raw) && raw > 500 && !(finite(outputDelay) && outputDelay > 500 && Math.abs(raw - outputDelay) < 100)) flags.set('raw-output-offset', raw);
      if (state && state !== 'running') flags.set('context-not-running', 0);
      if (finite(timing.prepareMs) && timing.prepareMs > 500) flags.set('slow-companion-preparation', timing.prepareMs);
      if (finite(timing.showMs) && timing.showMs > 500) flags.set('slow-companion-show', timing.showMs);
      if (finite(timing.introMs) && timing.introMs > 1500) flags.set('slow-intro', timing.introMs);
      if (finite(timing.readyMs) && timing.readyMs > 500) flags.set('slow-audio-ready', timing.readyMs);
      if (finite(timing.bufferMs) && timing.bufferMs > 500) flags.set('slow-buffer-preparation', timing.bufferMs);
      if (finite(timing.schedulerLatenessMs) && timing.schedulerLatenessMs > 1000) flags.set('late-scheduler-dispatch', timing.schedulerLatenessMs);
      if (finite(targetOffset) && targetOffset > 500) flags.set('late-target-output-estimate', targetOffset);
      const reasons = [...flags.keys()];
      const checkpoint = perf - context.lastCheckpoint >= 15 * 60 * 1000;
      const changed = reasons.some((reason) => !context.active.has(reason) || Math.abs(flags.get(reason) - context.active.get(reason)) >= 1000);
      const recovered = [...context.active.keys()].filter((reason) => !flags.has(reason));
      // Each fresh clock-progress gap is a new interval; persistent output flags
      // get a checkpoint rather than a duplicate entry for every cue.
      if (checkpoint || changed || recovered.length || reasons.includes('clock-progress-gap')) {
        context.lastCheckpoint = perf;
        write({ version: 2, atMs: Math.round(atMs), sessionId, contextId: context.id,
          kind: reasons.length || recovered.length ? 'observation' : 'checkpoint', reasons, recovered,
          clockProgressGapMs: round(gap), outputDelayMs: round(outputDelay), outputTimestampAgeMs: round(age), rawOutputOffsetMs: round(raw),
          baseLatencyMs: finite(read(() => ctx.baseLatency)) ? round(ctx.baseLatency * 1000) : null, outputLatencyMs: finite(read(() => ctx.outputLatency)) ? round(ctx.outputLatency * 1000) : null,
          contextState: ['running', 'suspended', 'interrupted', 'closed'].includes(state) ? state : 'unknown',
          estimator: ['output-timestamp', 'reported-latency', 'schedule-only'].includes(timing.estimator) ? timing.estimator : 'unknown',
          introMs: round(timing.introMs), prepareMs: round(timing.prepareMs), showMs: round(timing.showMs),
          readyMs: round(timing.readyMs), bufferMs: round(timing.bufferMs), schedulerLatenessMs: round(timing.schedulerLatenessMs), dispatchOffsetMs: round(timing.dispatchOffsetMs), targetOffsetMs: round(targetOffset) });
      }
      // Compare against the last recorded value, not the previous sample, so
      // small changes eventually accumulate into a meaningful update.
      if (checkpoint || changed || recovered.length || reasons.includes('clock-progress-gap')) context.active = flags;
    } catch { /* Diagnostics must never interfere with playback. */ }
  }
  // A cue-local timeline records normal paths too: a delayed output estimate may
  // otherwise look healthy and leave no event to correlate with a recording.
  function startCue(getContext, targetAtMs, backend) {
    const cueId = ++nextCueId;
    const started = now();
    return (stage, details = {}) => {
      try {
        if (!enabled || !['dispatch', 'prepare-start', 'prepare-end', 'show-start', 'show-end', 'play-request', 'source-start', 'source-ended', 'source-overdue', 'delivery-end'].includes(stage)) return;
        const ctx = getContext();
        if (ctx) noteContext(ctx);
        const state = read(() => ctx?.state);
        const wall = wallNow();
        const atMs = stage === 'source-start' && finite(details.startedAtMs) && Math.abs(details.startedAtMs - wall) <= 5000 ? details.startedAtMs : wall;
        const event = { version: 2, kind: 'cue-lifecycle', sessionId, cueId, contextId: ctx ? contexts.get(ctx).id : 0,
          stage, atMs: round(atMs), contextState: ['running', 'suspended', 'interrupted', 'closed'].includes(state) ? state : 'unknown',
          elapsedMs: round(now() - started), targetOffsetMs: finite(targetAtMs) ? round(atMs - targetAtMs) : null,
          contextTimeMs: finite(read(() => ctx?.currentTime)) ? round(ctx.currentTime * 1000) : null };
        if (['native', 'web-audio'].includes(details.backend || backend)) event.backend = details.backend || backend;
        for (const key of ['wallElapsedMs', 'audioProgressMs', 'expectedMs', 'callbackLagMs', 'scheduledAudioTimeMs', 'estimatedOutputOffsetMs']) {
          if (finite(details[key])) event[key] = round(details[key]);
        }
        if (stage === 'source-start' && ctx) {
          const stamp = read(() => ctx.getOutputTimestamp?.());
          const perf = now();
          event.outputTimestampAgeMs = finite(stamp?.performanceTime) && stamp.performanceTime > 0 ? round(perf - stamp.performanceTime) : null;
          event.rawOutputOffsetMs = finite(stamp?.performanceTime) && finite(stamp?.contextTime) && finite(details.scheduledAudioTimeMs)
            ? round(stamp.performanceTime + details.scheduledAudioTimeMs - stamp.contextTime * 1000 - perf) : null;
          event.baseLatencyMs = finite(read(() => ctx.baseLatency)) ? round(ctx.baseLatency * 1000) : null;
          event.outputLatencyMs = finite(read(() => ctx.outputLatency)) ? round(ctx.outputLatency * 1000) : null;
        }
        if (['ready', 'unavailable', 'timeout', 'cancel', 'overlap', 'fallback', 'shown', 'success', 'failed', 'cancelled', 'stale'].includes(details.result)) event.result = details.result;
        write(event);
      } catch { /* Diagnostics must never interfere with playback. */ }
    };
  }
  function recordContextRefresh(ctx, result) {
    try {
      if (!enabled || !ctx || !['success', 'failed'].includes(result)) return;
      noteContext(ctx);
      const state = read(() => ctx.state);
      write({ version: 2, atMs: Math.round(wallNow()), sessionId, contextId: contexts.get(ctx).id, kind: 'context-refresh', result,
        contextState: ['running', 'suspended', 'interrupted', 'closed'].includes(state) ? state : 'unknown' });
    } catch { /* Optional diagnostics. */ }
  }
  function recordPlayback(ctx, measurement) {
    try {
      if (!enabled || !ctx || !['overdue', 'ended'].includes(measurement?.stage)) return;
      const values = ['wallElapsedMs', 'audioProgressMs', 'expectedMs', 'callbackLagMs'];
      if (!values.every((key) => finite(measurement[key]))) return;
      noteContext(ctx);
      const state = read(() => ctx.state);
      write({ version: 2, atMs: Math.round(wallNow()), sessionId, contextId: contexts.get(ctx).id,
        kind: 'playback-check', stage: measurement.stage,
        reasons: [measurement.stage === 'overdue' ? 'end-event-overdue' : 'end-event-delayed'],
        contextState: ['running', 'suspended', 'interrupted', 'closed'].includes(state) ? state : 'unknown',
        wallElapsedMs: round(measurement.wallElapsedMs), audioProgressMs: round(measurement.audioProgressMs),
        expectedMs: round(measurement.expectedMs), callbackLagMs: round(measurement.callbackLagMs) });
    } catch { /* Optional monitoring must never interfere with playback. */ }
  }
  return {
    record, recordPlayback, recordContextRefresh, noteContext, startCue,
    setEnabled(value) { enabled = Boolean(value); enabledRevision++; if (!enabled) generation++; },
    async clear() { generation++; await queue; try { await store.clear(); getStorage().removeItem(legacyKey); events = []; legacy = []; error = ''; } catch { error = 'Could not clear timing history.'; } notify(); },
    getText() { return JSON.stringify({ version: 2, previewLimit: 200, legacyCumulativeEvents: legacy, events }, null, 2); },
    async getExportText() { await queue; await store.prune?.(); const all = await store.list(); return JSON.stringify({ version: 2, legacyCumulativeEvents: legacy, events: all }, null, 2); },
    getCount() { return events.length; }, getLegacyCount() { return legacy.length; }, getError() { return fileError || error; },
    whenIdle() { return queue; }
  };
}

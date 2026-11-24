import { describe, expect, it } from 'vitest';
import { createAudioAnomalies } from '../../src/lib/audioAnomalies.js';

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
function memoryStore() {
  let data = [];
  return { append: async (event) => { data.push(event); }, list: async () => [...data], clear: async () => { data = []; } };
}

describe('audio timing timeline', () => {
  it('records the native source timestamp and backend while rejecting stale timestamps', async () => {
    const log = createAudioAnomalies({ store: memoryStore(), getStorage: storage, now: () => 1000, wallNow: () => 10000 });
    const cue = log.startCue(() => null, undefined, 'native');
    cue('source-start', { startedAtMs: 9950 }); cue('source-start', { startedAtMs: 1000 });
    await log.whenIdle();
    const events = JSON.parse(log.getText()).events;
    expect(events[0]).toMatchObject({ backend: 'native', atMs: 9950, contextId: 0 });
    expect(events[1].atMs).toBe(10000);
  });
  it('sends a metadata-only live event without waiting for storage and respects opt-out', async () => {
    const received = [];
    const log = createAudioAnomalies({ store: memoryStore(), getStorage: storage, now: () => 1000, wallNow: () => 1000, onEvent: (event) => received.push(event) });
    const cue = log.startCue(() => ({ state: 'running', currentTime: 1 }), 2000);
    cue('source-start', { scheduledAudioTimeMs: 1010, filename: 'private.wav' });
    expect(received).toHaveLength(1); expect(JSON.stringify(received)).not.toContain('private');
    log.setEnabled(false); cue('source-start'); expect(received).toHaveLength(1);
    await log.whenIdle();
  });
  it('correlates every lifecycle stage without recording private fields and respects opt-out', async () => {
    let time = 1000;
    const log = createAudioAnomalies({ store: memoryStore(), getStorage: storage, now: () => time, wallNow: () => time });
    const ctx = { state: 'running', currentTime: 3 };
    const cue = log.startCue(() => ctx, 2000);
    cue('dispatch'); time = 2015;
    cue('source-start', { scheduledAudioTimeMs: 3010, estimatedOutputOffsetMs: 12, filename: 'private.wav' });
    time = 4015; ctx.currentTime = 5;
    cue('source-ended', { wallElapsedMs: 2000, audioProgressMs: 2000, expectedMs: 2000, callbackLagMs: 0 });
    cue('delivery-end', { result: 'success' });
    await log.whenIdle();
    const events = JSON.parse(log.getText()).events;
    expect(events.map((e) => e.stage)).toEqual(['dispatch', 'source-start', 'source-ended', 'delivery-end']);
    expect(new Set(events.map((e) => e.cueId)).size).toBe(1);
    expect(events[1]).toMatchObject({ targetOffsetMs: 15, contextTimeMs: 3000, scheduledAudioTimeMs: 3010 });
    expect(log.getText()).not.toContain('private');
    log.setEnabled(false); cue('source-ended'); await log.whenIdle(); expect(log.getCount()).toBe(4);
  });
  it('records only allowlisted completion metrics and honors opt-out', async () => {
    const store = memoryStore();
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => 1000, wallNow: () => 1000 });
    const ctx = { state: 'running', currentTime: 1 };
    log.recordPlayback(ctx, { stage: 'overdue', wallElapsedMs: 3500, audioProgressMs: 1000, expectedMs: 2000, callbackLagMs: 0, filename: 'secret.wav' });
    await log.whenIdle();
    expect(JSON.parse(log.getText()).events[0]).toMatchObject({ kind: 'playback-check', stage: 'overdue', reasons: ['end-event-overdue'], wallElapsedMs: 3500, audioProgressMs: 1000 });
    expect(log.getText()).not.toContain('secret');
    log.setEnabled(false);
    log.recordPlayback(ctx, { stage: 'ended', wallElapsedMs: 4000, audioProgressMs: 2000, expectedMs: 2000, callbackLagMs: 0 });
    await log.whenIdle(); expect(log.getCount()).toBe(1);
  });
  it('keeps a baseline, identifies new gaps, and does not repeat a permanent offset', async () => {
    const store = memoryStore(); let time = 1000;
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => time, wallNow: () => time });
    const ctx = { state: 'running', currentTime: 1, filename: 'secret.wav' };
    log.record(ctx, 1, time + 20, { estimator: 'schedule-only', introMs: 1000 });
    time += 60000; ctx.currentTime += 59;
    log.record(ctx, ctx.currentTime, time + 20);
    time += 60000; ctx.currentTime += 60;
    log.record(ctx, ctx.currentTime, time + 20);
    time += 60000; ctx.currentTime += 58;
    log.record(ctx, ctx.currentTime, time + 20);
    await log.whenIdle();
    const timeline = JSON.parse(log.getText()).events;
    expect(timeline.map((event) => event.clockProgressGapMs)).toEqual([null, 1000, 0, 2000]);
    expect(timeline[2].recovered).toContain('clock-progress-gap');
    expect(timeline[0].introMs).toBe(1000);
    expect(log.getText()).not.toContain('secret');
    const reopened = createAudioAnomalies({ store, getStorage: storage }); await reopened.whenIdle();
    expect(reopened.getCount()).toBe(4);
    await reopened.clear();
    expect(reopened.getCount()).toBe(0);
  });
  it('records a sustained output delay once and retains a later checkpoint', async () => {
    const store = memoryStore(); let time = 1000;
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => time, wallNow: () => time });
    const ctx = { state: 'running', currentTime: 1 };
    log.record(ctx, 1, time + 2000);
    time += 60000; ctx.currentTime += 60; log.record(ctx, ctx.currentTime, time + 2000);
    time += 900000; ctx.currentTime += 900; log.record(ctx, ctx.currentTime, time + 2000);
    await log.whenIdle();
    expect(JSON.parse(log.getText()).events).toHaveLength(2);
  });
  it('keeps older cumulative events separately and does not touch them on startup', async () => {
    const key = 'heartbeat.audio-timing-anomalies.v1';
    const old = JSON.stringify([{ reason: 'clock-divergence', atMs: 100, valueMs: 77000 }]);
    const local = storage({ [key]: old });
    const log = createAudioAnomalies({ store: memoryStore(), getStorage: () => local }); await log.whenIdle();
    expect(JSON.parse(log.getText()).legacyCumulativeEvents).toHaveLength(1);
    expect(local.getItem(key)).toBe(old);
    await log.clear(); expect(local.getItem(key)).toBeNull();
  });
  it('records material worsening and recovery of an ongoing delay', async () => {
    const store = memoryStore(); let time = 1000;
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => time, wallNow: () => time });
    const ctx = { state: 'running', currentTime: 1 };
    log.record(ctx, 1, time + 600);
    time += 10000; ctx.currentTime += 10; log.record(ctx, 11, time + 3000);
    time += 10000; ctx.currentTime += 10; log.record(ctx, 21, time + 10);
    await log.whenIdle();
    const events = JSON.parse(log.getText()).events;
    expect(events.map((event) => event.outputDelayMs)).toEqual([600, 3000, 10]);
    expect(events[2].recovered).toContain('estimated-output-delay');
  });
  it('resets comparisons on context state changes', async () => {
    const store = memoryStore(); let time = 1000, listener;
    const ctx = { state: 'running', currentTime: 1, addEventListener: (_, fn) => { listener = fn; } };
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => time, wallNow: () => time });
    log.record(ctx, 1, time + 10);
    ctx.state = 'suspended'; listener(); time += 60000;
    ctx.state = 'running'; listener(); log.record(ctx, 1, time + 10);
    await log.whenIdle();
    expect(JSON.parse(log.getText()).events.some((event) => event.reasons?.includes('clock-progress-gap'))).toBe(false);
  });
  it('reports storage failure without disrupting playback', async () => {
    const store = { list: async () => { throw Error('denied'); }, append: async () => { throw Error('denied'); } };
    const log = createAudioAnomalies({ store, getStorage: () => { throw Error('denied'); }, now: () => 1000, wallNow: () => 1000 });
    expect(() => log.record({ state: 'running', currentTime: 1 }, 1, 1020)).not.toThrow();
    await log.whenIdle(); expect(log.getError()).toContain('playback is unaffected');
  });
  it('stops new entries while disabled and rebaselines on re-enable', async () => {
    const store = memoryStore(); let time = 1000;
    const log = createAudioAnomalies({ store, getStorage: storage, now: () => time, wallNow: () => time });
    const ctx = { state: 'running', currentTime: 1 };
    log.record(ctx, 1, 1010); await log.whenIdle();
    log.setEnabled(false); time += 60000; log.record(ctx, 1, time + 10); await log.whenIdle();
    expect(log.getCount()).toBe(1);
    log.setEnabled(true); log.record(ctx, 1, time + 10); await log.whenIdle();
    expect(JSON.parse(log.getText()).events.some((event) => event.reasons?.includes('clock-progress-gap'))).toBe(false);
  });
});

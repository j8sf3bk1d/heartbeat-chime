import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompanionController } from '../../src/lib/companion.js';

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T13:00:00Z'));
  const show = vi.fn(async () => true), hide = vi.fn(async () => true), play = vi.fn(async () => true);
  const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show, hide, getPresetLabel: () => 'Cue', leadMs: 1000 });
  return { controller, show, hide, play };
}

describe('target-anchored companion', () => {
  it('prepares first, shows one second before the target, and plays at the target', async () => {
    const { controller, show, play } = setup();
    const target = Date.now() + 2000;
    const prepare = vi.fn(async () => true);
    const lifecycle = vi.fn();
    const result = controller.playWithIntro({ presetId: 'voice', prepare, play, targetAtMs: target, lifecycle });
    await vi.advanceTimersByTimeAsync(0); expect(prepare).toHaveBeenCalledOnce(); expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0][0].targetAtMs).toBe(target); expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999); expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true); expect(play).toHaveBeenCalledOnce();
    expect(lifecycle.mock.calls.map(([stage]) => stage)).toEqual(['prepare-start', 'prepare-end', 'show-start', 'show-end', 'play-request']);
  });
  it('does not add an extra intro to an already-late cue', async () => {
    const { controller, play } = setup();
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: Date.now() - 2000, maxLatenessMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0); expect(await result).toBe(true); expect(play).toHaveBeenCalledOnce();
  });
  it('does not hold audio for a slow companion after the target', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T13:00:00Z'));
    const play = vi.fn(async () => true), hide = vi.fn(async () => true);
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show: () => new Promise(() => {}), hide, getPresetLabel: () => 'Cue' });
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(2099); expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true);
    expect(play).toHaveBeenCalledOnce(); expect(hide).toHaveBeenCalledOnce();
  });
  it('skips a stale recurring cue after a long clock jump', async () => {
    const { controller, show, play } = setup();
    const target = Date.now() + 2000;
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: target, maxLatenessMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(target + 20_000); await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('stale'); expect(show).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  });
  it('cancels audio and hides the visual if the cue changes before the target', async () => {
    const { controller, show, play, hide } = setup(); let current = true;
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: Date.now() + 2000, isCurrent: () => current });
    await vi.advanceTimersByTimeAsync(1000); expect(show).toHaveBeenCalledOnce();
    current = false; await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('cancelled'); expect(play).not.toHaveBeenCalled(); expect(hide).toHaveBeenCalledOnce();
  });
  it('pause during the entrance prevents scheduled playback', async () => {
    const { controller, play } = setup();
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(1000); await controller.dismiss(); await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe('cancelled'); expect(play).not.toHaveBeenCalled();
  });
  it('disabling the companion during preparation still plays at the target', async () => {
    const { controller, play, show } = setup();
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(100);
    await controller.dismiss({ cancelPlayback: false });
    await vi.advanceTimersByTimeAsync(1899); expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(true);
    expect(play).toHaveBeenCalledOnce(); expect(show).not.toHaveBeenCalled();
  });
  it('releases overlapping cues at their targets without mismatched visuals', async () => {
    const { controller, play } = setup();
    const first = controller.playWithIntro({ presetId: 'a', play, targetAtMs: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(100);
    const second = controller.playWithIntro({ presetId: 'b', play, targetAtMs: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(1900); expect(play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); expect(play).toHaveBeenCalledTimes(2);
    expect(await first).toBe(true); expect(await second).toBe(true);
  });
  it('keeps speech motion and overlay lifetime anchored to the scheduled audio estimate', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T13:00:00Z'));
    const sendSpeech = vi.fn(), sendTiming = vi.fn();
    const target = Date.now() + 2000;
    const controller = createCompanionController({ state: { companionEnabled: true }, isDesktopRuntime: () => true, show: async () => true, hide: async () => true, sendSpeech, sendTiming, shouldAnimateSpeech: () => true, getPresetLabel: () => 'Cue' });
    const play = (speech, timing) => { speech({ startedAtMs: target + 10, frameMs: 40, levels: [0, 1] }); timing({ startedAtMs: target + 10, durationMs: 2000 }); return true; };
    const result = controller.playWithIntro({ presetId: 'voice', play, targetAtMs: target });
    await vi.advanceTimersByTimeAsync(2000); expect(await result).toBe(true);
    expect(sendSpeech).toHaveBeenCalledWith(expect.objectContaining({ startedAtMs: target + 10 }));
    expect(sendTiming).toHaveBeenCalledWith(expect.objectContaining({ startedAtMs: target + 10 }));
  });
});

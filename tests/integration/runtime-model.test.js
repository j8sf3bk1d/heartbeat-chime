import { describe, expect, it } from "vitest";
import { resolveCuePresetId } from "../../src/lib/presetPlayback.js";
import { createDefaultState, normalizeState } from "../../src/lib/state.js";
import { computeNextAligned, computeRecurringCatchUp, selectRecurringEntries } from "../../src/lib/timing.js";

const PRESETS = [
  { id: "grand_bell", label: "Grand Bell" },
  { id: "soft_chime", label: "Soft Chime" },
  { id: "wood_tick", label: "Wood Tick" },
  { id: "bright_ping", label: "Bright Ping" }
];

describe("runtime model integration", () => {
  it("hydrates persisted intervals and computes due recurring events", () => {
    const defaults = createDefaultState();
    const state = normalizeState(
      {
        masterVolume: 0.5,
        selectedProfileId: "focus",
        suppressLowerIntervalsOnCollision: true,
        themeMode: "dark",
        themePaletteId: "ember",
        intervals: [
          { id: "interval-1", enabled: true, presetId: "wood_tick", volume: 0.4 },
          { id: "interval-5", enabled: true, presetId: "grand_bell", volume: 0.7 }
        ]
      },
      defaults,
      PRESETS,
      ["clocktower", "focus", "arcade"]
    );

    const nowMs = new Date("2026-02-22T14:07:00.000Z").getTime();
    const oneMinute = state.intervals.find((interval) => interval.id === "interval-1");
    const fiveMinute = state.intervals.find((interval) => interval.id === "interval-5");

    const oneMinuteNext = computeNextAligned(new Date("2026-02-22T14:06:10.000Z").getTime(), oneMinute.minutes);
    const fiveMinuteNext = computeNextAligned(new Date("2026-02-22T14:04:01.000Z").getTime(), fiveMinute.minutes);

    const oneMinuteResult = computeRecurringCatchUp(nowMs, oneMinuteNext, oneMinute.minutes * 60 * 1000);
    const fiveMinuteResult = computeRecurringCatchUp(nowMs, fiveMinuteNext, fiveMinute.minutes * 60 * 1000);
    const { selected, suppressed } = selectRecurringEntries(
      [
        { minutes: oneMinute.minutes, fireCount: oneMinuteResult.fireCount, scheduledAtMs: oneMinuteResult.dueAtMs },
        { minutes: fiveMinute.minutes, fireCount: fiveMinuteResult.fireCount, scheduledAtMs: fiveMinuteResult.dueAtMs }
      ].filter((entry) => entry.fireCount > 0),
      state.suppressLowerIntervalsOnCollision
    );

    expect(state.masterVolume).toBe(0.5);
    expect(state.selectedProfileId).toBe("focus");
    expect(state.themeMode).toBe("dark");
    expect(state.themePaletteId).toBe("ember");
    expect(oneMinuteResult.fireCount).toBeGreaterThan(0);
    expect(fiveMinuteResult.fireCount).toBe(0);
    expect(fiveMinuteResult.skippedCount).toBe(1);
    expect(selected[0].minutes).toBe(1);
    expect(suppressed).toHaveLength(0);
  });

  it("does not advance suppressed interval playback cursor on collisions", () => {
    const defaults = createDefaultState();
    const state = normalizeState(
      {
        suppressLowerIntervalsOnCollision: true,
        intervals: [
          {
            id: "interval-1",
            enabled: true,
            presetId: "wood_tick",
            presetIds: ["wood_tick", "soft_chime"],
            playbackMode: "sequential",
            playbackCursor: 0
          },
          {
            id: "interval-5",
            enabled: true,
            presetId: "bright_ping",
            presetIds: ["bright_ping", "grand_bell"],
            playbackMode: "sequential",
            playbackCursor: 0
          }
        ]
      },
      defaults,
      PRESETS,
      ["clocktower", "focus", "arcade"]
    );

    const dueEntries = [
      { interval: state.intervals.find((interval) => interval.id === "interval-1"), minutes: 1, fireCount: 1, scheduledAtMs: 300_000 },
      { interval: state.intervals.find((interval) => interval.id === "interval-5"), minutes: 5, fireCount: 1, scheduledAtMs: 300_000 }
    ];
    const { selected, suppressed } = selectRecurringEntries(dueEntries, state.suppressLowerIntervalsOnCollision);

    const selectedPresetId = resolveCuePresetId(selected[0].interval, { advance: true });

    expect(selectedPresetId).toBe("bright_ping");
    expect(selected[0].interval.playbackCursor).toBe(1);
    expect(suppressed[0].interval.playbackCursor).toBe(0);
  });
});

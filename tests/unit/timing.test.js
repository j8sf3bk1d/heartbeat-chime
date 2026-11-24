import { describe, expect, it } from "vitest";
import { computeNextAligned, computeRecurringCatchUp, selectRecurringEntries } from "../../src/lib/timing.js";

describe("timing helpers", () => {
  it("aligns recurring interval timestamps to wall-clock boundaries", () => {
    const now = new Date("2026-02-22T14:03:17.000Z").getTime();
    const next = computeNextAligned(now, 5);
    expect(new Date(next).toISOString()).toBe("2026-02-22T14:05:00.000Z");
  });

  it("discards a long backlog and keeps only a recent boundary", () => {
    const periodMs = 60 * 1000;
    const nextAtMs = new Date("2026-02-22T14:00:00.000Z").getTime();
    const nowMs = new Date("2026-02-22T14:30:00.000Z").getTime();
    const result = computeRecurringCatchUp(nowMs, nextAtMs, periodMs);
    expect(result).toEqual({ fireCount: 1, dueAtMs: nowMs, nextAtMs: nowMs + periodMs, skippedCount: 30 });
    expect(computeRecurringCatchUp(nowMs + 500, result.nextAtMs, periodMs).fireCount).toBe(0);
  });

  it("skips stale boundaries permanently and resumes on the next aligned boundary", () => {
    const result = computeRecurringCatchUp(30 * 60_000 + 10_001, 0, 60_000);
    expect(result).toEqual({ fireCount: 0, nextAtMs: 31 * 60_000, dueAtMs: null, skippedCount: 31 });
    expect(computeRecurringCatchUp(result.nextAtMs, result.nextAtMs, 60_000)).toMatchObject({ fireCount: 1, skippedCount: 0 });
  });

  it("includes the ten-second grace boundary but never replays older occurrences", () => {
    expect(computeRecurringCatchUp(130_000, 0, 60_000)).toEqual({ fireCount: 1, nextAtMs: 180_000, dueAtMs: 120_000, skippedCount: 2 });
    expect(computeRecurringCatchUp(130_001, 0, 60_000).fireCount).toBe(0);
    expect(computeRecurringCatchUp(59_999, 60_000, 60_000)).toMatchObject({ fireCount: 0, nextAtMs: 60_000, skippedCount: 0 });
    expect(computeRecurringCatchUp(NaN, 60_000, 60_000).fireCount).toBe(0);
  });

  it("suppresses lower recurring intervals on shared boundaries", () => {
    const entries = [
      { minutes: 1, fireCount: 1, scheduledAtMs: 900_000 },
      { minutes: 5, fireCount: 1, scheduledAtMs: 900_000 },
      { minutes: 15, fireCount: 1, scheduledAtMs: 900_000 }
    ];
    const { selected, suppressed } = selectRecurringEntries(entries, true);
    expect(selected).toHaveLength(1);
    expect(selected[0].minutes).toBe(15);
    expect(suppressed.map((entry) => entry.minutes)).toEqual([1, 5]);
  });

  it("suppresses only equal scheduled timestamps, keeping unrelated delayed cues", () => {
    const entries = [
      { minutes: 1, scheduledAtMs: 900_000 },
      { minutes: 5, scheduledAtMs: 900_000 },
      { minutes: 1, scheduledAtMs: 960_000 },
      { minutes: 15, scheduledAtMs: 1_800_000 }
    ];
    const result = selectRecurringEntries(entries, true);
    expect(result.selected).toEqual(entries.slice(1));
    expect(result.suppressed).toEqual([entries[0]]);
  });

  it("does not infer a collision without a scheduled timestamp", () => {
    const entries = [{ minutes: 1 }, { minutes: 5 }];
    expect(selectRecurringEntries(entries, true)).toEqual({ selected: entries, suppressed: [] });
  });

  it("keeps all recurring intervals when suppression is disabled", () => {
    const entries = [
      { minutes: 1, fireCount: 1, scheduledAtMs: 300_000 },
      { minutes: 5, fireCount: 1, scheduledAtMs: 300_000 }
    ];
    const { selected, suppressed } = selectRecurringEntries(entries, false);
    expect(selected).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });
});

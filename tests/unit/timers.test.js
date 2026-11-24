import { describe, expect, it } from "vitest";
import { computeTimerProgressRatio } from "../../src/lib/timers.js";

describe("timer progress", () => {
  it("returns bounded progress for active timers", () => {
    const timer = {
      active: true,
      createdAtMs: 1_000,
      targetAtMs: 2_000
    };
    expect(computeTimerProgressRatio(timer, 1_500)).toBe(0.5);
    expect(computeTimerProgressRatio(timer, 2_500)).toBe(1);
    expect(computeTimerProgressRatio(timer, 500)).toBe(0);
  });

  it("returns complete progress for inactive timers", () => {
    expect(computeTimerProgressRatio({ active: false }, 1_000)).toBe(1);
  });
});

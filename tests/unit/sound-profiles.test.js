import { describe, expect, it } from "vitest";
import { applyProfileToIntervals, getSoundProfileById } from "../../src/lib/soundProfiles.js";

describe("sound profiles", () => {
  it("applies mapped presets to intervals", () => {
    const profile = getSoundProfileById("focus");
    const intervals = [
      { id: "interval-1", minutes: 1, presetId: "soft_chime" },
      { id: "interval-15", minutes: 15, presetId: "grand_bell" },
      { id: "interval-60", minutes: 60, presetId: "wood_tick" }
    ];
    const updated = applyProfileToIntervals(intervals, profile);
    expect(updated.find((interval) => interval.minutes === 1)?.presetId).toBe("wood_tick");
    expect(updated.find((interval) => interval.minutes === 15)?.presetId).toBe("soft_chime");
    expect(updated.find((interval) => interval.minutes === 60)?.presetId).toBe("grand_bell");
  });
});

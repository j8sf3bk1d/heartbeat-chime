import { describe, expect, it } from "vitest";
import { isUnmodifiedVoiceProfileSet } from "../../src/lib/intervalGridHandlers.js";

describe("voice profile expansion compatibility", () => {
  const voices = {
    intervalPresetByMinutes: { 5: ["old-1", "old-2", "new-1", "new-2", "v2-1", "v2-2"] },
    legacyIntervalPresetByMinutes: { 5: ["old-1", "old-2"] },
    frequencyBaseIntervalPresetByMinutes: { 5: ["old-1", "old-2", "new-1", "new-2"] }
  };
  const random = { minutes: 5, playbackMode: "random", presetWeights: {} };

  it("recognizes either original or expanded untouched defaults", () => {
    expect(isUnmodifiedVoiceProfileSet(random, ["old-2", "old-1"], voices)).toBe(true);
    expect(isUnmodifiedVoiceProfileSet(random, ["old-1", "new-1", "old-2", "new-2"], voices)).toBe(true);
    expect(isUnmodifiedVoiceProfileSet(random, ["old-1", "new-1", "old-2", "new-2", "v2-1", "v2-2"], voices)).toBe(true);
  });

  it("does not discard explicit user customization", () => {
    expect(isUnmodifiedVoiceProfileSet(random, ["old-1", "new-1"], voices)).toBe(false);
    expect(isUnmodifiedVoiceProfileSet({ ...random, playbackMode: "sequential" }, ["old-1", "old-2"], voices)).toBe(false);
    expect(isUnmodifiedVoiceProfileSet({ ...random, presetWeights: { "old-1": 3 } }, ["old-1", "old-2"], voices)).toBe(false);
    expect(isUnmodifiedVoiceProfileSet(random, [], null)).toBe(false);
  });
});

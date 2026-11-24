import { describe, expect, it } from "vitest";
import { clampTtsRate, clampTtsVolume, groupVoicesByLanguage, resolveTtsText, shouldSpeakCue } from "../../src/lib/tts.js";

describe("tts helpers", () => {
  it("clamps speech rate to safe bounds", () => {
    expect(clampTtsRate(0.1)).toBe(0.7);
    expect(clampTtsRate(2)).toBe(1.3);
    expect(clampTtsRate(1.05)).toBe(1.05);
  });

  it("clamps speech volume to safe bounds", () => {
    expect(clampTtsVolume(-3)).toBe(0);
    expect(clampTtsVolume(9)).toBe(1);
    expect(clampTtsVolume(0.65)).toBe(0.65);
  });

  it("prefers custom text, otherwise optional label fallback", () => {
    expect(resolveTtsText({ label: "Timer Done", customText: "Stretch now", speakLabel: true })).toBe("Stretch now");
    expect(resolveTtsText({ label: "Timer Done", customText: " ", speakLabel: true })).toBe("Timer Done");
    expect(resolveTtsText({ label: "Timer Done", customText: "", speakLabel: false })).toBe("");
  });

  it("applies layered cue speaking rules", () => {
    const recurringAllowed = shouldSpeakCue({
      ttsEnabled: true,
      cueType: "recurring",
      ttsRecurringEnabled: true,
      ttsOneShotEnabled: false,
      itemTtsEnabled: true
    });
    const recurringBlockedByType = shouldSpeakCue({
      ttsEnabled: true,
      cueType: "recurring",
      ttsRecurringEnabled: false,
      ttsOneShotEnabled: true,
      itemTtsEnabled: true
    });
    const oneShotBlockedByItem = shouldSpeakCue({
      ttsEnabled: true,
      cueType: "one-shot",
      ttsRecurringEnabled: true,
      ttsOneShotEnabled: true,
      itemTtsEnabled: false
    });
    const blockedByMaster = shouldSpeakCue({
      ttsEnabled: false,
      cueType: "one-shot",
      ttsRecurringEnabled: true,
      ttsOneShotEnabled: true,
      itemTtsEnabled: true
    });

    expect(recurringAllowed).toBe(true);
    expect(recurringBlockedByType).toBe(false);
    expect(oneShotBlockedByItem).toBe(false);
    expect(blockedByMaster).toBe(false);
  });

  it("groups and sorts voices by language", () => {
    const grouped = groupVoicesByLanguage([
      { voiceURI: "v3", name: "Samantha", lang: "en-US" },
      { voiceURI: "v2", name: "Anna", lang: "de-DE" },
      { voiceURI: "v1", name: "Alex", lang: "en-GB", default: true }
    ]);

    const groupsByKey = Object.fromEntries(grouped.map((group) => [group.key, group]));
    expect(Object.keys(groupsByKey).sort()).toEqual(["de", "en"]);
    expect(groupsByKey.de.voices.map((voice) => voice.voiceUri)).toEqual(["v2"]);
    expect(groupsByKey.en.voices.map((voice) => voice.voiceUri)).toEqual(["v1", "v3"]);
    expect(groupsByKey.en.voices[0].optionLabel).toContain("Default");
  });

  it("deduplicates voices and handles unknown language tags", () => {
    const grouped = groupVoicesByLanguage([
      { voiceURI: "v1", name: "Alpha", lang: "" },
      { voiceURI: "v1", name: "Alpha Duplicate", lang: "en-US" },
      { voiceURI: "v2", name: "Beta", lang: null }
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].key).toBe("und");
    expect(grouped[0].voices.map((voice) => voice.voiceUri)).toEqual(["v1", "v2"]);
    expect(grouped[0].voices.map((voice) => voice.optionLabel)).toEqual(["Alpha (und)", "Beta (und)"]);
  });
});

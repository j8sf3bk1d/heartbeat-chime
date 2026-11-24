import { describe, expect, it } from "vitest";
import { createBuiltInVoiceSet, getVoiceCoverageGaps } from "../../src/lib/builtInVoices.js";
import { COMPANION_EXPRESSIONS } from "../../src/lib/companionExpressions.js";
import currentManifest from "../../src/assets/voices/laura/manifest.json";

const clips = [1, 5, 15, 60].flatMap((intervalMinutes) => [1, 2, 3, 4, 5].flatMap((index) => [1, 2].map((generation) => ({
  id: `voice-${intervalMinutes}-${index}-${generation}`,
  lineId: `voice-${intervalMinutes}-${index}`,
  generation,
  status: "completed",
  intervalMinutes,
  text: `Time check ${intervalMinutes}-${index}`,
  fileName: `${intervalMinutes}-${index}-${generation}.mp3`
}))));
const urls = Object.fromEntries(clips.map((clip) => [clip.fileName, `/assets/${clip.fileName}`]));

describe("built-in voice set", () => {
  it("exposes each interval's set and resolves bundled URLs", () => {
    const set = createBuiltInVoiceSet({ clips }, urls);
    expect(set.intervalPresetByMinutes[5]).toHaveLength(10);
    expect(set.presets).toHaveLength(40);
    expect(set.getUrl("voice-5-1-1")).toBe("/assets/5-1-1.mp3");
    expect(set.getUrl("unknown")).toBeNull();
  });

  it("rejects incomplete assets, missing intervals and duplicate IDs", () => {
    const incomplete = { ...urls };
    delete incomplete[clips[0].fileName];
    expect(createBuiltInVoiceSet({ clips }, incomplete)).toBeNull();
    expect(createBuiltInVoiceSet({ clips: clips.filter((clip) => clip.intervalMinutes !== 60) }, urls)).toBeNull();
    expect(createBuiltInVoiceSet({ clips: [...clips, clips[0]] }, urls)).toBeNull();
    const duplicateTake = clips.map((clip, index) => index === 1 ? { ...clip, generation: 1 } : clip);
    expect(createBuiltInVoiceSet({ clips: duplicateTake }, urls)).toBeNull();
    const pending = clips.map((clip, index) => index === 1 ? { ...clip, status: "pending" } : clip);
    expect(createBuiltInVoiceSet({ clips: pending }, urls)).toBeNull();
    const reusedFile = clips.map((clip, index) => index === 1 ? { ...clip, fileName: clips[0].fileName } : clip);
    expect(createBuiltInVoiceSet({ clips: reusedFile }, urls)).toBeNull();
  });

  it("accepts additional completed pairs without changing the existing IDs", () => {
    const extra = [1, 2].map((generation) => ({
      id: `new-hmph-${generation}`, lineId: "new-hmph", generation, status: "completed",
      intervalMinutes: 1, text: "Hmph.", expression: "hmph", fileName: `new-hmph-${generation}.mp3`
    }));
    const expanded = createBuiltInVoiceSet({ clips: [...clips.map((clip) => ({ ...clip, collection: "legacy" })), ...extra] }, {
      ...urls, "new-hmph-1.mp3": "/assets/new-hmph-1.mp3", "new-hmph-2.mp3": "/assets/new-hmph-2.mp3"
    });
    expect(expanded?.intervalPresetByMinutes[1]).toEqual([...clips.filter((clip) => clip.intervalMinutes === 1).map((clip) => clip.id), ...extra.map((clip) => clip.id)]);
    expect(expanded?.getUrl("voice-5-1-1")).toBe("/assets/5-1-1.mp3");
    expect(expanded?.legacyIntervalPresetByMinutes[1]).toEqual(clips.filter((clip) => clip.intervalMinutes === 1).map((clip) => clip.id));
  });

  it("rejects incomplete, mismatched, or unknown-expression additional pairs", () => {
    const extra = [1, 2].map((generation) => ({
      id: `new-caring-${generation}`, lineId: "new-caring", generation, status: "completed",
      intervalMinutes: 1, text: "Drink water.", expression: "caring", fileName: `new-caring-${generation}.mp3`
    }));
    const expandedUrls = { ...urls, "new-caring-1.mp3": "/a.mp3", "new-caring-2.mp3": "/b.mp3" };
    expect(createBuiltInVoiceSet({ clips: [...clips, extra[0]] }, expandedUrls)).toBeNull();
    expect(createBuiltInVoiceSet({ clips: [...clips, extra[0], { ...extra[1], expression: "hmph" }] }, expandedUrls)).toBeNull();
    expect(createBuiltInVoiceSet({ clips: [...clips, extra[0], { ...extra[1], text: "Different words." }] }, expandedUrls)).toBeNull();
    expect(createBuiltInVoiceSet({ clips: [...clips, ...extra.map((clip) => ({ ...clip, expression: "unknown" }))] }, expandedUrls)).toBeNull();
  });

  it("reports interval/expression gaps until both matching completed takes exist", () => {
    const complete = [1, 5, 15, 60].flatMap((intervalMinutes) => COMPANION_EXPRESSIONS.flatMap((expression) => [1, 2].map((generation) => ({
      intervalMinutes, expression, generation, status: "completed", text: `${intervalMinutes} ${expression}`, lineId: `${intervalMinutes}-${expression}`
    }))));
    expect(getVoiceCoverageGaps({ clips: complete })).toEqual([]);
    expect(getVoiceCoverageGaps({ clips: complete.filter((clip) => !(clip.intervalMinutes === 15 && clip.expression === "hmph" && clip.generation === 2)) })).toEqual([
      { intervalMinutes: 15, expression: "hmph" }
    ]);
    expect(getVoiceCoverageGaps({ clips: complete.map((clip) => clip.intervalMinutes === 60 && clip.expression === "caring" && clip.generation === 2 ? { ...clip, text: "different" } : clip) })).toEqual([
      { intervalMinutes: 60, expression: "caring" }
    ]);
  });

  it("only enables the frequency expansion after every paired clip and URL is complete", () => {
    const additions = [[1, 22], [5, 11]].flatMap(([intervalMinutes, count]) =>
      Array.from({ length: count }, (_, index) => [1, 2].map((generation) => ({
        id: `frequency-${intervalMinutes}-${index}-${generation}`,
        lineId: `frequency-${intervalMinutes}-${index}`,
        generation, status: "completed", intervalMinutes, expression: "smug", collection: "frequency-v2",
        text: `A new time check ${intervalMinutes}-${index}`, fileName: `frequency-${intervalMinutes}-${index}-${generation}.mp3`
      }))).flat());
    const baseline = currentManifest.clips.filter((clip) => clip.collection !== "frequency-v2");
    const manifest = { ...currentManifest, frequencyCoverageVersion: 2, clips: [...baseline, ...additions] };
    const allUrls = Object.fromEntries(manifest.clips.map((clip) => [clip.fileName, `/assets/${clip.fileName}`]));
    const expanded = createBuiltInVoiceSet(manifest, allUrls);
    expect(expanded?.hasCompleteFrequencyCoverage).toBe(true);
    expect(expanded.frequencyBaseIntervalPresetByMinutes[1]).toHaveLength(22);
    expect(expanded.frequencyBaseIntervalPresetByMinutes[5]).toHaveLength(22);
    expect(expanded.intervalPresetByMinutes[1]).toHaveLength(66);
    expect(expanded.intervalPresetByMinutes[5]).toHaveLength(44);
    expect(expanded.presets).toHaveLength(150);
    expect(createBuiltInVoiceSet({ ...manifest, clips: manifest.clips.slice(0, -2) }, allUrls)).toBeNull();
    expect(createBuiltInVoiceSet({ ...manifest, frequencyCoverageVersion: undefined }, allUrls)).toBeNull();
    const missingUrl = { ...allUrls };
    delete missingUrl[additions.at(-1).fileName];
    expect(createBuiltInVoiceSet(manifest, missingUrl)).toBeNull();
  });
});

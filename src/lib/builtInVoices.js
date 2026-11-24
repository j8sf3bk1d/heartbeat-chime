import voiceManifest from "../assets/voices/laura/manifest.json";
import { COMPANION_EXPRESSIONS, isCompanionExpression } from "./companionExpressions.js";

// Coverage is based on distinct, completed matching pairs rather than clip
// count: two takes of a single utterance are the unit the user can hear.
export function getVoiceCoverageGaps(manifest) {
  const groups = new Map();
  for (const clip of Array.isArray(manifest?.clips) ? manifest.clips : []) {
    if (!clip?.lineId || typeof clip.text !== "string" || !clip.text.trim() || !isCompanionExpression(clip.expression) || clip.status !== "completed") continue;
    const key = JSON.stringify([clip.intervalMinutes, clip.expression, clip.lineId, clip.text]);
    const takes = groups.get(key) || new Set();
    if ([1, 2].includes(clip.generation)) takes.add(clip.generation);
    groups.set(key, takes);
  }
  const present = new Set();
  for (const [key, takes] of groups) {
    if (takes.size === 2) {
      const [minutes, expression] = JSON.parse(key);
      present.add(`${minutes}:${expression}`);
    }
  }
  return [1, 5, 15, 60].flatMap((intervalMinutes) => COMPANION_EXPRESSIONS
    .filter((expression) => !present.has(`${intervalMinutes}:${expression}`))
    .map((expression) => ({ intervalMinutes, expression })));
}

// Build the profile only when every clip in the manifest has a bundled URL.
// This module is intentionally independent of the asset import so it can be
// tested with fixtures before the recordings are available.
export function createBuiltInVoiceSet(manifest, urlsByFileName) {
  const clips = manifest?.clips;
  const minutes = [1, 5, 15, 60];
  // The original 20 lines remain the minimum supported set; later complete
  // pairs may be appended without changing any existing preset IDs.
  if (!Array.isArray(clips) || clips.length < 40) return null;

  const ids = new Set();
  const files = new Set();
  const urlsById = new Map();
  const intervalPresetByMinutes = {};
  const legacyIntervalPresetByMinutes = {};
  const frequencyBaseIntervalPresetByMinutes = {};
  const linesByInterval = new Map(minutes.map((value) => [value, new Map()]));
  for (const clip of clips) {
    const url = urlsByFileName?.[clip.fileName];
    if (!clip.id || ids.has(clip.id) || !minutes.includes(clip.intervalMinutes) || !clip.text || !url ||
        !clip.lineId || ![1, 2].includes(clip.generation) || clip.status !== "completed" || files.has(clip.fileName) ||
        (clip.expression !== undefined && !isCompanionExpression(clip.expression))) return null;
    const lines = linesByInterval.get(clip.intervalMinutes);
    const line = lines.get(clip.lineId) || { generations: new Set(), text: clip.text, expression: clip.expression, collection: clip.collection };
    // A matched line must speak the same text with the same visual intent on
    // both provider takes. Older manifests may omit expression on both.
    if (line.generations.has(clip.generation) || line.text !== clip.text || line.expression !== clip.expression || line.collection !== clip.collection) return null;
    line.generations.add(clip.generation);
    lines.set(clip.lineId, line);
    ids.add(clip.id);
    files.add(clip.fileName);
    urlsById.set(clip.id, url);
    (intervalPresetByMinutes[clip.intervalMinutes] ||= []).push(clip.id);
    if (clip.collection === "legacy") (legacyIntervalPresetByMinutes[clip.intervalMinutes] ||= []).push(clip.id);
    if (clip.collection !== "frequency-v2") (frequencyBaseIntervalPresetByMinutes[clip.intervalMinutes] ||= []).push(clip.id);
  }
  if (minutes.some((value) => {
    const lines = linesByInterval.get(value);
    return lines.size < 5 || [...lines.values()].some((line) => line.generations.size !== 2);
  })) return null;
  const hasExpressionCoverage = manifest.expressionCoverageVersion === 1 && getVoiceCoverageGaps(manifest).length === 0;
  const hasFrequencyClips = clips.some((clip) => clip.collection === "frequency-v2");
  const hasCompleteFrequencyCoverage = manifest.frequencyCoverageVersion === 2 && hasExpressionCoverage &&
    (frequencyBaseIntervalPresetByMinutes[1]?.length === 22) &&
    (frequencyBaseIntervalPresetByMinutes[5]?.length === 22) &&
    (frequencyBaseIntervalPresetByMinutes[15]?.length === 20) &&
    (frequencyBaseIntervalPresetByMinutes[60]?.length === 20) &&
    intervalPresetByMinutes[1]?.length >= 66 && intervalPresetByMinutes[5]?.length >= 44;
  // Never publish a partly staged frequency expansion as a usable profile.
  if ((hasFrequencyClips || manifest.frequencyCoverageVersion === 2) && !hasCompleteFrequencyCoverage) return null;

  return {
    presets: clips.map((clip) => ({
      id: clip.id,
      label: `${clip.text} · Take ${clip.generation}`,
      description: `Spoken ${clip.intervalMinutes}-minute cue.`,
      intervalMinutes: clip.intervalMinutes,
      tags: ["voice", "spoken"]
    })),
    intervalPresetByMinutes,
    legacyIntervalPresetByMinutes,
    frequencyBaseIntervalPresetByMinutes,
    // Do not migrate saved defaults until the expanded release is fully
    // present, validated and explicitly marked as covering the full matrix.
    hasCompleteExpressionCoverage: hasExpressionCoverage,
    hasCompleteFrequencyCoverage,
    getUrl: (presetId) => urlsById.get(presetId) || null
  };
}

// The glob emits URLs relative to Vite's configured base, including in Tauri.
const bundledUrls = import.meta.glob("../assets/voices/laura/*.mp3", {
  eager: true,
  query: "?url",
  import: "default"
});
const urlsByFileName = Object.fromEntries(
  Object.entries(bundledUrls).map(([path, url]) => [path.split("/").pop(), url])
);
const knownVoiceIds = new Set(voiceManifest.clips.map((clip) => clip.id));
const voiceMetadataById = new Map(voiceManifest.clips.map((clip) => [clip.id, clip]));
export function getBuiltInVoiceMetadata(presetId) {
  return voiceMetadataById.get(presetId) || null;
}
export function isKnownBuiltInVoiceId(presetId) {
  return knownVoiceIds.has(presetId);
}
export const BUILT_IN_VOICE_SET = createBuiltInVoiceSet(voiceManifest, urlsByFileName);
export function getBuiltInVoiceUrl(presetId) {
  return BUILT_IN_VOICE_SET?.getUrl(presetId) || null;
}

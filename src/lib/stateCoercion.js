import { isKnownBuiltInVoiceId } from "./builtInVoices.js";

export function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

export function coerceRangedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return clamp(number, min, max);
}

export function coerceNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function isPresetValid(presets, presetId) {
  return presets.some((preset) => preset.id === presetId);
}

export function isCustomId(value) {
  return typeof value === "string" && value.startsWith("custom:");
}

export function isValidPresetId(presets, presetId) {
  return isPresetValid(presets, presetId) || isCustomId(presetId) || isKnownBuiltInVoiceId(presetId);
}

export function normalizePresetIdSet(incomingSet, fallbackPresetId, presets) {
  const presetIds = Array.isArray(incomingSet)
    ? incomingSet
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry && isValidPresetId(presets, entry))
    : [];
  const dedupedPresetIds = [...new Set(presetIds)];
  if (fallbackPresetId && !dedupedPresetIds.includes(fallbackPresetId)) {
    dedupedPresetIds.unshift(fallbackPresetId);
  }
  return dedupedPresetIds.length ? dedupedPresetIds : fallbackPresetId ? [fallbackPresetId] : [];
}

export function normalizePresetWeights(incomingWeights, presetIds) {
  if (!incomingWeights || typeof incomingWeights !== "object") {
    return {};
  }
  const normalized = {};
  for (const presetId of presetIds) {
    const parsedWeight = Number(incomingWeights[presetId]);
    if (Number.isFinite(parsedWeight) && parsedWeight > 0) {
      normalized[presetId] = parsedWeight;
    }
  }
  return normalized;
}

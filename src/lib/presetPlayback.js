export const PLAYBACK_MODES = ["sequential", "random", "weighted-random"];

export function normalizePlaybackMode(playbackMode, fallback = "sequential") {
  if (PLAYBACK_MODES.includes(playbackMode)) {
    return playbackMode;
  }
  return PLAYBACK_MODES.includes(fallback) ? fallback : "sequential";
}

function getNormalizedPresetIds(cue) {
  const setIds = Array.isArray(cue?.presetIds)
    ? cue.presetIds.filter((presetId) => typeof presetId === "string" && presetId.trim())
    : [];
  if (setIds.length > 0) {
    return [...new Set(setIds)];
  }
  if (typeof cue?.presetId === "string" && cue.presetId.trim()) {
    return [cue.presetId.trim()];
  }
  return [];
}

export function resolveCuePresetId(cue, { advance = true, random = Math.random, excludePresetId = null, getRepeatGroup = (id) => id } = {}) {
  let presetIds = getNormalizedPresetIds(cue);
  if (!presetIds.length) {
    return null;
  }

  const playbackMode = normalizePlaybackMode(cue?.playbackMode);
  if (playbackMode !== "sequential" && presetIds.length > 1 && typeof excludePresetId === "string") {
    // Two takes may be distinct presets but the same spoken line. Exclude
    // that entire line when possible, preserving the weights of all others.
    // When the pool contains just one line, prefer another take rather than
    // silencing the cue or breaking the old single-sound behavior.
    const excludedGroup = getRepeatGroup(excludePresetId);
    const differentLines = presetIds.filter((presetId) => getRepeatGroup(presetId) !== excludedGroup);
    if (differentLines.length > 0) {
      presetIds = differentLines;
    } else if (presetIds.includes(excludePresetId)) {
      presetIds = presetIds.filter((presetId) => presetId !== excludePresetId);
    }
  }
  if (playbackMode === "random") {
    const sampled = Number(typeof random === "function" ? random() : Math.random());
    const bounded = Number.isFinite(sampled) ? Math.max(0, Math.min(0.999999, sampled)) : 0;
    const randomIndex = Math.floor(bounded * presetIds.length);
    return presetIds[randomIndex];
  }

  if (playbackMode === "weighted-random") {
    const rawWeights =
      cue && typeof cue === "object" && cue.presetWeights && typeof cue.presetWeights === "object"
        ? cue.presetWeights
        : {};
    const weightedEntries = presetIds.map((presetId) => {
      const sampledWeight = Number(rawWeights[presetId]);
      return {
        presetId,
        weight: Number.isFinite(sampledWeight) && sampledWeight > 0 ? sampledWeight : 1
      };
    });
    const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!(totalWeight > 0)) {
      return weightedEntries[0].presetId;
    }
    const sampled = Number(typeof random === "function" ? random() : Math.random());
    const bounded = Number.isFinite(sampled) ? Math.max(0, Math.min(0.999999, sampled)) : 0;
    const target = bounded * totalWeight;
    let runningWeight = 0;
    for (const entry of weightedEntries) {
      runningWeight += entry.weight;
      if (target < runningWeight) {
        return entry.presetId;
      }
    }
    return weightedEntries[weightedEntries.length - 1].presetId;
  }

  const rawCursor = Number(cue?.playbackCursor);
  const cursor = Number.isFinite(rawCursor) ? Math.floor(rawCursor) : 0;
  const normalizedCursor = ((cursor % presetIds.length) + presetIds.length) % presetIds.length;
  if (advance && cue && typeof cue === "object") {
    cue.playbackCursor = (normalizedCursor + 1) % presetIds.length;
  }
  return presetIds[normalizedCursor];
}

export function simulateCuePresetPicks(cue, { iterations = 100, random = Math.random, avoidRepeat = false, previousPresetId = null, getRepeatGroup = (id) => id } = {}) {
  const count = Number(iterations);
  if (!Number.isFinite(count) || count <= 0) {
    return {};
  }

  const simulationCue =
    cue && typeof cue === "object"
      ? {
          ...cue,
          presetIds: Array.isArray(cue.presetIds) ? [...cue.presetIds] : cue.presetIds,
          presetWeights:
            cue.presetWeights && typeof cue.presetWeights === "object" ? { ...cue.presetWeights } : cue.presetWeights
        }
      : cue;

  const counts = {};
  for (let index = 0; index < Math.floor(count); index += 1) {
    const presetId = resolveCuePresetId(simulationCue, { advance: true, random, excludePresetId: avoidRepeat ? previousPresetId : null, getRepeatGroup });
    if (!presetId) {
      continue;
    }
    counts[presetId] = (counts[presetId] || 0) + 1;
    previousPresetId = presetId;
  }
  return counts;
}

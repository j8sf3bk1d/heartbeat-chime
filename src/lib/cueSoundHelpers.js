import { escapeHtml } from "./escapeHtml.js";
import { getBuiltInVoiceMetadata } from "./builtInVoices.js";

import { normalizePlaybackMode, resolveCuePresetId, simulateCuePresetPicks } from "./presetPlayback.js";

const WEIGHT_PRESET_STRATEGIES = ["flat", "spotlight-first", "rare-last"];

// Imported sounds and unrelated built-ins retain individual identities. Only
// authored takes carrying a shared lineId are treated as the same utterance.
export function getPresetRepeatGroup(presetId) {
  const lineId = getBuiltInVoiceMetadata(presetId)?.lineId;
  return typeof lineId === "string" && lineId ? `line:${lineId}` : `preset:${presetId}`;
}

export function createCueSoundHelpers({ hasPresetId, getPresetLabel }) {
  function getCuePresetIds(cue) {
    const normalizedSet = Array.isArray(cue?.presetIds)
      ? cue.presetIds.filter(
          (presetId, index, list) =>
            typeof presetId === "string" && presetId.trim() && hasPresetId(presetId) && list.indexOf(presetId) === index
        )
      : [];
    if (normalizedSet.length > 0) {
      return normalizedSet;
    }
    if (typeof cue?.presetId === "string" && hasPresetId(cue.presetId)) {
      return [cue.presetId];
    }
    return ["soft_chime"];
  }

  function getCuePresetWeights(cue, presetIds = getCuePresetIds(cue)) {
    const rawWeights =
      cue && typeof cue === "object" && cue.presetWeights && typeof cue.presetWeights === "object" ? cue.presetWeights : {};
    const normalized = {};
    for (const presetId of presetIds) {
      const parsedWeight = Number(rawWeights[presetId]);
      if (Number.isFinite(parsedWeight) && parsedWeight > 0) {
        normalized[presetId] = parsedWeight;
      }
    }
    return normalized;
  }

  function sanitizeWeight(weight, fallback = 1) {
    const parsedWeight = Number(weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      return fallback;
    }
    return parsedWeight;
  }

  function normalizeWeightPresetStrategy(strategy, fallback = "flat") {
    if (WEIGHT_PRESET_STRATEGIES.includes(strategy)) {
      return strategy;
    }
    return WEIGHT_PRESET_STRATEGIES.includes(fallback) ? fallback : "flat";
  }

  function getWeightPresetLabel(strategy) {
    const normalized = normalizeWeightPresetStrategy(strategy);
    if (normalized === "spotlight-first") {
      return "Spotlight 1st";
    }
    if (normalized === "rare-last") {
      return "Rare Last";
    }
    return "Flat";
  }

  function getSelectedOptionValues(selectElement) {
    return [...selectElement.selectedOptions].map((option) => option.value);
  }

  function getPresetIdsFromSelect(selectElement, fallbackPresetId = "") {
    const selectedPresetIds = getSelectedOptionValues(selectElement).filter((presetId) => hasPresetId(presetId));
    if (selectedPresetIds.length > 0) {
      return selectedPresetIds;
    }
    if (fallbackPresetId && hasPresetId(fallbackPresetId)) {
      return [fallbackPresetId];
    }
    return [];
  }

  function buildPresetWeightsByStrategy(presetIds, strategy = "flat") {
    const normalizedStrategy = normalizeWeightPresetStrategy(strategy);
    if (!Array.isArray(presetIds) || presetIds.length === 0) {
      return {};
    }

    if (normalizedStrategy === "spotlight-first") {
      return presetIds.reduce((weights, presetId, index) => {
        weights[presetId] = index === 0 ? 4 : 1;
        return weights;
      }, {});
    }

    if (normalizedStrategy === "rare-last") {
      if (presetIds.length === 1) {
        return { [presetIds[0]]: 1 };
      }
      return presetIds.reduce((weights, presetId, index) => {
        weights[presetId] = index === presetIds.length - 1 ? 0.35 : 1.4;
        return weights;
      }, {});
    }

    return presetIds.reduce((weights, presetId) => {
      weights[presetId] = 1;
      return weights;
    }, {});
  }

  function formatSimulationSummary(counts, presetIds, { iterations = 100 } = {}) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (!total) {
      return "No simulation data.";
    }
    const byPreset = presetIds
      .map((presetId) => ({ presetId, count: counts[presetId] || 0 }))
      .sort((a, b) => b.count - a.count);
    const parts = byPreset
      .map(({ presetId, count }) => `${getPresetLabel(presetId)} ${Math.round((count / total) * 100)}%`)
      .join(" | ");
    return `Sim ${Math.floor(iterations)}: ${parts}`;
  }

  function runSimulationPreview({ presetIds, playbackMode, presetWeights, iterations = 100, avoidRepeat = false, previousPresetId = null }) {
    const counts = simulateCuePresetPicks(
      {
        presetIds,
        playbackMode,
        presetWeights,
        playbackCursor: 0
      },
      { iterations, avoidRepeat, previousPresetId, getRepeatGroup: getPresetRepeatGroup }
    );
    return formatSimulationSummary(counts, presetIds, { iterations });
  }

  function setSimulationOutput(outputElement, message) {
    if (!outputElement) {
      return;
    }
    outputElement.textContent = message || "";
  }

  function makeWeightPresetButtonsMarkup(buttonClass = "weight-preset-button") {
    return WEIGHT_PRESET_STRATEGIES.map(
      (strategy) =>
        `<button type="button" class="button-secondary ${buttonClass}" data-weight-preset-kind="${strategy}">${getWeightPresetLabel(
          strategy
        )}</button>`
    ).join("");
  }

  function getDefaultPresetWeights(presetIds, presetWeights = {}) {
    const normalized = {};
    for (const presetId of presetIds) {
      normalized[presetId] = sanitizeWeight(presetWeights[presetId], 1);
    }
    return normalized;
  }

  function makePresetWeightControlMarkup({
    presetIds,
    presetWeights = {},
    inputClass = "preset-weight-input",
    wrapperClass = "weight-control-grid"
  }) {
    const normalizedWeights = getDefaultPresetWeights(presetIds, presetWeights);
    return `
      <div class="${wrapperClass}">
        ${presetIds
          .map(
            (presetId) => `
              <label class="weight-control">
                <span>${escapeHtml(getPresetLabel(presetId))}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value="${normalizedWeights[presetId]}"
                  class="${inputClass}"
                  data-preset-weight-for="${escapeHtml(presetId)}"
                />
              </label>
            `
          )
          .join("")}
      </div>
    `;
  }

  function readPresetWeightsFromContainer(containerElement, presetIds = []) {
    if (!containerElement) {
      return {};
    }
    const allowedPresetIds = new Set(presetIds);
    const parsed = {};
    for (const input of containerElement.querySelectorAll("[data-preset-weight-for]")) {
      const presetId = input.dataset.presetWeightFor;
      if (!presetId || (allowedPresetIds.size > 0 && !allowedPresetIds.has(presetId))) {
        continue;
      }
      parsed[presetId] = sanitizeWeight(input.value, 1);
    }
    return parsed;
  }

  function renderPresetWeightControls(containerElement, presetIds, presetWeights = {}, options = {}) {
    if (!containerElement) {
      return;
    }
    containerElement.innerHTML = makePresetWeightControlMarkup({
      presetIds,
      presetWeights,
      inputClass: options.inputClass || "preset-weight-input",
      wrapperClass: options.wrapperClass || "weight-control-grid"
    });
  }

  function applyWeightPresetToControls(containerElement, presetIds, strategy, options = {}) {
    const nextWeights = buildPresetWeightsByStrategy(presetIds, strategy);
    renderPresetWeightControls(containerElement, presetIds, nextWeights, options);
    return nextWeights;
  }

  function normalizeCueSoundConfig(cue, { resetCursor = false } = {}) {
    cue.presetIds = getCuePresetIds(cue);
    cue.playbackMode = normalizePlaybackMode(cue.playbackMode, "sequential");
    cue.presetWeights = getCuePresetWeights(cue, cue.presetIds);
    if (!hasPresetId(cue.presetId) || !cue.presetIds.includes(cue.presetId)) {
      cue.presetId = cue.presetIds[0];
    }
    const rawCursor = Number(cue.playbackCursor);
    cue.playbackCursor = Number.isFinite(rawCursor) && rawCursor >= 0 ? Math.floor(rawCursor) : 0;
    if (resetCursor) {
      cue.playbackCursor = 0;
    }
  }

  function resolveCuePresetForPlayback(cue, { advance = true, excludePresetId = null } = {}) {
    normalizeCueSoundConfig(cue);
    const resolvedPresetId = resolveCuePresetId(cue, { advance, excludePresetId, getRepeatGroup: getPresetRepeatGroup });
    return hasPresetId(resolvedPresetId) ? resolvedPresetId : cue.presetIds[0];
  }

  function getPlaybackModeLabel(playbackMode) {
    if (playbackMode === "weighted-random") {
      return "Weighted Random";
    }
    return playbackMode === "random" ? "Random" : "Sequential";
  }

  return {
    normalizeWeightPresetStrategy,
    sanitizeWeight,
    getCuePresetIds,
    getCuePresetWeights,
    getSelectedOptionValues,
    getPresetIdsFromSelect,
    buildPresetWeightsByStrategy,
    runSimulationPreview,
    setSimulationOutput,
    makeWeightPresetButtonsMarkup,
    makePresetWeightControlMarkup,
    readPresetWeightsFromContainer,
    renderPresetWeightControls,
    applyWeightPresetToControls,
    normalizeCueSoundConfig,
    resolveCuePresetForPlayback,
    getPlaybackModeLabel
  };
}

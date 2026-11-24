import { BUILT_IN_VOICE_SET } from "./builtInVoices.js";
import { missingBundledVoiceIds } from "./voicePoolActions.js";

export function isUnmodifiedVoiceProfileSet(interval, previousPresetIds, voiceSet) {
  const current = voiceSet?.intervalPresetByMinutes?.[interval.minutes] || [];
  const legacy = voiceSet?.legacyIntervalPresetByMinutes?.[interval.minutes] || [];
  const frequencyBase = voiceSet?.frequencyBaseIntervalPresetByMinutes?.[interval.minutes] || [];
  const matches = (ids) => ids.length > 0 && previousPresetIds.length === ids.length &&
    ids.every((id) => previousPresetIds.includes(id));
  return (matches(current) || matches(legacy) || matches(frequencyBase)) && interval.playbackMode === "random" &&
    Object.keys(interval.presetWeights || {}).length === 0;
}

export function registerIntervalGridHandlers({
  intervalGrid,
  runtime,
  getIntervalById,
  isRunning,
  setNextForInterval,
  normalizePlaybackMode,
  getCuePresetIds,
  normalizeCueSoundConfig,
  saveState,
  sanitizeWeight,
  getCuePresetWeights,
  renderIntervals,
  setSimulationOutput,
  clamp,
  buildPresetWeightsByStrategy,
  runSimulationPreview,
  getRepeatSimulationContext,
  previewCue
}) {
  function restoreAdvancedClipSetViewport(intervalId, scrollTop) {
    requestAnimationFrame(() => {
      const row = intervalGrid.querySelector(`.interval-row[data-interval-id="${intervalId}"]`);
      if (!row) {
        return;
      }
      const advancedPanel = row.querySelector(".interval-advanced");
      if (advancedPanel && !advancedPanel.open) {
        advancedPanel.open = true;
      }
      const clipSetSelect = row.querySelector(".interval-preset-set");
      if (!clipSetSelect) {
        return;
      }
      clipSetSelect.scrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
      if (typeof clipSetSelect.focus === "function") {
        clipSetSelect.focus({ preventScroll: true });
      }
    });
  }

  intervalGrid.addEventListener("change", (event) => {
    const row = event.target.closest(".interval-row");
    if (!row) {
      return;
    }
    const interval = getIntervalById(row.dataset.intervalId);
    if (!interval) {
      return;
    }
    let shouldRerenderIntervals = false;
    let shouldNormalize = false;
    let shouldResetCursor = false;
    let shouldClearSimulation = false;
    let clipSetScrollTopToRestore = null;
    if (event.target.classList.contains("interval-clip-filter")) {
      if (event.target.value === "matching") runtime.intervalClipFilters.add(interval.id);
      else runtime.intervalClipFilters.delete(interval.id);
      renderIntervals();
      intervalGrid.querySelector(`[data-interval-id="${interval.id}"] .interval-clip-filter`)?.focus();
      return;
    }
    if (event.target.classList.contains("interval-enabled")) {
      interval.enabled = event.target.checked;
      if (isRunning()) {
        setNextForInterval(interval, Date.now());
      }
    }
    if (event.target.classList.contains("interval-preset")) {
      const previousPresetIds = getCuePresetIds(interval);
      interval.presetId = event.target.value;
      // A primary selection replaces the untouched profile-provided set.
      // Preserve sets customized through the advanced controls.
      // Preserve the existing primary-selection behavior for users whose
      // saved configuration still holds the original unmodified default set.
      const isDefaultVoiceSet = isUnmodifiedVoiceProfileSet(interval, previousPresetIds, BUILT_IN_VOICE_SET);
      if (isDefaultVoiceSet) {
        interval.presetIds = [interval.presetId];
      } else if (!previousPresetIds.includes(interval.presetId)) {
        interval.presetIds = previousPresetIds.length <= 1
          ? [interval.presetId]
          : [interval.presetId, ...previousPresetIds];
      }
      shouldNormalize = true;
      shouldResetCursor = true;
      shouldRerenderIntervals = true;
      shouldClearSimulation = true;
    }
    if (event.target.classList.contains("interval-preset-set")) {
      clipSetScrollTopToRestore = event.target.scrollTop;
      const selectedPresetIds = [...event.target.selectedOptions].map((option) => option.value);
      interval.presetIds = selectedPresetIds.length ? selectedPresetIds : [interval.presetId];
      if (!interval.presetIds.includes(interval.presetId)) {
        interval.presetId = interval.presetIds[0];
      }
      shouldNormalize = true;
      shouldResetCursor = true;
      shouldRerenderIntervals = true;
      shouldClearSimulation = true;
    }
    if (event.target.classList.contains("interval-playback-mode")) {
      interval.playbackMode = normalizePlaybackMode(event.target.value, "sequential");
      shouldNormalize = true;
      shouldResetCursor = true;
      shouldRerenderIntervals = true;
      shouldClearSimulation = true;
    }
    if (event.target.classList.contains("interval-preset-weight-input")) {
      const presetId = event.target.dataset.presetWeightFor;
      if (presetId) {
        const sanitizedWeight = sanitizeWeight(event.target.value, 1);
        event.target.value = String(sanitizedWeight);
        interval.presetWeights = {
          ...getCuePresetWeights(interval),
          [presetId]: sanitizedWeight
        };
        shouldNormalize = true;
        shouldClearSimulation = true;
      }
    }
    if (event.target.classList.contains("interval-tts-enabled")) {
      interval.ttsEnabled = event.target.checked;
    }
    if (shouldNormalize) {
      normalizeCueSoundConfig(interval, { resetCursor: shouldResetCursor });
    }
    saveState();
    if (shouldRerenderIntervals) {
      renderIntervals();
      if (clipSetScrollTopToRestore !== null) {
        restoreAdvancedClipSetViewport(interval.id, clipSetScrollTopToRestore);
      }
    } else if (shouldClearSimulation) {
      const simulationOutput = row.querySelector(".interval-weight-sim-output");
      setSimulationOutput(simulationOutput, "");
    }
  });

  intervalGrid.addEventListener(
    "toggle",
    (event) => {
      const advancedPanel = event.target;
      if (!advancedPanel || !advancedPanel.classList || !advancedPanel.classList.contains("interval-advanced")) {
        return;
      }
      const row = advancedPanel.closest(".interval-row");
      if (!row) {
        return;
      }
      const intervalId = row.dataset.intervalId;
      if (!intervalId) {
        return;
      }
      if (advancedPanel.open) {
        runtime.openIntervalAdvancedIds.add(intervalId);
      } else {
        runtime.openIntervalAdvancedIds.delete(intervalId);
      }
    },
    true
  );

  intervalGrid.addEventListener("input", (event) => {
    const row = event.target.closest(".interval-row");
    if (!row) {
      return;
    }
    const interval = getIntervalById(row.dataset.intervalId);
    if (!interval || !event.target.classList.contains("interval-volume")) {
      return;
    }
    interval.volume = clamp(Number(event.target.value), 0, 1);
    saveState();
  });

  intervalGrid.addEventListener("click", async (event) => {
    const row = event.target.closest(".interval-row");
    const interval = row ? getIntervalById(row.dataset.intervalId) : null;
    if (!interval) {
      return;
    }

    if (event.target.classList.contains("interval-add-bundled-voices")) {
      const selected = getCuePresetIds(interval);
      const missing = missingBundledVoiceIds(interval, selected, BUILT_IN_VOICE_SET);
      if (missing.length) {
        interval.presetIds = [...selected, ...missing];
        saveState();
        renderIntervals();
        intervalGrid.querySelector(`[data-interval-id="${interval.id}"] .interval-preset-set`)?.focus({ preventScroll: true });
      }
      return;
    }

    if (event.target.classList.contains("interval-weight-preset")) {
      const strategy = event.target.dataset.weightPresetKind;
      interval.presetWeights = buildPresetWeightsByStrategy(getCuePresetIds(interval), strategy);
      normalizeCueSoundConfig(interval);
      saveState();
      renderIntervals();
      return;
    }

    if (event.target.classList.contains("interval-weight-simulate")) {
      const output = row.querySelector(".interval-weight-sim-output");
      const presetIds = getCuePresetIds(interval);
      const simulationText = runSimulationPreview({
        presetIds,
        playbackMode: interval.playbackMode,
        presetWeights: getCuePresetWeights(interval, presetIds),
        ...getRepeatSimulationContext(interval),
        iterations: 100
      });
      setSimulationOutput(output, simulationText);
      return;
    }

    if (!event.target.classList.contains("interval-preview")) {
      return;
    }

    await previewCue({
      label: interval.label,
      cue: interval,
      volume: interval.volume,
      cueType: "recurring",
      itemTtsEnabled: interval.ttsEnabled
    });
  });
}

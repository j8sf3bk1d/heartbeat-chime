export function registerTimerHandlers({
  elements,
  state,
  renderTimerSoundSelectors,
  saveState,
  renderTimers,
  addLog,
  getSelectedOptionValues,
  ensurePresetInSet,
  syncWeightControlsForPresetSet,
  setSimulationOutput,
  getPresetIdsFromSelect,
  applyWeightPresetToControls,
  sanitizeWeight,
  runSimulationPreview,
  readPresetWeightsFromContainer,
  buildOneShot,
  formatDateTime,
  hasPresetId,
  normalizeCueSoundConfig,
  previewCue,
  soundEngine,
  getMasterVolume,
  fireCue
}) {
  const ONE_SHOT_PREVIEW_VOLUME = 0.85;

  function twoDigits(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateTimeLocalValue(epochMs) {
    const date = new Date(epochMs);
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(
      date.getHours()
    )}:${twoDigits(date.getMinutes())}`;
  }

  function getNextMinuteDateTimeLocalValue(epochMs = Date.now()) {
    const date = new Date(epochMs);
    date.setSeconds(0, 0);
    if (date.getTime() <= epochMs) {
      date.setMinutes(date.getMinutes() + 1);
    }
    return formatDateTimeLocalValue(date.getTime());
  }

  // Both one-shot forms share the same sound controls. Keeping their wiring
  // together prevents preview, weighting and selection behavior from drifting.
  function registerFormSoundControls({ preset, presetSet, weightControls, playbackMode, preview, label, weightActions, weightSimulate, simulationOutput }) {
    const weightOptions = { inputClass: "form-preset-weight-input", wrapperClass: "weight-control-grid" };
    const clearSimulation = () => setSimulationOutput(simulationOutput, "");
    const selectedPresetIds = () => getPresetIdsFromSelect(presetSet, preset.value);
    const syncWeights = () => syncWeightControlsForPresetSet(presetSet, weightControls, preset.value, weightOptions);

    function getSoundConfig() {
      const presetIds = selectedPresetIds();
      const effectivePresetIds = presetIds.length ? presetIds : [preset.value];
      return {
        presetId: preset.value,
        presetIds,
        presetWeights: readPresetWeightsFromContainer(weightControls, effectivePresetIds),
        playbackMode: playbackMode.value
      };
    }

    preview.addEventListener("click", async () => {
      const soundConfig = getSoundConfig();
      if (!soundConfig.presetId || !hasPresetId(soundConfig.presetId)) return;
      await previewCue({
        label: label.value?.trim() || "One-shot timer",
        cue: { ...soundConfig, playbackCursor: 0 },
        volume: ONE_SHOT_PREVIEW_VOLUME,
        cueType: "one-shot",
        itemTtsEnabled: true
      });
    });

    preset.addEventListener("change", () => {
      ensurePresetInSet(presetSet, preset.value);
      syncWeights();
      clearSimulation();
    });
    presetSet.addEventListener("change", () => {
      const selected = getSelectedOptionValues(presetSet);
      if (selected.length && !selected.includes(preset.value)) preset.value = selected[0];
      syncWeights();
      clearSimulation();
    });
    playbackMode.addEventListener("change", clearSimulation);
    weightActions.addEventListener("click", (event) => {
      if (!event.target.classList.contains("form-weight-preset")) return;
      applyWeightPresetToControls(weightControls, selectedPresetIds(), event.target.dataset.weightPresetKind, weightOptions);
      clearSimulation();
    });
    weightControls.addEventListener("change", (event) => {
      if (!event.target.classList.contains("form-preset-weight-input")) return;
      event.target.value = String(sanitizeWeight(event.target.value, 1));
      clearSimulation();
    });
    weightSimulate.addEventListener("click", () => {
      const presetIds = selectedPresetIds();
      setSimulationOutput(simulationOutput, runSimulationPreview({
        presetIds,
        playbackMode: playbackMode.value,
        presetWeights: readPresetWeightsFromContainer(weightControls, presetIds),
        iterations: 100
      }));
    });
    return getSoundConfig;
  }

  const getRelativeFormSoundConfig = registerFormSoundControls({
    preset: elements.relativePreset, presetSet: elements.relativePresetSet,
    weightControls: elements.relativePresetWeightControls, playbackMode: elements.relativePlaybackMode,
    preview: elements.relativePreview, label: elements.relativeLabel,
    weightActions: elements.relativeWeightPresetActions, weightSimulate: elements.relativeWeightSimulate,
    simulationOutput: elements.relativeWeightSimOutput
  });
  const getAbsoluteFormSoundConfig = registerFormSoundControls({
    preset: elements.absolutePreset, presetSet: elements.absolutePresetSet,
    weightControls: elements.absolutePresetWeightControls, playbackMode: elements.absolutePlaybackMode,
    preview: elements.absolutePreview, label: elements.absoluteLabel,
    weightActions: elements.absoluteWeightPresetActions, weightSimulate: elements.absoluteWeightSimulate,
    simulationOutput: elements.absoluteWeightSimOutput
  });

  elements.absoluteNow.addEventListener("click", (event) => {
    event.preventDefault();
    elements.absoluteWhen.value = getNextMinuteDateTimeLocalValue();
    elements.absoluteWhen.focus();
  });

  elements.relativeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const minutes = Number(elements.relativeMinutes.value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const soundConfig = getRelativeFormSoundConfig();
    const timer = buildOneShot({
      label: elements.relativeLabel.value,
      targetAtMs: Date.now() + minutes * 60 * 1000,
      ...soundConfig
    });
    state.oneShots.push(timer);
    elements.relativeForm.reset();
    elements.relativeMinutes.value = "10";
    renderTimerSoundSelectors();
    saveState();
    renderTimers();
    addLog(`Added one-shot timer for +${minutes} minutes`);
  });

  elements.absoluteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const whenRaw = elements.absoluteWhen.value;
    const targetAtMs = new Date(whenRaw).getTime();
    if (!Number.isFinite(targetAtMs) || targetAtMs <= Date.now()) {
      addLog("Target time must be in the future");
      return;
    }
    const soundConfig = getAbsoluteFormSoundConfig();
    const timer = buildOneShot({
      label: elements.absoluteLabel.value,
      targetAtMs,
      presetId: soundConfig.presetId,
      presetIds: soundConfig.presetIds,
      presetWeights: soundConfig.presetWeights,
      playbackMode: soundConfig.playbackMode
    });
    state.oneShots.push(timer);
    elements.absoluteForm.reset();
    renderTimerSoundSelectors();
    saveState();
    renderTimers();
    addLog(`Added target timer for ${formatDateTime(targetAtMs)}`);
  });

  elements.timersList.addEventListener("click", async (event) => {
    const item = event.target.closest(".timer-item");
    if (!item) {
      return;
    }
    const timer = state.oneShots.find((entry) => entry.id === item.dataset.timerId);
    if (!timer) {
      return;
    }
    const primaryPresetSelect = item.querySelector(".timer-edit-preset");
    const presetSetSelect = item.querySelector(".timer-edit-preset-set");
    const playbackModeSelect = item.querySelector(".timer-edit-playback-mode");
    const weightControls = item.querySelector(".timer-edit-weight-controls");
    const simulationOutput = item.querySelector(".timer-weight-sim-output");

    if (event.target.classList.contains("timer-weight-preset")) {
      if (!primaryPresetSelect || !presetSetSelect || !weightControls) {
        return;
      }
      const strategy = event.target.dataset.weightPresetKind;
      const presetIds = getPresetIdsFromSelect(presetSetSelect, primaryPresetSelect.value);
      applyWeightPresetToControls(weightControls, presetIds, strategy, {
        inputClass: "timer-edit-preset-weight-input",
        wrapperClass: "weight-control-grid"
      });
      setSimulationOutput(simulationOutput, "");
      return;
    }

    const action = event.target.dataset.action;
    if (!action) {
      return;
    }

    if (action === "cancel") {
      timer.active = false;
      timer.firedAtMs = null;
      addLog(`Canceled timer: ${timer.label}`);
    } else if (action === "remove") {
      state.oneShots = state.oneShots.filter((entry) => entry.id !== timer.id);
    } else if (action === "save-sound") {
      if (!primaryPresetSelect || !presetSetSelect || !playbackModeSelect || !weightControls) {
        return;
      }
      const selectedPresetIds = [...presetSetSelect.selectedOptions]
        .map((option) => option.value)
        .filter((presetId) => hasPresetId(presetId) || presetId.startsWith("custom:"));
      timer.presetId = primaryPresetSelect.value;
      timer.presetIds = selectedPresetIds.length ? selectedPresetIds : [timer.presetId];
      timer.playbackMode = playbackModeSelect.value;
      timer.presetWeights = readPresetWeightsFromContainer(weightControls, timer.presetIds);
      normalizeCueSoundConfig(timer, { resetCursor: true });
      setSimulationOutput(simulationOutput, "");
      addLog(`Updated timer sound: ${timer.label}`);
    } else if (action === "simulate-sound") {
      if (!primaryPresetSelect || !presetSetSelect || !playbackModeSelect || !weightControls) {
        return;
      }
      const presetIds = getPresetIdsFromSelect(presetSetSelect, primaryPresetSelect.value);
      const simulationText = runSimulationPreview({
        presetIds,
        playbackMode: playbackModeSelect.value,
        presetWeights: readPresetWeightsFromContainer(weightControls, presetIds),
        iterations: 100
      });
      setSimulationOutput(simulationOutput, simulationText);
      return;
    } else if (action === "toggle-tts") {
      timer.ttsEnabled = !timer.ttsEnabled;
      addLog(`${timer.ttsEnabled ? "Enabled" : "Disabled"} speech for timer: ${timer.label}`);
    } else if (action === "replay") {
      await soundEngine.unlock();
      soundEngine.setMasterVolume(getMasterVolume());
      fireCue({
        label: `${timer.label} (Replay)`,
        cue: timer,
        volume: timer.volume,
        cueType: "one-shot",
        itemTtsEnabled: timer.ttsEnabled
      });
    } else if (action === "test") {
      await previewCue({
        label: timer.label,
        cue: timer,
        volume: timer.volume,
        cueType: "one-shot",
        itemTtsEnabled: timer.ttsEnabled
      });
    }
    saveState();
    renderTimers();
  });

  elements.timersList.addEventListener("change", (event) => {
    const item = event.target.closest(".timer-item");
    if (!item) {
      return;
    }
    const primaryPresetSelect = item.querySelector(".timer-edit-preset");
    const presetSetSelect = item.querySelector(".timer-edit-preset-set");
    const weightControls = item.querySelector(".timer-edit-weight-controls");
    const simulationOutput = item.querySelector(".timer-weight-sim-output");
    if (!primaryPresetSelect || !presetSetSelect || !weightControls) {
      return;
    }

    if (event.target.classList.contains("timer-edit-preset")) {
      ensurePresetInSet(presetSetSelect, primaryPresetSelect.value);
      syncWeightControlsForPresetSet(presetSetSelect, weightControls, primaryPresetSelect.value, {
        inputClass: "timer-edit-preset-weight-input",
        wrapperClass: "weight-control-grid"
      });
      setSimulationOutput(simulationOutput, "");
      return;
    }

    if (event.target.classList.contains("timer-edit-preset-set")) {
      const selectedPresetIds = getPresetIdsFromSelect(presetSetSelect);
      if (selectedPresetIds.length && !selectedPresetIds.includes(primaryPresetSelect.value)) {
        primaryPresetSelect.value = selectedPresetIds[0];
      }
      syncWeightControlsForPresetSet(presetSetSelect, weightControls, primaryPresetSelect.value, {
        inputClass: "timer-edit-preset-weight-input",
        wrapperClass: "weight-control-grid"
      });
      setSimulationOutput(simulationOutput, "");
      return;
    }

    if (event.target.classList.contains("timer-edit-playback-mode")) {
      setSimulationOutput(simulationOutput, "");
      return;
    }

    if (event.target.classList.contains("timer-edit-preset-weight-input")) {
      event.target.value = String(sanitizeWeight(event.target.value, 1));
      setSimulationOutput(simulationOutput, "");
    }
  });
}

import { escapeHtml } from "./escapeHtml.js";
import { updateOverview } from "./navigation.js";
import { soundIntervalTags } from "./soundIntervals.js";
import { BUILT_IN_VOICE_SET } from "./builtInVoices.js";
import { missingBundledVoiceIds } from "./voicePoolActions.js";

export function createUiRenderers({
  elements,
  state,
  runtime,
  customLibrary,
  formatClock,
  formatDateTime,
  getRelativeDefaultPresetId,
  getAbsoluteDefaultPresetId,
  getPresetIdsFromSelect,
  readPresetWeightsFromContainer,
  makePresetOptions,
  makePresetSetOptions,
  makePlaybackModeOptions,
  renderPresetWeightControls,
  makeWeightPresetButtonsMarkup,
  setSimulationOutput,
  getAllProfiles,
  getCurrentProfile,
  ttsSpeaker,
  renderVoiceOptions,
  THEME_MODES,
  THEME_PALETTES,
  getThemeModeLabel,
  isDesktopRuntime,
  getCuePresetIds,
  getCuePresetWeights,
  makePresetWeightControlMarkup,
  getAllPresets,
  isBuiltInPresetId,
  isAudioStoreAvailable,
  computeTimerProgressRatio,
  getPresetLabel,
  getPlaybackModeLabel
}) {
  function renderTimerSoundSelectors() {
    const relativeDefaultPresetId = getRelativeDefaultPresetId();
    const absoluteDefaultPresetId = getAbsoluteDefaultPresetId();

    const currentRelativeSet = getPresetIdsFromSelect(elements.relativePresetSet);
    const currentAbsoluteSet = getPresetIdsFromSelect(elements.absolutePresetSet);
    const currentRelativeWeights = readPresetWeightsFromContainer(elements.relativePresetWeightControls, currentRelativeSet);
    const currentAbsoluteWeights = readPresetWeightsFromContainer(elements.absolutePresetWeightControls, currentAbsoluteSet);

    const relativePresetIds = currentRelativeSet.length ? currentRelativeSet : [relativeDefaultPresetId];
    const absolutePresetIds = currentAbsoluteSet.length ? currentAbsoluteSet : [absoluteDefaultPresetId];

    elements.relativePreset.innerHTML = makePresetOptions(relativeDefaultPresetId);
    elements.absolutePreset.innerHTML = makePresetOptions(absoluteDefaultPresetId);
    elements.relativePresetSet.innerHTML = makePresetSetOptions(relativePresetIds);
    elements.absolutePresetSet.innerHTML = makePresetSetOptions(absolutePresetIds);

    elements.relativePlaybackMode.innerHTML = makePlaybackModeOptions(elements.relativePlaybackMode.value || "sequential");
    elements.absolutePlaybackMode.innerHTML = makePlaybackModeOptions(elements.absolutePlaybackMode.value || "sequential");
    renderPresetWeightControls(elements.relativePresetWeightControls, relativePresetIds, currentRelativeWeights, {
      inputClass: "form-preset-weight-input",
      wrapperClass: "weight-control-grid"
    });
    renderPresetWeightControls(elements.absolutePresetWeightControls, absolutePresetIds, currentAbsoluteWeights, {
      inputClass: "form-preset-weight-input",
      wrapperClass: "weight-control-grid"
    });
    elements.relativeWeightPresetActions.innerHTML = makeWeightPresetButtonsMarkup("form-weight-preset");
    elements.absoluteWeightPresetActions.innerHTML = makeWeightPresetButtonsMarkup("form-weight-preset");
    setSimulationOutput(elements.relativeWeightSimOutput, "");
    setSimulationOutput(elements.absoluteWeightSimOutput, "");
  }

  function renderClock() {
    elements.clock.textContent = formatClock();
  }

  const selectOptionSignatures = new WeakMap();
  // Status/health renders are frequent. Replacing identical option nodes
  // closes open menus in some WebViews, so update only when data changes.
  function setSelectOptions(select, markup) {
    if (selectOptionSignatures.get(select) !== markup) {
      select.innerHTML = markup;
      selectOptionSignatures.set(select, markup);
    }
  }

  function renderSession({ forceSpeechDraft = false } = {}) {
    updateOverview(state, getPresetLabel, runtime);
    const toggleLabel = runtime.schedulerStarting ? "Starting…" : state.running ? "Pause Chimes" : "Start Chimes";
    elements.toggleEngine.textContent = state.running ? "❚❚" : "▶";
    elements.toggleEngine.setAttribute("aria-label", toggleLabel);
    elements.toggleEngine.title = toggleLabel;
    elements.toggleEngine.setAttribute("aria-disabled", String(Boolean(runtime.schedulerStarting)));
    const schedulerError = document.getElementById("scheduler-error");
    schedulerError.textContent = runtime.schedulerError || "";
    schedulerError.hidden = !runtime.schedulerError;
    document.getElementById("timers-paused-notice").hidden = Boolean(state.running);
    elements.statusText.textContent = state.running ? (runtime.audioReady === false ? "Audio unavailable" : "Running") : "Paused";
    elements.statusText.dataset.running = String(state.running && runtime.audioReady !== false);
    elements.masterVolume.value = String(state.masterVolume);
    elements.masterVolumeValue.textContent = `${Math.round(state.masterVolume * 100)}%`;
    elements.resumeOnLaunch.checked = Boolean(state.resumeOnLaunch);
    elements.resumeOnLaunch.disabled = !isDesktopRuntime();
    elements.launchAtLogin.checked = Boolean(state.launchAtLogin);
    elements.launchAtLogin.disabled = !isDesktopRuntime();
    elements.suppressLower.checked = state.suppressLowerIntervalsOnCollision;
    elements.avoidRandomRepeat.checked = state.avoidConsecutiveRandomSounds;

    const desktopRuntime = isDesktopRuntime();
    const trayConnected = desktopRuntime && Boolean(runtime.trayConnected);
    const hasTrayCommand = typeof runtime.lastTrayCommand === "string" && runtime.lastTrayCommand.trim().length > 0;
    const startupStatus = !desktopRuntime
      ? "Unavailable in browser"
      : runtime.desktopAutostartError
        ? `Sync failed: ${runtime.desktopAutostartError}`
        : runtime.desktopAutostartSyncedAtMs
          ? `Synced ${formatClock(new Date(runtime.desktopAutostartSyncedAtMs))}`
          : "Pending first sync";
    const lastTrayCommand = hasTrayCommand
      ? `${runtime.lastTrayCommand} @ ${formatClock(new Date(runtime.lastTrayCommandAtMs || Date.now()))}`
      : "None yet";

    elements.desktopRuntimeValue.textContent = desktopRuntime ? "Desktop (Tauri)" : "Web browser";
    elements.desktopTrayBridgeValue.textContent = trayConnected
      ? "Connected"
      : desktopRuntime
        ? "Disconnected"
        : "Unavailable";
    elements.desktopStartupValue.textContent = startupStatus;
    elements.desktopLastTrayCommandValue.textContent = lastTrayCommand;
    elements.desktopStatusRefresh.disabled = !desktopRuntime;
    elements.soundLibraryBrowser.open = Boolean(state.soundLibraryExpanded);

    const profiles = getAllProfiles();
    const profileOptions = profiles
      .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`)
      .join("");
    const profileExists = profiles.some((profile) => profile.id === state.selectedProfileId);
    const missingOption = profileExists ? "" : `<option value="${escapeHtml(state.selectedProfileId)}">${escapeHtml(`Missing sound mode (${state.selectedProfileId})`)}</option>`;
    setSelectOptions(elements.soundProfile, profileOptions + missingOption);
    const draftId = runtime.soundProfileDraftId || state.selectedProfileId;
    const draftProfile = profiles.find((profile) => profile.id === draftId);
    elements.soundProfile.value = draftProfile ? draftId : state.selectedProfileId;
    elements.soundProfileDescription.textContent = draftProfile?.description || (profileExists ? getCurrentProfile().description : "This sound mode is missing. Reimport its pack or choose another mode.");
    elements.soundProfileUndo.disabled = !runtime.soundProfileUndo;
    elements.ttsEnabled.checked = state.ttsEnabled;
    elements.ttsSpeakLabel.checked = state.ttsSpeakLabel;
    elements.ttsRecurringEnabled.checked = state.ttsRecurringEnabled;
    elements.ttsOneShotEnabled.checked = state.ttsOneShotEnabled;
    // Audio-health and tray updates also render this view while the user is
    // typing. The draft commits on change/blur; don't replace it mid-edit.
    if ((forceSpeechDraft || document.activeElement !== elements.ttsCustomText) && elements.ttsCustomText.value !== state.ttsCustomText) {
      elements.ttsCustomText.value = state.ttsCustomText;
    }
    elements.ttsRate.value = String(state.ttsRate);
    elements.ttsRateValue.textContent = `${state.ttsRate.toFixed(2)}x`;
    elements.ttsVolume.value = String(state.ttsVolume);
    elements.ttsVolumeValue.textContent = `${Math.round(state.ttsVolume * 100)}%`;
    elements.ttsSupportNote.textContent = ttsSpeaker.supported
      ? "Speech synthesis is available in this browser."
      : "Speech synthesis is not available in this browser.";
    elements.ttsEnabled.disabled = !ttsSpeaker.supported;
    elements.ttsSpeakLabel.disabled = !ttsSpeaker.supported;
    elements.ttsRecurringEnabled.disabled = !ttsSpeaker.supported;
    elements.ttsOneShotEnabled.disabled = !ttsSpeaker.supported;
    elements.ttsCustomText.disabled = !ttsSpeaker.supported;
    elements.ttsVoice.disabled = !ttsSpeaker.supported;
    elements.ttsRate.disabled = !ttsSpeaker.supported;
    elements.ttsVolume.disabled = !ttsSpeaker.supported;
    elements.ttsPreview.disabled = !ttsSpeaker.supported;
    elements.ttsRecurringAllOn.disabled = !ttsSpeaker.supported;
    elements.ttsRecurringAllOff.disabled = !ttsSpeaker.supported;
    elements.ttsOneShotAllOn.disabled = !ttsSpeaker.supported;
    elements.ttsOneShotAllOff.disabled = !ttsSpeaker.supported;

    renderVoiceOptions();

    setSelectOptions(elements.themeMode, THEME_MODES.map(
      (themeMode) => `<option value="${themeMode}">${getThemeModeLabel(themeMode)}</option>`
    ).join(""));
    elements.themeMode.value = state.themeMode;

    setSelectOptions(elements.themePalette, THEME_PALETTES.map(
      (themePalette) => `<option value="${themePalette.id}">${themePalette.label}</option>`
    ).join(""));
    elements.themePalette.value = state.themePaletteId;
  }

  function renderIntervals() {
    elements.intervalGrid.innerHTML = state.intervals
      .map(
        (interval) => `
          <article class="interval-row" data-interval-id="${escapeHtml(interval.id)}">
            <label class="interval-toggle">
              <input class="interval-enabled" type="checkbox" ${interval.enabled ? "checked" : ""} />
              <span>${escapeHtml(interval.label)}</span>
            </label>
            <label>
              <span>Sound</span>
              <select class="interval-preset">${makePresetOptions(interval.presetId)}</select>
            </label>
            <button type="button" class="button-secondary interval-preview">Preview</button>
            <details class="disclosure interval-advanced" ${runtime.openIntervalAdvancedIds.has(interval.id) ? "open" : ""}>
              <summary>Volume, speech &amp; multiple clips</summary>
              <div class="disclosure-body interval-advanced-body">
                <label>
                  <span>Volume</span>
                  <input class="interval-volume" type="range" min="0" max="1" step="0.05" value="${interval.volume}" />
                </label>
                <label class="field-inline">
                  <input class="interval-tts-enabled" type="checkbox" ${interval.ttsEnabled ? "checked" : ""} />
                  <span>Speak</span>
                </label>
                <label>
                  <span>Filter clips</span>
                  <select class="interval-clip-filter" aria-label="Filter clips for ${escapeHtml(interval.label)}">
                    <option value="all" ${!runtime.intervalClipFilters?.has(interval.id) ? "selected" : ""}>All sounds</option>
                    <option value="matching" ${runtime.intervalClipFilters?.has(interval.id) ? "selected" : ""}>Tagged ${interval.minutes} min + selected</option>
                  </select>
                </label>
                <p class="hint">Filter by interval tags; selected clips stay visible.</p>
                <label>
                  <span>Clip set</span>
                  <select class="interval-preset-set preset-set-select" multiple size="8">
                    ${makePresetSetOptions(getCuePresetIds(interval), runtime.intervalClipFilters?.has(interval.id) ? interval.minutes : null)}
                  </select>
                </label>
                ${missingBundledVoiceIds(interval, getCuePresetIds(interval), BUILT_IN_VOICE_SET).length ? `<button type="button" class="button-secondary interval-add-bundled-voices">Add ${missingBundledVoiceIds(interval, getCuePresetIds(interval), BUILT_IN_VOICE_SET).length} bundled voices</button><p class="hint">Adds the missing voices for this interval; keeps your current clips, weights and playback mode.</p>` : ""}
                <label>
                  <span>Playback</span>
                  <select class="interval-playback-mode">${makePlaybackModeOptions(interval.playbackMode)}</select>
                </label>
                <div class="weight-editor">
                  <span>Weights</span>
                  ${makePresetWeightControlMarkup({
                    presetIds: getCuePresetIds(interval),
                    presetWeights: getCuePresetWeights(interval),
                    inputClass: "interval-preset-weight-input",
                    wrapperClass: "weight-control-grid"
                  })}
                  <div class="weight-actions">
                    ${makeWeightPresetButtonsMarkup("interval-weight-preset")}
                    <button type="button" class="button-secondary interval-weight-simulate">Sim 100</button>
                  </div>
                  <p class="weight-sim-output interval-weight-sim-output"></p>
                </div>
              </div>
            </details>
          </article>
        `
      )
      .join("");
  }

  function renderPresetLibrary() {
    const previousFilterValue = elements.presetSourceFilter.value || "all";
    const sourceOptions = [
      { value: "all", label: "All sources" },
      { value: "built-in", label: "Built-in only" },
      { value: "imported", label: "Imported only" },
      ...customLibrary.packs.map((pack) => ({ value: `pack:${pack.id}`, label: `Pack: ${pack.label}` }))
    ];
    elements.presetSourceFilter.innerHTML = sourceOptions
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join("");
    elements.presetSourceFilter.value = sourceOptions.some((option) => option.value === previousFilterValue)
      ? previousFilterValue
      : "all";

    const intervalSelector = document.getElementById("preset-interval-filter");
    const previousInterval = intervalSelector.value || "all";
    const allMinutes = [...new Set([1, 5, 10, 15, 30, 60, ...getAllPresets().flatMap((preset) => soundIntervalTags(preset, state.soundIntervalTags))])].sort((a, b) => a - b);
    intervalSelector.innerHTML = '<option value="all">Any interval</option><option value="untagged">Untagged</option>' +
      allMinutes.map((minutes) => `<option value="${minutes}">${minutes} minute${minutes === 1 ? "" : "s"}</option>`).join("");
    intervalSelector.value = [...intervalSelector.options].some((option) => option.value === previousInterval) ? previousInterval : "all";
    const query = elements.presetSearch.value.trim().toLowerCase();
    const sourceFilter = elements.presetSourceFilter.value;
    const intervalFilter = document.getElementById("preset-interval-filter").value;
    const getPackLabel = (packId) => customLibrary.packs.find((pack) => pack.id === packId)?.label || packId || "Imported";

    const filtered = getAllPresets().filter((preset) => {
      const intervalTags = soundIntervalTags(preset, state.soundIntervalTags);
      if (intervalFilter === "untagged" && intervalTags.length) return false;
      if (intervalFilter !== "all" && intervalFilter !== "untagged" && !intervalTags.includes(Number(intervalFilter))) return false;
      const builtIn = isBuiltInPresetId(preset.id);
      if (sourceFilter === "built-in" && !builtIn) {
        return false;
      }
      if (sourceFilter === "imported" && builtIn) {
        return false;
      }
      if (sourceFilter.startsWith("pack:") && preset.packId !== sourceFilter.slice(5)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = `${preset.label} ${preset.description || ""} ${(preset.tags || []).join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });

    if (!filtered.length) {
      elements.presetLibrary.innerHTML = `<p class="hint">No sounds match your search.</p>`;
      return;
    }

    const grouped = new Map();
    for (const preset of filtered) {
      const builtIn = isBuiltInPresetId(preset.id);
      const groupKey = builtIn ? "__built-in__" : `pack:${preset.packId || "imported"}`;
      const groupLabel = builtIn ? "Built-in Sounds" : `Imported Pack · ${getPackLabel(preset.packId)}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { key: groupKey, label: groupLabel, presets: [] });
      }
      grouped.get(groupKey).presets.push(preset);
    }
    const groups = [...grouped.values()].sort((a, b) => {
      if (a.key === "__built-in__") {
        return -1;
      }
      if (b.key === "__built-in__") {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });
    for (const group of groups) {
      group.presets.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    }

    elements.presetLibrary.innerHTML = groups
      .map((group) => {
        const items = group.presets
          .map((preset) => {
            const sourceText = isBuiltInPresetId(preset.id) ? "Built-in" : `Imported Pack: ${getPackLabel(preset.packId)}`;
            const tags = Array.isArray(preset.tags)
              ? preset.tags.filter((tag) => typeof tag === "string" && tag.trim()).slice(0, 4)
              : [];
            const tagsMarkup = tags.length
              ? `<p class="preset-tags">${tags.map((tag) => `<span class="preset-tag">${escapeHtml(tag)}</span>`).join("")}</p>`
              : "";
            return `
              <article class="preset-item">
                <div>
                  <p class="preset-title">${escapeHtml(preset.label)}</p>
                  <p class="preset-meta">${escapeHtml(preset.description || "No description")} • ${escapeHtml(sourceText)}</p>
                  ${tagsMarkup}
                  <label class="preset-interval-tags"><span>Applies to (minutes)</span><input class="preset-interval-input" data-preset-id="${escapeHtml(preset.id)}" aria-label="Minutes for ${escapeHtml(preset.label)}" value="${soundIntervalTags(preset, state.soundIntervalTags).join(", ")}" placeholder="e.g. 1, 5, 15" inputmode="numeric" /><small>Optional; comma-separated</small></label>
                </div>
                <button type="button" class="button-secondary preset-preview" data-preset-id="${escapeHtml(preset.id)}">Preview</button>
              </article>
            `;
          })
          .join("");
        return `
          <section class="preset-group">
            <p class="preset-group-title">${escapeHtml(group.label)} <span class="preset-group-count">${group.presets.length}</span></p>
            ${items}
          </section>
        `;
      })
      .join("");
  }

  function renderPackList() {
    if (!isAudioStoreAvailable()) {
      elements.packList.innerHTML = `<p class="hint">Sound packs are unavailable in this browser (IndexedDB missing).</p>`;
      return;
    }
    if (!customLibrary.packs.length) {
      elements.packList.innerHTML = `<p class="hint">No imported packs yet.</p>`;
      return;
    }
    elements.packList.innerHTML = customLibrary.packs
      .map((pack) => {
        const presetCount = customLibrary.presets.filter((preset) => preset.packId === pack.id).length;
        const profileCount = customLibrary.profiles.filter((profile) => profile.packId === pack.id).length;
        return `
          <article class="pack-item" data-pack-id="${escapeHtml(pack.id)}">
            <div>
              <p class="pack-title">${escapeHtml(pack.label)}</p>
              <p class="pack-meta">${escapeHtml(pack.description || "No description")}</p>
              <p class="pack-meta">${presetCount} sounds • ${profileCount} profiles</p>
            </div>
            <button type="button" class="button-secondary pack-delete" data-pack-id="${escapeHtml(pack.id)}">Remove</button>
          </article>
        `;
      })
      .join("");
  }

  function updateTimerProgressBars() {
    const nowMs = Date.now();
    for (const fillElement of elements.timersList.querySelectorAll("[data-timer-progress-for]")) {
      const timerId = fillElement.dataset.timerProgressFor;
      const timer = state.oneShots.find((entry) => entry.id === timerId);
      if (!timer) {
        continue;
      }
      const ratio = timer.active ? computeTimerProgressRatio(timer, nowMs) : 1;
      fillElement.style.width = `${Math.round(ratio * 100)}%`;
    }
  }

  function renderTimers() {
    if (!state.oneShots.length) {
      elements.timersList.innerHTML = `<p class="hint">No one-shot timers yet.</p>`;
      return;
    }
    const timers = [...state.oneShots].sort((a, b) => a.targetAtMs - b.targetAtMs);
    elements.timersList.innerHTML = timers
      .map((timer) => {
        const timerPresetIds = getCuePresetIds(timer);
        const timerPresetWeights = getCuePresetWeights(timer, timerPresetIds);
        return `
          <article class="timer-item ${timer.active ? "timer-active" : "timer-finished"}" data-timer-id="${escapeHtml(timer.id)}">
            <div>
              <p class="timer-title">${escapeHtml(timer.label)}</p>
              <p class="timer-meta">
                Target: ${formatDateTime(timer.targetAtMs)} |
                Sound: ${escapeHtml(getPresetLabel(timerPresetIds[0]))}
              </p>
              <p class="timer-meta">
                Playback: ${getPlaybackModeLabel(timer.playbackMode)} |
                Clips: ${timerPresetIds.length}
              </p>
              <p class="timer-meta">
                ${timer.active ? "Pending" : `Fired ${timer.firedAtMs ? formatDateTime(timer.firedAtMs) : ""}`}
              </p>
              <p class="timer-meta">Speech: ${timer.ttsEnabled ? "Enabled" : "Disabled"}</p>
            </div>
            <div class="timer-actions">
              ${
                timer.active
                  ? `<button type="button" class="button-secondary" data-action="test">Test</button>
                     <button type="button" class="button-secondary" data-action="replay">Replay</button>
                     <button type="button" class="button-secondary" data-action="cancel">Cancel</button>
                     <button type="button" class="button-secondary" data-action="toggle-tts">${timer.ttsEnabled ? "TTS On" : "TTS Off"}</button>`
                  : `<button type="button" class="button-secondary" data-action="replay">Replay</button>
                     <button type="button" class="button-secondary" data-action="remove">Remove</button>
                     <button type="button" class="button-secondary" data-action="toggle-tts">${timer.ttsEnabled ? "TTS On" : "TTS Off"}</button>`
              }
            </div>
            <details class="timer-sound-editor">
              <summary>Edit sound</summary>
              <div class="timer-sound-editor-grid">
                <label>
                  <span>Primary sound</span>
                  <select class="timer-edit-preset">${makePresetOptions(timer.presetId)}</select>
                </label>
                <label>
                  <span>Playback</span>
                  <select class="timer-edit-playback-mode">${makePlaybackModeOptions(timer.playbackMode)}</select>
                </label>
                <label>
                  <span>Clip set</span>
                  <select class="timer-edit-preset-set preset-set-select" multiple size="4">
                    ${makePresetSetOptions(timerPresetIds)}
                  </select>
                </label>
                <label>
                  <span>Weights (per clip)</span>
                  <div class="timer-edit-weight-controls">
                    ${makePresetWeightControlMarkup({
                      presetIds: timerPresetIds,
                      presetWeights: timerPresetWeights,
                      inputClass: "timer-edit-preset-weight-input",
                      wrapperClass: "weight-control-grid"
                    })}
                  </div>
                  <div class="weight-actions">
                    ${makeWeightPresetButtonsMarkup("timer-weight-preset")}
                    <button type="button" class="button-secondary" data-action="simulate-sound">Sim 100</button>
                  </div>
                  <p class="weight-sim-output timer-weight-sim-output"></p>
                </label>
                <button type="button" class="button-secondary" data-action="save-sound">Save sound</button>
              </div>
            </details>
            <div class="timer-progress">
              <span
                class="timer-progress-fill"
                data-timer-progress-for="${escapeHtml(timer.id)}"
              ></span>
            </div>
          </article>
        `;
      })
      .join("");
    updateTimerProgressBars();
  }

  function renderLog() {
    if (!state.log.length) {
      elements.logList.innerHTML = `<p class="hint">No chimes yet.</p>`;
      return;
    }
    const latest = [...state.log].reverse();
    elements.logList.innerHTML = latest
      .map(
        (entry) => `
          <p class="log-item">
            <span>${formatClock(new Date(entry.atMs))}</span>
            <span>${escapeHtml(entry.message)}</span>
          </p>
        `
      )
      .join("");
  }

  return {
    renderTimerSoundSelectors,
    renderClock,
    renderSession,
    renderIntervals,
    renderPresetLibrary,
    renderPackList,
    updateTimerProgressBars,
    renderTimers,
    renderLog
  };
}

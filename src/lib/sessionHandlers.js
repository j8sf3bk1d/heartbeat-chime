export function registerSessionHandlers({
  elements,
  state,
  runtime,
  runtimeScheduler,
  soundEngine,
  addLog,
  saveState,
  renderSession,
  renderIntervals,
  renderTimerSoundSelectors,
  getProfileById,
  SOUND_PROFILES,
  applyProfileToIntervals,
  isDesktopRuntime,
  setLaunchAtLoginEnabled,
  refreshDesktopRuntime,
  syncTrayStatus,
  downloadJsonFile,
  makeExportFilename,
  serializeState,
  applyImportedState,
  createPortableBackup,
  parsePortableBackup,
  restorePortableLibrary,
  restoreCharacterLibrary,
  applyRestoredCharacter,
  clamp,
  clampTtsRate,
  clampTtsVolume,
  ttsSpeaker,
  resolveTtsText,
  setAllRecurringTtsEnabled,
  setAllOneShotTtsEnabled,
  applyThemeToDocument,
  getThemeModeLabel,
  THEME_PALETTES
}) {
  elements.toggleEngine.addEventListener("click", async () => {
    if (runtime.schedulerStarting) return;
    try {
      if (state.running) {
        runtimeScheduler.stopScheduler();
        return;
      }
      await runtimeScheduler.startScheduler();
    } catch (error) {
      console.error(error);
      // startScheduler publishes the precise audio or library recovery action.
    }
  });

  elements.masterVolume.addEventListener("input", (event) => {
    const nextValue = clamp(Number(event.target.value), 0, 1);
    state.masterVolume = nextValue;
    if (nextValue > 0) {
      runtime.lastNonZeroMasterVolume = nextValue;
    }
    soundEngine.setMasterVolume(nextValue);
    renderSession();
    saveState();
    if (typeof syncTrayStatus === "function") {
      void syncTrayStatus();
    }
  });

  // Only the fields changed by setup are captured. Later edits to those fields
  // block undo; unrelated volume, tags, timers and other preferences survive.
  const setupFields = ["enabled", "presetId", "presetIds", "playbackMode", "playbackCursor", "presetWeights"];
  const capture = (interval) => Object.fromEntries(setupFields.map(key => [key, structuredClone(interval[key])]));
  const comparable = (snapshot) => { const { playbackCursor, ...rest } = snapshot; return JSON.stringify(rest); };
  const rescheduleChanged = (previous, next) => {
    if (!state.running) return;
    for (const interval of next) {
      const prior = previous.find(item => item.id === interval.id);
      if (!prior || prior.enabled !== interval.enabled) runtimeScheduler.setNextForInterval(interval, Date.now());
    }
  };
  elements.soundProfile.addEventListener("change", (event) => {
    runtime.soundProfileDraftId = event.target.value;
    renderSession();
  });
  elements.soundProfileApply.addEventListener("click", () => {
    const nextProfile = getProfileById(elements.soundProfile.value);
    if (!nextProfile) { elements.soundProfileStatus.textContent = "Choose an available sound mode."; return; }
    const before = state.intervals.map(interval => ({id: interval.id, values: capture(interval)}));
    let intervals = applyProfileToIntervals(state.intervals, nextProfile);
    if (nextProfile.quickIntervals) intervals = intervals.map(interval => ({...interval, enabled: nextProfile.quickIntervals.includes(interval.minutes)}));
    const candidate = {...state, selectedProfileId: nextProfile.id, intervals};
    if (!saveState(candidate)) { elements.soundProfileStatus.textContent = "Could not save setup. Your previous settings remain in place."; return; }
    runtime.soundProfileUndo = {selectedProfileId: state.selectedProfileId, before, appliedProfileId: nextProfile.id, applied: intervals.map(interval => ({id:interval.id, values:capture(interval)}))};
    rescheduleChanged(state.intervals, intervals);
    state.selectedProfileId = nextProfile.id;
    state.intervals = intervals;
    if (state.running) void syncTrayStatus?.();
    runtime.soundProfileDraftId = nextProfile.id;
    renderSession(); renderIntervals(); renderTimerSoundSelectors();
    elements.soundProfileStatus.textContent = `${nextProfile.label} applied. Undo is available until the app closes or an assignment is edited.`;
    addLog(`Applied sound mode: ${nextProfile.label}`);
  });
  elements.soundProfileUndo.addEventListener("click", () => {
    const undo = runtime.soundProfileUndo;
    if (!undo) return;
    const unchanged = state.selectedProfileId === undo.appliedProfileId && state.intervals.length === undo.applied.length && undo.applied.every(({id,values}) => {
      const interval = state.intervals.find(item => item.id === id);
      return interval && comparable(capture(interval)) === comparable(values);
    });
    if (!unchanged) { elements.soundProfileStatus.textContent = "An interval changed after setup, so undo was not applied. Your edits are intact."; return; }
    const intervals = state.intervals.map(interval => ({...interval, ...structuredClone(undo.before.find(item => item.id === interval.id).values)}));
    if (!saveState({...state, selectedProfileId:undo.selectedProfileId, intervals})) { elements.soundProfileStatus.textContent = "Could not save undo. Your current settings remain in place."; return; }
    rescheduleChanged(state.intervals, intervals);
    state.selectedProfileId = undo.selectedProfileId;
    state.intervals = intervals;
    if (state.running) void syncTrayStatus?.();
    runtime.soundProfileDraftId = undo.selectedProfileId;
    runtime.soundProfileUndo = null;
    renderSession(); renderIntervals(); renderTimerSoundSelectors();
    elements.soundProfileStatus.textContent = "Previous interval setup restored.";
    addLog("Undid sound mode setup");
  });

  elements.launchAtLogin.addEventListener("change", async (event) => {
    if (!isDesktopRuntime()) {
      renderSession();
      return;
    }
    const desired = event.target.checked;
    try {
      const actual = await setLaunchAtLoginEnabled(desired);
      state.launchAtLogin = actual;
      runtime.desktopAutostartError = "";
      runtime.desktopAutostartSyncedAtMs = Date.now();
      saveState();
      addLog(state.launchAtLogin ? "Launch at login enabled" : "Launch at login disabled");
    } catch (error) {
      runtime.desktopAutostartError = error?.message || "Unable to update launch at login";
      addLog(`Launch-at-login update failed: ${runtime.desktopAutostartError}`);
    }
    renderSession();
    if (typeof syncTrayStatus === "function") {
      void syncTrayStatus();
    }
  });

  elements.resumeOnLaunch?.addEventListener("change", (event) => {
    runtimeScheduler.setResumeOnLaunch(event.target.checked);
  });

  elements.desktopStatusRefresh.addEventListener("click", async () => {
    if (!isDesktopRuntime()) {
      addLog("Desktop status refresh is unavailable in browser mode");
      renderSession();
      return;
    }
    try {
      await refreshDesktopRuntime();
      renderSession();
      addLog("Desktop startup/tray status refreshed");
    } catch (error) {
      console.error(error);
      addLog("Desktop status refresh failed");
    }
  });

  elements.configExport.addEventListener("click", () => {
    downloadJsonFile({
      filename: makeExportFilename(),
      data: {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        state: serializeState(state)
      }
    });
    addLog("Exported config");
  });

  elements.configImport.addEventListener("click", () => {
    elements.configImportFile.click();
  });

  elements.configImportFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      await applyImportedState(parsed);
      addLog("Imported config. Launch at login remains unchanged on this device.");
    } catch (error) {
      console.error(error);
      addLog(`Config import failed: ${error.message}`);
    }
  });

  function setBackupBusy(busy) {
    elements.backupExport.disabled = busy;
    elements.backupImport.disabled = busy;
  }

  elements.backupExport.addEventListener("click", async () => {
    setBackupBusy(true);
    elements.backupStatus.textContent = "Preparing backup…";
    try {
      const backup = await createPortableBackup(serializeState(state));
      downloadJsonFile({ filename: makeExportFilename().replace("heartbeat-config-", "heartbeat-backup-"), data: backup });
      elements.backupStatus.textContent = "Backup prepared. Keep the file somewhere private; it contains your imported sounds and characters.";
      addLog("Created full backup");
    } catch (error) {
      console.error(error);
      elements.backupStatus.textContent = `Backup failed: ${error.message}`;
      addLog(`Backup failed: ${error.message}`);
    } finally {
      setBackupBusy(false);
    }
  });

  elements.backupImport.addEventListener("click", () => elements.backupImportFile.click());
  function confirmBackupRestore() {
    const dialog = elements.backupConfirm;
    dialog.returnValue = "cancel";
    return new Promise((resolve, reject) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "restore"), {once:true});
      try { dialog.showModal(); } catch (error) { reject(error); }
    });
  }
  elements.backupImportFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    elements.backupStatus.textContent = "Checking backup…";
    let libraryImported = false;
    let charactersImported = false;
    let settingsCommitted = false;
    try {
      const backup = await parsePortableBackup(file);
      const confirmed = await confirmBackupRestore();
      if (!confirmed) {
        elements.backupStatus.textContent = "Restore canceled. Your settings, sounds, and characters were not changed.";
        return;
      }
      elements.backupStatus.textContent = "Restoring sounds, characters and settings…";
      const restored = await restorePortableLibrary(backup);
      libraryImported = true;
      const characterId = await restoreCharacterLibrary(backup.version === 2 ? backup.characters : null);
      charactersImported = backup.version === 2 && backup.characters.packs.length > 0;
      const { libraryReady, restartFailed } = await applyImportedState(restored.state, {
        hydrateAfterCommit: true,
        onCommit: () => { settingsCommitted = true; if (characterId !== null) applyRestoredCharacter(characterId); }
      });
      if (!libraryReady) {
        elements.backupStatus.textContent = "Settings were restored, but the sound library could not be loaded. Check storage and restart Heartbeat.";
        addLog("Restored backup; sound library could not be loaded");
      } else if (restartFailed) {
        elements.backupStatus.textContent = "Backup restored, but chimes could not restart. Check the sound settings and press Start.";
        addLog("Restored backup; chimes could not restart");
      } else {
        elements.backupStatus.textContent = restored.remapped
          ? "Backup restored. Conflicting sound packs were added as separate copies; launch at login remains unchanged."
          : "Backup restored. Launch at login remains unchanged on this device.";
        addLog("Restored full backup");
      }
    } catch (error) {
      console.error(error);
      const prefix = settingsCommitted
        ? "Settings were restored, but an error occurred while updating the app. "
        : charactersImported
        ? "Some sounds and characters were added, but settings could not be restored. Existing settings remain in place. "
        : libraryImported
        ? "Some sounds were added, but settings could not be restored. Existing settings remain in place. "
        : "Backup restore failed. ";
      elements.backupStatus.textContent = `${prefix}${error.message}`;
      addLog(`Backup restore failed: ${error.message}`);
    } finally {
      setBackupBusy(false);
    }
  });

  elements.ttsEnabled.addEventListener("change", (event) => {
    state.ttsEnabled = event.target.checked;
    saveState();
    renderSession();
    addLog(state.ttsEnabled ? "Spoken cues enabled" : "Spoken cues disabled");
  });

  elements.ttsSpeakLabel.addEventListener("change", (event) => {
    state.ttsSpeakLabel = event.target.checked;
    saveState();
    addLog(state.ttsSpeakLabel ? "Cue labels will be spoken when text is empty" : "Cue labels speech fallback disabled");
  });

  elements.ttsRecurringEnabled.addEventListener("change", (event) => {
    state.ttsRecurringEnabled = event.target.checked;
    saveState();
    addLog(state.ttsRecurringEnabled ? "Recurring speech enabled" : "Recurring speech disabled");
  });

  elements.ttsOneShotEnabled.addEventListener("change", (event) => {
    state.ttsOneShotEnabled = event.target.checked;
    saveState();
    addLog(state.ttsOneShotEnabled ? "One-shot speech enabled" : "One-shot speech disabled");
  });

  elements.ttsCustomText.addEventListener("change", (event) => {
    state.ttsCustomText = event.target.value.trim();
    saveState();
    addLog(state.ttsCustomText ? "Custom speech text updated" : "Custom speech text cleared");
  });

  elements.ttsVoice.addEventListener("change", (event) => {
    state.ttsVoiceUri = event.target.value || "";
    saveState();
    addLog(state.ttsVoiceUri ? "Speech voice updated" : "Speech voice reset to browser default");
  });

  elements.ttsRate.addEventListener("input", (event) => {
    state.ttsRate = clampTtsRate(Number(event.target.value));
    elements.ttsRateValue.textContent = `${state.ttsRate.toFixed(2)}x`;
    saveState();
  });

  elements.ttsVolume.addEventListener("input", (event) => {
    state.ttsVolume = clampTtsVolume(Number(event.target.value));
    elements.ttsVolumeValue.textContent = `${Math.round(state.ttsVolume * 100)}%`;
    saveState();
  });

  elements.ttsPreview.addEventListener("click", () => {
    if (!ttsSpeaker.supported) {
      addLog("Speech synthesis is unavailable in this browser.");
      return;
    }
    const previewText = resolveTtsText({
      label: "Heartbeat voice preview",
      customText: state.ttsCustomText,
      speakLabel: state.ttsSpeakLabel
    });
    if (!previewText) {
      addLog("No speech text available for preview. Set custom text or enable label speech.");
      return;
    }
    ttsSpeaker.speak({
      text: previewText,
      voiceUri: state.ttsVoiceUri,
      rate: state.ttsRate,
      volume: state.ttsVolume
    });
  });

  elements.ttsRecurringAllOn.addEventListener("click", () => {
    setAllRecurringTtsEnabled(true);
    addLog("Enabled speech for all recurring intervals");
  });

  elements.ttsRecurringAllOff.addEventListener("click", () => {
    setAllRecurringTtsEnabled(false);
    addLog("Disabled speech for all recurring intervals");
  });

  elements.ttsOneShotAllOn.addEventListener("click", () => {
    setAllOneShotTtsEnabled(true);
    addLog("Enabled speech for all one-shot timers");
  });

  elements.ttsOneShotAllOff.addEventListener("click", () => {
    setAllOneShotTtsEnabled(false);
    addLog("Disabled speech for all one-shot timers");
  });

  elements.themeMode.addEventListener("change", (event) => {
    state.themeMode = event.target.value;
    applyThemeToDocument();
    saveState();
    addLog(`Theme mode set to ${getThemeModeLabel(state.themeMode)}`);
  });

  elements.themePalette.addEventListener("change", (event) => {
    const palette = THEME_PALETTES.find((entry) => entry.id === event.target.value);
    if (!palette) {
      return;
    }
    state.themePaletteId = palette.id;
    applyThemeToDocument();
    saveState();
    addLog(`Theme palette set to ${palette.label}`);
  });

  elements.avoidRandomRepeat.addEventListener("change", (event) => {
    state.avoidConsecutiveRandomSounds = event.target.checked;
    saveState();
  });

  elements.suppressLower.addEventListener("change", (event) => {
    state.suppressLowerIntervalsOnCollision = event.target.checked;
    saveState();
    addLog(
      state.suppressLowerIntervalsOnCollision
        ? "Recurring collision suppression enabled"
        : "Recurring collision suppression disabled"
    );
  });
}

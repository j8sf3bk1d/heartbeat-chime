export function createRuntimeScheduler({
  state,
  runtime,
  soundEngine,
  renderClock,
  renderSession,
  renderTimers,
  addLog,
  fireCue,
  saveState,
  computeNextAligned,
  computeRecurringCatchUp,
  selectRecurringEntries,
  clamp,
  isDesktopRuntime,
  getLaunchAtLoginEnabled,
  listenForTrayCommands,
  toggleLaunchAtLogin,
  emitTrayStatus,
  validateRequiredSounds,
  onSchedulerStop = () => {}
}) {
  const AUDIO_HEALTH_CHECK_INTERVAL_MS = 15_000;
  const AUDIO_RECOVERY_LOG_COOLDOWN_MS = 120_000;
  const SOUND_VERIFICATION_TIMEOUT_MS = 30_000;
  const COMPANION_PREPARE_AHEAD_MS = 2_000;
  const preparedRecurring = new Map();
  const preparedOneShots = new Map();
  let lastAudioHealthCheckAtMs = 0;
  let lastAudioRecoveryWarningAtMs = 0;
  let startAttempt = 0;
  let startupResumeAttempted = false;
  const keyFor = (cue, target) => `${cue.id}:${target}`;
  const cueSignature = (cue) => JSON.stringify([cue.enabled, cue.minutes, cue.label, cue.presetId, cue.presetIds, cue.presetWeights, cue.playbackMode, cue.volume, cue.ttsEnabled]);
  runtime.schedulerStarting = false;
  runtime.schedulerError = "";
  runtime.audioReady = false;

  function needsImportedSoundLibrary() {
    return [...state.intervals.filter((cue) => cue.enabled), ...state.oneShots.filter((cue) => cue.active)]
      .some((cue) => [cue.presetId, ...(cue.presetIds || [])].some((id) => typeof id === "string" && id.startsWith("custom:")));
  }

  function hasMissingRequiredSound() {
    const missing = runtime.missingCustomPresetIds;
    return missing instanceof Set && [...state.intervals.filter((cue) => cue.enabled), ...state.oneShots.filter((cue) => cue.active)]
      .some((cue) => [cue.presetId, ...(cue.presetIds || [])].some((id) => missing.has(id)));
  }

  function getSoundAvailabilityError() {
    if (runtime.libraryReady === false && needsImportedSoundLibrary()) {
      return "Imported sounds could not load. Reload the app before starting chimes.";
    }
    return hasMissingRequiredSound() ? "A configured sound is missing. Restore the app or choose another sound." : "";
  }

  function hasUnpreparedRequiredVoice() {
    return typeof soundEngine.builtInVoiceUrl === "function" &&
      [...state.intervals.filter((cue) => cue.enabled), ...state.oneShots.filter((cue) => cue.active)]
        .some((cue) => [cue.presetId, ...(cue.presetIds || [])]
          .some((id) => soundEngine.builtInVoiceUrl(id) && !soundEngine.builtInBufferCache?.has(id)));
  }

  function reconcileSoundAvailability() {
    const needsVoicePreparation = state.running && hasUnpreparedRequiredVoice();
    const error = getSoundAvailabilityError() || (needsVoicePreparation
      ? "A newly configured voice needs to load. Press Start to load and verify your sounds."
      : "");
    if (error && (state.running || runtime.schedulerStarting)) {
      stopScheduler({ preserveRequest: true });
      runtime.schedulerError = error;
      addLog(error);
      renderSession();
    }
    return !error;
  }

  function setNextForInterval(interval, nowMs) {
    if (!interval.enabled) {
      runtime.nextByIntervalId.delete(interval.id);
      return;
    }
    runtime.nextByIntervalId.set(interval.id, computeNextAligned(nowMs, interval.minutes));
  }

  function armIntervals(nowMs) {
    runtime.nextByIntervalId.clear();
    for (const interval of state.intervals) {
      setNextForInterval(interval, nowMs);
    }
  }

  function buildTrayStatusText() {
    const runLabel = state.running ? (runtime.audioReady ? "Running" : "Audio unavailable") : "Paused";
    const muteLabel = state.masterVolume > 0 ? `${Math.round(state.masterVolume * 100)}%` : "Muted";
    const launchLabel = state.launchAtLogin ? "On" : "Off";
    return `Heartbeat · ${runLabel} · Volume ${muteLabel} · Launch at login ${launchLabel}`;
  }

  async function syncTrayStatus() {
    if (!isDesktopRuntime() || typeof emitTrayStatus !== "function") {
      return false;
    }
    return emitTrayStatus(buildTrayStatusText());
  }

  async function refreshAudioHealth({ reason = "tick", force = false } = {}) {
    const nowMs = Date.now();
    if (!force && nowMs - lastAudioHealthCheckAtMs < AUDIO_HEALTH_CHECK_INTERVAL_MS) {
      return;
    }
    lastAudioHealthCheckAtMs = nowMs;

    const previousState = typeof soundEngine.getContextState === "function" ? soundEngine.getContextState() : "unknown";
    const wasReady = runtime.audioReady;
    const healthAttempt = startAttempt;
    try {
      const ready = await soundEngine.ensureReady({ createIfMissing: false });
      if (healthAttempt !== startAttempt) return;
      const nextState = typeof soundEngine.getContextState === "function" ? soundEngine.getContextState() : previousState;
      runtime.audioReady = ready;
      runtime.schedulerError = ready ? "" : "Audio is unavailable. Open the app and press Start to enable sound.";
      renderSession();
      if (wasReady !== ready) void syncTrayStatus();
      if (ready && previousState !== "running" && nextState === "running") {
        addLog(`Recovered audio context (${previousState} -> running) via ${reason}`);
      }
      if (!ready && state.running && nowMs - lastAudioRecoveryWarningAtMs >= AUDIO_RECOVERY_LOG_COOLDOWN_MS) {
        addLog(`Audio is unavailable (${nextState}). Use Preview or restart chimes if cues are silent.`);
        lastAudioRecoveryWarningAtMs = nowMs;
      }
    } catch (error) {
      if (healthAttempt !== startAttempt) return;
      runtime.audioReady = false;
      runtime.schedulerError = "Audio recovery failed. Open the app and press Start to enable sound.";
      renderSession();
      if (wasReady) void syncTrayStatus();
      if (!state.running) {
        return;
      }
      if (nowMs - lastAudioRecoveryWarningAtMs >= AUDIO_RECOVERY_LOG_COOLDOWN_MS) {
        addLog(`Audio recovery error: ${error?.message || "Unknown error"}`);
        lastAudioRecoveryWarningAtMs = nowMs;
      }
    }
  }

  function schedulerTick() {
    if (!state.running) return;
    if (!reconcileSoundAvailability()) return;
    const nowMs = Date.now();
    for (const [key, job] of preparedRecurring) {
      if (!state.intervals.includes(job.cue) || !job.cue.enabled || nowMs - job.targetAtMs > 10_000) preparedRecurring.delete(key);
    }
    for (const [timer, job] of preparedOneShots) {
      if (!state.oneShots.includes(timer) || !timer.active || timer.targetAtMs !== job.targetAtMs) preparedOneShots.delete(timer);
    }
    renderClock();
    void refreshAudioHealth({ reason: "scheduler", force: false });
    // Keep due timers pending while sound is known to be unavailable. A later
    // successful health check resumes normal catch-up instead of losing cues.
    if (!runtime.audioReady || soundEngine.getContextState() !== "running") return;

    const recurringDueEntries = [];
    const recurringUpcomingEntries = [];
    const aheadMs = state.companionEnabled && isDesktopRuntime() ? COMPANION_PREPARE_AHEAD_MS : 0;
    let skippedRecurringCount = 0;
    for (const interval of state.intervals) {
      if (!interval.enabled) {
        continue;
      }
      const periodMs = interval.minutes * 60 * 1000;
      let nextAt = runtime.nextByIntervalId.get(interval.id);
      if (!nextAt) {
        nextAt = computeNextAligned(nowMs, interval.minutes);
      }
      if (aheadMs && nextAt > nowMs && nextAt - nowMs <= aheadMs) {
        recurringUpcomingEntries.push({ interval, minutes: interval.minutes, fireCount: 1, scheduledAtMs: nextAt, ttsEnabled: interval.ttsEnabled });
        continue;
      }
      const { fireCount, nextAtMs, dueAtMs, skippedCount } = computeRecurringCatchUp(nowMs, nextAt, periodMs);
      skippedRecurringCount += skippedCount;
      if (fireCount > 0) {
        recurringDueEntries.push({
          interval,
          minutes: interval.minutes,
          fireCount,
          scheduledAtMs: dueAtMs,
          ttsEnabled: interval.ttsEnabled
        });
      }
      runtime.nextByIntervalId.set(interval.id, nextAtMs);
    }
    if (skippedRecurringCount > 0) {
      addLog(`Skipped ${skippedRecurringCount} stale recurring cue${skippedRecurringCount === 1 ? "" : "s"} after interruption`);
    }

    // Reserve upcoming cues without advancing the clock boundary. The due
    // pass still owns catch-up, collision handling and advancing the schedule.
    const upcoming = selectRecurringEntries(recurringUpcomingEntries, state.suppressLowerIntervalsOnCollision);
    for (const entry of upcoming.suppressed) {
      const key = keyFor(entry.interval, entry.scheduledAtMs);
      const previous = preparedRecurring.get(key);
      if (previous) previous.suppressed = true;
      else preparedRecurring.set(key, { suppressed: true, cue: entry.interval, targetAtMs: entry.scheduledAtMs });
    }
    for (const entry of upcoming.selected) {
      const { interval, scheduledAtMs } = entry;
      const key = keyFor(interval, scheduledAtMs);
      if (preparedRecurring.has(key)) continue;
      const job = { consumed: false, complete: false, cue: interval, targetAtMs: scheduledAtMs };
      let signature = cueSignature(interval);
      const isCurrent = () => !job.suppressed && state.running && state.intervals.includes(interval) && interval.enabled && cueSignature(interval) === signature && runtime.audioReady && soundEngine.getContextState() === "running";
      preparedRecurring.set(key, job);
      const delivery = fireCue({ label: interval.label, cue: interval, volume: interval.volume, cueType: "recurring", scheduledAtMs, isCurrent, maxLatenessMs: 10_000, itemTtsEnabled: interval.ttsEnabled });
      signature = cueSignature(interval); // Selection may normalize legacy settings.
      Promise.resolve(delivery).then((result) => {
        if (preparedRecurring.get(key) !== job) return;
        job.complete = true;
        if (result === "cancelled") {
          preparedRecurring.delete(key);
          // If the due pass already consumed this reservation, allow a fresh
          // due-time attempt when the cue is still enabled and within grace.
          if (job.consumed && state.running && interval.enabled && Date.now() - scheduledAtMs <= 10_000) {
            const next = runtime.nextByIntervalId.get(interval.id);
            if (Number.isFinite(next) && next > scheduledAtMs) runtime.nextByIntervalId.set(interval.id, scheduledAtMs);
          }
        } else if (job.consumed) preparedRecurring.delete(key);
      }).catch(() => { if (preparedRecurring.get(key) === job) preparedRecurring.delete(key); });
    }

    const { selected, suppressed } = selectRecurringEntries(
      recurringDueEntries,
      state.suppressLowerIntervalsOnCollision
    );
    for (const entry of selected) {
      const key = keyFor(entry.interval, entry.scheduledAtMs);
      const existing = preparedRecurring.get(key);
      if (existing && !existing.suppressed) { existing.consumed = true; if (existing.complete) preparedRecurring.delete(key); continue; }
      // Suppression may have changed since the preparation pass.
      if (existing?.suppressed) preparedRecurring.delete(key);
      const interval = entry.interval;
      let signature = cueSignature(interval);
      fireCue({
        label: interval.label,
        cue: interval,
        volume: interval.volume,
        cueType: "recurring",
        scheduledAtMs: entry.scheduledAtMs,
        maxLatenessMs: 10_000,
        isCurrent: () => state.running && state.intervals.includes(interval) && interval.enabled && cueSignature(interval) === signature && runtime.audioReady && soundEngine.getContextState() === "running",
        itemTtsEnabled: entry.ttsEnabled
      });
      signature = cueSignature(interval);
    }
    for (const entry of suppressed) preparedRecurring.delete(keyFor(entry.interval, entry.scheduledAtMs));
    if (suppressed.length > 0) {
      const suppressedLabels = suppressed
        .map((entry) => `${entry.minutes}m`)
        .sort((a, b) => Number(a.replace("m", "")) - Number(b.replace("m", "")));
      addLog(`Suppressed lower recurring cues (${suppressedLabels.join(", ")})`);
    }

    let oneShotChanged = false;
    for (const timer of state.oneShots) {
      if (!timer.active) {
        continue;
      }
      const existing = preparedOneShots.get(timer);
      if (existing && existing.targetAtMs !== timer.targetAtMs) preparedOneShots.delete(timer);
      if (aheadMs && nowMs < timer.targetAtMs && timer.targetAtMs - nowMs <= aheadMs && !preparedOneShots.has(timer)) {
        const scheduledTargetAtMs = timer.targetAtMs;
        let signature = cueSignature(timer);
        const sameTimer = () => state.oneShots.includes(timer) && timer.active && timer.targetAtMs === scheduledTargetAtMs && cueSignature(timer) === signature;
        const isCurrent = () => state.running && sameTimer() && runtime.audioReady && soundEngine.getContextState() === "running";
        const job = { targetAtMs: scheduledTargetAtMs };
        preparedOneShots.set(timer, job);
        const delivery = fireCue({ label: timer.label, cue: timer, volume: timer.volume, cueType: "one-shot", scheduledAtMs: scheduledTargetAtMs, isCurrent, itemTtsEnabled: timer.ttsEnabled });
        signature = cueSignature(timer);
        const finish = (result) => {
          if (preparedOneShots.get(timer) !== job) return;
          if (result === false && sameTimer()) {
            preparedOneShots.delete(timer);
            stopScheduler({ preserveRequest: true });
            runtime.schedulerError = "A timer sound could not start. Check its sound and press Start to retry.";
            renderSession();
            return;
          }
          if (result !== "cancelled" && result !== "stale" && sameTimer()) {
            timer.active = false; timer.firedAtMs = Date.now(); saveState(); renderTimers();
          }
          preparedOneShots.delete(timer);
        };
        Promise.resolve(delivery).then((result) => {
          const remaining = scheduledTargetAtMs - Date.now();
          if (remaining > 0 && result !== "cancelled" && result !== "stale") setTimeout(() => finish(result), remaining);
          else finish(result);
        }).catch(() => { if (preparedOneShots.get(timer) === job) preparedOneShots.delete(timer); });
      }
      if (nowMs >= timer.targetAtMs && !preparedOneShots.has(timer)) {
        const scheduledTargetAtMs = timer.targetAtMs;
        timer.active = false;
        timer.firedAtMs = nowMs;
        const delivery = fireCue({
          label: timer.label,
          cue: timer,
          volume: timer.volume,
          cueType: "one-shot",
          scheduledAtMs: scheduledTargetAtMs,
          isCurrent: () => state.running && state.oneShots.includes(timer) && !timer.active && timer.firedAtMs === nowMs && timer.targetAtMs === scheduledTargetAtMs && runtime.audioReady && soundEngine.getContextState() === "running",
          itemTtsEnabled: timer.ttsEnabled
        });
        // Pausing during the visual lead-in must not consume a one-shot that
        // never sounded. Do not revive timers the user removed or rescheduled.
        Promise.resolve(delivery).then((result) => {
          if (result === false && state.oneShots.includes(timer) && !timer.active && timer.firedAtMs === nowMs && timer.targetAtMs === scheduledTargetAtMs) {
            timer.active = true; timer.firedAtMs = null;
            stopScheduler({ preserveRequest: true });
            runtime.schedulerError = "A timer sound could not start. Check its sound and press Start to retry.";
            renderSession(); renderTimers();
            return;
          }
          if (result !== "cancelled" || !state.oneShots.includes(timer) || timer.active || timer.firedAtMs !== nowMs || timer.targetAtMs !== scheduledTargetAtMs) return;
          timer.active = true;
          timer.firedAtMs = null;
          saveState();
          renderTimers();
        }).catch((error) => console.warn("Unable to deliver timer cue:", error));
        oneShotChanged = true;
      }
    }
    if (oneShotChanged) {
      saveState();
      renderTimers();
    }
  }

  async function startScheduler({ automatic = false } = {}) {
    if (state.running || runtime.schedulerStarting) return state.running;
    const attempt = ++startAttempt;
    if (!automatic) {
      state.schedulerRequested = true;
      saveState();
    }
    runtime.schedulerStarting = true;
    runtime.schedulerError = "";
    renderSession();
    try {
      const availabilityError = getSoundAvailabilityError();
      if (availabilityError) throw new Error(availabilityError);
      const ready = await soundEngine.unlock();
      if (attempt !== startAttempt) return false;
      if (ready !== true || soundEngine.getContextState() !== "running") {
        throw new Error("Audio needs permission. Open the app and press Start to enable sound.");
      }
      if (typeof validateRequiredSounds === "function") {
        let timeout;
        let valid;
        try {
          valid = await Promise.race([
            validateRequiredSounds(),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Sound verification timed out. Reload the app and try Start again.")), SOUND_VERIFICATION_TIMEOUT_MS); })
          ]);
        } finally {
          clearTimeout(timeout);
        }
        if (attempt !== startAttempt) return false;
        const updatedError = getSoundAvailabilityError();
        if (valid !== true || updatedError) {
          throw new Error(updatedError || "A configured sound could not be loaded. Import its sound pack again or choose another sound.");
        }
      }
      if (hasUnpreparedRequiredVoice()) {
        throw new Error("A configured voice is not ready. Press Start to load and verify your sounds.");
      }
      soundEngine.setMasterVolume(state.masterVolume);
      runtime.audioReady = true;
      armIntervals(Date.now());
      runtime.intervalHandle = window.setInterval(schedulerTick, 500);
      state.running = true;
      addLog(automatic ? "Scheduler resumed on desktop launch" : "Scheduler started");
      return true;
    } catch (error) {
      if (attempt !== startAttempt) return false;
      runtime.audioReady = false;
      runtime.schedulerError = error?.message || "Audio could not start. Open the app and press Start.";
      addLog(runtime.schedulerError);
      throw error;
    } finally {
      if (attempt === startAttempt) {
        runtime.schedulerStarting = false;
        renderSession();
        void syncTrayStatus();
      }
    }
  }

  function stopScheduler({ preserveRequest = false } = {}) {
    startAttempt += 1;
    onSchedulerStop();
    runtime.schedulerStarting = false;
    runtime.schedulerError = "";
    if (runtime.intervalHandle) {
      clearInterval(runtime.intervalHandle);
      runtime.intervalHandle = null;
    }
    runtime.nextByIntervalId.clear();
    preparedRecurring.clear();
    preparedOneShots.clear();
    state.running = false;
    if (!preserveRequest) state.schedulerRequested = false;
    saveState();
    renderSession();
    addLog("Scheduler paused");
    void syncTrayStatus();
  }

  function setResumeOnLaunch(enabled) {
    state.resumeOnLaunch = Boolean(enabled) && isDesktopRuntime();
    if (state.resumeOnLaunch) state.schedulerRequested = state.running;
    saveState();
    renderSession();
  }

  async function toggleMasterMute() {
    if (state.masterVolume > 0) {
      runtime.lastNonZeroMasterVolume = state.masterVolume;
      state.masterVolume = 0;
      soundEngine.setMasterVolume(0);
      saveState();
      renderSession();
      addLog("Master volume muted");
      void syncTrayStatus();
      return;
    }

    const restoredVolume = clamp(runtime.lastNonZeroMasterVolume || 0.75, 0.05, 1);
    state.masterVolume = restoredVolume;
    soundEngine.setMasterVolume(restoredVolume);
    saveState();
    renderSession();
    addLog(`Master volume restored (${Math.round(restoredVolume * 100)}%)`);
    void syncTrayStatus();
  }

  async function handleTrayCommand(command) {
    runtime.lastTrayCommand = command;
    runtime.lastTrayCommandAtMs = Date.now();
    renderSession();

    if (command === "toggle-running") {
      if (state.running) {
        stopScheduler();
        return;
      }
      try {
        await startScheduler();
      } catch (error) {
        console.error(error);
      }
      return;
    }

    if (command === "toggle-mute") {
      await toggleMasterMute();
      return;
    }

    if (command === "toggle-autostart") {
      try {
        const next = await toggleLaunchAtLogin();
        state.launchAtLogin = next;
        runtime.desktopAutostartSyncedAtMs = Date.now();
        runtime.desktopAutostartError = "";
        saveState();
        addLog(state.launchAtLogin ? "Launch at login enabled" : "Launch at login disabled");
      } catch (error) {
        runtime.desktopAutostartError = error?.message || "Unable to update launch at login";
        addLog(`Launch-at-login update failed: ${runtime.desktopAutostartError}`);
      }
      renderSession();
      void syncTrayStatus();
    }
  }

  async function refreshDesktopRuntime() {
    runtime.desktopRuntimeMode = isDesktopRuntime() ? "desktop" : "web";
    runtime.desktopAutostartSyncedAtMs = null;
    runtime.desktopAutostartError = "";
    runtime.trayConnected = false;

    if (!isDesktopRuntime()) {
      renderSession();
      return { desktop: false, trayConnected: false };
    }

    try {
      state.launchAtLogin = await getLaunchAtLoginEnabled();
      runtime.desktopAutostartSyncedAtMs = Date.now();
    } catch (error) {
      runtime.desktopAutostartError = error?.message || "Unable to read autostart status";
    }

    if (typeof runtime.unlistenTrayCommands === "function") {
      runtime.unlistenTrayCommands();
      runtime.unlistenTrayCommands = null;
    }
    try {
      runtime.unlistenTrayCommands = await listenForTrayCommands((command) => {
        void handleTrayCommand(command);
      });
      runtime.desktopTrayError = "";
    } catch (error) {
      runtime.desktopTrayError = error?.message || "Unable to connect tray commands";
    }
    runtime.trayConnected = typeof runtime.unlistenTrayCommands === "function";
    renderSession();
    void syncTrayStatus();
    return { desktop: true, trayConnected: runtime.trayConnected };
  }

  async function hydrateDesktopRuntime({ libraryReady = true } = {}) {
    runtime.libraryReady = libraryReady;
    const status = await refreshDesktopRuntime();
    if (!startupResumeAttempted) {
      startupResumeAttempted = true;
      if (status.desktop && state.resumeOnLaunch && state.schedulerRequested) {
        if (!libraryReady && needsImportedSoundLibrary()) {
          runtime.schedulerError = "Imported sounds could not load. Reload the app before starting chimes.";
          addLog(runtime.schedulerError);
          renderSession();
          return status;
        }
        try {
          await startScheduler({ automatic: true });
        } catch {
          // The visible scheduler error tells the user to grant audio permission.
        }
      }
    }
    return status;
  }

  return {
    setNextForInterval,
    startScheduler,
    stopScheduler,
    setResumeOnLaunch,
    reconcileSoundAvailability,
    toggleMasterMute,
    hydrateDesktopRuntime,
    refreshDesktopRuntime,
    syncTrayStatus
  };
}

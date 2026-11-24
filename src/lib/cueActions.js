export function createCueActions({
  state,
  saveState,
  renderLog,
  renderIntervals,
  renderTimers,
  ttsSpeaker,
  shouldSpeakCue,
  resolveTtsText,
  resolveCuePresetForPlayback,
  soundEngine,
  getPresetLabel,
  deliverCue = ({ play }) => play()
}) {
  // Session-only: previews and one-shot timers do not affect recurring rotation.
  const lastRecurringPresets = new Map();
  function addLog(message) {
    state.log.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      atMs: Date.now(),
      message
    });
    state.log = state.log.slice(-80);
    saveState();
    renderLog();
  }

  function maybeSpeakCue({ label, cueType, itemTtsEnabled = true }) {
    if (!ttsSpeaker.supported) {
      return;
    }
    if (
      !shouldSpeakCue({
        ttsEnabled: state.ttsEnabled,
        cueType,
        ttsRecurringEnabled: state.ttsRecurringEnabled,
        ttsOneShotEnabled: state.ttsOneShotEnabled,
        itemTtsEnabled
      })
    ) {
      return;
    }
    const text = resolveTtsText({
      label,
      customText: state.ttsCustomText,
      speakLabel: state.ttsSpeakLabel
    });
    if (!text) {
      return;
    }
    ttsSpeaker.speak({
      text,
      voiceUri: state.ttsVoiceUri,
      rate: state.ttsRate,
      volume: state.ttsVolume
    });
  }

  function setAllRecurringTtsEnabled(value) {
    for (const interval of state.intervals) {
      interval.ttsEnabled = value;
    }
    saveState();
    renderIntervals();
  }

  function setAllOneShotTtsEnabled(value) {
    for (const timer of state.oneShots) {
      timer.ttsEnabled = value;
    }
    saveState();
    renderTimers();
  }

  function fireCue({ label, cue, volume, cueType, itemTtsEnabled, scheduledAtMs, isCurrent, maxLatenessMs }) {
    const dispatchOffsetMs = Number.isFinite(scheduledAtMs) ? Date.now() - scheduledAtMs : undefined;
    const schedulerLatenessMs = Number.isFinite(scheduledAtMs) ? Math.max(0, Date.now() - scheduledAtMs) : undefined;
    const presetId = resolveCuePresetForPlayback(cue, {
      advance: false,
      excludePresetId: cueType === "recurring" && state.avoidConsecutiveRandomSounds ? lastRecurringPresets.get(cue.id) : null
    });
    const playback = deliverCue({ presetId, ...(Number.isFinite(scheduledAtMs) ? { targetAtMs: scheduledAtMs, isCurrent, maxLatenessMs } : {}), play: (onBufferScheduled, onAudioTiming, trace) => {
      // A prepared cue may be cancelled before its target; advance sequential
      // rotation only when playback is actually requested.
      if (cue.playbackMode !== "random" && cue.playbackMode !== "weighted-random" && Array.isArray(cue.presetIds)) {
        const index = cue.presetIds.indexOf(presetId);
        if (index >= 0) cue.playbackCursor = (index + 1) % cue.presetIds.length;
      }
      if (cueType === "recurring" && presetId) lastRecurringPresets.set(cue.id, presetId);
      const result = soundEngine.playPreset(presetId, volume, { onBufferScheduled, onAudioTiming, shouldPlay: isCurrent, native: true, trace: { ...trace, schedulerLatenessMs, dispatchOffsetMs, targetAtMs: scheduledAtMs } });
      void Promise.resolve(result).then((outcome) => {
        if (outcome === false || outcome === "cancelled" || outcome === "stale") return;
        maybeSpeakCue({ label, cueType, itemTtsEnabled });
        addLog(`${label} (${getPresetLabel(presetId)})`);
      }).catch(() => {});
      return result;
    } });
    return playback;
  }

  async function previewCue({ label, cue, volume, cueType, itemTtsEnabled = true, includeSpeech = true }) {
    await soundEngine.unlock();
    soundEngine.setMasterVolume(state.masterVolume);
    const presetId = resolveCuePresetForPlayback(cue, { advance: false });
    soundEngine.playPreset(presetId, volume);
    if (includeSpeech) {
      maybeSpeakCue({ label, cueType, itemTtsEnabled });
    }
    return presetId;
  }

  return {
    getLastRecurringPresetId: (id) => lastRecurringPresets.get(id) || null,
    addLog,
    maybeSpeakCue,
    previewCue,
    setAllRecurringTtsEnabled,
    setAllOneShotTtsEnabled,
    fireCue
  };
}

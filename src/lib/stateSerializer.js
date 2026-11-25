import { normalizeCompanionName } from "./companionName.js";

export function serializeState(state) {
  return {
    masterVolume: state.masterVolume,
    launchAtLogin: state.launchAtLogin,
    resumeOnLaunch: state.resumeOnLaunch === true,
    schedulerRequested: state.schedulerRequested === true,
    companionEnabled: state.companionEnabled === true,
    companionSuppressNonVoice: state.companionSuppressNonVoice === true,
    companionNameMode: state.companionNameMode === "custom" ? "custom" : "default",
    companionCustomName: normalizeCompanionName(state.companionCustomName),
    companionCharacterMotion: state.companionCharacterMotion !== false,
    companionMonitorId: state.companionMonitorId || "primary",
    companionCorner: state.companionCorner || "bottom-right",
    companionSize: [75, 100, 125, 150].includes(state.companionSize) ? state.companionSize : 100,
    avoidConsecutiveRandomSounds: state.avoidConsecutiveRandomSounds !== false,
    selectedProfileId: state.selectedProfileId,
    voiceCoverageMigrationVersion: state.voiceCoverageMigrationVersion === 2 ? 2 : state.voiceCoverageMigrationVersion === 1 ? 1 : 0,
    suppressLowerIntervalsOnCollision: state.suppressLowerIntervalsOnCollision,
    soundLibraryExpanded: state.soundLibraryExpanded,
    soundIntervalTags: state.soundIntervalTags,
    themeMode: state.themeMode,
    themePaletteId: state.themePaletteId,
    themePaletteMigrationVersion: 1,
    ttsEnabled: state.ttsEnabled,
    ttsSpeakLabel: state.ttsSpeakLabel,
    ttsCustomText: state.ttsCustomText,
    ttsVoiceUri: state.ttsVoiceUri,
    ttsRate: state.ttsRate,
    ttsVolume: state.ttsVolume,
    ttsRecurringEnabled: state.ttsRecurringEnabled,
    ttsOneShotEnabled: state.ttsOneShotEnabled,
    intervals: state.intervals,
    oneShots: state.oneShots,
    log: state.log
  };
}

import { applyProfileToIntervals, DEFAULT_SOUND_PROFILE_ID, getSoundProfileById } from "./soundProfiles.js";
import { BUILT_IN_VOICE_SET } from "./builtInVoices.js";
import { DEFAULT_THEME_MODE, DEFAULT_THEME_PALETTE_ID } from "./themes.js";

const DEFAULT_INTERVAL_MINUTES = [1, 5, 10, 15, 30, 60];

export function createDefaultIntervals() {
  const baseIntervals = DEFAULT_INTERVAL_MINUTES.map((minutes) => ({
    id: `interval-${minutes}`,
    minutes,
    label: `${minutes} minute${minutes > 1 ? "s" : ""}`,
    enabled: false,
    presetId: minutes >= 30 ? "grand_bell" : "soft_chime",
    presetIds: [minutes >= 30 ? "grand_bell" : "soft_chime"],
    playbackMode: "sequential",
    playbackCursor: 0,
    presetWeights: {},
    volume: minutes <= 5 ? 0.45 : 0.6,
    ttsEnabled: true
  }));
  return applyProfileToIntervals(baseIntervals, getSoundProfileById(DEFAULT_SOUND_PROFILE_ID));
}

export function createDefaultState() {
  return {
    running: false,
    masterVolume: 0.75,
    launchAtLogin: false,
    resumeOnLaunch: false,
    schedulerRequested: false,
    companionEnabled: false,
    companionSuppressNonVoice: false,
    companionNameMode: "default",
    companionCustomName: "",
    companionCharacterMotion: true,
    companionMonitorId: "primary",
    companionCorner: "bottom-right",
    companionSize: 100,
    selectedProfileId: DEFAULT_SOUND_PROFILE_ID,
    voiceCoverageMigrationVersion: BUILT_IN_VOICE_SET?.hasCompleteFrequencyCoverage ? 2 : BUILT_IN_VOICE_SET?.hasCompleteExpressionCoverage ? 1 : 0,
    suppressLowerIntervalsOnCollision: true,
    avoidConsecutiveRandomSounds: true,
    soundLibraryExpanded: false,
    soundIntervalTags: {},
    themeMode: DEFAULT_THEME_MODE,
    themePaletteId: DEFAULT_THEME_PALETTE_ID,
    themePaletteMigrationVersion: 1,
    ttsEnabled: false,
    ttsSpeakLabel: true,
    ttsCustomText: "",
    ttsVoiceUri: "",
    ttsRate: 1,
    ttsVolume: 0.8,
    ttsRecurringEnabled: true,
    ttsOneShotEnabled: true,
    intervals: createDefaultIntervals(),
    oneShots: [],
    log: []
  };
}

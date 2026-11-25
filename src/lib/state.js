import { normalizeCompanionName } from "./companionName.js";
import { DEFAULT_SOUND_PROFILE_ID } from "./soundProfiles.js";
import { BUILT_IN_VOICE_SET } from "./builtInVoices.js";
import { migrateLegacyVoiceDefaults } from "./voiceCoverageMigration.js";
import { normalizePlaybackMode } from "./presetPlayback.js";
import { normalizeThemeMode, normalizeThemePaletteId } from "./themes.js";
import { clampTtsRate, clampTtsVolume } from "./tts.js";
import { createDefaultIntervals, createDefaultState } from "./stateDefaults.js";
import {
  clamp,
  coerceNonNegativeInteger,
  coerceRangedNumber,
  isCustomId,
  isValidPresetId,
  normalizePresetIdSet,
  normalizePresetWeights
} from "./stateCoercion.js";
import { serializeState } from "./stateSerializer.js";
import { normalizeSoundIntervalOverrides } from "./soundIntervals.js";

export const STORAGE_KEY = "heartbeat-state-v1";
export { clamp, createDefaultIntervals, createDefaultState, serializeState };

export function normalizeState(parsed, defaults, presets, validProfileIds = [DEFAULT_SOUND_PROFILE_ID], options = {}) {
  if (!parsed || typeof parsed !== "object") {
    return defaults;
  }

  const intervalById = new Map(
    Array.isArray(parsed.intervals) ? parsed.intervals.map((interval) => [interval.id, interval]) : []
  );
  const intervals = defaults.intervals.map((defaultInterval) => {
    const incoming = intervalById.get(defaultInterval.id) || {};
    const incomingPresetId =
      typeof incoming.presetId === "string" && incoming.presetId.trim() ? incoming.presetId.trim() : null;
    const resolvedPresetId =
      incomingPresetId && isValidPresetId(presets, incomingPresetId) ? incomingPresetId : defaultInterval.presetId;
    const presetIds = normalizePresetIdSet(incoming.presetIds, resolvedPresetId, presets);
    return {
      ...defaultInterval,
      enabled: Boolean(incoming.enabled),
      presetId: resolvedPresetId,
      presetIds,
      playbackMode: normalizePlaybackMode(incoming.playbackMode, intervalById.has(defaultInterval.id) ? "sequential" : defaultInterval.playbackMode),
      playbackCursor: coerceNonNegativeInteger(incoming.playbackCursor, defaultInterval.playbackCursor),
      presetWeights: normalizePresetWeights(incoming.presetWeights, presetIds),
      volume: coerceRangedNumber(incoming.volume, defaultInterval.volume, 0, 1),
      ttsEnabled: typeof incoming.ttsEnabled === "boolean" ? incoming.ttsEnabled : defaultInterval.ttsEnabled
    };
  });
  const voiceMigration = migrateLegacyVoiceDefaults(parsed, intervals, BUILT_IN_VOICE_SET, options);

  const oneShots = Array.isArray(parsed.oneShots)
    ? parsed.oneShots
        .map((timer) => {
          const presetId =
            (typeof timer.presetId === "string" &&
              timer.presetId.trim() &&
              isValidPresetId(presets, timer.presetId.trim()) &&
              timer.presetId.trim()) ||
            "soft_chime";
          const presetIds = normalizePresetIdSet(timer.presetIds, presetId, presets);
          return {
            id: timer.id,
            label: typeof timer.label === "string" && timer.label.trim() ? timer.label.trim() : "One-shot timer",
            targetAtMs: Number(timer.targetAtMs),
            createdAtMs: Number(timer.createdAtMs) || null,
            presetId,
            presetIds,
            playbackMode: normalizePlaybackMode(timer.playbackMode, "sequential"),
            playbackCursor: coerceNonNegativeInteger(timer.playbackCursor, 0),
            presetWeights: normalizePresetWeights(timer.presetWeights, presetIds),
            volume: coerceRangedNumber(timer.volume, 0.8, 0, 1),
            ttsEnabled: typeof timer.ttsEnabled === "boolean" ? timer.ttsEnabled : true,
            active: Boolean(timer.active),
            firedAtMs: Number(timer.firedAtMs) || null
          };
        })
        .filter((timer) => Number.isFinite(timer.targetAtMs))
    : [];

  return {
    running: false,
    masterVolume: coerceRangedNumber(parsed.masterVolume, defaults.masterVolume, 0, 1),
    launchAtLogin: typeof parsed.launchAtLogin === "boolean" ? parsed.launchAtLogin : defaults.launchAtLogin,
    resumeOnLaunch: parsed.resumeOnLaunch === true,
    schedulerRequested: parsed.schedulerRequested === true,
    companionEnabled: parsed.companionEnabled === true,
    companionSuppressNonVoice: parsed.companionSuppressNonVoice === true,
    companionNameMode: parsed.companionNameMode === "custom" ? "custom" : "default",
    companionCustomName: normalizeCompanionName(parsed.companionCustomName),
    companionCharacterMotion: typeof parsed.companionCharacterMotion === "boolean" ? parsed.companionCharacterMotion : true,
    companionMonitorId: typeof parsed.companionMonitorId === "string" && parsed.companionMonitorId.length > 0 && parsed.companionMonitorId.length <= 128 ? parsed.companionMonitorId : "primary",
    companionCorner: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(parsed.companionCorner) ? parsed.companionCorner : "bottom-right",
    companionSize: [75, 100, 125, 150].includes(parsed.companionSize) ? parsed.companionSize : 100,
    avoidConsecutiveRandomSounds: typeof parsed.avoidConsecutiveRandomSounds === "boolean"
      ? parsed.avoidConsecutiveRandomSounds : true,
    selectedProfileId:
      typeof parsed.selectedProfileId === "string" &&
      (validProfileIds.includes(parsed.selectedProfileId) || isCustomId(parsed.selectedProfileId) || parsed.selectedProfileId === "dry_time_checks")
        ? parsed.selectedProfileId
        : defaults.selectedProfileId,
    voiceCoverageMigrationVersion: voiceMigration.version,
    suppressLowerIntervalsOnCollision:
      typeof parsed.suppressLowerIntervalsOnCollision === "boolean"
        ? parsed.suppressLowerIntervalsOnCollision
        : defaults.suppressLowerIntervalsOnCollision,
    soundLibraryExpanded:
      typeof parsed.soundLibraryExpanded === "boolean" ? parsed.soundLibraryExpanded : defaults.soundLibraryExpanded,
    soundIntervalTags: normalizeSoundIntervalOverrides(parsed.soundIntervalTags),
    themeMode: normalizeThemeMode(parsed.themeMode),
    themePaletteId: normalizeThemePaletteId(parsed.themePaletteId === "dawn" && !(Number(parsed.themePaletteMigrationVersion) >= 1) ? "lilac" : parsed.themePaletteId),
    themePaletteMigrationVersion: 1,
    ttsEnabled: typeof parsed.ttsEnabled === "boolean" ? parsed.ttsEnabled : defaults.ttsEnabled,
    ttsSpeakLabel: typeof parsed.ttsSpeakLabel === "boolean" ? parsed.ttsSpeakLabel : defaults.ttsSpeakLabel,
    ttsCustomText: typeof parsed.ttsCustomText === "string" ? parsed.ttsCustomText : defaults.ttsCustomText,
    ttsVoiceUri: typeof parsed.ttsVoiceUri === "string" ? parsed.ttsVoiceUri : defaults.ttsVoiceUri,
    ttsRate: clampTtsRate(Number(parsed.ttsRate)),
    ttsVolume: clampTtsVolume(Number(parsed.ttsVolume)),
    ttsRecurringEnabled:
      typeof parsed.ttsRecurringEnabled === "boolean" ? parsed.ttsRecurringEnabled : defaults.ttsRecurringEnabled,
    ttsOneShotEnabled:
      typeof parsed.ttsOneShotEnabled === "boolean" ? parsed.ttsOneShotEnabled : defaults.ttsOneShotEnabled,
    intervals: voiceMigration.intervals,
    oneShots,
    log: Array.isArray(parsed.log) ? parsed.log.slice(-80) : []
  };
}

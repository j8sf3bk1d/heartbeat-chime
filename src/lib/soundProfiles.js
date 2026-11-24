import { BUILT_IN_VOICE_SET } from "./builtInVoices.js";
import { THEMED_SOUNDS, THEMED_PROFILES } from "./themedSounds.js";

export const PRESETS = [
  ...(BUILT_IN_VOICE_SET?.presets || []),
  ...THEMED_SOUNDS,
  {
    id: "grand_bell",
    label: "Grand Bell",
    description: "Long resonant bell strike.",
    tags: ["bell", "clock", "long"]
  },
  {
    id: "soft_chime",
    label: "Soft Chime",
    description: "Gentle three-note cue.",
    tags: ["chime", "soft", "calm"]
  },
  {
    id: "wood_tick",
    label: "Wood Tick",
    description: "Short percussive click.",
    tags: ["tick", "short", "metronome"]
  },
  {
    id: "bright_ping",
    label: "Bright Ping",
    description: "Sharp high-frequency alert.",
    tags: ["ping", "bright", "alert"]
  }
];

export const SOUND_PROFILES = [
  ...(BUILT_IN_VOICE_SET ? [{
    id: "dry_time_checks",
    label: "Dry Time Checks",
    description: "Varied spoken time checks with a teasing edge.",
    intervalPresetByMinutes: {
      ...BUILT_IN_VOICE_SET.intervalPresetByMinutes,
      10: "soft_chime",
      30: "grand_bell"
    },
    playbackMode: "random",
    relativeDefaultPresetId: "soft_chime",
    absoluteDefaultPresetId: "grand_bell"
  }] : []),
  ...THEMED_PROFILES,
  {
    id: "clocktower",
    label: "Clocktower",
    description: "Traditional bell hierarchy with steady lower ticks.",
    intervalPresetByMinutes: {
      1: "wood_tick",
      5: "soft_chime",
      10: "soft_chime",
      15: "bright_ping",
      30: "grand_bell",
      60: "grand_bell"
    },
    relativeDefaultPresetId: "soft_chime",
    absoluteDefaultPresetId: "grand_bell"
  },
  {
    id: "focus",
    label: "Deep Focus",
    description: "Low-distraction cues with subdued short intervals.",
    intervalPresetByMinutes: {
      1: "wood_tick",
      5: "wood_tick",
      10: "soft_chime",
      15: "soft_chime",
      30: "bright_ping",
      60: "grand_bell"
    },
    relativeDefaultPresetId: "soft_chime",
    absoluteDefaultPresetId: "bright_ping"
  },
  {
    id: "arcade",
    label: "Arcade Energy",
    description: "High-contrast bright cues for energetic sessions.",
    intervalPresetByMinutes: {
      1: "bright_ping",
      5: "bright_ping",
      10: "soft_chime",
      15: "bright_ping",
      30: "grand_bell",
      60: "grand_bell"
    },
    relativeDefaultPresetId: "bright_ping",
    absoluteDefaultPresetId: "grand_bell"
  }
];

export const DEFAULT_SOUND_PROFILE_ID = BUILT_IN_VOICE_SET ? "dry_time_checks" : "clocktower";

export function getSoundProfileById(profileId) {
  return SOUND_PROFILES.find((profile) => profile.id === profileId) || SOUND_PROFILES[0];
}

export function applyProfileToIntervals(intervals, profile) {
  return intervals.map((interval) => {
    const mappedPreset = profile.intervalPresetByMinutes[interval.minutes];
    if (!mappedPreset) {
      return interval;
    }
    const presetIds = Array.isArray(mappedPreset) ? mappedPreset : [mappedPreset];
    if (!presetIds.length) return interval;
    return {
      ...interval,
      presetId: presetIds[0],
      presetIds: [...presetIds],
      ...(profile.playbackMode ? { playbackMode: profile.playbackMode } : {}),
      playbackCursor: 0,
      presetWeights: {}
    };
  });
}

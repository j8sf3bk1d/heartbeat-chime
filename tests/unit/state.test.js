import { describe, expect, it } from "vitest";
import { createDefaultState, normalizeState, serializeState } from "../../src/lib/state.js";

const PRESETS = [
  { id: "grand_bell", label: "Grand Bell" },
  { id: "soft_chime", label: "Soft Chime" },
  { id: "bright_ping", label: "Bright Ping" },
  { id: "wood_tick", label: "Wood Tick" }
];

describe("state normalization", () => {
  it("preserves valid zero values instead of replacing with defaults", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        masterVolume: 0,
        intervals: [{ id: "interval-1", enabled: true, volume: 0, presetId: "soft_chime" }]
      },
      defaults,
      PRESETS
    );
    expect(normalized.masterVolume).toBe(0);
    expect(normalized.intervals.find((interval) => interval.id === "interval-1")?.volume).toBe(0);
  });

  it("falls back safely for malformed values", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        masterVolume: "not-a-number",
        intervals: [{ id: "interval-5", enabled: true, volume: 42, presetId: "unknown" }],
        oneShots: [{ targetAtMs: "abc", volume: -5 }]
      },
      defaults,
      PRESETS
    );
    const fiveMinute = normalized.intervals.find((interval) => interval.id === "interval-5");
    expect(normalized.masterVolume).toBe(defaults.masterVolume);
    expect(fiveMinute?.volume).toBe(1);
    expect(fiveMinute?.presetId).toBe(defaults.intervals.find((interval) => interval.id === "interval-5")?.presetId);
    expect(normalized.oneShots).toHaveLength(0);
  });

  it("normalizes profile and suppression settings with safe defaults", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        selectedProfileId: "unknown-mode",
        launchAtLogin: "true",
        suppressLowerIntervalsOnCollision: "yes",
        themeMode: "neon",
        themePaletteId: "ultra",
        ttsEnabled: "true",
        ttsSpeakLabel: "sometimes",
        ttsCustomText: 1234,
        ttsVoiceUri: 5678,
        ttsRate: 9
      },
      defaults,
      PRESETS,
      ["clocktower", "focus", "arcade"]
    );
    expect(normalized.selectedProfileId).toBe(defaults.selectedProfileId);
    expect(normalized.launchAtLogin).toBe(defaults.launchAtLogin);
    expect(normalized.suppressLowerIntervalsOnCollision).toBe(defaults.suppressLowerIntervalsOnCollision);
    expect(normalized.themeMode).toBe(defaults.themeMode);
    expect(normalized.themePaletteId).toBe(defaults.themePaletteId);
    expect(normalized.ttsEnabled).toBe(defaults.ttsEnabled);
    expect(normalized.ttsSpeakLabel).toBe(defaults.ttsSpeakLabel);
    expect(normalized.ttsCustomText).toBe(defaults.ttsCustomText);
    expect(normalized.ttsVoiceUri).toBe(defaults.ttsVoiceUri);
    expect(normalized.ttsRate).toBe(1.3);
  });

  it("preserves custom profile and preset ids for imported packs", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        selectedProfileId: "custom:anime:focus",
        intervals: [{ id: "interval-1", enabled: true, volume: 0.5, presetId: "custom:anime:tick" }],
        oneShots: [{ id: "a", label: "x", targetAtMs: 9999999999999, presetId: "custom:anime:bell", active: true }]
      },
      defaults,
      PRESETS,
      ["clocktower", "focus", "arcade"]
    );
    expect(normalized.selectedProfileId).toBe("custom:anime:focus");
    expect(normalized.intervals.find((interval) => interval.id === "interval-1")?.presetId).toBe("custom:anime:tick");
    expect(normalized.oneShots[0]?.presetId).toBe("custom:anime:bell");
  });

  it("normalizes layered tts settings and item-level toggles", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        ttsVolume: -4,
        ttsRecurringEnabled: false,
        ttsOneShotEnabled: "yes",
        intervals: [{ id: "interval-1", ttsEnabled: false }],
        oneShots: [
          {
            id: "timer-a",
            label: "Break",
            targetAtMs: 9999999999999,
            presetId: "soft_chime",
            ttsEnabled: false,
            active: true
          },
          {
            id: "timer-b",
            label: "Refill",
            targetAtMs: 9999999999999,
            presetId: "soft_chime",
            active: true
          }
        ]
      },
      defaults,
      PRESETS
    );

    expect(normalized.ttsVolume).toBe(0);
    expect(normalized.ttsRecurringEnabled).toBe(false);
    expect(normalized.ttsOneShotEnabled).toBe(defaults.ttsOneShotEnabled);
    expect(normalized.intervals.find((interval) => interval.id === "interval-1")?.ttsEnabled).toBe(false);
    expect(normalized.oneShots.find((timer) => timer.id === "timer-a")?.ttsEnabled).toBe(false);
    expect(normalized.oneShots.find((timer) => timer.id === "timer-b")?.ttsEnabled).toBe(true);
  });

  it("preserves valid launch-at-login boolean setting", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        launchAtLogin: true
      },
      defaults,
      PRESETS
    );
    expect(normalized.launchAtLogin).toBe(true);
  });

  it("normalizes multi-clip fields with fallback behavior", () => {
    const defaults = createDefaultState();
    const normalized = normalizeState(
      {
        intervals: [
          {
            id: "interval-1",
            presetId: "wood_tick",
            presetIds: ["wood_tick", "bright_ping", "unknown", "wood_tick"],
            playbackMode: "random",
            playbackCursor: 4,
            presetWeights: { wood_tick: 2, bright_ping: "3", unknown: 9, bad: -1 }
          },
          {
            id: "interval-5",
            presetId: "soft_chime",
            presetIds: [],
            playbackMode: "chaos",
            playbackCursor: -2,
            presetWeights: { soft_chime: -3 }
          }
        ],
        oneShots: [
          {
            id: "timer-a",
            label: "Break",
            targetAtMs: 9999999999999,
            presetId: "soft_chime",
            presetIds: ["bright_ping", "soft_chime"],
            playbackMode: "random",
            playbackCursor: 1,
            presetWeights: { bright_ping: 4, soft_chime: 1 },
            active: true
          },
          {
            id: "timer-b",
            label: "Refill",
            targetAtMs: 9999999999999,
            presetId: "wood_tick",
            presetIds: ["invalid"],
            playbackMode: "nope",
            playbackCursor: -1,
            presetWeights: { wood_tick: 3 },
            active: true
          }
        ]
      },
      defaults,
      PRESETS
    );

    const oneMinute = normalized.intervals.find((interval) => interval.id === "interval-1");
    const fiveMinute = normalized.intervals.find((interval) => interval.id === "interval-5");
    const timerA = normalized.oneShots.find((timer) => timer.id === "timer-a");
    const timerB = normalized.oneShots.find((timer) => timer.id === "timer-b");

    expect(oneMinute?.presetIds).toEqual(["wood_tick", "bright_ping"]);
    expect(oneMinute?.playbackMode).toBe("random");
    expect(oneMinute?.playbackCursor).toBe(4);
    expect(oneMinute?.presetWeights).toEqual({ wood_tick: 2, bright_ping: 3 });

    expect(fiveMinute?.presetIds).toEqual(["soft_chime"]);
    expect(fiveMinute?.playbackMode).toBe("sequential");
    expect(fiveMinute?.playbackCursor).toBe(0);
    expect(fiveMinute?.presetWeights).toEqual({});

    expect(timerA?.presetIds).toEqual(["bright_ping", "soft_chime"]);
    expect(timerA?.playbackMode).toBe("random");
    expect(timerA?.playbackCursor).toBe(1);
    expect(timerA?.presetWeights).toEqual({ bright_ping: 4, soft_chime: 1 });

    expect(timerB?.presetIds).toEqual(["wood_tick"]);
    expect(timerB?.playbackMode).toBe("sequential");
    expect(timerB?.playbackCursor).toBe(0);
    expect(timerB?.presetWeights).toEqual({ wood_tick: 3 });
  });

  it("migrates old settings to an explicit desktop resume opt-in", () => {
    const defaults = createDefaultState();
    const old = normalizeState({ launchAtLogin: true, running: true }, defaults, PRESETS);
    expect(old.resumeOnLaunch).toBe(false);
    expect(old.schedulerRequested).toBe(false);
    expect(old.running).toBe(false);
    const optedIn = normalizeState({ resumeOnLaunch: true, schedulerRequested: true }, defaults, PRESETS);
    expect(serializeState(optedIn)).toMatchObject({ resumeOnLaunch: true, schedulerRequested: true });
    expect(optedIn.running).toBe(false);
    const malformed = normalizeState({ resumeOnLaunch: "true", schedulerRequested: 1 }, defaults, PRESETS);
    expect(malformed.resumeOnLaunch).toBe(false);
    expect(malformed.schedulerRequested).toBe(false);
  });

  it("serializes only persisted fields", () => {
    const defaults = createDefaultState();
    const serialized = serializeState({
      ...defaults,
      running: true,
      masterVolume: 0.6
    });

    expect(serialized.masterVolume).toBe(0.6);
    expect(serialized).not.toHaveProperty("running");
  });

  it("defaults character motion on and preserves an explicit preference across exports", () => {
    const defaults = createDefaultState();
    expect(defaults.companionCharacterMotion).toBe(true);
    expect(normalizeState({}, defaults, PRESETS).companionCharacterMotion).toBe(true);
    expect(normalizeState({ companionCharacterMotion: "false" }, defaults, PRESETS).companionCharacterMotion).toBe(true);
    const selected = normalizeState({ companionCharacterMotion: false }, defaults, PRESETS);
    expect(selected.companionCharacterMotion).toBe(false);
    expect(serializeState(selected).companionCharacterMotion).toBe(false);
    expect(normalizeState(serializeState(selected), defaults, PRESETS).companionCharacterMotion).toBe(false);
  });

  it("migrates saved legacy Dawn once while preserving deliberate Dawn choices and exports", () => {
    const defaults = createDefaultState();
    const migrated = normalizeState({ themePaletteId: "dawn", masterVolume: 0.23 }, defaults, PRESETS);
    expect(migrated.themePaletteId).toBe("lilac");
    expect(migrated.masterVolume).toBe(0.23);
    expect(migrated.themePaletteMigrationVersion).toBe(1);
    const exported = serializeState({ ...migrated, themePaletteId: "dawn" });
    expect(normalizeState(exported, defaults, PRESETS).themePaletteId).toBe("dawn");
    expect(normalizeState({ themePaletteId: "ember" }, defaults, PRESETS).themePaletteId).toBe("ember");
  });
});

import { getBuiltInVoiceMetadata } from "./lib/builtInVoices.js";
import { normalizeCompanionName } from "./lib/companionName.js";
import { initializeNavigation } from "./lib/navigation.js";
import { serializeState, STORAGE_KEY, clamp, createDefaultState, normalizeState } from "./lib/state.js";
import { computeNextAligned, computeRecurringCatchUp, selectRecurringEntries } from "./lib/timing.js";
import { PRESETS, SOUND_PROFILES, applyProfileToIntervals } from "./lib/soundProfiles.js";
import { PLAYBACK_MODES, normalizePlaybackMode } from "./lib/presetPlayback.js";
import { THEME_MODES, THEME_PALETTES, resolveAppliedMode } from "./lib/themes.js";
import { computeTimerProgressRatio } from "./lib/timers.js";
import { createRuntimeScheduler } from "./lib/runtimeScheduler.js";
import { createUiRenderers } from "./lib/uiRenderers.js";
import { registerIntervalGridHandlers } from "./lib/intervalGridHandlers.js";
import { registerLibraryHandlers } from "./lib/libraryHandlers.js";
import { registerTimerHandlers } from "./lib/timerHandlers.js";
import { registerSessionHandlers } from "./lib/sessionHandlers.js";
import { SoundEngine } from "./lib/soundEngine.js";
import { listCharacterPacks, getCharacterPack, importCharacterPack, replaceCharacterPack, selectedCharacter, selectCharacter, restoreCharacterLibrary } from "./lib/characterStore.js";
import { createAudioDiagnostics } from "./lib/audioDiagnostics.js";
import { createAudioAnomalies } from "./lib/audioAnomalies.js";
import { BUILT_IN_VOICE_SET, isKnownBuiltInVoiceId } from "./lib/builtInVoices.js";
import { createCueSoundHelpers, getPresetRepeatGroup } from "./lib/cueSoundHelpers.js";
import { createStatePersistence, downloadJsonFile, formatClock, formatDateTime, makeExportFilename } from "./lib/configState.js";
import { prepareConfigImport, commitConfigImport } from "./lib/configImport.js";
import { createPortableBackup, parsePortableBackup, restorePortableLibrary } from "./lib/portableBackup.js";
import { createModelHelpers } from "./lib/modelHelpers.js";
import { createCueActions } from "./lib/cueActions.js";
import { createCompanionController, createCompanionPreviewPicker, prewarmCompanionIfEnabled } from "./lib/companion.js";
import {
  applyThemeToDocument as applyThemeToDocumentHelper,
  getThemeModeLabel,
  renderVoiceOptions as renderVoiceOptionsHelper
} from "./lib/themeHelpers.js";
import { buildSoundPackFromAudioFiles, buildSoundPackFromFiles } from "./lib/soundPackImport.js";
import { clampTtsRate, clampTtsVolume, createTtsSpeaker, groupVoicesByLanguage, resolveTtsText, shouldSpeakCue } from "./lib/tts.js";
import {
  emitTrayStatus,
  getTimingLogPath,
  configureTimingLog,
  appendTimingLog,
  setDiagnosticDisplay,
  publishDiagnosticEvent,
  publishDiagnosticCue,
  playNativeDiagnostic,
  playNativeClip,
  listOverlayMonitors,
  prewarmCompanionOverlay,
  showCompanionOverlay,
  hideCompanionOverlay,
  sendCompanionSpeech,
  sendCompanionTiming,
  setCompanionCharacterMotion,
  getLaunchAtLoginEnabled,
  isDesktopRuntime,
  listenForTrayCommands,
  listenForCharacterLoaded,
  setLaunchAtLoginEnabled,
  toggleLaunchAtLogin
} from "./lib/desktopBridge.js";
import {
  deleteSoundPack,
  getSoundPresetBlob,
  isAudioStoreAvailable,
  loadSoundLibrary,
  saveSoundPack
} from "./lib/audioStore.js";

function saveState(candidate = state) {
  return statePersistence.save(serializeState(candidate));
}

async function applyImportedState(importPayload, { hydrateAfterCommit = false, onCommit = () => {} } = {}) {
  const normalized = prepareConfigImport(importPayload, {
    state, createDefaultState, normalizeState,
    presets: getAllPresets(), profileIds: getAllProfiles().map((profile) => profile.id)
  });
  const wasRunning = state.running || runtime.schedulerStarting;
  commitConfigImport(normalized, {
    state, saveState, shouldStop: wasRunning,
    stopScheduler: runtimeScheduler.stopScheduler
  });
  if (!state.companionEnabled) void companion.dismiss({ cancelPlayback: false });
  else void prewarmCompanion();
  void companion.setCharacterMotion(state.companionCharacterMotion !== false);
  onCommit();
  // A full backup adds audio before settings are committed. Hydrate it only
  // after that commit, so a failed settings write leaves live state untouched.
  const libraryReady = hydrateAfterCommit ? await hydrateCustomLibrary({ announceErrors: true }) : true;
  runtime.lastNonZeroMasterVolume = state.masterVolume > 0 ? state.masterVolume : runtime.lastNonZeroMasterVolume;
  soundEngine.setMasterVolume(state.masterVolume);
  reconcileStateWithAvailableAssets();
  saveState();
  renderAll({ forceSpeechDraft: true });
  void runtimeScheduler.syncTrayStatus();

  let restartFailed = false;
  if (wasRunning && libraryReady) {
    try {
      await runtimeScheduler.startScheduler();
    } catch (error) {
      console.error(error);
      restartFailed = true;
      addLog("Config imported, but scheduler restart failed. Press Start.");
    }
  }
  return { libraryReady, restartFailed };
}

let recoveryCopy = null;
const storageWarning = document.getElementById("storage-warning");
const recoveryDownload = document.getElementById("storage-recovery-download");
const recoveryDismiss = document.getElementById("storage-recovery-dismiss");
const statePersistence = createStatePersistence({
  storageKey: STORAGE_KEY,
  onStatus: ({ message, recovery, canDismiss }) => {
    recoveryCopy = recovery;
    document.getElementById("storage-warning-message").textContent = message;
    recoveryDownload.hidden = !recovery;
    recoveryDismiss.hidden = !recovery || !canDismiss;
    storageWarning.hidden = false;
  }
});
recoveryDownload.addEventListener("click", () => {
  if (!recoveryCopy) return;
  const url = URL.createObjectURL(new Blob([recoveryCopy.raw], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "heartbeat-config-recovery.txt";
  anchor.click();
  URL.revokeObjectURL(url);
});
recoveryDismiss.addEventListener("click", () => {
  if (statePersistence.dismissRecovery()) storageWarning.hidden = true;
});
const state = statePersistence.load({
  createDefaultState,
  soundProfiles: SOUND_PROFILES,
  normalizeState,
  presets: PRESETS
});
const customLibrary = {
  packs: [],
  presets: [],
  profiles: [],
  missingPresetIds: new Set()
};
const {
  isBuiltInPresetId,
  getAllPresets,
  getAllProfiles,
  hasPresetId,
  getPresetById,
  getPresetLabel,
  getProfileById,
  getCurrentProfile,
  getRelativeDefaultPresetId,
  getAbsoluteDefaultPresetId,
  makePresetOptions,
  makePresetSetOptions
} = createModelHelpers({
  state,
  customLibrary,
  presets: PRESETS,
  soundProfiles: SOUND_PROFILES
});

const ttsSpeaker = createTtsSpeaker();
const soundEngine = new SoundEngine({
  customBlobLoader: async (presetId) => getSoundPresetBlob(presetId),
  nativeClipPlayer: isDesktopRuntime() && /Mac/.test(navigator.platform) ? playNativeClip : null
});
const diagnosticsEnabled = document.getElementById("audio-diagnostics-enabled");
const diagnosticsStatus = document.getElementById("audio-diagnostics-status");
const diagnosticsOutput = document.getElementById("audio-diagnostics-output");
const anomalyOutput = document.getElementById("audio-anomalies-output");
const anomalyStatus = document.getElementById("audio-anomalies-status");
const nativeTiming = isDesktopRuntime();
const audioLogEnabled = document.getElementById("audio-log-enabled");
const audioLogFiles = document.getElementById("audio-log-files");
const audioLogMode = document.getElementById("audio-log-mode");
let audioLogSettings = { enabled: true, files: 5 };
try {
  const saved = JSON.parse(localStorage.getItem('heartbeat.audio-log-settings.v1') || '{}');
  audioLogSettings = { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true, files: [2, 5, 10].includes(saved.files) ? saved.files : 5 };
} catch { /* Defaults are safe if local storage is unavailable. */ }
audioLogEnabled.checked = audioLogSettings.enabled;
audioLogFiles.value = String(audioLogSettings.files);
document.getElementById("audio-log-file-controls").hidden = !nativeTiming;
audioLogMode.textContent = nativeTiming ? "Desktop writes JSON lines directly to the log file. The preview is a separate local cache (up to 30 days or 50,000 entries). Clearing it does not delete log files." : "Browser mode keeps a local history for up to 30 days or 50,000 entries; no desktop log file is available.";
let logConfigurationError = '';
let logSettingsError = '';
let logConfiguration = nativeTiming ? configureTimingLog(audioLogSettings.enabled, audioLogSettings.files).then(() => true, () => { logConfigurationError = 'Could not configure the timing log file.'; return false; }) : Promise.resolve(true);
if (nativeTiming) void getTimingLogPath().then((path) => { document.getElementById("audio-log-path").textContent = `Log file: ${path}`; }).catch(() => { document.getElementById("audio-log-path").textContent = 'Could not locate the timing log file.'; });
let diagnosticDisplayEnabled = false;
const diagnosticDisplayToggle = document.getElementById("diagnostic-display-enabled");
const diagnosticDisplayStatus = document.getElementById("diagnostic-display-status");
diagnosticDisplayToggle.disabled = !nativeTiming;
function displayDiagnosticEvent(event) {
  if (!diagnosticDisplayEnabled || !['cue-lifecycle', 'context-refresh'].includes(event.kind)) return;
  const { kind, stage, backend, cueId, contextId, atMs, targetOffsetMs, estimatedOutputOffsetMs, wallElapsedMs, expectedMs, result } = event;
  void publishDiagnosticEvent({ kind, stage: stage || null, backend: backend || null, cueId: cueId || null, contextId, atMs, targetOffsetMs: targetOffsetMs ?? null, estimatedOutputOffsetMs: estimatedOutputOffsetMs ?? null, wallElapsedMs: wallElapsedMs ?? null, expectedMs: expectedMs ?? null, result: result || null }).catch(() => {});
}
const anomalies = createAudioAnomalies({ onEvent: displayDiagnosticEvent, enabled: audioLogSettings.enabled, appendFile: nativeTiming ? async (event) => { if (!audioLogSettings.enabled) return; if (!await logConfiguration) throw new Error('Timing file configuration failed'); await appendTimingLog(event); } : null, onChange: refreshAnomalies });
function refreshAnomalies() {
  anomalyStatus.textContent = logSettingsError || logConfigurationError || anomalies.getError() || `Showing ${anomalies.getCount()} recent timeline entries; ${anomalies.getLegacyCount()} older flags retained.`;
  anomalyOutput.value = anomalies.getText();
}
refreshAnomalies();
function updateAudioLogSettings() {
  audioLogSettings = { enabled: audioLogEnabled.checked, files: Number(audioLogFiles.value) };
  anomalies.setEnabled(audioLogSettings.enabled);
  soundEngine.onAudioPlaybackDiagnostic = audioLogSettings.enabled ? (ctx, measurement) => anomalies.recordPlayback(ctx, measurement) : null;
  try { localStorage.setItem('heartbeat.audio-log-settings.v1', JSON.stringify(audioLogSettings)); logSettingsError = ''; } catch { logSettingsError = 'Could not save timing log settings; they may reset on restart.'; }
  if (nativeTiming) logConfiguration = logConfiguration.then(() => configureTimingLog(audioLogSettings.enabled, audioLogSettings.files)).then(() => { logConfigurationError = ''; refreshAnomalies(); return true; }, () => { logConfigurationError = 'Could not configure the timing log file.'; refreshAnomalies(); return false; });
  refreshAnomalies();
}
audioLogEnabled.addEventListener('change', () => {
  if (!audioLogEnabled.checked && diagnosticDisplayEnabled) {
    diagnosticDisplayEnabled = false; diagnosticDisplayToggle.checked = false;
    void setDiagnosticDisplay(false, state.companionMonitorId).catch(() => {});
  }
  updateAudioLogSettings();
});
diagnosticDisplayToggle.addEventListener("change", async () => {
  const enabled = diagnosticDisplayToggle.checked;
  if (enabled && !audioLogEnabled.checked) { audioLogEnabled.checked = true; updateAudioLogSettings(); }
  diagnosticDisplayToggle.disabled = true;
  try {
    await setDiagnosticDisplay(enabled, state.companionMonitorId);
    diagnosticDisplayEnabled = enabled;
    diagnosticDisplayStatus.textContent = enabled ? "Showing cue identity and app timing. Line text appears on screen; output time is an estimate." : "Shows cue identity and timing on the companion display. Line text appears on screen; enables timing history.";
  } catch {
    diagnosticDisplayEnabled = false; diagnosticDisplayToggle.checked = false;
    diagnosticDisplayStatus.textContent = "Could not show the diagnostic display.";
  } finally { diagnosticDisplayToggle.disabled = !nativeTiming; }
});
audioLogFiles.addEventListener('change', updateAudioLogSettings);
const abWeb = document.getElementById("audio-ab-web"), abNative = document.getElementById("audio-ab-native"), abStatus = document.getElementById("audio-ab-status");
abWeb.disabled = abNative.disabled = !nativeTiming;
async function runAudioComparison(backend) {
  abWeb.disabled = abNative.disabled = true;
  if (!audioLogEnabled.checked) { audioLogEnabled.checked = true; updateAudioLogSettings(); }
  const life = anomalies.startCue(() => backend === "native" ? null : soundEngine.ctx, undefined, backend);
  life("dispatch");
  try {
    const id = "laura-minute-01";
    const url = BUILT_IN_VOICE_SET?.getUrl(id);
    if (!url) throw new Error("Bundled comparison clip is unavailable.");
    let duration = 4500;
    if (backend === "web-audio") {
      if (!await soundEngine.unlock()) throw new Error("Audio needs to be unlocked.");
      soundEngine.setMasterVolume(state.masterVolume);
      life("play-request");
      const played = await soundEngine.playPreset(id, 0.85, { trace: { lifecycle: life } });
      if (played !== true) throw new Error("Web Audio could not play the test.");
      duration = (soundEngine.builtInBufferCache.get(id)?.duration || 4.5) * 1000;
    } else {
      life("play-request");
      const result = await playNativeDiagnostic(Math.max(0, Math.min(1, state.masterVolume * 0.85)));
      if (!result || !Number.isFinite(result.startedAtMs)) throw new Error("Native audio could not play the test.");
      life("source-start", { startedAtMs: result.startedAtMs });
      duration = result.durationMs || duration;
    }
    life("delivery-end", { result: "success" });
    abStatus.textContent = `${backend === "native" ? "Native" : "Web Audio"} test started. Use the output probe to measure it.`;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.min(duration + 500, 30000))));
  } catch (error) {
    life("delivery-end", { result: "failed" });
    abStatus.textContent = error?.message || "Comparison test failed.";
  } finally { abWeb.disabled = abNative.disabled = !nativeTiming; }
}
abWeb.addEventListener("click", () => void runAudioComparison("web-audio"));
abNative.addEventListener("click", () => void runAudioComparison("native"));

const diagnostics = createAudioDiagnostics({ onChange: (count) => {
  diagnosticsStatus.textContent = diagnosticsEnabled.checked ? `Recording: ${count} sample${count === 1 ? "" : "s"}.` : "Recording off.";
  diagnosticsOutput.value = diagnosticsEnabled.checked ? diagnostics.getText() : "";
} });
soundEngine.onAudioContextCreated = (ctx) => { diagnostics.noteContext(ctx); anomalies.noteContext(ctx); };
soundEngine.onAudioContextRefresh = (ctx, result) => anomalies.recordContextRefresh(ctx, result);
soundEngine.onAudioPlaybackDiagnostic = audioLogSettings.enabled ? (ctx, measurement) => anomalies.recordPlayback(ctx, measurement) : null;
soundEngine.onAudioDiagnostic = (ctx, scheduledTime, estimatedStartMs, trace) => {
  anomalies.record(ctx, scheduledTime, estimatedStartMs, trace);
  diagnostics.record(ctx, scheduledTime, estimatedStartMs);
};
diagnosticsEnabled.addEventListener("change", () => {
  diagnostics.setEnabled(diagnosticsEnabled.checked);
});
document.getElementById("audio-anomalies-clear").addEventListener("click", () => anomalies.clear());
document.getElementById("audio-anomalies-select").addEventListener("click", () => { anomalyOutput.focus(); anomalyOutput.select(); });
document.getElementById("audio-anomalies-download").addEventListener("click", async () => {
  try {
    const url = URL.createObjectURL(new Blob([await anomalies.getExportText()], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "heartbeat-audio-timing.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { anomalyStatus.textContent = "Could not export timing history."; }
});
document.getElementById("audio-diagnostics-select").addEventListener("click", () => {
  diagnosticsOutput.focus();
  diagnosticsOutput.select();
});
const companionStatus = document.getElementById("companion-status");
const companionEnabled = document.getElementById("companion-enabled");
const companionCharacterMotion = document.getElementById("companion-character-motion");
const companionSuppressNonVoice = document.getElementById("companion-suppress-non-voice");
const companionNameMode = document.getElementById("companion-name-mode"), companionCustomName = document.getElementById("companion-custom-name");
const companionMonitor = document.getElementById("companion-monitor");
const companionCorner = document.getElementById("companion-corner");
const companionSize = document.getElementById("companion-size");
const companionPreview = document.getElementById("companion-preview");
const companionRefresh = document.getElementById("companion-refresh");
const characterSelect = document.getElementById("companion-character"), characterFile = document.getElementById("character-file");
const characterImport = document.getElementById("character-import"), characterExport = document.getElementById("character-export");
const characterUpdate = document.getElementById("character-update"), characterUpdateFile = document.getElementById("character-update-file");
let updateTarget = null;
let companionError = "";
let companionDisplayNotice = "";
async function refreshCharacters() {
  try {
    const selected = selectedCharacter(), packs = await listCharacterPacks();
    characterSelect.replaceChildren(new Option("Heartbeat", "builtin"));
    for (const pack of packs) characterSelect.add(new Option(pack.name, pack.id));
    if (packs.some(pack => pack.id === selected)) characterSelect.value = selected;
    else { characterSelect.value = "builtin"; if (selected !== "builtin") { companionDisplayNotice = "Saved character is unavailable; using Heartbeat."; renderCompanionStatus(); } }
    characterExport.disabled = characterUpdate.disabled = characterSelect.value === "builtin";
  } catch { companionDisplayNotice = "Character storage is unavailable; using Heartbeat."; renderCompanionStatus(); }
}
characterSelect.addEventListener("change", () => {
  try { selectCharacter(characterSelect.value); companionDisplayNotice = "Character will change on the next preview or chime."; characterExport.disabled = characterUpdate.disabled = characterSelect.value === "builtin"; renderCompanionStatus(); }
  catch { companionDisplayNotice = "Could not save character selection."; renderCompanionStatus(); void refreshCharacters(); }
});
characterImport.addEventListener("click", () => characterFile.click());
characterFile.addEventListener("change", async () => {
  const file = characterFile.files?.[0]; if (!file) return;
  characterImport.disabled = true;
  try { const pack = await importCharacterPack(file); selectCharacter(pack.id); await refreshCharacters(); companionDisplayNotice = `${pack.name} imported. Preview her or wait for the next chime.`; }
  catch (error) { companionDisplayNotice = `Could not import character: ${error.message}`; }
  finally { characterFile.value = ""; characterImport.disabled = false; renderCompanionStatus(); }
});
characterUpdate.addEventListener("click", () => {
  updateTarget = characterSelect.value;
  if (updateTarget !== "builtin") characterUpdateFile.click();
});
characterUpdateFile.addEventListener("change", async () => {
  const file = characterUpdateFile.files?.[0], target = updateTarget;
  updateTarget = null;
  if (!file || !target) return;
  characterUpdate.disabled = true;
  try {
    const pack = await replaceCharacterPack(target, file);
    await refreshCharacters();
    companionDisplayNotice = pack.refreshSignaled ? `${pack.name} updated. Preview her or wait for the next chime.` : `${pack.name} updated, but the companion could not be notified. Restart Heartbeat to refresh it.`;
  } catch (error) { companionDisplayNotice = `Could not update character: ${error.message}`; }
  finally { characterUpdateFile.value = ""; characterUpdate.disabled = characterSelect.value === "builtin"; renderCompanionStatus(); }
});
characterExport.addEventListener("click", async () => {
  try { const pack = await getCharacterPack(characterSelect.value); if (!pack) throw new Error("Character is unavailable."); downloadJsonFile({filename:"heartbeat-character.json",data:pack}); companionDisplayNotice = "Character exported."; }
  catch (error) { companionDisplayNotice = `Could not export character: ${error.message}`; }
  renderCompanionStatus();
});
void refreshCharacters();
if (isDesktopRuntime()) void listenForCharacterLoaded((id) => {
  if (id === selectedCharacter() && id !== "builtin") { companionDisplayNotice = "Selected character loaded in the companion."; renderCompanionStatus(); }
}).catch(() => {});
function renderCompanionStatus() {
  companionStatus.textContent = companionError || companionDisplayNotice || (isDesktopRuntime() ? "" : "The companion is available in the desktop app.");
}
const companion = createCompanionController({
  state, isDesktopRuntime, show: showCompanionOverlay, hide: hideCompanionOverlay, sendSpeech: sendCompanionSpeech, sendTiming: sendCompanionTiming, setMotionPreference: setCompanionCharacterMotion, getPresetLabel, getPreset: (id) => getAllPresets().find((preset) => preset.id === id),
  onCue: ({presetId, cue, characterId, generation, targetAtMs}) => {
    if (!diagnosticDisplayEnabled) return;
    const voice = getBuiltInVoiceMetadata(presetId);
    const clean = (value, limit) => String(value || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, limit);
    const pack = [...characterSelect.options].find(option => option.value === characterId)?.textContent || "Heartbeat";
    void publishDiagnosticCue({
      presetId: clean(presetId, 120), lineId: clean(voice?.lineId, 120),
      take: voice?.generation === 1 || voice?.generation === 2 ? voice.generation : null,
      expression: cue.expression, text: clean(cue.text, 160), character: clean(pack, 80), characterId,
      generation, targetAtMs: Number.isFinite(targetAtMs) ? Math.round(targetAtMs) : null
    }).catch(() => {});
  },
  onError: (error) => { companionError = `Companion unavailable: ${error?.message || "try again"}`; renderCompanionStatus(); }
});
if (isDesktopRuntime()) void companion.setCharacterMotion(state.companionCharacterMotion !== false);
async function prewarmCompanion() {
  const warmed = await prewarmCompanionIfEnabled({ state, isDesktopRuntime, prewarm: prewarmCompanionOverlay,
      onError: (error) => { companionError = `Companion unavailable: ${error?.message || "try again"}`; renderCompanionStatus(); } });
  if (warmed && state.companionEnabled) { companionError = ""; renderCompanionStatus(); }
  return warmed;
}

function renderCompanionControls() {
  const desktop = isDesktopRuntime();
  companionEnabled.checked = state.companionEnabled;
  companionNameMode.value = state.companionNameMode;
  companionCustomName.value = state.companionCustomName;
  companionCustomName.disabled = state.companionNameMode !== "custom";
  companionEnabled.disabled = !desktop;
  companionSuppressNonVoice.checked = state.companionSuppressNonVoice === true;
  companionSuppressNonVoice.disabled = !desktop || !state.companionEnabled;
  companionCharacterMotion.checked = state.companionCharacterMotion !== false;
  companionCharacterMotion.disabled = !desktop || !state.companionEnabled;
  companionMonitor.disabled = !desktop || !state.companionEnabled;
  companionCorner.disabled = !desktop || !state.companionEnabled;
  companionSize.disabled = !desktop || !state.companionEnabled;
  companionPreview.disabled = !desktop || !state.companionEnabled;
  companionRefresh.disabled = !desktop;
  companionCorner.value = state.companionCorner;
  companionSize.value = String(state.companionSize);
  if ([...companionMonitor.options].some((option) => option.value === state.companionMonitorId)) {
    companionMonitor.value = state.companionMonitorId;
  } else {
    companionMonitor.value = "primary";
  }
  renderCompanionStatus();
}

async function refreshCompanionDisplays() {
  if (!isDesktopRuntime()) return;
  try {
    const monitors = await listOverlayMonitors();
    companionMonitor.replaceChildren(new Option("Primary display", "primary"));
    for (const monitor of monitors) companionMonitor.add(new Option(monitor.label, monitor.id));
    companionDisplayNotice = monitors.some((monitor) => monitor.id === state.companionMonitorId) || state.companionMonitorId === "primary"
      ? "" : "Saved display unavailable; using the primary display.";
    renderCompanionControls();
  } catch (error) {
    companionDisplayNotice = `Unable to list displays: ${error?.message || "try again"}`;
    renderCompanionStatus();
  }
}
companionEnabled.addEventListener("change", () => {
  state.companionEnabled = companionEnabled.checked;
  if (!state.companionEnabled) { companionError = ""; void companion.dismiss({ cancelPlayback: false }); }
  else void prewarmCompanion();
  saveState();
  renderCompanionControls();
});
companionNameMode.addEventListener("change", () => {
  state.companionNameMode = companionNameMode.value === "custom" ? "custom" : "default";
  companionCustomName.disabled = state.companionNameMode !== "custom";
  saveState();
});
companionCustomName.addEventListener("change", () => {
  state.companionCustomName = normalizeCompanionName(companionCustomName.value);
  companionCustomName.value = state.companionCustomName;
  saveState();
});
companionMonitor.addEventListener("change", () => { state.companionMonitorId = companionMonitor.value; saveState(); if (diagnosticDisplayEnabled) void setDiagnosticDisplay(true, state.companionMonitorId).catch(() => { diagnosticDisplayStatus.textContent = "Could not move the diagnostic display."; }); });
companionCorner.addEventListener("change", () => { state.companionCorner = companionCorner.value; saveState(); });
companionSize.addEventListener("change", () => { state.companionSize = Number(companionSize.value); saveState(); });
companionSuppressNonVoice.addEventListener("change", () => { state.companionSuppressNonVoice = companionSuppressNonVoice.checked; saveState(); });
companionCharacterMotion.addEventListener("change", () => {
  state.companionCharacterMotion = companionCharacterMotion.checked;
  saveState();
  void companion.setCharacterMotion(state.companionCharacterMotion);
});
companionRefresh.addEventListener("click", () => void refreshCompanionDisplays());
const chooseCompanionPreview = createCompanionPreviewPicker({
  presetIds: BUILT_IN_VOICE_SET?.presets.map((preset) => preset.id) || [],
  getRepeatGroup: getPresetRepeatGroup
});
companionPreview.addEventListener("click", async () => {
  let lifecycle;
  try {
    await soundEngine.unlock();
    soundEngine.setMasterVolume(state.masterVolume);
    const presetId = chooseCompanionPreview();
    if (!presetId) throw new Error("Bundled voices are unavailable.");
    lifecycle = anomalies.startCue(() => soundEngine.ctx);
    lifecycle("dispatch");
    const playback = await companion.playWithIntro({ presetId, lifecycle, prepare: () => soundEngine.preparePresetForPlayback(presetId), play: (onBufferScheduled, onAudioTiming, trace) => soundEngine.playPreset(presetId, 0.85, { onBufferScheduled, onAudioTiming, trace, native: true }) });
    lifecycle("delivery-end", { result: playback === true ? "success" : playback === "cancelled" ? "cancelled" : "failed" });
    if (playback !== true && playback !== "cancelled") { companionError = "Could not play the preview. Check your audio settings."; renderCompanionStatus(); }
  } catch (error) { lifecycle?.("delivery-end", { result: "failed" }); companionError = `Could not play the preview: ${error?.message || "check audio settings"}`; renderCompanionStatus(); }
});
void refreshCompanionDisplays();
void prewarmCompanion();
const runtime = {
  libraryReady: false,
  intervalHandle: null,
  nextByIntervalId: new Map(),
  openIntervalAdvancedIds: new Set(),
  intervalClipFilters: new Set(),
  lastNonZeroMasterVolume: state.masterVolume > 0 ? state.masterVolume : 0.75,
  unlistenTrayCommands: null,
  desktopRuntimeMode: isDesktopRuntime() ? "desktop" : "web",
  desktopAutostartSyncedAtMs: null,
  desktopAutostartError: "",
  trayConnected: false,
  lastTrayCommand: "",
  lastTrayCommandAtMs: null
};
const prefersDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const elements = {
  clock: document.getElementById("clock"),
  statusText: document.getElementById("status-text"),
  toggleEngine: document.getElementById("toggle-engine"),
  masterVolume: document.getElementById("master-volume"),
  masterVolumeValue: document.getElementById("master-volume-value"),
  soundProfile: document.getElementById("sound-profile"),
  soundProfileApply: document.getElementById("sound-profile-apply"),
  soundProfileUndo: document.getElementById("sound-profile-undo"),
  soundProfileStatus: document.getElementById("sound-profile-status"),
  soundProfileDescription: document.getElementById("sound-profile-description"),
  launchAtLogin: document.getElementById("launch-at-login"),
  resumeOnLaunch: document.getElementById("resume-on-launch"),
  desktopRuntimeValue: document.getElementById("desktop-runtime-value"),
  desktopTrayBridgeValue: document.getElementById("desktop-tray-bridge-value"),
  desktopStartupValue: document.getElementById("desktop-startup-value"),
  desktopLastTrayCommandValue: document.getElementById("desktop-last-tray-command-value"),
  desktopStatusRefresh: document.getElementById("desktop-status-refresh"),
  configExport: document.getElementById("config-export"),
  configImport: document.getElementById("config-import"),
  configImportFile: document.getElementById("config-import-file"),
  backupExport: document.getElementById("backup-export"),
  backupImport: document.getElementById("backup-import"),
  backupImportFile: document.getElementById("backup-import-file"),
  backupStatus: document.getElementById("backup-status"),
  backupConfirm: document.getElementById("backup-confirm"),
  ttsEnabled: document.getElementById("tts-enabled"),
  ttsSpeakLabel: document.getElementById("tts-speak-label"),
  ttsRecurringEnabled: document.getElementById("tts-recurring-enabled"),
  ttsOneShotEnabled: document.getElementById("tts-one-shot-enabled"),
  ttsCustomText: document.getElementById("tts-custom-text"),
  ttsVoice: document.getElementById("tts-voice"),
  ttsRate: document.getElementById("tts-rate"),
  ttsRateValue: document.getElementById("tts-rate-value"),
  ttsVolume: document.getElementById("tts-volume"),
  ttsVolumeValue: document.getElementById("tts-volume-value"),
  ttsPreview: document.getElementById("tts-preview"),
  ttsRecurringAllOn: document.getElementById("tts-recurring-all-on"),
  ttsRecurringAllOff: document.getElementById("tts-recurring-all-off"),
  ttsOneShotAllOn: document.getElementById("tts-one-shot-all-on"),
  ttsOneShotAllOff: document.getElementById("tts-one-shot-all-off"),
  ttsSupportNote: document.getElementById("tts-support-note"),
  themeMode: document.getElementById("theme-mode"),
  themePalette: document.getElementById("theme-palette"),
  suppressLower: document.getElementById("suppress-lower"),
  avoidRandomRepeat: document.getElementById("avoid-random-repeat"),
  intervalGrid: document.getElementById("interval-grid"),
  soundLibraryBrowser: document.getElementById("sound-library-browser"),
  presetSearch: document.getElementById("preset-search"),
  presetSourceFilter: document.getElementById("preset-source-filter"),
  presetLibrary: document.getElementById("preset-library"),
  packImportForm: document.getElementById("pack-import-form"),
  packFiles: document.getElementById("pack-files"),
  quickPackForm: document.getElementById("quick-pack-form"),
  quickPackLabel: document.getElementById("quick-pack-label"),
  quickPackFiles: document.getElementById("quick-pack-files"),
  quickPackStatus: document.getElementById("quick-pack-status"),
  packList: document.getElementById("pack-list"),
  relativeForm: document.getElementById("relative-form"),
  relativeLabel: document.getElementById("relative-label"),
  relativeMinutes: document.getElementById("relative-minutes"),
  relativePreview: document.getElementById("relative-preview"),
  relativePreset: document.getElementById("relative-preset"),
  relativePlaybackMode: document.getElementById("relative-playback-mode"),
  relativePresetSet: document.getElementById("relative-preset-set"),
  relativePresetWeightControls: document.getElementById("relative-preset-weight-controls"),
  relativeWeightPresetActions: document.getElementById("relative-weight-preset-actions"),
  relativeWeightSimulate: document.getElementById("relative-weight-simulate"),
  relativeWeightSimOutput: document.getElementById("relative-weight-sim-output"),
  absoluteForm: document.getElementById("absolute-form"),
  absoluteLabel: document.getElementById("absolute-label"),
  absoluteWhen: document.getElementById("absolute-when"),
  absoluteNow: document.getElementById("absolute-now"),
  absolutePreset: document.getElementById("absolute-preset"),
  absolutePreview: document.getElementById("absolute-preview"),
  absolutePlaybackMode: document.getElementById("absolute-playback-mode"),
  absolutePresetSet: document.getElementById("absolute-preset-set"),
  absolutePresetWeightControls: document.getElementById("absolute-preset-weight-controls"),
  absoluteWeightPresetActions: document.getElementById("absolute-weight-preset-actions"),
  absoluteWeightSimulate: document.getElementById("absolute-weight-simulate"),
  absoluteWeightSimOutput: document.getElementById("absolute-weight-sim-output"),
  timersList: document.getElementById("timers-list"),
  logList: document.getElementById("log-list")
};

const {
  normalizeWeightPresetStrategy,
  sanitizeWeight,
  getCuePresetIds,
  getCuePresetWeights,
  getSelectedOptionValues,
  getPresetIdsFromSelect,
  buildPresetWeightsByStrategy,
  runSimulationPreview,
  setSimulationOutput,
  makeWeightPresetButtonsMarkup,
  makePresetWeightControlMarkup,
  readPresetWeightsFromContainer,
  renderPresetWeightControls,
  applyWeightPresetToControls,
  normalizeCueSoundConfig,
  resolveCuePresetForPlayback,
  getPlaybackModeLabel
} = createCueSoundHelpers({
  hasPresetId: (id) => hasPresetId(id) || (typeof id === "string" && id.startsWith("custom:")) || isKnownBuiltInVoiceId(id),
  getPresetLabel
});

function renderVoiceOptions() {
  renderVoiceOptionsHelper({
    ttsSpeaker,
    groupVoicesByLanguage,
    ttsVoiceElement: elements.ttsVoice,
    selectedVoiceUri: state.ttsVoiceUri
  });
}

function applyThemeToDocument() {
  applyThemeToDocumentHelper({
    state,
    resolveAppliedMode,
    prefersDarkQuery
  });
}

function reconcileStateWithAvailableAssets() {
  let changed = false;
  if (!getProfileById(state.selectedProfileId) && !state.selectedProfileId.startsWith("custom:") && state.selectedProfileId !== "dry_time_checks") {
    state.selectedProfileId = SOUND_PROFILES[0].id;
    state.intervals = applyProfileToIntervals(state.intervals, getCurrentProfile());
    changed = true;
  }
  for (const interval of state.intervals) {
    const previous = JSON.stringify({
      presetId: interval.presetId,
      presetIds: interval.presetIds,
      playbackMode: interval.playbackMode,
      playbackCursor: interval.playbackCursor,
      presetWeights: interval.presetWeights
    });
    normalizeCueSoundConfig(interval);
    const next = JSON.stringify({
      presetId: interval.presetId,
      presetIds: interval.presetIds,
      playbackMode: interval.playbackMode,
      playbackCursor: interval.playbackCursor,
      presetWeights: interval.presetWeights
    });
    if (previous !== next) {
      changed = true;
    }
  }
  for (const timer of state.oneShots) {
    const previous = JSON.stringify({
      presetId: timer.presetId,
      presetIds: timer.presetIds,
      playbackMode: timer.playbackMode,
      playbackCursor: timer.playbackCursor,
      presetWeights: timer.presetWeights
    });
    normalizeCueSoundConfig(timer);
    const next = JSON.stringify({
      presetId: timer.presetId,
      presetIds: timer.presetIds,
      playbackMode: timer.playbackMode,
      playbackCursor: timer.playbackCursor,
      presetWeights: timer.presetWeights
    });
    if (previous !== next) {
      changed = true;
    }
  }
  refreshMissingCustomPresets();
  if (changed) {
    saveState();
  }
}

function refreshMissingCustomPresets() {
  const ids = [...state.intervals, ...state.oneShots].flatMap((cue) => [cue.presetId, ...(cue.presetIds || [])]);
  runtime.missingCustomPresetIds = new Set(ids.filter((id) => typeof id === "string" && (id.startsWith("custom:") || isKnownBuiltInVoiceId(id)) && !hasPresetId(id)));
  runtimeScheduler.reconcileSoundAvailability();
}

async function hydrateCustomLibrary({ announceErrors = false } = {}) {
  if (!isAudioStoreAvailable()) {
    customLibrary.packs = [];
    customLibrary.presets = [];
    customLibrary.profiles = [];
    runtime.libraryReady = false;
    refreshMissingCustomPresets();
    renderPackList();
    return false;
  }
  try {
    const library = await loadSoundLibrary();
    customLibrary.packs = library.packs;
    customLibrary.presets = library.presets;
    customLibrary.profiles = library.profiles;
    const referencedIds = new Set([...state.intervals, ...state.oneShots].flatMap((cue) => [cue.presetId, ...(cue.presetIds || [])]));
    const referencedPresets = library.presets.filter((preset) => referencedIds.has(preset.id));
    const availability = await Promise.all(referencedPresets.map(async (preset) => [preset.id, Boolean(await getSoundPresetBlob(preset.id))]));
    customLibrary.missingPresetIds = new Set(availability.filter(([, available]) => !available).map(([id]) => id));
    soundEngine.clearCustomBufferCache();
    runtime.libraryReady = true;
    reconcileStateWithAvailableAssets();
    renderAll();
    return true;
  } catch (error) {
    console.error(error);
    if (announceErrors) {
      addLog("Unable to load imported sound packs");
    }
    runtime.libraryReady = false;
    refreshMissingCustomPresets();
    renderPackList();
    return false;
  }
}

function makePlaybackModeOptions(selectedMode = "sequential") {
  const normalizedMode = normalizePlaybackMode(selectedMode);
  return PLAYBACK_MODES.map((mode) => {
    const label = getPlaybackModeLabel(mode);
    return `<option value="${mode}"${normalizedMode === mode ? " selected" : ""}>${label}</option>`;
  }).join("");
}

function ensurePresetInSet(selectElement, presetId) {
  if (!presetId) {
    return;
  }
  const selectedValues = getSelectedOptionValues(selectElement);
  if (selectedValues.includes(presetId)) {
    return;
  }
  for (const option of selectElement.options) {
    if (option.value === presetId) {
      option.selected = true;
    }
  }
}

function syncWeightControlsForPresetSet(
  selectElement,
  weightControlsContainer,
  fallbackPresetId = "",
  options = { inputClass: "preset-weight-input", wrapperClass: "weight-control-grid" }
) {
  const presetIds = getPresetIdsFromSelect(selectElement, fallbackPresetId);
  if (!presetIds.length) {
    if (weightControlsContainer) {
      weightControlsContainer.innerHTML = "";
    }
    return;
  }
  const parsedWeights = readPresetWeightsFromContainer(weightControlsContainer, presetIds);
  renderPresetWeightControls(weightControlsContainer, presetIds, parsedWeights, options);
}

const {
  renderTimerSoundSelectors,
  renderClock,
  renderSession,
  renderIntervals,
  renderPresetLibrary,
  renderPackList,
  updateTimerProgressBars,
  renderTimers,
  renderLog
} = createUiRenderers({
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
});

const { addLog, previewCue, setAllRecurringTtsEnabled, setAllOneShotTtsEnabled, fireCue, getLastRecurringPresetId } = createCueActions({
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
  deliverCue: (cue) => {
    const lifecycle = anomalies.startCue(() => soundEngine.ctx, cue.targetAtMs);
    lifecycle('dispatch');
    const result = companion.playWithIntro({ ...cue, lifecycle, prepare: () => soundEngine.preparePresetForPlayback(cue.presetId) });
    void Promise.resolve(result).then((value) => lifecycle('delivery-end', { result: value === false ? 'failed' : value === 'cancelled' || value === 'stale' ? value : 'success' }), () => lifecycle('delivery-end', { result: 'failed' }));
    return result;
  }
});

async function validateRequiredSounds() {
  const cues = [...state.intervals.filter((cue) => cue.enabled), ...state.oneShots.filter((cue) => cue.active)];
  const requiredIds = [...new Set(cues.flatMap((cue) => [cue.presetId, ...(cue.presetIds || [])]))];
  const ids = requiredIds.filter((id) => typeof id === "string" && id.startsWith("custom:"));
  const voiceIds = requiredIds.filter((id) => soundEngine.builtInVoiceUrl(id));
  if (ids.length && !runtime.libraryReady) return false;
  try {
    const [availability, voiceAvailability] = await Promise.all([
      Promise.all(ids.map(async (id) => [id, Boolean(await soundEngine.prepareCustomPreset(id))])),
      Promise.all(voiceIds.map((id) => soundEngine.prepareBuiltInVoice(id)))
    ]);
    for (const [id, available] of availability) {
      if (available && customLibrary.presets.some((preset) => preset.id === id)) {
        customLibrary.missingPresetIds.delete(id);
        runtime.missingCustomPresetIds.delete(id);
      } else {
        customLibrary.missingPresetIds.add(id);
        runtime.missingCustomPresetIds.add(id);
      }
    }
    renderIntervals();
    return voiceAvailability.every(Boolean) && availability.every(([, available]) => available) && ids.every((id) => !runtime.missingCustomPresetIds.has(id));
  } catch (error) {
    console.error(error);
    runtime.libraryReady = false;
    return false;
  }
}

const runtimeScheduler = createRuntimeScheduler({
  validateRequiredSounds,
  onSchedulerStop: () => void companion.dismiss(),
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
  emitTrayStatus
});

function renderAll({ forceSpeechDraft = false } = {}) {
  renderCompanionControls();
  applyThemeToDocument();
  renderClock();
  renderSession({ forceSpeechDraft });
  renderIntervals();
  renderPresetLibrary();
  renderPackList();
  renderTimers();
  renderLog();
  renderTimerSoundSelectors();
}

function getIntervalById(intervalId) {
  return state.intervals.find((interval) => interval.id === intervalId);
}

function buildOneShot({ label, targetAtMs, presetId, presetIds, presetWeights, playbackMode }) {
  const normalizedPresetIds = Array.isArray(presetIds) ? [...new Set(presetIds.filter((entry) => hasPresetId(entry)))] : [];
  const effectivePresetIds = normalizedPresetIds.length ? normalizedPresetIds : [presetId];
  const effectivePresetId = hasPresetId(presetId) ? presetId : effectivePresetIds[0];
  const timer = {
    id: crypto.randomUUID(),
    label: label?.trim() ? label.trim() : "One-shot timer",
    createdAtMs: Date.now(),
    targetAtMs,
    presetId: effectivePresetId,
    presetIds: effectivePresetIds,
    playbackMode: normalizePlaybackMode(playbackMode, "sequential"),
    playbackCursor: 0,
    presetWeights: presetWeights && typeof presetWeights === "object" ? presetWeights : {},
    volume: 0.85,
    ttsEnabled: true,
    active: true,
    firedAtMs: null
  };
  normalizeCueSoundConfig(timer);
  return timer;
}

registerSessionHandlers({
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
  refreshDesktopRuntime: runtimeScheduler.refreshDesktopRuntime,
  syncTrayStatus: runtimeScheduler.syncTrayStatus,
  downloadJsonFile,
  makeExportFilename,
  serializeState,
  applyImportedState,
  createPortableBackup,
  parsePortableBackup,
  restorePortableLibrary,
  restoreCharacterLibrary,
  applyRestoredCharacter: (id) => {
    try { selectCharacter(id); }
    catch { throw new Error("Character selection could not be saved; choose the restored character in Settings."); }
    void refreshCharacters();
  },
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
});

registerIntervalGridHandlers({
  intervalGrid: elements.intervalGrid,
  runtime,
  getIntervalById,
  isRunning: () => state.running,
  setNextForInterval: runtimeScheduler.setNextForInterval,
  normalizePlaybackMode,
  getCuePresetIds,
  normalizeCueSoundConfig,
  saveState,
  sanitizeWeight,
  getCuePresetWeights,
  renderIntervals,
  setSimulationOutput,
  clamp,
  buildPresetWeightsByStrategy,
  runSimulationPreview,
  getRepeatSimulationContext: (interval) => ({
    avoidRepeat: state.avoidConsecutiveRandomSounds,
    previousPresetId: getLastRecurringPresetId(interval.id)
  }),
  previewCue
});

registerLibraryHandlers({
  soundLibraryBrowser: elements.soundLibraryBrowser,
  state,
  saveState,
  presetSearch: elements.presetSearch,
  presetSourceFilter: elements.presetSourceFilter,
  presetIntervalFilter: document.getElementById("preset-interval-filter"),
  presetTagFilter: document.getElementById("preset-tag-filter"),
  presetLibrary: elements.presetLibrary,
  packImportForm: elements.packImportForm,
  packFiles: elements.packFiles,
  quickPackForm: elements.quickPackForm,
  quickPackLabel: elements.quickPackLabel,
  quickPackFiles: elements.quickPackFiles,
  quickPackStatus: elements.quickPackStatus,
  packList: elements.packList,
  renderPresetLibrary,
  renderIntervals,
  soundEngine,
  getMasterVolume: () => state.masterVolume,
  isAudioStoreAvailable,
  buildSoundPackFromFiles,
  buildSoundPackFromAudioFiles,
  saveSoundPack,
  hydrateCustomLibrary,
  deleteSoundPack,
  addLog
});

registerTimerHandlers({
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
  getMasterVolume: () => state.masterVolume,
  fireCue
});

renderAll();
initializeNavigation({ state });
renderClock();
void (async () => {
  const libraryReady = await hydrateCustomLibrary();
  await runtimeScheduler.hydrateDesktopRuntime({ libraryReady });
  saveState();
  renderSession();
})();

setInterval(() => { void soundEngine.refreshContextIfDue(); }, 10_000);

setInterval(() => {
  renderClock();
  updateTimerProgressBars();
}, 1000);

if (typeof prefersDarkQuery.addEventListener === "function") {
  prefersDarkQuery.addEventListener("change", () => {
    if (state.themeMode === "system") {
      applyThemeToDocument();
    }
  });
}

if (ttsSpeaker.supported) {
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      renderSession();
    });
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      renderSession();
    };
  }
}

window.addEventListener("beforeunload", () => {
  if (typeof runtime.unlistenTrayCommands === "function") {
    runtime.unlistenTrayCommands();
    runtime.unlistenTrayCommands = null;
  }
});

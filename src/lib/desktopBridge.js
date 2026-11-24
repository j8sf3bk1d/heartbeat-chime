let desktopApisPromise = null;

export function isDesktopRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ === "object";
}

async function loadDesktopApis() {
  if (!isDesktopRuntime()) {
    return null;
  }
  if (!desktopApisPromise) {
    desktopApisPromise = Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/plugin-autostart")])
      .then(([event, autostart]) => ({
        listen: event.listen,
        emit: event.emit,
        isAutostartEnabled: autostart.isEnabled,
        enableAutostart: autostart.enable,
        disableAutostart: autostart.disable
      }))
      .catch((error) => {
        desktopApisPromise = null;
        console.warn("Desktop bridge failed to initialize:", error);
        throw error;
      });
  }
  return desktopApisPromise;
}

export async function listenForTrayCommands(onCommand) {
  const apis = await loadDesktopApis();
  if (!apis) {
    return null;
  }
  return apis.listen("heartbeat://tray-command", (event) => {
    const command = typeof event.payload === "string" ? event.payload : "";
    if (command) {
      onCommand(command);
    }
  });
}

export async function listenForCharacterLoaded(onLoaded) {
  const apis = await loadDesktopApis();
  if (!apis) return null;
  return apis.listen("heartbeat://character-loaded", (event) => onLoaded(event.payload));
}

export async function getLaunchAtLoginEnabled() {
  const apis = await loadDesktopApis();
  if (!apis) {
    return false;
  }
  return apis.isAutostartEnabled();
}

export async function setLaunchAtLoginEnabled(enabled) {
  const apis = await loadDesktopApis();
  if (!apis) {
    return false;
  }
  if (enabled) {
    await apis.enableAutostart();
  } else {
    await apis.disableAutostart();
  }
  const actual = await apis.isAutostartEnabled();
  if (actual !== Boolean(enabled)) {
    throw new Error("Launch-at-login setting was not applied. Check macOS Login Items.");
  }
  return actual;
}

export async function toggleLaunchAtLogin() {
  const enabled = await getLaunchAtLoginEnabled();
  return setLaunchAtLoginEnabled(!enabled);
}

export async function emitTrayStatus(statusText) {
  if (typeof statusText !== "string" || !statusText.trim()) {
    return false;
  }
  try {
    const apis = await loadDesktopApis();
    if (!apis) return false;
    await apis.emit("heartbeat://tray-status", statusText.trim());
    return true;
  } catch (error) {
    console.warn("Unable to publish tray status:", error);
    return false;
  }
}

// Companion commands are implemented in Rust and restricted to the main
// window. The companion itself has only the event listener permission.
async function invokeCompanion(command, args) {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
}

export async function getTimingLogPath() { return invokeCompanion("timing_log_path"); }
export async function configureTimingLog(enabled, files) { return invokeCompanion("timing_log_configure", { enabled, files }); }
export async function appendTimingLog(event) { return invokeCompanion("timing_log_append", { event }); }

export async function listOverlayMonitors() {
  return (await invokeCompanion("overlay_monitors")) || [];
}

export async function prewarmCompanionOverlay() {
  return Boolean(await invokeCompanion("overlay_prewarm"));
}

export async function showCompanionOverlay(request) {
  return Boolean(await invokeCompanion("overlay_show", { request }));
}

export async function hideCompanionOverlay(generation) {
  return Boolean(await invokeCompanion("overlay_hide", { generation }));
}

export async function sendCompanionSpeech(request) {
  return Boolean(await invokeCompanion("overlay_speech", { request }));
}

export async function sendCompanionTiming(request) {
  return Boolean(await invokeCompanion("overlay_audio_timing", { request }));
}

export async function setCompanionCharacterMotion(enabled, revision) {
  return Boolean(await invokeCompanion("overlay_motion_preference", { enabled, revision }));
}

export async function setDiagnosticDisplay(enabled, monitorId) { return invokeCompanion("diagnostic_display_set", { enabled, monitorId }); }
export async function publishDiagnosticCue(cue) { return invokeCompanion("diagnostic_display_cue", { cue }); }
export async function publishDiagnosticEvent(event) { return invokeCompanion("diagnostic_display_event", { event }); }

export async function playNativeDiagnostic(volume) { return invokeCompanion("native_audio_diagnostic", { volume }); }
export async function playNativeClip(bytes, volume) { return invokeCompanion("native_audio_clip", { bytes: Array.from(bytes), volume }); }

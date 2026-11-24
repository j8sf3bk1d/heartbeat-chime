//! A single, click-through, non-activating companion window. The main window
//! is the only caller allowed to control it; the companion may only ask for its
//! pending caption after installing its event listener.
use serde::{Deserialize, Serialize};
use std::sync::{Condvar, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const OVERLAY: &str = "companion";
const CUE_EVENT: &str = "heartbeat://overlay-cue";
const TIMING_EVENT: &str = "heartbeat://overlay-timing";
const SPEECH_EVENT: &str = "heartbeat://overlay-speech";
const CLEAR_EVENT: &str = "heartbeat://overlay-clear";
const MOTION_EVENT: &str = "heartbeat://overlay-motion-preference";
const WIDTH: f64 = 600.0;
const HEIGHT: f64 = 270.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCue {
  text: String,
  expression: String,
  character_id: String,
  duration_ms: u64,
  sequence: u64,
  generation: u64,
  character_motion: bool,
  motion_revision: u64,
  target_at_ms: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEnvelope {
  generation: u64,
  started_at_ms: u64,
  frame_ms: u32,
  levels: Vec<f32>,
}

fn valid_speech_envelope(request: &SpeechEnvelope, now_ms: u128) -> bool {
  request.frame_ms == 40 && !request.levels.is_empty() && request.levels.len() <= 600 &&
    request.levels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)) &&
    now_ms.abs_diff(request.started_at_ms as u128) <= 5_000
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTiming { generation: u64, started_at_ms: u64, duration_ms: u32 }

fn timing_remaining_ms(request: &AudioTiming, now_ms: u128) -> Option<u64> {
  if now_ms.abs_diff(request.started_at_ms as u128) > 5_000 || !(1..=30_000).contains(&request.duration_ms) { return None; }
  let end = (request.started_at_ms as u128) + u128::from(request.duration_ms) + 2_000;
  Some(end.saturating_sub(now_ms).min(37_000) as u64)
}

#[derive(Clone, Serialize)]
struct OverlayClear { generation: u64 }

#[derive(Clone, Serialize)]
struct MotionPreference { enabled: bool, revision: u64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRequest {
  monitor_id: String,
  corner: String,
  #[serde(default = "default_size")]
  size: u16,
  text: String,
  expression: String,
  #[serde(default = "default_character_id")]
  character_id: String,
  #[serde(default = "default_character_motion")]
  character_motion: bool,
  duration_ms: u64,
  generation: u64,
  #[serde(default)]
  target_at_ms: Option<u64>,
}

fn default_size() -> u16 { 100 }
fn default_character_motion() -> bool { true }
fn default_character_id() -> String { "builtin".into() }
fn valid_character_id(id: &str) -> bool {
  id == "builtin" || (id.len() == 46 && id.starts_with("character:") && id[10..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase() || b == b'-'))
}

#[tauri::command]
pub async fn overlay_character_loaded<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, character_id: String) -> Result<(), String> {
  require_window(&caller, OVERLAY)?;
  if !valid_character_id(&character_id) { return Err("Invalid companion character.".into()); }
  app.emit_to("main", "heartbeat://character-loaded", character_id).map_err(|e| e.to_string())
}

// Keep this explicit at the native IPC boundary even though the same IDs are
// used by the frontend; arbitrary strings should not reach overlay events.
fn valid_expression(expression: &str) -> bool {
  matches!(expression, "neutral" | "smug" | "flustered" | "hmph" | "caring" | "impressed" | "exasperated" | "delighted")
}

#[derive(Serialize)]
pub struct MonitorOption { id: String, label: String }

#[derive(Default)]
pub struct OverlayState { inner: Mutex<OverlayInner>, ready: Condvar }
#[derive(Default)]
struct OverlayInner { sequence: u64, latest_generation: u64, pending: Option<OverlayCue>, ready_at: Option<std::time::Instant>, motion_revision: u64, motion_enabled: bool, expires_at: Option<std::time::Instant>, maximum_expires_at: Option<std::time::Instant> }

fn require_window<R: Runtime>(caller: &WebviewWindow<R>, expected: &str) -> Result<(), String> {
  if caller.label() == expected { Ok(()) } else { Err("Window is not permitted to control the companion.".into()) }
}

pub(crate) fn monitor_id(monitor: &tauri::Monitor) -> String {
  let p = monitor.position();
  format!("{}:{}:{}", monitor.name().map(String::as_str).unwrap_or("Display"), p.x, p.y)
}

// All inputs and outputs are physical pixels, including displays with negative
// origins. The desired logical size is scaled once for the target monitor.
fn placement(area_x: i32, area_y: i32, area_width: u32, area_height: u32, scale: f64, size: u16, corner: &str) -> (i32, i32, u32, u32) {
  let margin = (12.0 * scale).round() as u32;
  let max_width = area_width.saturating_sub(margin.saturating_mul(2)).max(1);
  let max_height = area_height.saturating_sub(margin.saturating_mul(2)).max(1);
  let requested_width = WIDTH * scale * f64::from(size) / 100.0;
  let requested_height = HEIGHT * scale * f64::from(size) / 100.0;
  // Fit uniformly rather than clipping one dimension, preserving the layout's
  // aspect ratio on small or mixed-DPI screens.
  let fit = (f64::from(max_width) / requested_width).min(f64::from(max_height) / requested_height).min(1.0);
  let width = ((requested_width * fit).floor() as u32).clamp(1, max_width);
  let height = ((requested_height * fit).floor() as u32).clamp(1, max_height);
  let x = if corner.ends_with("right") { area_x.saturating_add(area_width.saturating_sub(width.saturating_add(margin)) as i32) } else { area_x.saturating_add(margin.min(area_width.saturating_sub(width)) as i32) };
  let y = if corner.starts_with("bottom") { area_y.saturating_add(area_height.saturating_sub(height.saturating_add(margin)) as i32) } else { area_y.saturating_add(margin.min(area_height.saturating_sub(height)) as i32) };
  (x, y, width, height)
}

#[tauri::command]
pub async fn overlay_monitors<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>) -> Result<Vec<MonitorOption>, String> {
  require_window(&caller, "main")?;
  let monitors = app.available_monitors().map_err(|e| e.to_string())?;
  Ok(monitors.iter().enumerate().map(|(index, monitor)| MonitorOption {
    id: monitor_id(monitor),
    label: monitor.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
  }).collect())
}

fn ensure_window<R: Runtime>(app: &AppHandle<R>) -> Result<(WebviewWindow<R>, bool), String> {
  if let Some(window) = app.get_webview_window(OVERLAY) {
    // Never show the companion unless click-through can actually be applied.
    window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    return Ok((window, false));
  }
  let window = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
    .title("Heartbeat companion")
    .inner_size(WIDTH, HEIGHT)
    .transparent(true)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build().map_err(|e| e.to_string())?;
  window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
  Ok((window, true))
}

// Build the hidden window while the feature is enabled, so its WebView can
// finish initializing before an audio cue needs to display a caption.
#[tauri::command]
pub async fn overlay_prewarm<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>) -> Result<bool, String> {
  require_window(&caller, "main")?;
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  let (_, created) = ensure_window(&app)?;
  if created { inner.ready_at = None; }
  Ok(true)
}

// Tao's macOS `show()` calls `makeKeyAndOrderFront:` even when the window is
// configured focusable(false), which can activate Heartbeat and interrupt the
// user's current app. An NSWindow that canHide also causes AppKit to unhide
// the application when ordered front after Command-H, restoring the main
// window. The companion alone opts out of app-wide hiding before nonactivating
// ordering, leaving the main window and its normal hide/restore behavior alone.
#[cfg(target_os = "macos")]
pub(crate) fn show_without_activation<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  use std::sync::{mpsc, Arc};
  let window_on_main = window.clone();
  // The cancellation lock is held through the actual AppKit ordering call.
  // A timed-out caller either cancels before ordering starts, or waits for it
  // to finish and can hide the window before releasing the outer show lock.
  let active = Arc::new(Mutex::new(true));
  let active_on_main = active.clone();
  let (sender, receiver) = mpsc::sync_channel(1);
  window.run_on_main_thread(move || {
    let Ok(active_guard) = active_on_main.lock() else { return; };
    if !*active_guard { return; }
    let result = window_on_main.ns_window().map_err(|e| e.to_string()).and_then(|pointer| {
      if pointer.is_null() { return Err("Companion window is unavailable.".to_owned()); }
      // SAFETY: Tauri returns the live NSWindow pointer for this window; this
      // callback executes on the AppKit main thread and retains its owner.
      unsafe {
        let ns_window = &*(pointer.cast::<objc2::runtime::AnyObject>());
        let _: () = objc2::msg_send![ns_window, setCanHide: false];
        let _: () = objc2::msg_send![ns_window, orderFrontRegardless];
      }
      Ok(())
    });
    let _ = sender.send(result);
  }).map_err(|e| e.to_string())?;
  match receiver.recv_timeout(std::time::Duration::from_secs(5)) {
    Ok(result) => result,
    Err(_) => {
      if let Ok(mut active_guard) = active.lock() { *active_guard = false; }
      Err("Could not show the companion without activating the app.".into())
    }
  }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn show_without_activation<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  window.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn overlay_show<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>, request: OverlayRequest) -> Result<bool, String> {
  require_window(&caller, "main")?;
  if !matches!(request.corner.as_str(), "top-left" | "top-right" | "bottom-left" | "bottom-right") { return Err("Invalid screen corner.".into()); }
  if !matches!(request.size, 75 | 100 | 125 | 150) { return Err("Invalid companion size.".into()); }
  if !valid_expression(&request.expression) { return Err("Invalid companion expression.".into()); }
  if !valid_character_id(&request.character_id) { return Err("Invalid companion character.".into()); }
  let text = request.text.trim();
  if text.is_empty() || text.chars().count() > 500 { return Err("Invalid companion dialogue.".into()); }
  if !(1000..=30000).contains(&request.duration_ms) { return Err("Invalid companion duration.".into()); }
  // Serialize the full show operation with hide and expiration. In particular,
  // a hide that follows an in-flight show must not be undone by its late show.
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  // Frontend generations preserve invocation order even if IPC scheduling
  // reverses a pending show and a later disable/hide request.
  if request.generation <= inner.latest_generation { return Ok(false); }
  inner.latest_generation = request.generation;
  // A newer show immediately invalidates any older readiness wait.
  state.ready.notify_all();
  let monitors = app.available_monitors().map_err(|e| e.to_string())?;
  let monitor = monitors.iter().find(|m| monitor_id(m) == request.monitor_id)
    .cloned().or_else(|| app.primary_monitor().ok().flatten())
    .or_else(|| monitors.first().cloned()).ok_or("No display is available.")?;
  let area = monitor.work_area();
  let scale = monitor.scale_factor();
  let (x, y, width, height) = placement(area.position.x, area.position.y, area.size.width, area.size.height, scale, request.size, &request.corner);
  let (window, created) = ensure_window(&app)?;
  if created { inner.ready_at = None; }
  window.set_size(PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
  window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
  inner.sequence = inner.sequence.wrapping_add(1);
  if let Some(previous) = inner.pending.as_ref() {
    let _ = app.emit_to(OVERLAY, CLEAR_EVENT, OverlayClear { generation: previous.generation });
  }
  let character_motion = if inner.motion_revision == 0 { request.character_motion } else { inner.motion_enabled };
  let mut cue = OverlayCue { text: text.into(), expression: request.expression, character_id: request.character_id, duration_ms: request.duration_ms, sequence: inner.sequence, generation: request.generation, character_motion, motion_revision: inner.motion_revision, target_at_ms: request.target_at_ms };
  inner.pending = Some(cue.clone());
  state.ready.notify_all();
  // WKWebView can activate the app when first shown immediately after its load
  // callback. Give its native initialization a bounded first-show settling
  // interval; prewarming normally hides this latency from a chime. The wait
  // releases the mutex and is interruptible by a later cue or explicit hide.
  const SETTLE: std::time::Duration = std::time::Duration::from_millis(1500);
  let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
  loop {
    if inner.sequence != cue.sequence || inner.latest_generation != request.generation { return Ok(false); }
    let now = std::time::Instant::now();
    if inner.ready_at.is_some_and(|ready| now.saturating_duration_since(ready) >= SETTLE) { break; }
    if now >= deadline {
      inner.pending = None;
      return Err("Companion did not become ready.".into());
    }
    let until_ready = inner.ready_at.map(|ready| SETTLE.saturating_sub(now.saturating_duration_since(ready))).unwrap_or(deadline.saturating_duration_since(now));
    let timeout = until_ready.min(deadline.saturating_duration_since(now));
    (inner, _) = state.ready.wait_timeout(inner, timeout).map_err(|_| "Companion state unavailable.")?;
  }
  // Preference may change while the first WebView waits for readiness.
  if inner.motion_revision > cue.motion_revision {
    cue.character_motion = inner.motion_enabled;
    cue.motion_revision = inner.motion_revision;
    inner.pending = Some(cue.clone());
  }
  // Its ready command may already have returned this cue; sequence numbers
  // let the companion deduplicate that result and the event below.
  if let Err(error) = app.emit_to(OVERLAY, CUE_EVENT, &cue).map_err(|e| e.to_string()).and_then(|_| show_without_activation(&window)) {
    inner.pending = None;
    let _ = window.hide();
    return Err(error);
  }
  let shown_at = std::time::Instant::now();
  inner.expires_at = Some(shown_at + std::time::Duration::from_millis(cue.duration_ms));
  inner.maximum_expires_at = Some(shown_at + std::time::Duration::from_secs(42));
  drop(inner);
  let app_for_timer = app.clone();
  std::thread::spawn(move || {
    let state = app_for_timer.state::<OverlayState>();
    let Ok(mut inner) = state.inner.lock() else { return; };
    loop {
      if inner.sequence != cue.sequence || inner.latest_generation != cue.generation { return; }
      let Some(deadline) = inner.expires_at else { return; };
      let remaining = deadline.saturating_duration_since(std::time::Instant::now());
      if remaining.is_zero() {
        inner.pending = None;
        inner.expires_at = None;
        inner.maximum_expires_at = None;
        let _ = app_for_timer.emit_to(OVERLAY, CLEAR_EVENT, OverlayClear { generation: cue.generation });
        if let Some(window) = app_for_timer.get_webview_window(OVERLAY) { let _ = window.hide(); }
        return;
      }
      match state.ready.wait_timeout(inner, remaining) {
        Ok((guard, _)) => inner = guard,
        Err(_) => return,
      }
    }
  });
  Ok(true)
}

#[tauri::command]
pub async fn overlay_hide<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>, generation: u64) -> Result<bool, String> {
  require_window(&caller, "main")?;
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  if generation < inner.latest_generation { return Ok(false); }
  inner.latest_generation = generation;
  inner.sequence = inner.sequence.wrapping_add(1);
  if let Some(previous) = inner.pending.as_ref() {
    let _ = app.emit_to(OVERLAY, CLEAR_EVENT, OverlayClear { generation: previous.generation });
  }
  inner.pending = None;
  inner.expires_at = None;
  inner.maximum_expires_at = None;
  state.ready.notify_all();
  if let Some(window) = app.get_webview_window(OVERLAY) { window.hide().map_err(|e| e.to_string())?; }
  Ok(true)
}

// Audio timing is independent of visual motion. It can only extend the
// currently visible cue, never revive a hidden or superseded generation.
#[tauri::command]
pub async fn overlay_audio_timing<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>, request: AudioTiming) -> Result<bool, String> {
  require_window(&caller, "main")?;
  let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
  let remaining = timing_remaining_ms(&request, now).ok_or("Invalid companion audio timing.")?;
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  if inner.latest_generation != request.generation || !inner.pending.as_ref().is_some_and(|cue| cue.generation == request.generation) { return Ok(false); }
  let Some(window) = app.get_webview_window(OVERLAY) else { return Ok(false); };
  if !window.is_visible().unwrap_or(false) { return Ok(false); }
  let Some(deadline) = inner.expires_at else { return Ok(false); };
  let candidate = (std::time::Instant::now() + std::time::Duration::from_millis(remaining)).min(inner.maximum_expires_at.unwrap_or(deadline));
  if candidate > deadline { inner.expires_at = Some(candidate); state.ready.notify_all(); }
  app.emit_to(OVERLAY, TIMING_EVENT, &request).map_err(|e| e.to_string())?;
  Ok(true)
}

// The main window can provide a coarse envelope only for the currently
// displayed cue. Neither raw audio nor microphone data crosses this boundary.
#[tauri::command]
pub async fn overlay_speech<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>, request: SpeechEnvelope) -> Result<bool, String> {
  require_window(&caller, "main")?;
  let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
  if !valid_speech_envelope(&request, now) {
    return Err("Invalid companion speech envelope.".into());
  }
  let inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  if inner.latest_generation != request.generation || !inner.pending.as_ref().is_some_and(|cue| cue.generation == request.generation) {
    return Ok(false);
  }
  if inner.motion_revision > 0 && !inner.motion_enabled { return Ok(false); }
  let Some(window) = app.get_webview_window(OVERLAY) else { return Ok(false); };
  if !window.is_visible().unwrap_or(false) { return Ok(false); }
  app.emit_to(OVERLAY, SPEECH_EVENT, &request).map_err(|e| e.to_string())?;
  Ok(true)
}

#[tauri::command]
pub async fn overlay_motion_preference<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, OverlayState>, enabled: bool, revision: u64) -> Result<bool, String> {
  require_window(&caller, "main")?;
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  if revision <= inner.motion_revision { return Ok(false); }
  inner.motion_revision = revision;
  inner.motion_enabled = enabled;
  if let Some(cue) = inner.pending.as_mut() { cue.character_motion = enabled; cue.motion_revision = revision; }
  if app.get_webview_window(OVERLAY).is_some() {
    app.emit_to(OVERLAY, MOTION_EVENT, MotionPreference { enabled, revision }).map_err(|e| e.to_string())?;
  }
  Ok(true)
}

#[tauri::command]
pub async fn overlay_ready<R: Runtime>(caller: WebviewWindow<R>, state: State<'_, OverlayState>) -> Result<Option<OverlayCue>, String> {
  require_window(&caller, OVERLAY)?;
  let mut inner = state.inner.lock().map_err(|_| "Companion state unavailable.")?;
  inner.ready_at = Some(std::time::Instant::now());
  state.ready.notify_all();
  Ok(inner.pending.clone())
}

#[cfg(test)]
mod tests {
  use super::{placement, valid_character_id, valid_expression, valid_speech_envelope, timing_remaining_ms, AudioTiming, SpeechEnvelope};

  #[test]
  fn accepts_only_bounded_character_ids() {
    assert!(valid_character_id("builtin"));
    assert!(valid_character_id("character:123e4567-e89b-12d3-a456-426614174000"));
    assert!(!valid_character_id("character:../../etc/passwd"));
    assert!(!valid_character_id("character:123E4567-e89b-12d3-a456-426614174000"));
  }

  #[test]
  fn validates_bounded_audio_timing() {
    let mut timing = AudioTiming { generation: 1, started_at_ms: 1_003_000, duration_ms: 4_000 };
    assert_eq!(timing_remaining_ms(&timing, 1_000_000), Some(9_000));
    timing.started_at_ms = 1_005_001;
    assert_eq!(timing_remaining_ms(&timing, 1_000_000), None);
    timing.started_at_ms = 1_000_000;
    timing.duration_ms = 30_001;
    assert_eq!(timing_remaining_ms(&timing, 1_000_000), None);
  }

  #[test]
  fn accepts_only_supported_companion_expressions() {
    for value in ["neutral", "smug", "flustered", "hmph", "caring", "impressed", "exasperated", "delighted"] {
      assert!(valid_expression(value));
    }
    for value in ["", "HMPh", "unknown", "../neutral", "<img>"] {
      assert!(!valid_expression(value));
    }
  }

  #[test]
  fn validates_speech_envelope_size_values_and_clock() {
    let mut request = SpeechEnvelope { generation: 9, started_at_ms: 1_000_000, frame_ms: 40, levels: vec![0.0, 0.5, 1.0] };
    assert!(valid_speech_envelope(&request, 1_000_000));
    assert!(!valid_speech_envelope(&request, 1_005_001));
    request.levels = vec![];
    assert!(!valid_speech_envelope(&request, 1_000_000));
    request.levels = vec![0.1; 601];
    assert!(!valid_speech_envelope(&request, 1_000_000));
    request.levels = vec![f32::NAN];
    assert!(!valid_speech_envelope(&request, 1_000_000));
    request.levels = vec![-0.01];
    assert!(!valid_speech_envelope(&request, 1_000_000));
    request.levels = vec![1.01];
    assert!(!valid_speech_envelope(&request, 1_000_000));
    request.levels = vec![0.5];
    request.frame_ms = 41;
    assert!(!valid_speech_envelope(&request, 1_000_000));
  }

  #[test]
  fn positions_retina_window_within_negative_origin_work_area() {
    assert_eq!(placement(-2560, 50, 2560, 1400, 2.0, 100, "bottom-right"), (-1224, 886, 1200, 540));
    assert_eq!(placement(-2560, 50, 2560, 1400, 2.0, 100, "top-left"), (-2536, 74, 1200, 540));
    assert_eq!(placement(-2560, 50, 2560, 1400, 2.0, 150, "top-left"), (-2536, 74, 1800, 810));
    assert_eq!(placement(-2560, 50, 2560, 1400, 2.0, 75, "top-left"), (-2536, 74, 900, 405));
  }

  #[test]
  fn clamps_on_small_displays() {
    let (x, y, width, height) = placement(0, 0, 500, 200, 2.0, 150, "bottom-right");
    assert_eq!((x, y, width, height), (139, 24, 337, 152));
    let (x, y, width, height) = placement(10, 20, 10, 10, 2.0, 150, "top-left");
    assert!(x >= 10 && y >= 20 && x + width as i32 <= 20 && y + height as i32 <= 30);
  }
}

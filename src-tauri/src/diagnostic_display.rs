//! An opt-in, noninteractive capture aid. It receives timing metadata only.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "diagnostic";
const EVENT: &str = "heartbeat://diagnostic-timing";
const CUE_EVENT: &str = "heartbeat://diagnostic-cue";
#[derive(Default)]
pub struct DiagnosticState(Mutex<bool>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticEvent {
  kind: String, stage: Option<String>, backend: Option<String>, cue_id: Option<u32>, context_id: u32, at_ms: u64,
  target_offset_ms: Option<i64>, estimated_output_offset_ms: Option<i64>,
  wall_elapsed_ms: Option<i64>, expected_ms: Option<i64>, result: Option<String>,
}
impl DiagnosticEvent {
  fn valid(&self) -> bool {
    ["cue-lifecycle", "context-refresh"].contains(&self.kind.as_str()) &&
    self.backend.as_ref().map_or(true, |s| ["native", "web-audio"].contains(&s.as_str())) &&
    self.stage.as_ref().map_or(true, |s| ["dispatch", "prepare-start", "prepare-end", "show-start", "show-end", "play-request", "source-start", "source-ended", "source-overdue", "delivery-end"].contains(&s.as_str())) &&
    self.result.as_ref().map_or(true, |s| ["ready", "unavailable", "timeout", "cancel", "overlap", "fallback", "shown", "success", "failed", "cancelled", "stale"].contains(&s.as_str())) &&
    [self.target_offset_ms, self.estimated_output_offset_ms, self.wall_elapsed_ms, self.expected_ms].iter().all(|x| x.map_or(true, |v| v.unsigned_abs() <= 31_536_000_000))
  }
}
fn main_only<R: Runtime>(caller: &WebviewWindow<R>) -> Result<(), String> {
  if caller.label() == "main" { Ok(()) } else { Err("Only the main window may control diagnostics".into()) }
}
#[tauri::command]
pub async fn diagnostic_display_set<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, DiagnosticState>, enabled: bool, monitor_id: String) -> Result<(), String> {
  main_only(&caller)?;
  let mut current = state.0.lock().map_err(|_| "Diagnostic display unavailable")?;
  if !enabled {
    *current = false;
    if let Some(window) = app.get_webview_window(LABEL) { window.hide().map_err(|e| e.to_string())?; }
    return Ok(());
  }
  let window = if let Some(window) = app.get_webview_window(LABEL) { window } else {
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("diagnostic.html".into()))
      .title("Heartbeat diagnostic display").inner_size(470.0, 360.0).decorations(false).resizable(false)
      .always_on_top(true).skip_taskbar(true).focused(false).focusable(false).visible(false)
      .build().map_err(|e| e.to_string())?
  };
  window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
  let monitors = app.available_monitors().map_err(|e| e.to_string())?;
  let monitor = monitors.iter().find(|m| crate::overlay::monitor_id(m) == monitor_id)
    .cloned().or_else(|| app.primary_monitor().ok().flatten()).or_else(|| monitors.first().cloned()).ok_or("No display available")?;
  let work = monitor.work_area();
  let margin = (12.0 * monitor.scale_factor()).round() as i32;
  window.set_position(PhysicalPosition::new(work.position.x.saturating_add(margin), work.position.y.saturating_add(margin))).map_err(|e| e.to_string())?;
  crate::overlay::show_without_activation(&window)?;
  *current = true;
  Ok(())
}
#[tauri::command]
pub async fn diagnostic_display_event<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, DiagnosticState>, event: DiagnosticEvent) -> Result<(), String> {
  main_only(&caller)?;
  if !event.valid() { return Err("Invalid diagnostic event".into()); }
  if *state.0.lock().map_err(|_| "Diagnostic display unavailable")? {
    if let Some(window) = app.get_webview_window(LABEL) { window.emit(EVENT, event).map_err(|e| e.to_string())?; }
  }
  Ok(())
}
// Cue identity is deliberately ephemeral: it is emitted only to the opted-in
// display and never appended to timing history or the rotating log.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticCue {
  preset_id: String, line_id: String, take: Option<u8>, expression: String,
  text: String, character: String, character_id: String,
  generation: u64, target_at_ms: Option<u64>,
}
impl DiagnosticCue {
  fn valid(&self) -> bool {
    let short = |s: &str, n: usize| s.chars().count() <= n && !s.chars().any(char::is_control);
    short(&self.preset_id, 120) && short(&self.line_id, 120) && short(&self.text, 160) &&
    short(&self.character, 80) && short(&self.character_id, 46) &&
    self.take.map_or(true, |n| n == 1 || n == 2) &&
    matches!(self.expression.as_str(), "neutral" | "smug" | "flustered" | "hmph" | "caring" | "impressed" | "exasperated" | "delighted") &&
    self.generation <= 9_007_199_254_740_991 && self.target_at_ms.map_or(true, |n| n <= 9_007_199_254_740_991)
  }
}
#[tauri::command]
pub async fn diagnostic_display_cue<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, DiagnosticState>, cue: DiagnosticCue) -> Result<(), String> {
  main_only(&caller)?;
  if !cue.valid() { return Err("Invalid diagnostic cue".into()); }
  if *state.0.lock().map_err(|_| "Diagnostic display unavailable")? {
    if let Some(window) = app.get_webview_window(LABEL) { window.emit(CUE_EVENT, cue).map_err(|e| e.to_string())?; }
  }
  Ok(())
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn cue_display_rejects_unbounded_or_unexpected_content() {
    let raw = r#"{"presetId":"clip","lineId":"line","take":2,"expression":"exasperated","text":"hello","character":"Example","characterId":"builtin","generation":1,"targetAtMs":null}"#;
    assert!(serde_json::from_str::<DiagnosticCue>(raw).unwrap().valid());
    assert!(!serde_json::from_str::<DiagnosticCue>(&raw.replace("exasperated", "unknown")).unwrap().valid());
    assert!(!serde_json::from_str::<DiagnosticCue>(&raw.replace("hello", &"x".repeat(161))).unwrap().valid());
    assert!(serde_json::from_str::<DiagnosticCue>(&raw.replace("\"presetId\"", "\"secret\":true,\"presetId\"")).is_err());
  }
  #[test]
  fn only_allowlisted_diagnostic_metadata_is_accepted() {
    let event = r#"{"kind":"cue-lifecycle","stage":"source-start","cueId":2,"contextId":1,"atMs":123,"targetOffsetMs":5,"estimatedOutputOffsetMs":10,"wallElapsedMs":null,"expectedMs":null,"result":null}"#;
    assert!(serde_json::from_str::<DiagnosticEvent>(event).unwrap().valid());
    assert!(serde_json::from_str::<DiagnosticEvent>(&event.replace("source-start", "private")).unwrap().valid() == false);
    assert!(serde_json::from_str::<DiagnosticEvent>(&event.replace("\"kind\":", "\"dialogue\":\"private\",\"kind\":")).is_err());
  }
}

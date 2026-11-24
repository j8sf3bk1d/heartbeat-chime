use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

const MAX_BYTES: u64 = 1024 * 1024;
#[derive(Default)]
struct Settings { enabled: bool, files: u8 }
#[derive(Default)]
pub struct TimingLogLock(Arc<Mutex<Settings>>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimingEvent {
  version: u8, at_ms: u64, session_id: String, context_id: u32, kind: String,
  #[serde(default, skip_serializing_if = "Option::is_none")] backend: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")] cue_id: Option<u32>,
  #[serde(default, skip_serializing_if = "Option::is_none")] elapsed_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] context_time_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] scheduled_audio_time_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] estimated_output_offset_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] result: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")] reasons: Option<Vec<String>>,
  #[serde(default, skip_serializing_if = "Option::is_none")] recovered: Option<Vec<String>>,
  #[serde(default, skip_serializing_if = "Option::is_none")] clock_progress_gap_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] output_delay_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] output_timestamp_age_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] raw_output_offset_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] base_latency_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] output_latency_ms: Option<i64>,
  context_state: String,
  #[serde(default, skip_serializing_if = "Option::is_none")] estimator: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")] intro_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] prepare_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] show_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] ready_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] buffer_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] scheduler_lateness_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] dispatch_offset_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] target_offset_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] stage: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")] wall_elapsed_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] audio_progress_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] expected_ms: Option<i64>,
  #[serde(default, skip_serializing_if = "Option::is_none")] callback_lag_ms: Option<i64>,
}
impl TimingEvent {
  fn valid(&self) -> bool {
    let allowed = ["clock-progress-gap", "estimated-output-delay", "stale-output-timestamp", "raw-output-offset", "context-not-running", "slow-companion-preparation", "slow-companion-show", "slow-intro", "slow-audio-ready", "slow-buffer-preparation", "late-scheduler-dispatch", "late-target-output-estimate", "end-event-overdue", "end-event-delayed"];
    self.version == 2 && self.session_id.len() <= 50 && !self.session_id.is_empty() && self.session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') &&
      ["checkpoint", "observation", "context-state", "context-refresh", "playback-check", "cue-lifecycle"].contains(&self.kind.as_str()) &&
      ["running", "suspended", "interrupted", "closed", "unknown"].contains(&self.context_state.as_str()) &&
      self.estimator.as_ref().map_or(true, |s| ["output-timestamp", "reported-latency", "schedule-only", "unknown"].contains(&s.as_str())) &&
      self.stage.as_ref().map_or(true, |s| ["overdue", "ended", "dispatch", "prepare-start", "prepare-end", "show-start", "show-end", "play-request", "source-start", "source-ended", "source-overdue", "delivery-end"].contains(&s.as_str())) &&
      self.backend.as_ref().map_or(true, |s| ["native", "web-audio"].contains(&s.as_str())) &&
      self.result.as_ref().map_or(true, |s| ["ready", "unavailable", "timeout", "cancel", "overlap", "fallback", "shown", "success", "failed", "cancelled", "stale"].contains(&s.as_str())) &&
      [&self.reasons, &self.recovered].iter().all(|v| v.as_ref().map_or(true, |items| items.len() <= allowed.len() && items.iter().all(|s| allowed.contains(&s.as_str())))) &&
      [self.elapsed_ms, self.context_time_ms, self.scheduled_audio_time_ms, self.estimated_output_offset_ms, self.clock_progress_gap_ms, self.output_delay_ms, self.output_timestamp_age_ms, self.raw_output_offset_ms, self.base_latency_ms, self.output_latency_ms, self.intro_ms, self.prepare_ms, self.show_ms, self.ready_ms, self.buffer_ms, self.scheduler_lateness_ms, self.dispatch_offset_ms, self.target_offset_ms, self.wall_elapsed_ms, self.audio_progress_ms, self.expected_ms, self.callback_lag_ms].iter().all(|v| v.map_or(true, |n| n.unsigned_abs() <= 31_536_000_000))
  }
}
fn file(dir: &Path, index: u8) -> PathBuf {
  dir.join(if index == 0 { "audio-timing.jsonl".to_string() } else { format!("audio-timing.{index}.jsonl") })
}
fn ensure_regular(path: &Path) -> Result<(), String> {
  match fs::symlink_metadata(path) { Ok(m) if !m.is_file() || m.file_type().is_symlink() => Err("Timing log path is not a regular file".into()), Ok(_) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) }
}
fn append(dir: &Path, bytes: &[u8], files: u8, max_bytes: u64) -> Result<(), String> {
  if ![2, 5, 10].contains(&files) || bytes.len() as u64 > max_bytes { return Err("Invalid timing log limits".into()); }
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  for index in 0..files { ensure_regular(&file(dir, index))?; }
  let current = file(dir, 0);
  let size = fs::metadata(&current).map(|m| m.len()).unwrap_or(0);
  if size.saturating_add(bytes.len() as u64) > max_bytes {
    // A lower retention choice takes effect on the next rotation.
    for index in files..10 { let old = file(dir, index); ensure_regular(&old)?; if old.exists() { fs::remove_file(old).map_err(|e| e.to_string())?; } }
    let oldest = file(dir, files - 1);
    if oldest.exists() { fs::remove_file(oldest).map_err(|e| e.to_string())?; }
    for index in (0..files - 1).rev() { let source = file(dir, index); if source.exists() { fs::rename(source, file(dir, index + 1)).map_err(|e| e.to_string())?; } }
  }
  let mut options = OpenOptions::new(); options.create(true).append(true);
  #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
  options.open(current).and_then(|mut f| f.write_all(bytes)).map_err(|e| e.to_string())
}
fn main_only<R: Runtime>(caller: &WebviewWindow<R>) -> Result<(), String> { if caller.label() == "main" { Ok(()) } else { Err("Only the main window can access timing logs".into()) } }
#[tauri::command]
pub async fn timing_log_path<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>) -> Result<String, String> {
  main_only(&caller)?;
  Ok(file(&app.path().app_log_dir().map_err(|e| e.to_string())?, 0).to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn timing_log_configure<R: Runtime>(caller: WebviewWindow<R>, state: State<'_, TimingLogLock>, enabled: bool, files: u8) -> Result<(), String> {
  main_only(&caller)?;
  if ![2, 5, 10].contains(&files) { return Err("Invalid timing log retention".into()); }
  let mut settings = state.0.lock().map_err(|_| "Timing log lock unavailable")?;
  settings.enabled = enabled; settings.files = files;
  Ok(())
}
#[tauri::command]
pub async fn timing_log_append<R: Runtime>(caller: WebviewWindow<R>, app: AppHandle<R>, state: State<'_, TimingLogLock>, event: TimingEvent) -> Result<(), String> {
  main_only(&caller)?;
  if !event.valid() { return Err("Invalid timing event".into()); }
  let mut data = serde_json::to_vec(&event).map_err(|e| e.to_string())?; data.push(b'\n');
  if data.len() > 4096 { return Err("Timing event too large".into()); }
  let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
  let settings = Arc::clone(&state.0);
  tauri::async_runtime::spawn_blocking(move || {
    let guard = settings.lock().map_err(|_| "Timing log lock unavailable")?;
    if !guard.enabled { return Err("Timing file logging is disabled".into()); }
    append(&dir, &data, guard.files, MAX_BYTES)
  }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};
  fn temp_dir() -> PathBuf {
    std::env::temp_dir().join(format!("heartbeat-timing-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
  }
  #[test]
  fn append_rotates_and_respects_lower_retention_on_next_rotation() {
    let dir = temp_dir();
    for _ in 0..12 { append(&dir, b"{\"v\":1}\n", 5, 16).unwrap(); }
    assert!(file(&dir, 4).exists());
    for _ in 0..3 { append(&dir, b"{\"v\":2}\n", 2, 16).unwrap(); }
    assert!(file(&dir, 1).exists());
    assert!(!file(&dir, 2).exists());
    assert!(!file(&dir, 4).exists());
    assert!(append(&dir, b"x", 3, 16).is_err());
    assert!(append(&dir, &[b'x'; 17], 2, 16).is_err());
    fs::remove_dir_all(dir).unwrap();
  }
  #[test]
  fn rejects_unknown_content_and_accepts_known_timing_fields() {
    let valid = r#"{"version":2,"atMs":10,"sessionId":"100-abc","contextId":1,"kind":"observation","contextState":"running","reasons":["clock-progress-gap"],"clockProgressGapMs":900}"#;
    let event: TimingEvent = serde_json::from_str(valid).unwrap(); assert!(event.valid());
    assert!(serde_json::from_str::<TimingEvent>(&valid.replace("\"version\":2", "\"version\":2,\"dialogue\":\"private\"")).is_err());
    let unknown: TimingEvent = serde_json::from_str(&valid.replace("clock-progress-gap", "private-message")).unwrap(); assert!(!unknown.valid());
    let refresh = r#"{"version":2,"atMs":10,"sessionId":"100-abc","contextId":2,"kind":"context-refresh","contextState":"running","result":"success"}"#;
    assert!(serde_json::from_str::<TimingEvent>(refresh).unwrap().valid());
    let lifecycle = r#"{"version":2,"atMs":10,"sessionId":"100-abc","contextId":1,"cueId":3,"kind":"cue-lifecycle","stage":"source-ended","contextState":"running","elapsedMs":2000,"contextTimeMs":10000,"wallElapsedMs":2000,"audioProgressMs":1990,"expectedMs":2000}"#;
    let event: TimingEvent = serde_json::from_str(lifecycle).unwrap(); assert!(event.valid());
    let invalid: TimingEvent = serde_json::from_str(&lifecycle.replace("source-ended", "secret-text")).unwrap(); assert!(!invalid.valid());
    let ab = r#"{"version":2,"atMs":10,"sessionId":"100-abc","contextId":0,"cueId":3,"kind":"cue-lifecycle","stage":"source-start","backend":"native","contextState":"unknown"}"#;
    assert!(serde_json::from_str::<TimingEvent>(ab).unwrap().valid());
    assert!(!serde_json::from_str::<TimingEvent>(&ab.replace("native", "private-name")).unwrap().valid());
    let playback = r#"{"version":2,"atMs":10,"sessionId":"100-abc","contextId":1,"kind":"playback-check","contextState":"running","reasons":["end-event-overdue"],"stage":"overdue","wallElapsedMs":3500,"audioProgressMs":1000,"expectedMs":2000,"callbackLagMs":0}"#;
    let event: TimingEvent = serde_json::from_str(playback).unwrap(); assert!(event.valid());
  }
  #[cfg(unix)]
  #[test]
  fn refuses_a_symlink_at_log_path() {
    let dir = temp_dir(); fs::create_dir_all(&dir).unwrap();
    std::os::unix::fs::symlink(dir.join("somewhere-else"), file(&dir, 0)).unwrap();
    assert!(append(&dir, b"test\n", 2, 100).is_err());
    fs::remove_dir_all(dir).unwrap();
  }
}

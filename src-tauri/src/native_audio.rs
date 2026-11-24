use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioResult { started_at_ms: u64, duration_ms: u32 }

#[cfg(target_os = "macos")]
extern "C" { fn hb_native_audio_play(bytes: *const u8, length: usize, volume: f64, started_ms: *mut f64, duration_ms: *mut f64) -> i32; }

#[tauri::command]
pub async fn native_audio_clip<R: Runtime>(caller: WebviewWindow<R>, bytes: Vec<u8>, volume: f64) -> Result<NativeAudioResult, String> {
  if caller.label() != "main" { return Err("Only the main window may play audio".into()); }
  if !volume.is_finite() || !(0.0..=1.0).contains(&volume) || bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 { return Err("Invalid native audio input".into()); }
  #[cfg(target_os = "macos")]
  {
    let (mut started, mut duration) = (0.0, 0.0);
    let played = unsafe { hb_native_audio_play(bytes.as_ptr(), bytes.len(), volume, &mut started, &mut duration) };
    if played != 1 || !started.is_finite() || started <= 0.0 || !duration.is_finite() || !(0.0..=600_000.0).contains(&duration) { return Err("Native playback failed".into()); }
    Ok(NativeAudioResult { started_at_ms: started.round() as u64, duration_ms: duration.round() as u32 })
  }
  #[cfg(not(target_os = "macos"))]
  { let _ = (bytes, volume); Err("Native playback requires macOS".into()) }
}

#[tauri::command]
pub async fn native_audio_diagnostic<R: Runtime>(caller: WebviewWindow<R>, volume: f64) -> Result<NativeAudioResult, String> {
  if caller.label() != "main" { return Err("Only the main window may play diagnostic audio".into()); }
  if !volume.is_finite() || !(0.0..=1.0).contains(&volume) { return Err("Invalid diagnostic audio volume".into()); }
  #[cfg(target_os = "macos")]
  {
    let bytes = include_bytes!("../../src/assets/voices/laura/minute-01.mp3");
    let (mut started, mut duration) = (0.0, 0.0);
    // The bridge copies bytes before returning; it retains the player separately.
    let played = unsafe { hb_native_audio_play(bytes.as_ptr(), bytes.len(), volume, &mut started, &mut duration) };
    if played != 1 || !started.is_finite() || started <= 0.0 || !duration.is_finite() || !(0.0..=600_000.0).contains(&duration) { return Err("Native diagnostic playback failed".into()); }
    Ok(NativeAudioResult { started_at_ms: started.round() as u64, duration_ms: duration.round() as u32 })
  }
  #[cfg(not(target_os = "macos"))]
  { let _ = volume; Err("Native diagnostic playback requires macOS".into()) }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
  use super::*;
  #[test]
  fn bundled_comparison_clip_starts_with_silent_volume_and_returns_timing() {
    let bytes = include_bytes!("../../src/assets/voices/laura/minute-01.mp3");
    let (mut started, mut duration) = (0.0, 0.0);
    let result = unsafe { hb_native_audio_play(bytes.as_ptr(), bytes.len(), 0.0, &mut started, &mut duration) };
    assert_eq!(result, 1);
    assert!(started > 1_000_000_000_000.0);
    assert!(duration > 1000.0 && duration < 20_000.0);
  }
}

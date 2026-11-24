use tauri::{
  menu::{MenuBuilder, MenuItemBuilder},
  tray::TrayIconBuilder,
  AppHandle, Emitter, Listener, Manager, Runtime, WindowEvent,
};

mod overlay;
mod native_audio;
mod diagnostic_display;
mod timing_log;

const EVENT_TRAY_COMMAND: &str = "heartbeat://tray-command";
const EVENT_TRAY_STATUS: &str = "heartbeat://tray-status";
const ID_TRAY_OPEN: &str = "tray-open";
const ID_TRAY_TOGGLE_RUNNING: &str = "tray-toggle-running";
const ID_TRAY_TOGGLE_MUTE: &str = "tray-toggle-mute";
const ID_TRAY_TOGGLE_AUTOSTART: &str = "tray-toggle-autostart";
const ID_TRAY_QUIT: &str = "tray-quit";

fn emit_tray_command<R: Runtime>(app: &AppHandle<R>, command: &str) {
  let _ = app.emit(EVENT_TRAY_COMMAND, command);
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn set_tray_tooltip<R: Runtime>(app: &AppHandle<R>, text: &str) {
  if let Some(tray) = app.tray_by_id("main") {
    let _ = tray.set_tooltip(Some(text));
  }
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let open_item = MenuItemBuilder::with_id(ID_TRAY_OPEN, "Open").build(app)?;
  let toggle_running_item = MenuItemBuilder::with_id(ID_TRAY_TOGGLE_RUNNING, "Start/Pause Chimes").build(app)?;
  let toggle_mute_item = MenuItemBuilder::with_id(ID_TRAY_TOGGLE_MUTE, "Mute/Unmute").build(app)?;
  let toggle_autostart_item =
    MenuItemBuilder::with_id(ID_TRAY_TOGGLE_AUTOSTART, "Toggle Launch at Login").build(app)?;
  let quit_item = MenuItemBuilder::with_id(ID_TRAY_QUIT, "Quit").build(app)?;

  let tray_menu = MenuBuilder::new(app)
    .items(&[
      &open_item,
      &toggle_running_item,
      &toggle_mute_item,
      &toggle_autostart_item,
      &quit_item,
    ])
    .build()?;

  let icon = app.default_window_icon().cloned();
  let mut tray_builder = TrayIconBuilder::with_id("main").menu(&tray_menu);
  if let Some(icon) = icon {
    tray_builder = tray_builder.icon(icon);
  }
  tray_builder
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      ID_TRAY_OPEN => focus_main_window(app),
      ID_TRAY_TOGGLE_RUNNING => emit_tray_command(app, "toggle-running"),
      ID_TRAY_TOGGLE_MUTE => emit_tray_command(app, "toggle-mute"),
      ID_TRAY_TOGGLE_AUTOSTART => emit_tray_command(app, "toggle-autostart"),
      ID_TRAY_QUIT => app.exit(0),
      _ => {}
    })
    .build(app)?;

  set_tray_tooltip(app, "Heartbeat · Paused · Volume 75% · Launch at login Off");

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(overlay::OverlayState::default())
    .manage(diagnostic_display::DiagnosticState::default())
    .manage(timing_log::TimingLogLock::default())
    .invoke_handler(tauri::generate_handler![native_audio::native_audio_diagnostic, native_audio::native_audio_clip, diagnostic_display::diagnostic_display_set, diagnostic_display::diagnostic_display_event, diagnostic_display::diagnostic_display_cue, timing_log::timing_log_path, timing_log::timing_log_configure, timing_log::timing_log_append, overlay::overlay_monitors, overlay::overlay_prewarm, overlay::overlay_show, overlay::overlay_hide, overlay::overlay_ready, overlay::overlay_speech, overlay::overlay_audio_timing, overlay::overlay_motion_preference, overlay::overlay_character_loaded])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      app.handle().plugin(tauri_plugin_autostart::Builder::new().build())?;
      setup_tray(app.handle())?;
      let app_handle = app.handle().clone();
      let listener_handle = app_handle.clone();
      app_handle.listen(EVENT_TRAY_STATUS, move |event| {
        if let Ok(text) = serde_json::from_str::<String>(event.payload()) {
          if !text.trim().is_empty() {
            set_tray_tooltip(&listener_handle, &text);
          }
        }
      });
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    use std::{path::PathBuf, process::Command};
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let object = out.join("native_audio.o");
    let library = out.join("libheartbeat_native_audio.a");
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() { Ok("aarch64") => "arm64", Ok("x86_64") => "x86_64", _ => panic!("Unsupported macOS architecture for native diagnostic player") };
    let status = Command::new("xcrun").args(["clang", "-fobjc-arc", "-arch", arch, "-c", "src/native_audio.m", "-o"]).arg(&object).status().expect("xcrun clang is required for macOS audio diagnostics");
    assert!(status.success(), "Failed to compile native diagnostic player");
    let status = Command::new("xcrun").arg("ar").arg("crs").arg(&library).arg(&object).status().expect("xcrun ar is required");
    assert!(status.success(), "Failed to archive native diagnostic player");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=heartbeat_native_audio");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rerun-if-changed=src/native_audio.m");
  }
  tauri_build::build()
}

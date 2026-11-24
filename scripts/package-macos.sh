#!/bin/sh
# Build in a private temporary target and keep the finished app outside it.
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo 'This packaging workflow requires macOS.' >&2
  exit 1
fi
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$repo_dir"
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/heartbeat-build.XXXXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
CARGO_TARGET_DIR="$build_dir" npm run tauri:build:app
source_app="$build_dir/release/bundle/macos/Heartbeat Chime Community.app"
if [ ! -f "$source_app/Contents/MacOS/app" ]; then
  echo 'Built app executable not found; no artifact staged.' >&2
  exit 1
fi
mkdir -p artifacts
artifact_dir=$(mktemp -d "$repo_dir/artifacts/heartbeat-$(date +%Y%m%d-%H%M%S)-XXXXXXXX")
if ! ditto "$source_app" "$artifact_dir/Heartbeat Chime Community.app"; then
  echo "Copy failed; inspect the incomplete artifact at $artifact_dir" >&2
  exit 1
fi
if [ ! -f "$artifact_dir/Heartbeat Chime Community.app/Contents/MacOS/app" ]; then
  echo "Copy verification failed; inspect $artifact_dir" >&2
  exit 1
fi
staged_app="$artifact_dir/Heartbeat Chime Community.app"
if ! codesign --verify --deep --strict "$staged_app" 2>/dev/null; then
  heartbeat_signature_details=$(codesign -d --verbose=2 "$staged_app" 2>&1 || true)
  case "$heartbeat_signature_details" in
    *"Signature=adhoc"*|*"code object is not signed at all"*)
      # Seal local linker-signed/unsigned builds as complete bundles. Never
      # replace a developer signature, including one that failed verification.
      codesign --force --sign - "$staged_app"
      printf 'Applied a local ad-hoc bundle signature (not notarization).\n'
      ;;
    *)
      printf 'App signature failed verification; refusing to replace a developer or unknown signature. Inspect %s\n' "$staged_app" >&2
      exit 1
      ;;
  esac
fi
codesign --verify --deep --strict "$staged_app"
printf '\nPackaged app: %s\n' "$artifact_dir/Heartbeat Chime Community.app"
printf 'Move or copy this bundle to your chosen permanent location before deleting artifacts.\n'

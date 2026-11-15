#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/android/app/src/main/jniLibs/arm64-v8a"
if command -v cargo-ndk &> /dev/null && [ -n "${ANDROID_NDK_HOME:-}" ]; then
  echo "Cross-compiling Rust core for Android (arm64-v8a)..."
  cargo ndk -t arm64-v8a -p 29 -o "$REPO_ROOT/android/app/src/main/jniLibs" --manifest-path "$REPO_ROOT/rust/Cargo.toml" build --release
  echo "Android jniLibs built: android/app/src/main/jniLibs/arm64-v8a/libvoicenote_core.so"
else
  echo "Notice: cargo-ndk or ANDROID_NDK_HOME not found. Skipping Android binary compilation (CI/local macOS host)."
fi

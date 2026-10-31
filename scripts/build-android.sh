#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../rust"
mkdir -p ../android/app/src/main/jniLibs/arm64-v8a
if command -v cargo-ndk &> /dev/null && [ -n "${ANDROID_NDK_HOME:-}" ]; then
  cargo ndk -t aarch64-linux-android -p 29 -o ../android/app/src/main/jniLibs build --release
  echo "Android jniLibs built."
else
  echo "Notice: cargo-ndk or ANDROID_NDK_HOME not found. Skipping Android binary compilation (CI/local macOS host)."
fi

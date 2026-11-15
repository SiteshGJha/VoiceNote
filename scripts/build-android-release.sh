#!/usr/bin/env bash
set -euo pipefail

# ANSI color codes for diagnostics
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo -e "${BLUE}=== VoiceNote Android Standalone Release APK Builder ===${NC}"

# 1. Pre-Flight Checks
echo "Running pre-flight environment diagnostics..."

# Node.js check
if ! command -v node &> /dev/null; then
  echo -e "${RED}ERROR: Node.js is not installed.${NC}"
  echo -e "${YELLOW}Remediation: nvm use 18 || brew install node@18${NC}"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}ERROR: Node.js >= 18 is required (found v$(node -v)).${NC}"
  echo -e "${YELLOW}Remediation: nvm use 18 || brew install node@18${NC}"
  exit 1
fi

# JDK 17 check
if ! command -v javac &> /dev/null; then
  echo -e "${RED}ERROR: JDK is not installed.${NC}"
  echo -e "${YELLOW}Remediation: brew install openjdk@17${NC}"
  exit 1
fi
JAVA_VER=$(javac -version 2>&1 | awk '{print $2}' | cut -d. -f1)
if [ "$JAVA_VER" != "17" ]; then
  echo -e "${RED}ERROR: Java 17 is required for AGP 8.5 (found javac $JAVA_VER).${NC}"
  echo -e "${YELLOW}Remediation: brew install openjdk@17 && export JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home${NC}"
  exit 1
fi

# ANDROID_HOME check
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo -e "${RED}ERROR: ANDROID_HOME environment variable is not set or directory does not exist.${NC}"
  echo -e "${YELLOW}Remediation: export ANDROID_HOME=\$HOME/Library/Android/sdk${NC}"
  exit 1
fi

# ANDROID_NDK_HOME check
if [ -z "${ANDROID_NDK_HOME:-}" ] || [ ! -d "$ANDROID_NDK_HOME" ]; then
  echo -e "${RED}ERROR: ANDROID_NDK_HOME environment variable is not set or directory does not exist.${NC}"
  echo -e "${YELLOW}Remediation: export ANDROID_NDK_HOME=\$ANDROID_HOME/ndk/<version> (e.g. 26.1.10909125)${NC}"
  exit 1
fi

# cargo-ndk check
if ! command -v cargo-ndk &> /dev/null; then
  echo -e "${RED}ERROR: 'cargo-ndk' is not installed.${NC}"
  echo -e "${YELLOW}Remediation: cargo install cargo-ndk${NC}"
  exit 1
fi

# Rust target aarch64-linux-android check
if command -v rustup &> /dev/null; then
  if ! rustup target list 2>/dev/null | grep -q "aarch64-linux-android (installed)"; then
    echo -e "${RED}ERROR: Rust target 'aarch64-linux-android' is not installed.${NC}"
    echo -e "${YELLOW}Remediation: rustup target add aarch64-linux-android${NC}"
    exit 1
  fi
fi

# Dynamic apksigner resolution
APKSIGNER=$(ls -1 "$ANDROID_HOME/build-tools/"*/apksigner 2>/dev/null | tail -n 1 || true)
if [ -z "$APKSIGNER" ] || [ ! -x "$APKSIGNER" ]; then
  echo -e "${RED}ERROR: 'apksigner' not found in $ANDROID_HOME/build-tools/.${NC}"
  echo -e "${YELLOW}Remediation: Install Android SDK Build-Tools via SDK Manager: sdkmanager 'build-tools;34.0.0'${NC}"
  exit 1
fi

echo -e "${GREEN}Pre-flight checks passed!${NC}"

# 2. Quality Gates
echo "Running quality audits and test suites..."
npm run audit:privacy
npm test

# 3. Ensure Output Directory
mkdir -p "$REPO_ROOT/dist"

# 4. Keystore Provisioning
KEYSTORE_PATH="${VN_KEYSTORE_PATH:-$REPO_ROOT/android/app/voicenote-release.keystore}"
if [ ! -f "$KEYSTORE_PATH" ]; then
  echo "Release keystore missing; generating default developer keystore..."
  "$REPO_ROOT/scripts/generate-android-keystore.sh"
fi

# 5. Compile Rust Android JNI Shared Library
echo "Cross-compiling Rust core JNI libraries for Android..."
"$REPO_ROOT/scripts/build-android.sh"

# 6. Assemble Standalone Release APK
echo "Compiling and assembling release APK via Gradle..."
cd "$REPO_ROOT/android"
chmod +x gradlew
./gradlew assembleRelease

cd "$REPO_ROOT"
ASSEMBLED_APK="$REPO_ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$ASSEMBLED_APK" ]; then
  # Check if split ABI apk was generated
  ASSEMBLED_APK="$REPO_ROOT/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk"
fi

if [ ! -f "$ASSEMBLED_APK" ]; then
  echo -e "${RED}ERROR: Release APK not found in expected build outputs.${NC}"
  exit 1
fi

# 7. Signature Verification
echo "Verifying APK signature using apksigner..."
"$APKSIGNER" verify --verbose "$ASSEMBLED_APK"

# 8. Copy to dist
DEST_APK="$REPO_ROOT/dist/VoiceNote-1.0.0-arm64-v8a.apk"
cp "$ASSEMBLED_APK" "$DEST_APK"
echo -e "${GREEN}APK successfully generated at: $DEST_APK${NC}"

# 9. Binary Size Ceiling Assertion (< 80 MB)
FILE_SIZE_MB=$(du -m "$DEST_APK" | cut -f1)
echo "APK Package Size: ${FILE_SIZE_MB} MB (Ceiling: 80 MB)"

if [ "$FILE_SIZE_MB" -gt 80 ]; then
  echo -e "${RED}ERROR: Package size ($FILE_SIZE_MB MB) exceeds the 80 MB ceiling!${NC}"
  echo -e "${RED}Ensure that ML model weights (*.bin, *.gguf, *.onnx) are not bundled in assets.${NC}"
  exit 1
fi

echo -e "${GREEN}=== Android Standalone APK Build Complete: dist/VoiceNote-1.0.0-arm64-v8a.apk (${FILE_SIZE_MB} MB) ===${NC}"

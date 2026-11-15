# VoiceNote Standalone Packaging & Distribution Guide

This document defines the standalone build, signing, and installation workflows for distributing VoiceNote on **macOS Desktop** (`.dmg`) and **Android Mobile** (`.apk`).

---

## 1. Architectural & Privacy Invariants

All VoiceNote production installers strictly adhere to the project's core non-negotiable principles:
- **100% Offline Core Runtime**: Speech recognition (Whisper) and tone rewriting (SLM) run entirely on-device. Packaged binaries never initiate outbound network connections for inference.
- **Zero Telemetry**: No third-party analytics, crash reporting, tracking, or remote config SDKs. Verified via `npm run audit:privacy`.
- **Zero Bundled Model Weights**: Installation binaries must remain strictly under **80 MB**. Whisper and SLM model weights are never bundled into application assets; they are downloaded on first run via user consent and stored in the app sandbox.
- **Automated Size Ceiling Assertion**: Both build scripts (`build-macos-dmg.sh` and `build-android-release.sh`) automatically assert that output packages do not exceed 80 MB. If an artifact exceeds this limit, the build aborts immediately.

---

## 2. Toolchain Prerequisites

### Common Requirements
- **Node.js**: `>= 18.0.0`
- **Rust**: `>= 1.75.0` (`cargo --version`)

### macOS DMG Toolchain
- **Xcode & Command Line Tools**: Xcode 15+ (`xcode-select -p`)
- **CocoaPods**: `pod --version`
- **Rust Dual Targets**:
  ```bash
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  ```
- **create-dmg** (Optional, recommended):
  ```bash
  brew install create-dmg
  ```
  *(Note: If `create-dmg` is absent, the build script automatically falls back to standard macOS `hdiutil`.)*

### Android Release APK Toolchain
- **JDK**: Java 17 (`javac -version`)
  ```bash
  brew install openjdk@17
  export JAVA_HOME="/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home"
  ```
- **Android SDK**: API Platform 34 & Build-Tools
  ```bash
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  ```
- **Android NDK**: NDK r26b or r27
  ```bash
  export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
  ```
- **cargo-ndk**:
  ```bash
  cargo install cargo-ndk
  ```
- **Rust Android Target**:
  ```bash
  rustup target add aarch64-linux-android
  ```

---

## 3. macOS Universal DMG Packaging

### Build Command
```bash
npm run build:macos:dmg
# Alternatively: ./scripts/build-macos-dmg.sh
```

### Pipeline Overview
1. **Pre-flight Checks**: Validates Node >= 18, Xcode, CocoaPods, and Rust targets.
2. **Quality Gates**: Runs `npm run audit:privacy` and `npm test` before compilation.
3. **Universal Rust Compilation**: Compiles dual slices (`aarch64` and `x86_64`) and merges them via `lipo -create` into `macos/build/rust/libvoicenote_core.a`.
4. **Offline JavaScript Bundle**: Generates standalone `macos/voicenote-macOS/main.jsbundle` and assets.
5. **Headless Xcode Archive**: Executes `xcodebuild archive` in Release configuration.
6. **Inside-Out Ad-Hoc Codesign**: Signs nested frameworks in `Contents/Frameworks/` before the top-level `VoiceNote.app` bundle.
7. **DMG Volume Layout**: Stages `VoiceNote.app` into an intermediate `dmg-root/` folder and creates `dist/VoiceNote-1.0.0.dmg`.
8. **Size Assertion**: Asserts `VoiceNote-1.0.0.dmg` < 80 MB.

### End-User Installation & Gatekeeper Bypass
Because VoiceNote uses ad-hoc self-signing:
1. Double-click `dist/VoiceNote-1.0.0.dmg` to mount the disk image.
2. Drag `VoiceNote.app` into `/Applications`.
3. If macOS Gatekeeper blocks execution ("unidentified developer" or "damaged app"):
   - **GUI Bypass**: Secondary-click (Right-Click) `VoiceNote.app` in `/Applications` and select **Open**, then click **Open** on the confirmation dialog.
   - **Terminal Bypass**: Strip the Apple quarantine attribute:
     ```bash
     xattr -cr /Applications/VoiceNote.app
     ```

---

## 4. Android Standalone Release APK Packaging

### Build Command
```bash
npm run build:android:release
# Alternatively: ./scripts/build-android-release.sh
```

### Signing Configuration & Keystores
The build script automatically provisions a local release keystore at `android/app/voicenote-release.keystore` if none exists:
```bash
npm run generate:android:keystore
# Alternatively: ./scripts/generate-android-keystore.sh
```
To supply external production credentials (e.g. in CI/CD), set the following environment variables:
- `VN_KEYSTORE_PATH`: Absolute path to custom keystore file.
- `VN_KEYSTORE_PASSWORD`: Keystore password.
- `VN_KEY_ALIAS`: Key alias.
- `VN_KEY_PASSWORD`: Key password.

*(Note: Keystores are strictly gitignored.)*

### Pipeline Overview
1. **Pre-flight Checks**: Validates Node >= 18, JDK 17, Android SDK/NDK, `cargo-ndk`, `aarch64-linux-android`, and `apksigner`.
2. **Quality Gates**: Runs `npm run audit:privacy` and `npm test`.
3. **Rust JNI Cross-Compilation**: Uses `cargo ndk` to compile `libvoicenote_core.so` targeting `arm64-v8a` (Android API 29+).
4. **Gradle Assembly**: Runs `./gradlew assembleRelease`, bundling offline JavaScript (`index.android.bundle`), linking JNI, aligning, and signing the APK.
5. **Signature Validation**: Executes `apksigner verify --verbose` to guarantee package integrity.
6. **Size Assertion**: Asserts `VoiceNote-1.0.0-arm64-v8a.apk` < 80 MB before copying to `dist/`.

### Sideloading Instructions
1. Enable **Install unknown apps** in Android Settings for your browser or file manager.
2. Transfer `dist/VoiceNote-1.0.0-arm64-v8a.apk` to your Android device via USB, or install via ADB:
   ```bash
   adb install -r dist/VoiceNote-1.0.0-arm64-v8a.apk
   ```
3. Launch VoiceNote. Only the `RECORD_AUDIO` permission is requested on first capture.

---

## 5. Verification & Quality Assurance

Run the automated packaging sanity test suite:
```bash
npm test tests/native/packagingSanity.test.ts
```

Run privacy and type safety audits:
```bash
npm run audit:privacy
npm run typecheck
```

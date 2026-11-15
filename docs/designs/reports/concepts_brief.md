# Standalone Android APK & macOS DMG Production Packaging

* **Author:** Sitesh Jha
* **Date:** 2026-11-15

## Overview

VoiceNote requires standalone production packaging pipelines to distribute installable application binaries without running a local Metro development server. The project targets macOS (Universal arm64 and x86_64 desktop) and Android (arm64-v8a mobile devices). This feature establishes headless, reproducible build and packaging configurations:
1. An ad-hoc signed macOS `.dmg` installer containing a pre-bundled JavaScript runtime (`main.jsbundle`) and universal compiled Rust engine (`libvoicenote_core.a` merged via `lipo`).
2. A standalone signed Android `.apk` installer by bootstrapping the missing React Native 0.76 Gradle build system, JNI C-FFI exports, automated local keystore provisioning, and Android `AudioRecord` capture bridge to interface with `libvoicenote_core.so`.
3. Comprehensive developer documentation (`docs/PACKAGING.md`) detailing build commands, prerequisite toolchains, signing procedures, Gatekeeper bypass steps, and sideloading verification steps.

Both packaging pipelines strictly enforce the project's non-negotiable privacy and resource limits: zero telemetry, zero cloud inference, post-install on-demand model downloading (enforcing an automated hard ceiling of 80 MB on all installer packages), and memory isolation under 500 MB RAM.

## Analysis

### 1. Contrarian & Architecture Scope (`egm-zoom-out` & `egm-design`)
* **Thin Installers vs. Offline Bundling**: Bundling Whisper GGML (~145 MB) and SLM GGUF (~350 MB) weights directly into the APK or DMG would bloat installer packages to > 500 MB, violating PRD Section 27 and creating severe memory extraction bottlenecks. The build pipelines enforce an automated hard ceiling of **80 MB** on generated `.apk` and `.dmg` files. If package size exceeds 80 MB, the build immediately aborts with an error indicating accidental inclusion of model weights.
* **Ad-hoc Signing vs. Gatekeeper Friction**: Ad-hoc code signing (`codesign --sign -`) on macOS avoids the recurring fees of the Apple Developer Program but triggers macOS Gatekeeper warnings on fresh systems. The packaging guide explicitly documents user bypass steps: secondary-click "Open" and the terminal quarantine removal command `xattr -cr /Applications/VoiceNote.app`.
* **Direct APK Sideloading vs. Play Store**: Producing standalone signed APKs requires handling Android's "Install unknown apps" security prompts. The guide outlines user steps and emphasizes that the application requests only the `RECORD_AUDIO` permission.

### 2. Android Scaffolding & Native Integration (`egm-codebase-details`)
* **Gradle Build Tree Initialization**: The repository currently holds only `android/app/src/main/AndroidManifest.xml`. Building an APK requires bootstrapping root `build.gradle` (AGP 8.5.2, Kotlin 1.9.24), `settings.gradle` with React Native autolinking plugins, `gradle.properties`, `android/app/build.gradle`, and `android/app/proguard-rules.pro`.
* **Rust Cross-Compilation (`cargo ndk`)**: Compiling `rust/voicenote-core` into `libvoicenote_core.so` requires targeting `aarch64-linux-android` (arm64-v8a) and `x86_64-linux-android`. The build pipeline integrates `cargo ndk` to output binaries directly into `android/app/src/main/jniLibs/`.
* **Native Audio Bridge Parity**: To mirror the functionality of `AppDelegate.mm` on macOS, an Android native module (`VoiceNoteNativeAudioModule.kt`) captures 16 kHz 16-bit mono PCM via `AudioRecord`, passes data to `voicenote-core` through JNI bindings (`VoiceNoteCoreJni.kt`), and emits rolling chunk events (`onChunkReady`, `onCeilingReached`) to the JavaScript runtime.
* **Automated Local Keystore Provisioning**: For standalone APK generation, `scripts/build-android-release.sh` checks for an existing signing keystore. If neither environment variables (`VN_KEYSTORE_PATH`) nor local keys exist, it automatically invokes `scripts/generate-android-keystore.sh` to generate a local developer keystore (`android/app/voicenote-release.keystore`, gitignored) with predictable default aliases, preventing build stalls.

### 3. Build Reproducibility & Universal Binaries (`egm-structural` & `egm-implementation-readiness`)
* **Universal macOS Binaries via `lipo`**: The macOS packaging script compiles `rust/voicenote-core` for both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets, merges them using `lipo -create -output macos/build/rust/libvoicenote_core.a`, and configures Xcode to build a universal release archive supporting both Apple Silicon and Intel Macs.
* **Fail-Fast Toolchain Pre-flight**: Build scripts inspect required dependencies before starting compilation (JDK 17, Android SDK 34, Android NDK r26b/r27, `cargo-ndk`, Rust targets, Xcode CLI tools, CocoaPods, and `create-dmg`). If any tool is missing, the script immediately aborts with non-zero exit code and outputs exact installation commands (e.g. `brew install create-dmg`, `cargo install cargo-ndk`, `rustup target add ...`).
* **Isolated Distribution Outputs**: All generated installers are output to a clean root `dist/` directory (`dist/VoiceNote-1.0.0.dmg` and `dist/VoiceNote-1.0.0-arm64-v8a.apk`), cleanly separated from transient compilation caches.
* **Pre-Build Verification Gates**: Build scripts execute `npm run audit:privacy` and `npm test` before packaging to prevent releasing binaries with telemetry regressions or test failures.

## Goals vs. Non-Goals

### In-Scope Goals
* **Android Scaffolding**: Create the complete React Native 0.76 Gradle and Kotlin project structure in `android/` required to build release APKs.
* **Rust JNI Exports**: Add JNI C-FFI bindings to `rust/voicenote-core` and build scripts using `cargo ndk` for `arm64-v8a` and `x86_64`.
* **Android Native Audio Capture**: Implement `AudioRecord` background capture and JNI audio processing matching the existing `src/native/nativeAudio.ts` contract.
* **Universal macOS DMG Packaging**: Implement `scripts/build-macos-dmg.sh` to compile dual-architecture Rust static libraries via `lipo`, bundle JavaScript, build universal release `.app`, apply ad-hoc signatures, and generate a `.dmg` under 80 MB.
* **Android Standalone Release Packaging**: Implement `scripts/build-android-release.sh` with automatic keystore provisioning, NDK compilation, and signed APK assembly under 80 MB.
* **Fail-Fast Diagnostics**: Incorporate pre-flight prerequisite checks that abort immediately with exact installation remediation steps.
* **Packaging Documentation**: Author `docs/PACKAGING.md` providing step-by-step instructions for prerequisites, compilation, signing, installation, and troubleshooting.

### Out-of-Scope Non-Goals
* Publishing to the Google Play Store or configuring Android App Bundles (`.aab`).
* Paid Apple Developer ID certificates or automated `xcrun notarytool` cloud notarization.
* Windows (`react-native-windows`) or Linux desktop packaging.
* In-app binary self-updating mechanisms.

## Alternatives Weighed

1. **Bundling ML Models into Application Installers**:
   * *Rejected*: Bundling Whisper and SLM models directly into APK and DMG assets creates installer files > 500 MB. This increases distribution overhead, consumes device storage before feature verification, and violates the PRD rule that models must be downloaded post-install after verifying device disk quota headroom. Enforced via a strict 80 MB build ceiling assertion.
2. **Apple Silicon-Only (`arm64`) vs. Universal Binary (`lipo`)**:
   * *Rejected Single Architecture*: While Apple Silicon represents the primary modern Mac userbase, Intel x86_64 Macs remain common in desktop environments. Building dual-target static libraries via `lipo` adds minimal build overhead while guaranteeing universal compatibility across all macOS 13+ devices.
3. **Interactive Password Prompts vs. Automated Keystore Defaults**:
   * *Rejected Interactive Prompts*: Forcing interactive password entry blocks headless and automated build runs. Providing automated local keystore generation with default credentials (overridable by environment variables) guarantees reproducible, non-blocking builds.
4. **Permissive Warning on Missing Toolchains vs. Immediate Fail-Fast Abort**:
   * *Rejected Permissive Fallback*: Allowing builds to proceed when core toolchains (like `cargo-ndk` or `create-dmg`) are missing leads to obscure compiler errors deep in the build log. Aborting immediately with exact copy-paste remediation commands minimizes developer troubleshooting time.

## Key Decisions & Staging for Next Steps

1. **Phase 1: Rust Android JNI & Dual macOS Architecture Compilation**
   - Add JNI bridge (`android_jni.rs`) in `rust/voicenote-core`.
   - Update `scripts/build-android.sh` to cross-compile `libvoicenote_core.so` for `arm64-v8a` and `x86_64`.
   - Update `scripts/build-macos.sh` to cross-compile for `aarch64-apple-darwin` and `x86_64-apple-darwin`, combining them via `lipo`.
2. **Phase 2: Android Platform Harness & Audio Bridge**
   - Scaffold root `build.gradle`, `settings.gradle`, `gradle.properties`, and `android/app/build.gradle`.
   - Implement `VoiceNoteNativeAudioModule.kt` and `VoiceNoteCoreJni.kt` implementing the native audio recording and silence trimming contracts.
3. **Phase 3: Automated Packaging Scripts & Fail-Fast Tooling**
   - Write `scripts/generate-android-keystore.sh` for local release signing keys.
   - Write `scripts/build-android-release.sh` with toolchain pre-flight checks, automatic keystore provisioning, and an 80 MB package size assertion.
   - Write `scripts/build-macos-dmg.sh` with toolchain pre-flight checks, `lipo` universal merging, `create-dmg` (with `hdiutil` fallback), and an 80 MB package size assertion.
4. **Phase 4: Developer Guide & Verification Suite**
   - Write `docs/PACKAGING.md` detailing toolchain prerequisites, build steps, and Gatekeeper/sideloading bypasses.
   - Verify that all builds pass privacy audits, run unit tests, and maintain installer sizes under 80 MB.

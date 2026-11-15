# Task Plan: Standalone Android APK & macOS DMG Production Packaging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create standalone release packaging pipelines and scaffolding for VoiceNote to produce an ad-hoc signed universal macOS DMG (`dist/VoiceNote-1.0.0.dmg`) and signed standalone Android APK (`dist/VoiceNote-1.0.0-arm64-v8a.apk`), enforcing an 80 MB ceiling and 100% offline-first runtime.

**Architecture:** Decoupled platform packaging pipelines (`scripts/build-macos-dmg.sh` and `scripts/build-android-release.sh`) anchored to repository root. macOS builds compile dual-architecture static Rust slices (`aarch64` + `x86_64`) merged via `lipo`, bundle offline JavaScript (`main.jsbundle`), archive via `xcodebuild`, apply inside-out ad-hoc codesign, and stage an intermediate `dmg-root` volume. Android scaffolds a full React Native 0.76 Gradle/NDK hierarchy (`AGP 8.5.2`, `Kotlin 1.9.24`, `Gradle 8.8`), cross-compiles `libvoicenote_core.so` via `cargo ndk` (API 29), provisions a gitignored release keystore, and compiles signed APKs via `./gradlew assembleRelease`.

**Tech Stack:** React Native 0.76, Rust 1.75+, Cargo NDK, Gradle 8.8, AGP 8.5.2, Kotlin 1.9.24, Xcode 15+, Apple `lipo`, `codesign`, `create-dmg` / `hdiutil`, Android SDK 34 / NDK r26b/r27, `apksigner`.

**Spec:** [`docs/designs/standalone_android_apk_and_macos_dmg_packaging.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/standalone_android_apk_and_macos_dmg_packaging.md)

---

## 1. Global Constraints

- **Zero Cloud Inference**: ASR and SLM run 100% on-device; no external API endpoints are touched during runtime.
- **Zero Telemetry**: No analytics, tracking, or phoning home SDKs.
- **No Bundled Model Weights**: Installation binaries must remain strictly under **80 MB**; models are downloaded on demand after install.
- **Headless & Idempotent**: Scripts run non-interactively in terminal/CI and abort immediately with exact remediation commands if any toolchain prerequisite is missing.
- **Git Hygiene**: Generated keystores (`voicenote-release.keystore`), DMG images (`*.dmg`), archives (`*.xcarchive`), and compiled JNI libraries (`android/app/src/main/jniLibs/`) must never be committed to git.

---

## 2. Review Focus

1. **Pre-flight Dependency Detection**: Missing JDK 17, Android NDK, `cargo-ndk`, or Rust targets must abort immediately with exit code 1 and exact remediation commands.
2. **DMG Volume Layout**: Passing `.app` directly as `-srcfolder` unpacks files at the root of the volume; script must stage into `build/macos/dmg-root/` so `VoiceNote.app` appears alongside `/Applications`.
3. **macOS Inside-Out Codesign**: Nested frameworks and dylibs in `Contents/Frameworks/` must be signed before the top-level bundle to avoid `--deep` invalidation.
4. **Binary Size Ceiling**: Any package exceeding 80 MB must fail packaging with an explicit error identifying probable model weight bundling.
5. **Executable Permissions**: All `.sh` scripts and `gradlew` must have executable permissions (`chmod +x`).

---

## 3. Required API Contracts & Interface Definitions

### A. Rust JNI Bridge (`rust/voicenote-core/src/android_jni.rs`)
```rust
#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_trimSilenceWav(
    mut env: JNIEnv,
    _class: JClass,
    input_path: JString,
    output_path: JString,
) -> jboolean;

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_verifyFileChecksum(
    mut env: JNIEnv,
    _class: JClass,
    file_path: JString,
    expected_sha256: JString,
) -> jboolean;

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_transcribeAudio(
    mut env: JNIEnv,
    _class: JClass,
    file_path: JString,
    language: JString,
    model_path: JString,
) -> jobject;

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_getCoreVersion(
    env: JNIEnv,
    _class: JClass,
) -> jstring;
```

### B. Kotlin JNI Interface (`android/app/src/main/java/com/voicenote/core/VoiceNoteCoreJni.kt`)
```kotlin
package com.voicenote.core

data class VoiceNoteAsrResult(
    val text: String,
    val language: String,
    val durationMs: Long
)

object VoiceNoteCoreJni {
    init {
        System.loadLibrary("voicenote_core")
    }

    @JvmStatic external fun trimSilenceWav(inputPath: String, outputPath: String): Boolean
    @JvmStatic external fun verifyFileChecksum(filePath: String, expectedSha256: String): Boolean
    @JvmStatic external fun transcribeAudio(filePath: String, language: String, modelPath: String): VoiceNoteAsrResult
    @JvmStatic external fun getCoreVersion(): String
}
```

### C. Android Native Audio Module (`VoiceNoteNativeAudioModule.kt`)
```kotlin
package com.voicenote.nativeaudio

import com.facebook.react.bridge.*

class VoiceNoteNativeAudioModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "VoiceNoteNativeAudio"

    @ReactMethod fun startRecording(promise: Promise)
    @ReactMethod fun stopRecording(promise: Promise)
    @ReactMethod fun startRollingRecording(options: ReadableMap?, promise: Promise)
    @ReactMethod fun stopRollingRecording(promise: Promise)
    @ReactMethod fun cancelRollingRecording(promise: Promise)
    @ReactMethod fun downloadFile(url: String, targetPath: String, promise: Promise)
    @ReactMethod fun verifyFileChecksum(filePath: String, expectedSha256: String, promise: Promise)
    @ReactMethod fun moveFile(sourcePath: String, targetPath: String, promise: Promise)
    @ReactMethod fun transcribeAudio(filePath: String, language: String?, modelPath: String?, promise: Promise)
    @ReactMethod fun isRollingRecordingActive(promise: Promise)
}
```

---

## 4. Step-by-Step Implementation Checklist

### Task 1: Rust Android JNI & macOS Universal Build
**Files:**
- Modify: `rust/voicenote-core/Cargo.toml`
- Modify: `rust/voicenote-core/src/lib.rs`
- Create: `rust/voicenote-core/src/android_jni.rs`
- Modify: `scripts/build-macos.sh`
- Modify: `scripts/build-android.sh`

- [x] **Step 1.1**: Update `rust/voicenote-core/Cargo.toml` to version `1.0.0` and add `jni = { version = "0.21", default-features = false }`.
- [x] **Step 1.2**: In `rust/voicenote-core/src/lib.rs`, add `#[cfg(target_os = "android")] pub mod android_jni;` and update `voicenote_core_version` to return `"1.0.0"`.
- [x] **Step 1.3**: Create `rust/voicenote-core/src/android_jni.rs` implementing `Java_com_voicenote_core_VoiceNoteCoreJni_*` bindings calling `vn_audio_trim_and_save_wav`, `crypto::verify_file_sha256`, and `vn_asr_transcribe`.
- [x] **Step 1.4**: Modify `scripts/build-macos.sh` to anchor with `REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"`, compile `aarch64-apple-darwin` and `x86_64-apple-darwin` slices, and merge via `lipo -create` into `macos/build/rust/libvoicenote_core.a`.
- [x] **Step 1.5**: Modify `scripts/build-android.sh` to anchor with `REPO_ROOT` and cross-compile `libvoicenote_core.so` via `cargo ndk` to `android/app/src/main/jniLibs/arm64-v8a/`.
- [x] **Step 1.6**: Run `cargo check --manifest-path rust/Cargo.toml` to verify Rust code compiles without errors.

---

### Task 2: Android Project Scaffolding
**Files:**
- Create: `android/build.gradle`
- Create: `android/settings.gradle`
- Create: `android/gradle.properties`
- Create: `android/gradlew` & `android/gradle/wrapper/gradle-wrapper.properties`
- Create: `android/app/build.gradle`
- Create: `android/app/src/main/res/values/styles.xml`
- Create: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Create: `android/app/proguard-rules.pro`

- [x] **Step 2.1**: Create `android/build.gradle` configuring AGP 8.5.2, Kotlin 1.9.24, and repositories (google(), mavenCentral(), and node_modules/react-native/android).
- [x] **Step 2.2**: Create `android/settings.gradle` with rootProject.name = 'voicenote', include ':app', and apply native_modules.gradle autolinking.
- [x] **Step 2.3**: Create `android/gradle.properties` setting `-Xmx2048m`, `android.useAndroidX=true`, `android.enableJetifier=true`, and `hermesEnabled=true`.
- [x] **Step 2.4**: Create `android/gradlew` (executable shell script with curl fallback for wrapper jar) and `android/gradle/wrapper/gradle-wrapper.properties` targeting Gradle 8.8 (`gradle-8.8-bin.zip`). Ensure `chmod +x android/gradlew`.
- [x] **Step 2.5**: Create `android/app/build.gradle` applying `com.android.application`, `org.jetbrains.kotlin.android`, and `com.facebook.react`, with `applicationId "com.voicenote"`, `minSdkVersion 29`, `targetSdkVersion 34`, `compileSdkVersion 34`, `ndk.abiFilters "arm64-v8a"`, signing configs referencing `voicenote-release.keystore`, and ProGuard configuration.
- [x] **Step 2.6**: Create `android/app/src/main/res/values/styles.xml` defining `AppTheme` extending `Theme.AppCompat.DayNight.NoActionBar`.
- [x] **Step 2.7**: Create `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` adaptive launcher icon XML resources.
- [x] **Step 2.8**: Create `android/app/proguard-rules.pro` keeping `com.voicenote.core.**`, native methods, Nitro, and MMKV symbols.

---

### Task 3: Android Native Modules & Kotlin Entry Points
**Files:**
- Create: `android/app/src/main/java/com/voicenote/MainActivity.kt`
- Create: `android/app/src/main/java/com/voicenote/MainApplication.kt`
- Create: `android/app/src/main/java/com/voicenote/core/VoiceNoteCoreJni.kt`
- Create: `android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativeAudioModule.kt`
- Create: `android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativePackage.kt`

- [x] **Step 3.1**: Create `android/app/src/main/java/com/voicenote/MainActivity.kt` extending `ReactActivity` returning `"voicenote"` as main component name.
- [x] **Step 3.2**: Create `android/app/src/main/java/com/voicenote/MainApplication.kt` extending `Application` and `ReactApplication`, configuring `ReactNativeHost` with autolinked packages plus `VoiceNoteNativePackage()`.
- [x] **Step 3.3**: Create `android/app/src/main/java/com/voicenote/core/VoiceNoteCoreJni.kt` declaring external JNI bindings and `VoiceNoteAsrResult` data class.
- [x] **Step 3.4**: Create `android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativeAudioModule.kt` implementing the complete `nativeAudio.ts` contract for Android (`AudioRecord` 16kHz PCM, rolling chunk management, file download/verification/move, `transcribeAudio`, and RCTDeviceEventEmitter events).
- [x] **Step 3.5**: Create `android/app/src/main/java/com/voicenote/nativeaudio/VoiceNoteNativePackage.kt` registering `VoiceNoteNativeAudioModule`.

---

### Task 4: Packaging Automation & Signing Scripts
**Files:**
- Create: `scripts/generate-android-keystore.sh`
- Create: `scripts/build-android-release.sh`
- Create: `scripts/build-macos-dmg.sh`
- Modify: `.gitignore`

- [x] **Step 4.1**: Create `scripts/generate-android-keystore.sh` with `chmod +x` to generate `android/app/voicenote-release.keystore` via `keytool` with default dev credentials or environment overrides.
- [x] **Step 4.2**: Create `scripts/build-android-release.sh` with `chmod +x` containing pre-flight checks (Node >= 18, JDK 17, Android SDK 34, Android NDK r26b/r27, `cargo-ndk`, `aarch64-linux-android`), keystore provisioning, `cargo ndk` build, `./gradlew assembleRelease`, dynamic `apksigner` validation, and 80 MB ceiling assertion.
- [x] **Step 4.3**: Create `scripts/build-macos-dmg.sh` with `chmod +x` containing pre-flight checks (Node >= 18, Xcode 15+, CocoaPods, Rust macOS targets, `create-dmg`/`hdiutil`), universal Rust `lipo` build, `npm run bundle:macos`, `xcodebuild archive`, `.app` extraction, inside-out ad-hoc codesigning, `dmg-root` staging, DMG generation, and 80 MB ceiling assertion.
- [x] **Step 4.4**: Update `.gitignore` to ignore `*.dmg`, `*.xcarchive`, `android/app/src/main/jniLibs/`, `macos/build/`, and `android/app/voicenote-release.keystore`.

---

### Task 5: Project Scripts & Community CLI Platform Android Dependency
**Files:**
- Modify: `package.json`
- Create: `docs/PACKAGING.md`

- [x] **Step 5.1**: Update `package.json` adding `"@react-native-community/cli-platform-android": "^20.2.0"` to `devDependencies` and adding scripts: `build:macos:dmg`, `build:android:release`, `build:all`, and `generate:android:keystore`.
- [x] **Step 5.2**: Create `docs/PACKAGING.md` documenting prerequisites, build commands, signing configuration, verification steps, Gatekeeper bypass (`xattr -cr`), and Android sideloading instructions.

---

### Task 6: Automated Packaging Sanity Test Suite & Full Verification Loop
**Files:**
- Create: `tests/native/packagingSanity.test.ts`

- [x] **Step 6.1**: Create `tests/native/packagingSanity.test.ts` verifying that:
  - Packaging scripts (`scripts/build-macos-dmg.sh`, `scripts/build-android-release.sh`, `scripts/generate-android-keystore.sh`) exist and have executable bit set (`0o111`).
  - Both release build scripts contain the 80 MB size assertion logic.
  - `.gitignore` ignores `*.dmg`, `*.xcarchive`, `android/app/src/main/jniLibs/`, and `*.keystore`.
  - Android scaffolding files (`build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew`, `styles.xml`, `proguard-rules.pro`) exist.
- [x] **Step 6.2**: Run `npm test tests/native/packagingSanity.test.ts` to confirm tests pass.
- [x] **Step 6.3**: Run `npm run audit:privacy` to verify 0 privacy / telemetry violations.
- [x] **Step 6.4**: Run `npm run typecheck` and full `npm test` to verify 0 regressions across all existing test suites.

# Comprehension Test Report

**Target Document:** [`docs/designs/standalone_android_apk_and_macos_dmg_packaging.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/standalone_android_apk_and_macos_dmg_packaging.md)  
**Review Stage:** Stage 6 (Comprehension Test)  
**Reviewer:** `egm-comprehension` (Naive Reader)

---

## What this proposes
This document specifies an automated, headless build and packaging pipeline to produce standalone, production-ready distribution artifacts for VoiceNote on macOS and Android without requiring an active Metro development server. It introduces a universal macOS disk image (`dist/VoiceNote-1.0.0.dmg`) combining Apple Silicon (`arm64`) and Intel (`x86_64`) native Rust binaries with an ad-hoc signed `.app` bundle, alongside an Android mobile package (`dist/VoiceNote-1.0.0-arm64-v8a.apk`) targeting `arm64-v8a` devices. The design defines full Android project scaffolding (Gradle build configurations, Kotlin entry points, and an `AudioRecord` native module), a JNI bridge to the shared Rust core (`rust/voicenote-core`), automated local keystore provisioning, and pre-flight dependency verification. It also strictly enforces an 80 MB file size limit across all generated release packages to guarantee that offline machine learning model weights are never bundled into the installers.

## How the existing system works, per this document
According to the document, VoiceNote currently functions solely as a macOS desktop development application built with React Native 0.76 and connected to `rust/voicenote-core` via Nitro Modules JSI bindings. The current workflow relies entirely on an active local Node.js Metro bundler and Xcode debug builds, with no reproducible scripts to compile offline JavaScript bundles, static assets, or universal native binaries for distribution. Furthermore, the repository's Android support is completely uninitialized, containing only a bare `AndroidManifest.xml` without Gradle build scripts, settings, NDK toolchains, JNI symbols, or native audio recording capabilities. Consequently, neither a standalone macOS DMG nor an Android APK can currently be compiled, assembled, or distributed.

---

## Findings

### 1. Missing React Native Gradle Plugin in Android Scaffolding Specification
* **Severity**: 🟡 **Major**
* **Affected Scope**: `## Technical Plan` (Lines 106, 207–212) and `## Detailed Implementation Plan`, Items 6, 7, 9 (Lines 360–379).
* **Discrepancy Description & Rationale**: The document specifies running `./gradlew bundleReleaseJsAndAssets` (or `./gradlew assembleRelease`) to produce `index.android.bundle` and package the APK. In React Native 0.76, the `bundleReleaseJsAndAssets` task is provided by the React Native Gradle Plugin (`com.facebook.react`). However, the specifications for `android/build.gradle`, `android/settings.gradle`, and `android/app/build.gradle` omit applying `com.facebook.react` or its settings plugin, declaring only AGP 8.5.2, Kotlin 1.9.24, CLI autolinking (`native_modules.gradle`), and `react-android`. Without the React Native Gradle plugin explicitly declared and applied in the Gradle scaffolding specification, `./gradlew bundleReleaseJsAndAssets` will not exist and standalone JavaScript bundling will fail.

### 2. Ambiguous Relationship and Logic Duplication Between Base Scripts and Packaging Scripts
* **Severity**: 🟡 **Major**
* **Affected Scope**: `## Detailed Implementation Plan`, Items 4 & 5 (`scripts/build-macos.sh`, `scripts/build-android.sh`, Lines 350–359) vs. Items 17 & 18 (`scripts/build-android-release.sh`, `scripts/build-macos-dmg.sh`, Lines 415–424).
* **Discrepancy Description & Rationale**: The implementation plan proposes modifying `scripts/build-macos.sh` (to build dual Cargo targets and merge them via `lipo`) and `scripts/build-android.sh` (to cross-compile via `cargo ndk`). At the same time, it creates `scripts/build-macos-dmg.sh` and `scripts/build-android-release.sh`, which are described as performing those exact same Cargo, `lipo`, and `cargo ndk` steps inline. The document never clarifies the architectural relationship between the base scripts and the release packaging scripts. A reader cannot tell whether the packaging scripts invoke the base scripts or duplicate their commands, nor what the distinct scope of the base scripts is intended to be.

### 3. Incomplete Android Native Audio Bridge Specification and Assumed Parity Knowledge
* **Severity**: 🟡 **Major**
* **Affected Scope**: `## Technical Plan` (Lines 221–225) and `## Detailed Implementation Plan`, Item 14 (`VoiceNoteNativeAudioModule.kt`, Lines 400–404).
* **Discrepancy Description & Rationale**: The document states that `VoiceNoteNativeAudioModule.kt` "Implements `src/native/nativeAudio.ts` contract for Android" and achieves "behavioral parity with macOS `AppDelegate.mm`". However, the text only specifies audio recording (`AudioRecord`), rolling chunk buffering, silence trimming, and two events (`onChunkReady`, `onCeilingReached`). The bridge contract in `src/native/nativeAudio.ts` also defines file management (`moveFile`, `downloadFile`, `verifyFileChecksum`), audio transcription (`transcribeAudio`), and metering events (`onAudioMetering`), none of which are addressed in the Android specification. Additionally, referencing "parity with macOS `AppDelegate.mm`" assumes the reader has unstated institutional knowledge of the existing macOS native audio implementation.

### 4. Unexplained Architectural Divergence: Android JNI vs. macOS Nitro Modules JSI
* **Severity**: 🟡 **Major**
* **Affected Scope**: `## Overview` (Line 11), `## Technical Plan` (Lines 197–202, 218), and `## Detailed Implementation Plan` (Lines 344–348, 395–398).
* **Discrepancy Description & Rationale**: Line 11 states that macOS communicates with `rust/voicenote-core` via Nitro Modules JSI bindings. In contrast, the Android plan introduces a bespoke Kotlin JNI class (`VoiceNoteCoreJni.kt` calling `android_jni.rs` C-FFI exports), while line 218 retains ProGuard rules for `com.margelo.nitro.**`. The document does not explain how the JavaScript layer on Android actually accesses `VoiceNoteCoreJni` (e.g., whether it is wrapped in a React Native NativeModule or if Nitro Modules is also used on Android). The coexistence of Nitro Modules on macOS and Kotlin JNI on Android represents an unexplained architectural divergence.

### 5. Undefined Project Reference: `PRD Section 27`
* **Severity**: 🟡 **Major**
* **Affected Scope**: `## Alternatives Considered`, Alternative A (Line 258).
* **Discrepancy Description & Rationale**: The document justifies rejecting model bundling by citing a "PRD Section 27 requirement that models must be downloaded post-install after verifying device disk quota headroom." However, the document neither links to the PRD file (e.g., `docs/PRD.md`) nor defines what Section 27 requires. A fresh reader has no immediate path to verify this requirement.

### 6. Unstated Mechanism for Package Version Resolution
* **Severity**: 🟢 **Nit**
* **Affected Scope**: Lines 29, 55, 61, 98, 108, 187, 239, 313, and 347.
* **Discrepancy Description & Rationale**: The design hardcodes version `1.0.0` across output filenames (`VoiceNote-1.0.0.dmg`, `VoiceNote-1.0.0-arm64-v8a.apk`) and JNI returns (`getCoreVersion` returning `"1.0.0"`). It does not specify whether the build scripts dynamically extract the version from `package.json` or if the version string is hardcoded in the scripts.

### 7. Unexplained Runtime Audio Permission Flow on Android
* **Severity**: 🟢 **Nit**
* **Affected Scope**: `## Critical User Journeys`, CUJ 4 (Line 73), `## Technical Plan` (Lines 221–225), and `## Non-Functional Requirements` (Line 304).
* **Discrepancy Description & Rationale**: While the document states that `android.permission.RECORD_AUDIO` is declared in `AndroidManifest.xml`, `RECORD_AUDIO` is a dangerous runtime permission on Android 6.0+ (API 23+). The document does not clarify whether runtime permission requesting and handling is performed in JavaScript (via React Native's `PermissionsAndroid`) or handled natively inside `VoiceNoteNativeAudioModule.kt`.

### 8. Undefined Acronym: `EGM`
* **Severity**: 🟢 **Nit**
* **Affected Scope**: Footer / Provenance (Lines 468–470).
* **Discrepancy Description & Rationale**: The document concludes with `<!-- Provenance: Indicates initial structural drafting via EGM. -->` and `*Drafted with EGM*`. "EGM" is an undefined acronym with no expansion, definition, or link.

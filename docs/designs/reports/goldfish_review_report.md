# Goldfish Annotated Review Report

**Status:** resolved
**Target:** `docs/designs/standalone_android_apk_and_macos_dmg_packaging.md` (`Lines 349-501`)

## Prioritized Findings & AI Suggestions

### 1. Invocations of Non-Existent Rust Functions `trim_silence_wav` and `sha256_digest_file` [`egm-codebase-details`] - Severity: High
*   **Affected Scope:** [Lines 363-370](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L363-L370) (Item 3: `rust/voicenote-core/src/android_jni.rs`)
*   **Discrepancy Description:** The plan specifies invoking `audio::silence_trim::trim_silence_wav` and `crypto::sha256::sha256_digest_file`, but these functions do not exist in `rust/voicenote-core`. The codebase exports `vn_audio_trim_and_save_wav` and `crypto::verify_file_sha256`.
*   **Rationale:** Compilation of `android_jni.rs` will fail with unresolved function errors.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Invoking the actual C-FFI functions already present in `rust/voicenote-core` ensures compilation succeeds without rewriting core audio/crypto logic.
*   ***Proposed Edit:***
    *   Location: Item 3 (`android_jni.rs`) and Item 14 (`VoiceNoteCoreJni.kt`)
    *   Change: Bind to `vn_audio_trim_and_save_wav` and `crypto::verify_file_sha256` (exposing `verifyFileChecksum` returning `jboolean`).

### 2. Missing Android Gradle Wrapper Files from File Enumeration [`egm-implementation-readiness`] - Severity: High
*   **Affected Scope:** [Lines 351-410](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L351-L410) (Items 6–11) & Line 446 (Item 18)
*   **Discrepancy Description:** `scripts/build-android-release.sh` executes `./gradlew assembleRelease`, but the repository contains no Gradle wrapper scripts or binaries, and none are enumerated in the implementation plan.
*   **Rationale:** Running the script on a fresh clone fails with `bash: ./gradlew: No such file or directory`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Explicitly enumerating `android/gradlew`, `android/gradlew.bat`, `gradle-wrapper.properties` (Gradle 8.8), and `gradle-wrapper.jar` provides complete zero-decision instructions.
*   ***Proposed Edit:***
    *   Location: Target Files to Create/Modify
    *   Change: Add `android/gradlew`, `android/gradle/wrapper/gradle-wrapper.properties` (Gradle 8.8), and `android/gradle/wrapper/gradle-wrapper.jar`.

### 3. Missing `transcribeAudio` JNI Export and Kotlin Binding [`egm-implementation-readiness`] - Severity: High
*   **Affected Scope:** [Lines 363-370, 421-435](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L363-L370) (Items 3, 14, 15)
*   **Discrepancy Description:** `VoiceNoteNativeAudioModule.kt` is required to dispatch transcription, but `android_jni.rs` and `VoiceNoteCoreJni.kt` omit the Whisper transcription JNI export (`vn_asr_transcribe`).
*   **Rationale:** The developer cannot implement transcription on Android without guessing the JNI export signature.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Add `Java_com_voicenote_core_VoiceNoteCoreJni_transcribeAudio` calling `vn_asr_transcribe` and declare `VoiceNoteAsrResult` in Kotlin.
*   ***Proposed Edit:***
    *   Location: Items 3, 14, 15
    *   Change: Define JNI export and Kotlin method `transcribeAudio(filePath: String, language: String, modelPath: String): VoiceNoteAsrResult`.

### 4. Missing Launcher Icon Resources Blocking AAPT2 Resource Linking [`egm-implementation-readiness`] - Severity: Medium
*   **Affected Scope:** [Lines 351-410](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L351-L410) & Line 228
*   **Discrepancy Description:** `AndroidManifest.xml` references `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`, but launcher drawables are not enumerated in the files to create.
*   **Rationale:** AAPT2 will fail during `./gradlew assembleRelease` with unresolved resource errors.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Add minimal XML launcher drawables under `android/app/src/main/res/mipmap-anydpi-v26/`.
*   ***Proposed Edit:***
    *   Location: Target Files to Create/Modify
    *   Change: Enumerate `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`.

### 5. Version Mismatch Between Core C-FFI / Cargo.toml and JNI Bridge [`egm-codebase-details`] - Severity: Medium
*   **Affected Scope:** [Lines 368, 423](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L368)
*   **Discrepancy Description:** JNI hardcodes version `"1.0.0"`, but `rust/voicenote-core/Cargo.toml` and `lib.rs` export `"0.1.0"`.
*   **Rationale:** Inconsistent version reporting across platforms.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Invoke `voicenote_core_version()` directly from JNI and bump `rust/voicenote-core/Cargo.toml` to `"1.0.0"`.
*   ***Proposed Edit:***
    *   Location: Items 1, 3, 14
    *   Change: Bump `Cargo.toml` to `1.0.0` and call `voicenote_core_version()` in JNI.

### 6. Missing `apksigner` Path Resolution and Toolchain Pre-Flight [`egm-codebase-details`] - Severity: Medium
*   **Affected Scope:** [Lines 133-138, 446-450](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L133-L138)
*   **Discrepancy Description:** `apksigner` resides inside `$ANDROID_HOME/build-tools/<version>/apksigner` and is not on standard `$PATH`.
*   **Rationale:** Calling `apksigner` directly fails with command not found.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Resolve `apksigner` dynamically from `$ANDROID_HOME/build-tools/` in `scripts/build-android-release.sh`.
*   ***Proposed Edit:***
    *   Location: Item 18 and Pre-flight Table
    *   Change: Add dynamic `APKSIGNER` discovery: `APKSIGNER=$(ls -1 "$ANDROID_HOME/build-tools/"*/apksigner 2>/dev/null | tail -n 1)`.

### 7. Lack of Exact Class Definitions and Method Signatures for Android Architecture [`egm-implementation-readiness`] - Severity: Medium
*   **Affected Scope:** [Lines 411-440](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L411-L440) (Items 12–16)
*   **Discrepancy Description:** Implementation descriptions lack concrete Kotlin declarations and method signatures.
*   **Rationale:** Zero-decision standard requires full signatures to prevent implementer guessing.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Provide exact Kotlin signatures and data class definitions.
*   ***Proposed Edit:***
    *   Location: Items 12–16
    *   Change: Insert concrete Kotlin class signatures and data class structures.

### 8. Omission of `onAudioMetering` in Android Native Audio Module Event List [`egm-codebase-details`] - Severity: Low
*   **Affected Scope:** [Line 433](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L433) (Item 15)
*   **Discrepancy Description:** Item 15 omits `onAudioMetering` emitted by `nativeAudio.ts` and `AppDelegate.mm`.
*   **Rationale:** Audio waveforms in UI will not animate during recording on Android.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Add `onAudioMetering` to the emitted event list.
*   ***Proposed Edit:***
    *   Location: Item 15
    *   Change: Add `onAudioMetering` to the emitted events list.

### 9. Redundant Patterns in `.gitignore` Modification Specification [`egm-codebase-details`] - Severity: Low
*   **Affected Scope:** [Lines 466-470](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L466-L470) (Item 22)
*   **Discrepancy Description:** Instructs ignoring patterns already present in `.gitignore`.
*   **Rationale:** Avoid duplicate lines in `.gitignore`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Prune to truly new patterns (`*.dmg`, `*.xcarchive`, `android/app/src/main/jniLibs/`, `macos/build/`).
*   ***Proposed Edit:***
    *   Location: Item 22
    *   Change: List only uncommitted new patterns.

### 10. Hyperlinked File Headers and Exact Scripts Block [`egm-style`] - Severity: Low
*   **Affected Scope:** [Lines 353-475](docs/designs/standalone_android_apk_and_macos_dmg_packaging.md#L353-L475) & Lines 461-465
*   **Discrepancy Description:** Target file headings use bare backticks, and Item 21 omits the exact `"scripts"` JSON block.
*   **Rationale:** Formatting consistency and zero-decision completeness.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:** Add file hyperlinks and exact JSON block.
*   ***Proposed Edit:***
    *   Location: Detailed Implementation Plan
    *   Change: Hyperlink headers and provide exact `"scripts"` JSON block.

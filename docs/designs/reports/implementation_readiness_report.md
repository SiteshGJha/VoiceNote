# Goldfish Review Report: Implementation Readiness Test

**Target:** `docs/designs/standalone_android_apk_and_macos_dmg_packaging.md` (`Lines 349-501`)  
**Review Stage:** Stage 9 (Implementation Readiness Test)  
**Deliverable File:** `implementation_readiness_report.md`

## Reviewer Status

| Reviewer | Status |
|---|---|
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

---

## Severity Summary
- 🔴 **Blocker**: 3
- 🟡 **Major**: 4
- 🟢 **Nit**: 3
- **Total Findings**: 10

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Invocations of Non-Existent Rust Functions `trim_silence_wav` and `sha256_digest_file` - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 363–370 (Item 3: `rust/voicenote-core/src/android_jni.rs`)
* **Discrepancy Description**: Item 3 instructs `android_jni.rs` to invoke:
  1. `Java_com_voicenote_core_VoiceNoteCoreJni_trimSilenceWav` calling `audio::silence_trim::trim_silence_wav`.
  2. `Java_com_voicenote_core_VoiceNoteCoreJni_sha256DigestFile` calling `crypto::sha256::sha256_digest_file`.
  
  In the actual codebase:
  - `rust/voicenote-core/src/audio/silence_trim.rs` only defines `trim_silence` and `trim_silence_with_rate` (which process in-memory `&[i16]` PCM slices), and `rust/voicenote-core/src/lib.rs` exports `vn_audio_trim_and_save_wav`. There is no `trim_silence_wav` function anywhere in the workspace, nor does `rust/voicenote-core/src/audio/wav.rs` contain a WAV file reader.
  - `rust/voicenote-core/src/crypto/sha256.rs` only exports `pub fn verify_file_sha256(file_path: &Path, expected_hex: &str) -> Result<bool, VnError>`. There is no `sha256_digest_file` function returning a digest string.
* **Rationale & Recommendation**: Rust compilation of `android_jni.rs` will fail immediately with unresolved symbol errors (`E0425: cannot find function in module`). Update Item 3 to invoke actual codebase functions:
  - For silence trimming: bind to `vn_audio_trim_and_save_wav`.
  - For checksum verification: invoke `crypto::verify_file_sha256` directly across JNI via `Java_com_voicenote_core_VoiceNoteCoreJni_verifyFileChecksum(env, class, filePath, expectedSha256)` returning a `jboolean`, mirroring macOS `AppDelegate.mm`'s `verifyFileChecksum`.

---

### 2. Missing Android Gradle Wrapper Files from File Enumeration - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 351–410 (Items 6–11) & Line 446 (Item 18)
* **Discrepancy Description**: Item 18 (`scripts/build-android-release.sh`) executes `./gradlew assembleRelease`. However, the repository currently contains no Gradle wrapper scripts or binaries (`android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.properties`, `android/gradle/wrapper/gradle-wrapper.jar`), and none of these files are enumerated in `Target Files to Create/Modify` (Items 6–16).
* **Rationale & Recommendation**: Executing `scripts/build-android-release.sh` on a clean checkout will fail with `bash: ./gradlew: No such file or directory`. Add `android/gradlew`, `android/gradle/wrapper/gradle-wrapper.properties` (configured for Gradle 8.8 to support AGP 8.5.2), and `android/gradle/wrapper/gradle-wrapper.jar` to the file enumeration, or instruct the setup script to bootstrap the wrapper via `gradle wrapper --gradle-version 8.8`.

---

### 3. Missing `transcribeAudio` JNI Export and Kotlin Binding - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness` / `egm-codebase-details`
* **Affected Scope:** Lines 363–370 (Item 3), Lines 421–425 (Item 14), Lines 426–435 (Item 15)
* **Discrepancy Description**: Item 15 requires `VoiceNoteNativeAudioModule.kt` to implement "Transcription dispatch: `transcribeAudio`" to fulfill the `src/native/nativeAudio.ts` contract. However, Item 3 (`android_jni.rs`) and Item 14 (`VoiceNoteCoreJni.kt`) only specify exports for `trimSilenceWav`, `sha256DigestFile`, and `getCoreVersion`. There is no JNI export or Kotlin wrapper for Whisper transcription (`vn_asr_transcribe`).
* **Rationale & Recommendation**: An engineer cannot complete Item 15 without guessing or inventing the transcription JNI binding. Add `Java_com_voicenote_core_VoiceNoteCoreJni_transcribeAudio` to `android_jni.rs` (calling `vn_asr_transcribe` from `lib.rs`) and declare `external fun transcribeAudio(filePath: String, language: String, modelPath: String): VoiceNoteAsrResult` in `VoiceNoteCoreJni.kt`, with exact data class definitions for the result.

---

### 4. Missing Launcher Icon Resources Blocking AAPT2 Resource Linking - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 351–410 (Items 6–11) & Line 228 (Section 3)
* **Discrepancy Description**: `android/app/src/main/AndroidManifest.xml` references `android:icon="@mipmap/ic_launcher"` and `android:roundIcon="@mipmap/ic_launcher_round"`. While Section 3 (Line 228) notes `android/app/src/main/res/mipmap/`, no mipmap launcher drawables are enumerated in `Target Files to Create/Modify` (Items 6–16).
* **Rationale & Recommendation**: Running `./gradlew assembleRelease` will cause AAPT2 resource linking to fail (`resource mipmap/ic_launcher not found`). Add minimal adaptive XML launcher icon resources (`android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`, with fallback PNGs/drawables) to `Target Files to Create/Modify`.

---

### 5. Version Mismatch Between Core C-FFI / Cargo.toml and JNI Bridge - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Line 368 (Item 3) & Line 423 (Item 14)
* **Discrepancy Description**: Item 3 specifies that `Java_com_voicenote_core_VoiceNoteCoreJni_getCoreVersion` returns `"1.0.0"`. However, `rust/voicenote-core/Cargo.toml` defines `version = "0.1.0"` and `rust/voicenote-core/src/lib.rs` exports `voicenote_core_version` returning `"0.1.0"`.
* **Rationale & Recommendation**: Standardize versioning: update `rust/voicenote-core/Cargo.toml` and `lib.rs` to `"1.0.0"` (matching `package.json`), or have the JNI implementation invoke `voicenote_core_version()` directly so that there is a single source of truth.

---

### 6. Missing `apksigner` Path Resolution and Toolchain Pre-Flight - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` / `egm-implementation-readiness`
* **Affected Scope:** Lines 446–450 (Item 18) & Lines 133–138 (Pre-flight Table)
* **Discrepancy Description**: Item 18 requires `apksigner verify` during packaging. However, `apksigner` resides inside `$ANDROID_HOME/build-tools/<version>/apksigner` and is not on standard system `$PATH`. The pre-flight verification table (lines 133–138) does not check for `apksigner` or specify how the script locates it.
* **Rationale & Recommendation**: Add `apksigner` resolution in `scripts/build-android-release.sh` (e.g. `APKSIGNER=$(ls -1 "$ANDROID_HOME/build-tools/"*/apksigner 2>/dev/null | tail -n 1)`) and include `apksigner` / Android build-tools in the pre-flight check table.

---

### 7. Lack of Exact Class Definitions and Method Signatures for Android Architecture - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 411–440 (Items 12–16)
* **Discrepancy Description**: Items 12 through 16 provide high-level functional summaries rather than zero-decision exact code signatures. Provide explicit interface and class declarations for `VoiceNoteCoreJni.kt`, `VoiceNoteNativePackage.kt`, and `MainApplication.kt`.
* **Rationale & Recommendation**: Provide explicit signatures and data classes for all Kotlin modules in the implementation plan.

---

### 8. Omission of `onAudioMetering` in Android Native Audio Module Event List - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Line 433 (Item 15)
* **Discrepancy Description**: Item 15 lists only `onChunkReady` and `onCeilingReached` as events emitted by `VoiceNoteNativeAudioModule.kt`. However, `src/native/nativeAudio.ts` and `AppDelegate.mm` both emit `onAudioMetering`.
* **Rationale & Recommendation**: Add `onAudioMetering` to the supported events list in Item 15.

---

### 9. Redundant Patterns in `.gitignore` Modification Specification - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 466–470 (Item 22)
* **Discrepancy Description**: Item 22 instructs ignoring `dist/`, `*.keystore`, `*.jks`, `android/.gradle/`, and `android/app/build/`. All of these are already present in the existing `.gitignore`.
* **Rationale & Recommendation**: Specify only the truly missing patterns (`*.dmg`, `*.xcarchive`, `android/app/src/main/jniLibs/`, `macos/build/`) to avoid redundant edits.

---

### 10. Stylistic Incompleteness: Bare File Paths and Missing Concrete Script JSON Block - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 353–475 (Target Files List) & Lines 461–465 (Item 21)
* **Discrepancy Description**: File headers use bare backticks rather than standard clickable markdown file URI links (`[path](file:///...)`). Item 21 names the four npm scripts to add but omits the exact JSON block for `package.json`.
* **Rationale & Recommendation**: Hyperlink target file headers to improve document navigation in markdown renderers, and provide the exact `"scripts"` JSON block to adhere to the spec-first zero-decision protocol.

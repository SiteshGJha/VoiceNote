# First-Run Model Setup, Auto-Copy Dictation Pipeline, and Memory Invariants

* **Author:** Sitesh Jha
* **Status:** Approved
* **Date:** 2026-11-07

--------------------------------------------------------------------------------

## Overview

VoiceNote is an on-device, privacy-first desktop and mobile application designed to transcribe spoken notes and rewrite them into tailored tones (Professional or Casual) without any cloud dependency. 

This design introduces a cohesive first-run onboarding and model provisioning system to eliminate the cold-start missing model failure, an automatic copy-to-clipboard dictation pipeline that prepares rewritten speech for immediate pasting into external applications without disruptive screen transitions, and deterministic sequential memory coordination rules guaranteeing that process memory stays strictly below the 500 MB RAM budget.

## The Problem

1. **Cold-Start Model Failure**: VoiceNote deliberately excludes multi-hundred megabyte model weights from application binary packages. On clean installations, attempting to record immediately results in an unhandled pipeline failure (`ASR_MODEL_MISSING: ASR model is not installed. Please download it first.`) or a dead-end alert. Users are forced to abandon their recording intent, manually navigate to a secondary management screen, and identify and download two distinct models without clear guidance.
2. **Friction in Quick Dictation**: Modern desktop and mobile dictation workflows require rapid capture and immediate clipboard availability. Currently, completing a recording forcefully navigates the user to a secondary `ResultScreen`, requiring manual interaction to select and copy text before it can be pasted into their working application (Slack, code editor, email client).
3. **Memory Footprint Risks**: Executing both speech recognition (Whisper Base ~148 MB) and language modeling (SLM ~380 MB) on low-spec hardware without strict lifecycle coordination risks exceeding 500 MB RAM, causing operating system memory warnings or background process termination.

## Goals

* **Automated First-Run Setup**: Provide an interactive, in-tree provisioning modal triggered automatically when required model weights are absent upon tapping record, downloading and cryptographically verifying both baseline ASR and SLM weights with live progress.
* **Storage Safety Verification**: Reuse VoiceNote's dynamic `StorageQuotaManager` with 20% safety headroom to verify available disk capacity before starting downloads, preventing mid-download corruption.
* **Instant In-Place Dictation**: Automatically write the final rewritten text to the system clipboard upon pipeline completion, backed by subtle haptic feedback and an in-tree toast notification while remaining on `HomeScreen` to preserve focus.
* **Zero Clipboard Damage on Silence**: Guarantee that empty speech recordings or silence-triggered stops leave the user's existing clipboard contents completely untouched.
* **Strict < 500 MB RAM Budget**: Enforce deterministic sequential memory lifecycle execution: Whisper context is explicitly unloaded from RAM before SLM context allocates memory.
* **Guaranteed Audio Ephemerality**: Ensure all temporary WAV recordings are erased immediately post-ASR via explicit cleanup handlers, even when inference encounters unexpected errors.

## Non-Goals

* **Global Background Key Interception**: Intercepting system-wide `Fn` double-press events outside the active application window is out of scope to avoid macOS Accessibility permission barriers and native dictation collisions.
* **Synthetic Keystroke Injection**: Automatically injecting `Cmd+V` keystrokes into external target applications is out of scope due to desktop sandbox restrictions.
* **Cloud Inference Fallback**: Transmitting audio or text to external cloud APIs under any failure condition remains strictly prohibited.
* **Binary Model Bundling**: Embedding GGUF model files directly into release installers or Git repositories is out of scope.

## Decisions Made

* **Decision 1: Lazy Trigger on Record Tap**: The `FirstRunSetupModal` appears when the user initiates their first recording intent rather than preemptively interrupting app boot, ensuring users can browse settings or history unimpeded.
* **Decision 2: In-Place Toast vs. ResultScreen**: When `autoCopyToClipboard` is active, `HomeScreen` does NOT automatically navigate away to `ResultScreen`. It displays an in-place `Toast` with a "View Note" button. If the user desires detailed review, tapping "View Note" navigates to `ResultScreen`.
* **Decision 3: Fallback Copy on Rewrite Timeout**: If tone rewriting fails or triggers hallucination guards, the sanitized raw transcript is copied to the clipboard and an informational toast is displayed: *"Tone rewriting unavailable — copied raw transcript"*.
* **Decision 4: Explicit Sequential Memory Teardown**: Rather than inventing a speculative "ModelCoordinator" abstraction, `orchestrator.ts` explicitly awaits `whisperNative.unloadModel()` post-ASR before invoking `rewrite()`, freeing ~148 MB RAM before allocating SLM memory.

## Critical User Journeys (CUJs)

### CUJ 1: First-Time User Guided Provisioning
* **Given**: A clean install of VoiceNote where no model weights exist in local storage.
* **When**: The user opens VoiceNote and taps the Record button (or hits Spacebar).
* **Then**: VoiceNote verifies disk space with `storageQuota.assertSufficientStorage()`, displays the `FirstRunSetupModal`, sequentially downloads and verifies Whisper Base and baseline SLM weights with live `ProgressBar` updates, dismisses upon completion, and activates recording controls.

### CUJ 2: Instant Dictation to Clipboard (In-Place)
* **Given**: Required models are verified and installed, and the user has VoiceNote open while writing a message in Slack.
* **When**: The user speaks a voice note and stops recording.
* **Then**: The audio is silence-trimmed, transcribed via Whisper, audio temp file deleted, Whisper context unloaded from RAM, rewritten into the active tone via SLM, automatically copied to the system clipboard, confirmed via subtle haptics and an in-place toast: *"Copied to clipboard — ready to paste"*, while keeping the user on `HomeScreen`.

### CUJ 3: Accidental Empty Recording / Silence
* **Given**: VoiceNote is ready to record.
* **When**: The user taps Record but does not speak (background noise only).
* **Then**: VAD/silence trimmer flags `No Speech Detected`, recording halts, temporary audio is deleted, and the user's existing clipboard contents remain unchanged.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. Architectural Overview & Data Flow

```text
[Record Tap on HomeScreen]
           │
           ▼
[Check modelInstaller.isProvisioned()] ── No ──► [storageQuota.assertSufficientStorage()]
           │                                                │ (Sufficient Disk Space)
          Yes                                               ▼
           │                                    [FirstRunSetupModal]
           │                                    ├── Stage 1: Download & Verify Whisper Base (~148 MB)
           │                                    └── Stage 2: Download & Verify Baseline SLM (~380 MB)
           ▼                                                │ (onProvisioningComplete Callback)
[Recording Trigger Active] ◄────────────────────────────────┘
           │
           ▼ [User Speaks & Stops]
[AudioRecorder / SilenceTrimmer] ── (Zero Speech) ──► [Abort & Leave Clipboard Untouched]
           │ (Valid Speech PCM in Temp WAV)
           ▼
[Phase 1: Whisper ASR Execution]
    ├── Allocate Whisper Context in RAM (~148 MB)
    ├── Run Offline Transcription -> rawTranscript
    ├── Delete Temp WAV File Immediately (`cleanupTempFile`)
    └── EXPLICIT RELEASE: await whisperNative.unloadModel() (RAM drops back to baseline)
           │
           ▼
[Phase 2: SLM Tone Rewriting Execution]
    ├── Allocate SLM Context in RAM (~380 MB)
    ├── Rewrite tone (Professional / Casual) -> finalRewrittenText
    ├── Validate Entity Preservation (Hallucination Guard)
    └── Schedule 60s Idle Auto-Unload Timer
           │
           ▼
[Pipeline Output & Clipboard Integration]
    ├── autoCopyToClipboard? ── Yes ──► Clipboard.setString(finalRewrittenText)
    ├── Trigger Haptic Feedback ('success')
    ├── Display In-Place Toast on HomeScreen: "Copied to clipboard — ready to paste"
    └── Store Encrypted History Record (MMKV)
```

### 2. Subsystem Specifications

#### A. Model Provisioning Subsystem (`src/services/modelManager/`)
* **State Detection API (`installer.ts`)**:
  ```typescript
  import { ModelSpec, getModelSpec } from './catalog';

  export interface ProvisioningStatus {
    isProvisioned: boolean;
    hasAsr: boolean;
    hasSlm: boolean;
    missingSpecs: ModelSpec[];
  }

  // Returns true only when physical GGUF files exist in sandbox storage and pass size checks
  public getProvisioningStatus(): ProvisioningStatus;
  public isProvisioned(): boolean;
  ```
* **Storage Guard**: Reuses existing `storageQuota.assertSufficientStorage(totalDownloadBytes)` dynamically applying the 20% safety headroom.
* **Sandbox Path Resolution**: Reuses `this.modelsDir` (resolving to app sandbox document directories on iOS/Android, and `~/.voicenote/models/` on macOS desktop).

#### B. First-Run Setup Modal Component (`src/components/FirstRunSetupModal.tsx`)
* An accessible, in-tree modal dialog layered above `HomeScreen` using `{ ...StyleSheet.absoluteFillObject, zIndex: 1000 }` (zero `RCTModalHostView` dependency).
* **Props Contract**:
  ```typescript
  export interface FirstRunSetupModalProps {
    visible: boolean;
    onDismiss: () => void;
    onProvisioningComplete: () => void;
  }
  ```
* **Visual States**:
  1. *Prompt State*: Explains the 100% offline privacy architecture and states download footprint (~528 MB total).
  2. *Downloading State*: Reuses `src/components/ProgressBar.tsx` for real-time progress and verification spinners.
  3. *Error / Retry State*: On network failure, displays a retry button; partially downloaded files are cleaned up.
  4. *Completion State*: Calls `onProvisioningComplete()` and auto-dismisses.

#### C. Pipeline Orchestrator & Clipboard Output (`src/pipeline/orchestrator.ts`)
* **Sequential RAM Enforcement**:
  ```typescript
  // Post-ASR: Guarantee Whisper is fully unmapped from memory before SLM loads
  await audioRecorder.cleanupTempFile(seg.uri);
  await whisperNative.unloadModel();
  ```
* **Clipboard Integration**:
  ```typescript
  if (options.autoCopy !== false && finalRewrittenText) {
    Clipboard.setString(finalRewrittenText);
    logger.info('Pipeline', 'Final rewritten text auto-copied to system clipboard');
  }
  ```
* **Safety Invariants**:
  1. *Empty Audio Guard*: If VAD flags `hasSpeech === false`, pipeline aborts early; clipboard remains untouched.
  2. *SLM Fallback Guard*: If SLM inference times out (> 10s) or fails preservation checks, sanitized `rawTranscript` is copied and `result.usedFallback = true` signals the UI.

#### D. Model Footprint & Memory Budget Specification

| Model Specification | Kind | Quantization | Download Size (Disk) | Peak Resident RAM (RSS) |
| :--- | :--- | :--- | :--- | :--- |
| `whisper-base-multilingual` | ASR | Q5_1 | 148 MB | ~148 MB |
| `palmer-005` (Default Baseline) | SLM | Q4_K_M | 380 MB | ~380 MB |
| `qwen2.5-0.5b-instruct` (Optional) | SLM | Q4_K_M | 491 MB | ~495 MB (512 ctx cap) |

* **Deterministic Mutual Exclusion**:
  Because Whisper context is explicitly unloaded via `await whisperNative.unloadModel()` prior to SLM allocation, Whisper (~148 MB) and SLM (~380 MB) never coexist in RAM. Peak memory during pipeline execution is:
  $$\text{Peak RAM} = \max(148\,\text{MB}, 380\,\text{MB}) + 12\,\text{MB (PCM \& App Runtime)} = 392\,\text{MB} < 500\,\text{MB Budget}$$

#### E. In-Tree Toast Component (`src/components/Toast.tsx`)
* Lightweight, cross-platform notification component using React Native `Animated.View`.
* Props: `message: string`, `visible: boolean`, `duration?: number`, `actionLabel?: string`, `onAction?: () => void`.
* Positioned absolutely at bottom of screen; auto-dismisses after 2500 ms.

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: Background Global Daemon with `Fn` Double-Press Modifier
* **Pros**: Dictation triggerable while app is minimized.
* **Cons**: Hard-bound to macOS System Dictation; requires intrusive Accessibility (`AXIsProcessTrusted`) permissions; fails silently on permission denial.
* **Reason for Rejection**: High platform fragility and permission barriers. In-app fast capture with instant clipboard copy provides equivalent speed without OS collisions.

### Alternative B: Concurrent Model Residency (Whisper + SLM simultaneously in RAM)
* **Pros**: Saves ~150 ms context reload latency between ASR and SLM.
* **Cons**: Whisper Base (~148 MB) + SLM (~380 MB) simultaneously in memory exceeds 528 MB RAM, breaching the 500 MB budget and triggering OS memory warnings.
* **Reason for Rejection**: Violates non-negotiable < 500 MB RAM budget. Strict sequential unloading guarantees cross-platform stability.

### Alternative C: Two-Step Manual Download in Models Screen
* **Pros**: Requires no new UI components.
* **Cons**: Leaves the cold-start error `ASR model is not installed` unresolved and causes severe onboarding drop-off.
* **Reason for Rejection**: Unacceptable first-run user experience.

### Alternative D: Fallback to Cloud ASR / LLM Endpoints
* **Pros**: Zero local storage footprint.
* **Cons**: Direct violation of the Prime Directive: zero cloud inference.
* **Reason for Rejection**: Non-negotiable security constraint.

--------------------------------------------------------------------------------

## Non-Functional Requirements

### Security & Privacy
* **Zero Network Inference**: Network activity is restricted strictly to HTTPS model weight downloads with streaming SHA-256 integrity verification. Zero telemetry, zero analytics SDKs.
* **Audio Ephemerality**: Temporary audio recordings are erased immediately post-ASR via explicit cleanup handlers.

### Performance & Latency
* **Peak Memory Budget**: < 500 MB RAM guaranteed at all times via sequential model execution.
* **Inference Timeouts**: Adaptive ASR timeout (duration * 3 + 15s, max 120s) and strict 10s SLM timeout to prevent thread hangs.
* **Main Thread Responsiveness**: All ML inference, audio processing, and cryptographic hashing run asynchronously on background threads off the React Native JS event loop.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `src/pipeline/types.ts` (Modify)
* **Type / Scope**: TypeScript Types
* **Proposed Changes**: Add `autoCopy?: boolean` property to `PipelineExecutionOptions`.
* **Rationale**: Required for strict TypeScript typechecking when configuring clipboard output.

#### 2. `src/state/types.ts` (Modify)
* **Type / Scope**: TypeScript Types
* **Proposed Changes**: Add `autoCopyToClipboard: boolean` to `UserSettings` and set `autoCopyToClipboard: true` in `DEFAULT_SETTINGS`.
* **Rationale**: Maintains state interface consistency across settings actions.

#### 3. `src/services/modelManager/installer.ts` (Modify)
* **Type / Scope**: TypeScript Service
* **Proposed Changes**:
  * Implement `getProvisioningStatus(): ProvisioningStatus` to verify physical existence and non-zero size for baseline ASR (`whisper-base-multilingual`) and baseline SLM (`palmer-005` / `qwen2.5-0.5b-instruct`).
  * Implement `isProvisioned(): boolean` returning `true` only when both baseline models are present on disk.
* **Rationale**: Provides single source of truth for model readiness across the application.

#### 4. `src/components/Toast.tsx` (Create)
* **Type / Scope**: React Component (In-tree UI)
* **Proposed Changes**: Implement animated cross-platform toast with auto-dismiss (2500 ms) and optional action button.
* **Rationale**: Delivers non-blocking visual feedback for clipboard copy and SLM fallbacks without third-party npm dependencies.

#### 5. `src/components/FirstRunSetupModal.tsx` (Create)
* **Type / Scope**: React Component (In-tree UI Overlay)
* **Proposed Changes**:
  * Implement modal overlay with `visible`, `onDismiss`, and `onProvisioningComplete` props.
  * Execute sequential downloads via `modelInstaller.installModel()`.
  * Reuses `src/components/ProgressBar.tsx` for visual download states.
* **Rationale**: Replaces the dead-end missing model alert with an automated, one-tap provisioning wizard.

#### 6. `src/screens/HomeScreen.tsx` (Modify)
* **Type / Scope**: React Screen
* **Proposed Changes**:
  * Replace the blocking `Alert.alert('Models Required', ...)` on record tap with opening `FirstRunSetupModal`.
  * Wire `onProvisioningComplete` callback to re-check provisioning state and activate the record button.
  * Integrate `Toast` component: when `autoCopyToClipboard` is active, remain on `HomeScreen` and present toast with "View Note" button navigating to `ResultScreen`.
* **Rationale**: Resolves the cold-start error state and eliminates navigation friction for quick dictation.

#### 7. `src/pipeline/orchestrator.ts` (Modify)
* **Type / Scope**: Pipeline Engine
* **Proposed Changes**:
  * Await `whisperNative.unloadModel()` immediately after ASR completes to guarantee Whisper is freed from memory before SLM tone rewriting begins.
  * Import `Clipboard` from `@react-native-clipboard/clipboard`.
  * Execute `Clipboard.setString(finalRewrittenText)` when `options.autoCopy !== false`.
  * Guard empty audio (`hasSpeech === false`): abort pipeline without touching clipboard memory.
  * Guard SLM fallback: copy sanitized `rawTranscript` and set `usedFallback = true`.
* **Rationale**: Enforces sequential RAM mutual exclusion (< 500 MB) and implements clipboard auto-copy.

#### 8. `src/state/useSettingsStore.ts` (Modify)
* **Type / Scope**: Zustand Store
* **Proposed Changes**:
  * Add `autoCopyToClipboard: boolean` state.
  * Add `setAutoCopyToClipboard(enabled: boolean): void` action.
* **Rationale**: Allows users to configure clipboard behavior.

#### 9. `src/screens/SettingsScreen.tsx` (Modify)
* **Type / Scope**: React Screen
* **Proposed Changes**: Add a "Dictation & Clipboard" section with a `Switch` toggle bound to `autoCopyToClipboard`.
* **Rationale**: Exposes user preference in settings UI.

#### 10. `tests/mocks/clipboard.ts` (Create)
* **Type / Scope**: Test Fixture
* **Proposed Changes**: Implement Jest mock for `@react-native-clipboard/clipboard` (`setString`, `getString`, `hasString`).
* **Rationale**: Prevents native clipboard crashes in Node Jest test runs.

#### 11. `jest.config.js` (Modify)
* **Type / Scope**: Build Configuration
* **Proposed Changes**: Add `'^@react-native-clipboard/clipboard$': '<rootDir>/tests/mocks/clipboard.ts'` to `moduleNameMapper`.
* **Rationale**: Maps native clipboard imports to test mocks.

#### 12. `tests/services/modelInstaller.test.ts` (Create)
* **Type / Scope**: Jest Unit Test
* **Proposed Changes**: Test `getProvisioningStatus()` and `isProvisioned()` under unprovisioned, partial, and fully provisioned states.
* **Rationale**: Validates model detection logic in automated CI.

#### 13. `tests/pipeline/orchestrator.test.ts` (Modify)
* **Type / Scope**: Jest Unit Test
* **Proposed Changes**:
  * Verify `whisperNative.unloadModel` is called post-ASR before rewrite.
  * Verify `Clipboard.setString` is called with rewritten text.
  * Verify clipboard is untouched on silent recordings.
* **Rationale**: Validates sequential memory cleanup and clipboard safety.

#### 14. `tests/components/FirstRunSetupModal.test.tsx` (Create)
* **Type / Scope**: Jest Component Test
* **Proposed Changes**: Test rendering of prompt state, simulated progress bars, error retry, and `onProvisioningComplete` callback.
* **Rationale**: Validates setup modal interactive states.

#### 15. `docs/PRD.md` & `docs/TASKS.md` (Modify)
* **Type / Scope**: Documentation
* **Proposed Changes**: Record First-Run Provisioning Flow, Clipboard Auto-Copy Stage, and Sequential Memory Invariants in PRD and task tracking.
* **Rationale**: Maintains architectural consistency and documentation integrity.

### Verification Plan

* **Static Analysis & Typecheck**:
  * `npm run typecheck` — Must complete with 0 errors across TypeScript codebase.
  * `npm run lint` — Must pass with 0 ESLint violations.
* **Automated Unit & Integration Tests**:
  * `npm test` — Run all Jest test suites, confirming 100% pass rate.
  * `cargo test --manifest-path rust/Cargo.toml` — Run all native Rust unit tests to verify core invariants.
* **Privacy & Security Audit**:
  * `npm run audit:privacy` — Must verify zero unauthorized network calls (`fetch`/`axios` strictly restricted to `downloader.ts`) and zero telemetry.
* **Memory Budget & Sequential Verification**:
  * Verify `whisperNative.unloadModel()` executes before `rewrite()` starts, ensuring peak memory stays below 400 MB RAM.
  * Verify audio temporary files are removed immediately post-ASR.

--------------------------------------------------------------------------------

*Drafted with EGM*

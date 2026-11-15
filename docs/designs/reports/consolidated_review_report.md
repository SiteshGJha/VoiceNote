# Consolidated Goldfish Review Report

**Target Document:** [`docs/designs/first_run_setup_and_clipboard.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/first_run_setup_and_clipboard.md)  
**Date:** 2026-11-07  
**Evaluator:** Swarm Compiler & Aggregator (`egm-synthesizer`)  
**Mode:** UNINTERRUPTED FULL FLOW (Stages 5, 6, 7, 8, 9)

---

## Executive Summary

The Goldfish Review Protocol executed all five review stages across 7 specialized reviewer personas (`egm-zoom-out`, `egm-comprehension`, `egm-design`, `egm-structural`, `egm-style`, `egm-implementation-readiness`, `egm-codebase-details`). 

The reviewers reached **absolute consensus** that while the core objective—solving the cold-start missing model failure (`ASR_MODEL_MISSING`) and streamlining dictation output—is critical and high-value, the current design document cannot proceed to implementation without remediating **4 Blockers** and **6 Major issues**. Most notably:
1. **The "ModelCoordinator" architecture is fictional:** It is featured prominently in the architecture and RAM budget narrative, but has zero scheduled tasks in the implementation plan. Whisper is cached for 5 minutes in `whisperNative.ts`, breaching the 500 MB RAM budget during sequential calls.
2. **Qwen 2.5 0.5B memory math is inconsistent:** Qwen 2.5 0.5B Q4_K_M is 491 MB on disk; loading it into RAM exceeds 500 MB. The 380 MB figure in the spec belongs to `palmer-005`.
3. **Missing Jest Native Mocks:** `@react-native-clipboard/clipboard` has no mock in `jest.config.js`, which will immediately break all automated test suites in Node CI.
4. **Non-Existent Test File:** `tests/services/modelInstaller.test.ts` does not exist on disk, but was marked as `(Modify)`.

---

## Actionable Consolidated Findings

### 🔴 Blocker 1: Fictional "ModelCoordinator" Narrative & Sequential Memory Violation
* **Sources:** Zoom Out (Finding 1 & 5), Comprehension (Finding 1), Critic (Finding 5), Intermediate Zoom Out (Finding 1)
* **Problem**: The document highlights a "ModelCoordinator" subsystem to satisfy the < 500 MB budget, but no file or native logic is scheduled in the plan. In reality, `whisperNative.ts` caches Whisper in RAM for 5 minutes (`SESSION_IDLE_UNLOAD_MS = 5 * 60 * 1000`). When tone rewriting runs immediately after ASR, both models coexist in memory, peaking at ~528 MB RAM.
* **Remediation**:
  1. Drop the fictional "ModelCoordinator" abstraction.
  2. Implement sequential memory safety directly in `src/pipeline/orchestrator.ts`: call `await whisperNative.unloadModel()` immediately after ASR finishes before calling `rewrite()`.
  3. Update `orchestrator.ts` in the implementation plan to reflect this deallocation call.

### 🔴 Blocker 2: Memory Budget Arithmetic Inconsistency for Baseline SLM
* **Sources:** Zoom Out (Finding 5), Critic (Finding 1), Intermediate Zoom Out (Finding 3), Comprehension (Finding 4)
* **Problem**: The document states Qwen 2.5 0.5B requires ~380 MB RAM to calculate peak RAM as `max(148MB, 380MB) + 12MB = ~392 MB`. However, Qwen 2.5 0.5B Q4_K_M is ~491 MB on disk (`catalog.ts`); loading it into memory with KV cache exceeds 500 MB. ~380 MB is the footprint of `palmer-005`.
* **Remediation**:
  1. Standardize the baseline SLM in the setup sheet to `palmer-005` (380 MB), which guarantees the < 500 MB ceiling.
  2. Alternatively, specify a smaller quantization profile for Qwen with verified peak RSS numbers.
  3. Clearly distinguish between `Disk Footprint (GGUF file size)` and `Resident Memory (Peak RSS in RAM)`.

### 🔴 Blocker 3: Missing Jest Native Mock for Clipboard Breaks Test Suite
* **Sources:** Implementation Readiness (Finding 1)
* **Problem**: Adding `import Clipboard from '@react-native-clipboard/clipboard'` into `src/pipeline/orchestrator.ts` without providing a mock in `jest.config.js` `moduleNameMapper` will crash Jest in Node CI with `NativeModule: RNClipboard is null`.
* **Remediation**:
  1. Add `tests/mocks/clipboard.ts` providing `setString: jest.fn()` and `getString: jest.fn()`.
  2. Add `jest.config.js` to Target Files to map `@react-native-clipboard/clipboard` to `tests/mocks/clipboard.ts`.

### 🔴 Blocker 4: Non-Existent Test File Marked as `(Modify)`
* **Sources:** Implementation Readiness (Finding 2)
* **Problem**: `tests/services/modelInstaller.test.ts` does not exist on disk (`ENOENT`). Marking it as `(Modify)` violates Spec-First and Zero-Prompt protocols.
* **Remediation**:
  1. Change status to `tests/services/modelInstaller.test.ts (Create)`.
  2. Detail the mock filesystem setup and assertions for `getProvisioningStatus()` and `isProvisioned()`.

---

### 🟡 Major 1: Omission of `types.ts` Files Causes TypeScript Errors
* **Sources:** Implementation Readiness (Finding 3)
* **Problem**: `options.autoCopy` is omitted from `src/pipeline/types.ts` (`PipelineExecutionOptions`), and `autoCopyToClipboard` is omitted from `src/state/types.ts` (`UserSettings` and `DEFAULT_SETTINGS`). `npm run typecheck` will fail.
* **Remediation**: Add `src/pipeline/types.ts` and `src/state/types.ts` to Target Files with explicit type declarations.

### 🟡 Major 2: Unresolved Navigation UX Paradox for Dictation Flow
* **Sources:** Zoom Out (Finding 2), Comprehension (Finding 3), Critic (Finding 4), Intermediate Zoom Out (Finding 2), Implementation Readiness (Finding 5)
* **Problem**: Problem #2 states navigating to a review screen creates friction, but the implementation plan keeps `navigation.navigate('Result', { result })` in `HomeScreen.tsx`, which immediately obscures the toast.
* **Remediation**: Resolve the navigation invariant:
  - Option A: When `autoCopyToClipboard` is active, `HomeScreen` stays on the recording screen and presents an in-place `Toast` with a quick link to "View Note".
  - Option B: `HomeScreen` navigates to `ResultScreen` passing `autoCopied: true`, where the toast is displayed.

### 🟡 Major 3: Unspecified Cross-Platform Toast UI Component
* **Sources:** Comprehension (Finding 9), Implementation Readiness (Finding 4)
* **Problem**: React Native core has no cross-platform toast, and superpowers guidelines forbid adding unvetted third-party npm packages (`react-native-toast-message`).
* **Remediation**: Add an in-tree `src/components/Toast.tsx` component (built with React Native `Animated.View`, positioned absolutely, with auto-dismiss after 2500 ms) to Target Files.

### 🟡 Major 4: Mobile Sandbox Violations & Storage Quota Re-invention
* **Sources:** Zoom Out (Finding 3), Comprehension (Finding 5), Critic (Finding 2 & 11), Intermediate Zoom Out (Finding 4 & 5)
* **Problem**: The document specifies POSIX home paths (`~/.voicenote/`) that crash on iOS/Android, and invents `assertSufficientFreeSpace` with a hardcoded 1.5 GB gate, rejecting devices with ~1 GB free space.
* **Remediation**:
  1. Use platform-agnostic sandbox directory paths (`dirs.DocumentDir`).
  2. Reuse the existing `storageQuota.assertSufficientStorage(totalDownloadBytes)` helper with its dynamic 20% safety headroom.

### 🟡 Major 5: Unresolved Open Questions Contradict Settled Implementation Plans
* **Sources:** Comprehension (Finding 2), Critic (Finding 6), Intermediate Zoom Out (Finding 7)
* **Problem**: Open questions Q1 & Q2 are listed as unresolved, yet the technical plan already specifies triggering on record tap and copying the raw transcript on SLM fallback.
* **Remediation**: Remove "Open Questions" and record the resolved decisions in "Decisions Made".

### 🟡 Major 6: Component Props & Reactive State Indecision
* **Sources:** Implementation Readiness (Finding 8)
* **Problem**: Line 234 leaves an open choice: "Integrate `useModelProvisioning` or `modelInstaller.isProvisioned()`." Calling a non-reactive singleton won't update `HomeScreen` when downloads finish.
* **Remediation**: Define an explicit callback prop on `FirstRunSetupModal` (`onProvisioningComplete: () => void`) that triggers `HomeScreen` to re-check provisioning state and activate the record button.

---

### 🟢 Nits & Style Polish
1. **Speculative Test Counts**: Remove hardcoded "41+ Jest suites" / "67+ Rust tests" from the verification plan; use command-based verification criteria.
2. **Reusing Existing `ProgressBar.tsx`**: Specify that `FirstRunSetupModal` reuses `src/components/ProgressBar.tsx` rather than building custom progress bars.
3. **Toast UI Copy on Fallback**: Standardize the fallback toast string: *"Tone rewriting unavailable — copied raw transcript"*.

---

## Traceability Matrix

| Reviewer Finding | Stage | Consolidated Action Item |
| :--- | :--- | :--- |
| Zoom Out #1 & #5, Comp #1, Critic #5, Inter #1 | Stages 5, 6, 7, 8 | 🔴 Blocker 1 (Sequential Memory Unload in `orchestrator.ts`) |
| Critic #1, Inter #3, Comp #4, Zoom Out #5 | Stages 5, 6, 7, 8 | 🔴 Blocker 2 (Baseline SLM Sizing & RSS Clarification) |
| Readiness #1 | Stage 9 | 🔴 Blocker 3 (`tests/mocks/clipboard.ts` & `jest.config.js`) |
| Readiness #2 | Stage 9 | 🔴 Blocker 4 (`tests/services/modelInstaller.test.ts (Create)`) |
| Readiness #3 | Stage 9 | 🟡 Major 1 (`src/pipeline/types.ts` & `src/state/types.ts`) |
| Zoom Out #2, Comp #3, Critic #4, Inter #2, Readiness #5 | Stages 5, 6, 7, 8, 9 | 🟡 Major 2 (Navigation UX Resolution) |
| Comp #9, Readiness #4 | Stages 6, 9 | 🟡 Major 3 (`src/components/Toast.tsx` In-Tree Component) |
| Zoom Out #3, Comp #5, Critic #2 & #11, Inter #4 & #5 | Stages 5, 6, 7, 8 | 🟡 Major 4 (Sandbox Paths & Reuse `assertSufficientStorage`) |
| Comp #2, Critic #6, Inter #7 | Stages 6, 7, 8 | 🟡 Major 5 (Prune Contradictory Open Questions) |
| Readiness #8 | Stage 9 | 🟡 Major 6 (`onProvisioningComplete` Prop) |

# Stage 8 Intermediate Zoom Out Review Report

* **Target Document:** [`docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md) (Lines 1–332)
* **Reviewer:** Skeptical Architect (`egm-zoom-out`)
* **Status:** **REJECT ARCHITECTURE / PIVOT TO MINIMALIST MMKV**
* **Date:** 2026-11-17

---

## 1. Executive Summary & Architectural Verdict

The proposed design correctly identifies the root failure on macOS desktop:
1. `os.homedir()` polyfills to `"/"` in React Native, targeting the read-only root partition (`"/.voicenote/models"`).
2. `installer.ts` imports Node `fs`, which routes to an ephemeral in-memory Map mock ([`src/shims/fs.js`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/src/shims/fs.js)), erasing installed model records when the JavaScript process quits.

However, the proposed architectural remedy introduces an over-engineering spiral. Rather than solving state persistence using the project's existing storage engine (`react-native-mmkv`, already in `package.json` line 32 and mandated by project rules), the document designs a custom, cross-boundary POSIX mini-filesystem inside `AppDelegate.mm`, coupled with an asynchronous cold-start directory scanner, filename matching heuristics, and background SHA-256 rehashing.

The Stage 6 comprehension report and Stage 7 critic report correctly diagnosed mechanical omissions in this mini-filesystem (missing `getFileSize`, mobile platform breakage, UI thread blocking, sandbox path traversal risks, and async getter race conditions). Crucially, **accepting the critic's recommendations to "fix" these omissions makes the design significantly more bloated and complex**. It attempts to cure the symptoms of an over-engineered abstraction by adding even more low-level infrastructure.

**Architectural Verdict:** **Reject the custom mini-filesystem and two-tier deep reconciliation architecture.** Pivot to a minimalist 2-component fix:
1. Expose **one** native path helper `getModelsDirectory` on `VoiceNoteNativeAudio` in `AppDelegate.mm`.
2. Persist installed model metadata directly in **MMKV** (`voicenote-models` instance).

This eliminates 5–7 native bridge methods, eliminates the asynchronous startup waterfall and UI spinners, preserves 100% cross-platform parity across iOS, Android, and macOS, and reduces the implementation from ~600+ lines of fragile native and async code to ~30 lines of clean TypeScript.

---

## 2. Re-Evaluation in Light of Stage 6 & Stage 7 Findings

| Finding | Review Stage | Critic Severity | Critic Proposed "Fix" | Skeptical Architect Perspective |
| :--- | :--- | :--- | :--- | :--- |
| **Missing File Size Primitive** | Stage 6 & 7 | 🔴 Blocker | Add `getFileSize(filePath)` primitive to native bridge and compare against `spec.sizeBytes`. | **Symptom patch.** The need for file size checks arises only because the manifest was decoupled from the download transaction into a brittle physical JSON file. |
| **Mobile Platform Isolation** | Stage 7 | 🔴 Blocker | Duplicate all 5–7 filesystem primitives in iOS Swift/ObjC and Android Kotlin/JNI. | **Exploding Scope.** Building a custom POSIX bridge across 3 platforms to write a 1 KB JSON manifest violates YAGNI. MMKV already works out of the box across all 3 platforms. |
| **Async Getter Race Condition** | Stage 7 | 🟡 Major | Implement a 4-state asynchronous lifecycle state machine (`'uninitialized'`, `'initializing'`, etc.) and UI skeletons. | **Self-inflicted wound.** Caused entirely by making manifest reads asynchronous over the bridge. Synchronous MMKV reads eliminate the race condition completely. |
| **Catalog Filename Mismatch** | Stage 6 & 7 | 🟡 Major | Build heuristic directory scanning matching `.bin`, `.gguf`, and alias tables. | **Over-engineering.** VoiceNote has exactly *two* catalog models. Filenames are deterministic constants. Dynamic directory scanning is completely unnecessary. |
| **GCD Queue & UI Blocking** | Stage 7 | 🟡 Major | Wrap SHA-256 streams in `dispatch_async` background queues in Objective-C++. | **Premature optimization.** Rehashing 639 MB on startup is only proposed because of speculative deep reconciliation. Checksums should only run once during download. |
| **Path Traversal / Sandbox Security** | Stage 7 | 🟡 Major | Add `NSURL.standardizingPath` resolution, boundary prefix checks, and `FS_ACCESS_DENIED` errors. | **Inherent flaw.** Exposing unconstrained `readTextFile`, `writeTextFile`, and `listDirectory` to JavaScript creates an unnecessary security attack surface. |

---

## 3. Comparison: Custom Filesystem vs. Minimalist MMKV

| Dimension | Bloated Approach (Design Doc + Critic Patches) | Minimalist Approach (MMKV + Single Path Helper) |
| :--- | :--- | :--- |
| **Native Bridge Surface** | 6–8 methods (`getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, `getFileSize`, `listDirectory`, `verifyFileChecksum`, `moveFile`). | **1 method** (`getModelsDirectory(): Promise<string>`). |
| **Native Code Footprint** | ~400+ lines across `AppDelegate.mm`, iOS, and Android. | **~10 lines** in `AppDelegate.mm`. Zero changes on mobile platforms. |
| **Manifest Storage Engine** | Custom physical JSON file written via bridge string passing. | **MMKV** (`id: 'voicenote-models'`). Synchronous C++ memory-mapped file, zero bridge hops, crash-safe, atomic. |
| **Startup Latency & Overhead** | 300–800 ms during deep reconciliation; async startup waterfall requiring UI spinners. | **< 0.05 ms synchronous read**. Zero main-thread blocking, zero UI spinners. |
| **UI State Impact** | Mutexes, `isInitializingModels` state, record button loading indicators, 4-state lifecycle machine. | **Zero UI modifications**. `modelInstaller.isProvisioned()` returns synchronously and immediately on first frame. |
| **Cross-Platform Parity** | Broken on iOS/Android unless custom filesystem primitives are ported to Kotlin and Swift. | **100% Cross-Platform**. MMKV is already active across all platforms. |
| **Speculative Reconciliation** | Dynamic directory scanning, regex filename matching, background SHA-256 rehashing. | **YAGNI**. There are only two catalog models. |
| **Security Surface** | High: Unsanitized file I/O primitives exposed to JS; path traversal risks. | **Zero**: No arbitrary file reading/writing primitives exposed to JS. |

---

## 4. Actionable Pivot Plan

1. **Delete Custom Filesystem Primitives:**
   * Remove `readTextFile`, `writeTextFile`, `fileExists`, and `listDirectory`. Do not add `getFileSize` or path traversal filters.
2. **Add Single Base Path Resolver (1 Native Method):**
   * Expose `getModelsDirectory(): Promise<string>` on `VoiceNoteNativeAudio` in `AppDelegate.mm`.
3. **Persist Model Registry via MMKV:**
   * In `src/services/modelManager/installer.ts`, instantiate `new MMKV({ id: 'voicenote-models' })`. Load model records synchronously on startup.
4. **Drop Deep Reconciliation & Dynamic Directory Scanning:**
   * Drop dynamic scanning. Verify checksums only during download using the pre-existing `nativeAudio.verifyFileChecksum`.
5. **Revert UI Changes:**
   * Revert all proposed changes to `HomeScreen.tsx` and `App.tsx`. Synchronous MMKV reads keep `isProvisioned()` instant and deterministic.

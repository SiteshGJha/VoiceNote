# VoiceNote — Technical Deep-Dive & Interview Guide

> Use this document to explain the project in an interview: what it is, how it
> works under the hood, and the production-grade engineering patterns used in a
> modern offline voice-memo product.

---

## 1. Product in 30 Seconds

VoiceNote is a **fully offline, privacy-first mobile voice-memo app** that:

1. Records speech through the microphone,
2. Transcribes it **on-device** into text (English, Hindi, and mixed Hinglish),
3. Rewrites the transcript **on-device** into a chosen tone (Professional / Casual),
4. Lets the user **edit, copy, share, and review** the result from an encrypted history.

**Constraints that define every decision:**
- Zero cloud inference — no audio, transcript, or text ever leaves the device.
- Zero telemetry — no analytics, crash reporters, or tracking SDKs.
- Audio is ephemeral — temp files are deleted immediately after transcription.
- Models are downloaded on-demand by the user (not bundled into the binary).

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             React Native (TS)                               │
│                                                                             │
│  UI Screens: Home · Result · History · Models · Settings · Privacy          │
│  State:      Zustand (useAppStore, useSettingsStore)                        │
│  Navigation: React Navigation native-stack                                  │
│                                                                             │
│  Pipeline Orchestrator (executePipeline)                                    │
│   Audio Capture ─► VAD ─► Silence Trim ─► ASR ─► [delete audio] ─►          │
│   SLM Tone Rewrite ─► Encrypted History ─► Result                           │
└──────────────┬──────────────────────────────────────────────┬───────────────┘
               │ Nitro Modules JSI (RustCoreHybridObject)     │ OS APIs
               ▼                                              ▼
┌──────────────────────────────────────────────┐  ┌───────────────────────────┐
│ voicenote-core (Rust Static Library / C-ABI) │  │ KEYCHAIN (encryption key) │
│  • AudioBuffer: RAII Drop file ephemerality  │  │ MMKV (encrypted storage)  │
│  • Silero VAD V4 ONNX: tract-onnx engine     │  │ Clipboard · Share sheet   │
│  • Whisper ASR: whisper-rs + segmenter       │  │ Filesystem (models/temp)  │
│  • LLaMA SLM: GGUF validation & rewrite engine│ │ Microphone permission     │
│  • ModelCoordinator: <500MB RAM & auto-unload│  └───────────────────────────┘
│  • Hallucination Guard: entity preservation  │
│  • Streaming SHA-256: ring v0.17 verifier    │
└──────────────────────────────────────────────┘
```

Key entry point: `App.tsx` (theme init + native JSI smoke test) →
`src/navigation/AppNavigator.tsx` → screens in `src/screens/`.
The end-to-end flow lives in `src/pipeline/orchestrator.ts:14` (`executePipeline`),
with pipeline stages `vad | asr | slm | saving | done`.
The native core is powered by `voicenote-core` (Rust static library) exposing a C-ABI
via Nitro Modules JSI (`margelo::nitro::HybridObject` / `RustCoreHybridObject`),
guaranteeing memory safety, off-main-thread execution, and hardware-accelerated ML inference.

---

## 3. Core Pipeline Walkthrough (How It Works)

### 3.1 Audio Capture (`src/audio/recorder.ts`, `useAudioRecorder.ts`, Rust `AudioBuffer`)
- Records **16 kHz / 16-bit / mono PCM** — the exact format Whisper and Silero VAD require.
- Two paths: a **native microphone bridge** (`nativeAudio`) backed by Rust `AudioBuffer` on device, and a **background worker simulation** (`audioWorker`, strictly dev/test guarded) for tests.
- Every PCM frame is pushed through `pushFrame()`, which computes normalized amplitude for the **live waveform UI** and dispatches to listeners (VAD).
- **RAII `Drop` Ephemerality**: In Rust (`src/audio/buffer.rs`), `AudioBuffer` implements `Drop`. When the buffer goes out of scope, finishes ASR, or aborts mid-recording, the underlying temporary audio file is **strictly deleted** immediately, guaranteeing zero sensitive audio data leakage even during panics or crashes.
- On stop, raw PCM is **silence-trimmed** and wrapped with a standard 44-byte WAV header (`wav.rs` / `wavUtils.ts`) into a **temporary cache file**.
- **5-Minute Continuous Dictation (Rolling Whisper)** (`src/audio/rollingRecorder.ts`, `AppDelegate.mm`, `VoiceNoteNativeAudioModule.kt`): For extended dictations, the native recorder captures audio continuously and automatically partitions it at natural silence boundaries into **20–25s slices** (`onAudioChunkReady`). A native safety timer enforces a hard **5-minute (300s)** ceiling (`onRollingSafetyCeilingReached`), auto-finalizing recording to prevent device memory exhaustion.

### 3.2 Voice Activity Detection (`src/vad/silero.rs`, `src/vad/gate.rs`, `src/native/webrtcVad.ts`)
- Powered on-device by **Silero VAD V4 ONNX** running via `tract-onnx` with zero phase distortion and minimal CPU overhead.
- A **state machine**: `idle → speech → silence`.
- Each 30 ms (or 512-sample) frame is scored; speech requires exceeding a threshold for a minimum duration (`minSpeechMs`) — this filters out clicks and door slams.
- **Auto-stop**: after sustained silence past the configured window (`autoStopSilenceMs`, default 1500 ms), `onAutoStop` fires → recording finalizes automatically (user doesn't have to tap stop).
- **Sensitivity presets** (`low/medium/high`) tune thresholds for noisy vs quiet environments.
- Single-fire guard: `onAutoStop` fires only once per session to avoid duplicate finalization.

### 3.3 Silence Trimming (`src/audio/silenceTrim.ts`, Rust `src/audio/silence_trim.rs`)
- Computes RMS energy per 30 ms frame, finds first/last speech frames, and trims leading/trailing silence **while keeping 200 ms of padding** so phonemes at the edges are never clipped.
- If no speech at all → `hasSpeech: false` → the UI short-circuits with a "No Speech Detected" message **before** ever calling ASR (saves battery and time).

### 3.4 ASR — Speech-to-Text (`src/ml/asr/`, Rust `src/asr/whisper.rs`, `src/asr/segmenter.rs`)
- High-performance on-device ASR engine powered by `whisper-rs` (whisper.cpp) with Metal GPU acceleration on Apple Silicon.
- **iOS CoreML Build Alert**: Build scripts (`build.rs`) detect iOS builds and emit compiler warnings if compiled without CoreML acceleration, falling back gracefully to NEON vectorization.
- Resolves the model by the user's selected **tier** (`fast` = Whisper-Tiny, `balanced` = Whisper-Base default, `accurate` = Whisper-Small) via `asrModelRegistry`.
- **Model guard**: verifies the model file actually exists on disk; returns `ASR_MODEL_MISSING` with a clear re-download message.
- **Bilingual strategy** (`language.ts`, Rust `src/asr/language.rs`): for `auto`, short clips (<1.5 s) default to English (Whisper's detector is unreliable that short); longer clips use a Hinglish-aware `initial_prompt` so code-switched Hindi/English are transcribed in the correct scripts.
- **Long-audio segmentation** (`segmenter.ts`, Rust `src/asr/segmenter.rs`): WAVs > 27 s are sliced into ≤27 s segments **at silence boundaries** (so words are never cut), each segment is transcribed independently with its own adaptive timeout, and results are merged. This prevents the "dropped/truncated audio" problem of feeding a long clip into Whisper's fixed ~30 s window.
- **Rolling FIFO Whisper Worker** (`src/ml/asr/rollingAsrWorker.ts`): In continuous 5-minute capture mode, incoming 20–25s audio chunks are queued into a sequential FIFO background worker. Whisper transcribes chunks concurrently with ongoing recording. To eliminate seam boundary hallucination, the tail words of chunk `N-1` are passed as the `initial_prompt` for chunk `N`. Each intermediate chunk file is strictly deleted immediately upon transcription completion.
- **Adaptive timeout** (`computeTimeoutForDuration`): `3 × audio duration + 15 s`, clamped to [30 s, 120 s] — larger models on slow devices don't spuriously time out, and worst cases stay bounded.
- **Devanagari normalization & Romanization** (`normalize.ts`, `romanize.ts`): whitespace/punctuation cleanup that is Devanagari-safe, plus deterministic phonetic transliteration to Latin script when requested.

### 3.5 Tone Rewriting — SLM (`src/ml/slm/`, Rust `src/slm/llama.rs`, `src/slm/validator.rs`)
- On-device GGUF SLM engine (`LlamaEngine`): validates GGUF container headers and memory coordination (< 500 MB RAM budget), and performs structured rewriting validated by the Rust hallucination guard (`validate_preservation`). Standalone zero-dependency library without bundled third-party cmake llama.cpp binary.
- **Prompt engineering** (`promptBuilder.ts`, Rust `src/asr/language.rs`): canonical templates for *Professional* and *Casual* with explicit rules — remove filler words, complete sentences, **preserve facts/names/numbers/dates**, no preamble, low temperature (0.3) for faithful rewriting.
- **ModelCoordinator (< 500 MB RAM Budget)** (`src/model_coordinator.rs`): Enforces mutual exclusion between ASR and SLM model memory allocations. If the SLM is invoked while ASR is in memory, ASR is unloaded first (and vice-versa). An idle timer automatically unloads models after 60 seconds of inactivity to keep baseline RAM footprint near zero.
- **Semantic Paragraph Rewriter** (`src/ml/slm/paragraphRewriter.ts`): For long continuous transcripts, the orchestrator divides text into natural **150–200 word semantic paragraph chunks**. Each paragraph is rewritten sequentially with its own entity preservation check and joined with clean double-newlines. Whisper is explicitly unloaded from memory prior to paragraph rewriting to guarantee strict adherence to the `< 500 MB` RAM budget.
- **Rust Hallucination Guard** (`validator.ts`, Rust `src/slm/validator.rs`):
  1. **Entity extraction**: regex-izes numbers, units, dates, currencies, capitalized proper nouns (skipping common sentence starters + filler words).
  2. **Entity preservation**: every critical entity extracted from the raw transcript MUST be present in the rewritten output (handling time variations like "3pm" ↔ "3:00 PM" and ordinals like "15th" ↔ "15").
  3. **Length-ratio check**: rewritten length must stay within safe bounds [0.35×, 2.5×] of raw input length.
  - On any violation, the app **gracefully falls back to the raw transcript** with a warning badge rather than surfacing hallucinated text.

### 3.6 Encrypted History (`src/services/history/`)
- Records stored **newest-first**, capped at **50 entries with FIFO eviction**.
- Encryption key generated/stored in the **OS Keychain** (`keychain.ts`), used to create an **encrypted MMKV** store in production.
- Full CRUD (`addRecord / listRecords / deleteRecord / clearAll`) behind a single service.

### 3.7 Model Manager (`src/services/modelManager/`, Rust `src/crypto/sha256.rs`)
- **Catalog** (`catalog.ts`): declarative model metadata — id, kind, size, version, URL, **SHA-256 checksum**, quant, min RAM.
- **Downloader** (`downloader.ts`): resumable HTTPS downloads with progress callbacks (drives the ProgressBar).
- **Streaming SHA-256 Verifier** (`verifier.ts`, Rust `src/crypto/sha256.rs` via `ring = "0.17"`): streams chunks directly from disk to compute SHA-256 without memory spikes, verifying integrity against expected catalog digests.
- **Quota/eviction** (`storageQuota.ts`): refuses installs when free disk is insufficient (with headroom); the Models screen shows a usage banner.
- **Installer & Two-Tier Reconciliation** (`installer.ts`, `AppDelegate.mm`, `nativeAudio.ts`): maintains a physical on-disk manifest at `~/.voicenote/models/installed_models.json` via native atomic file primitives. On cold start, **Tier 1 Fast Path (< 10 ms)** validates file presence and byte size against the manifest; if the manifest is missing or damaged, **Tier 2 Deep Reconciliation** scans `asr/` and `slm/` subdirectories, matches candidate files against catalog specifications, verifies cryptographic SHA-256 hashes, reconstructs the manifest, and registers engines without prompting the user to re-download. Model uninstallation safely unregisters engines and purges physical files.

### 3.8 UI & State
- **Zustand stores**: `useAppStore` (pipeline stage, tone/language, last result, metrics, errors), `useSettingsStore` (tone, lang, VAD sensitivity, ASR tier, Hindi output format, theme, haptics).
- **Screens**: Home (record + waveform + selectors), Result (raw/rewritten toggle, inline edit, copy/share, instant re-rewrite), History (list + detail modal), Models (download/verify/delete), Settings, Privacy.
- **`InteractionManager.runAfterInteractions`** defers heavy UI transitions until the JS thread is idle → smooth animations during ML processing.
- **Haptics + accessibility**: every touchable has `accessibilityRole`/`accessibilityLabel`; haptic feedback is togglable.

### 3.9 Standalone Production Packaging (`scripts/build-macos-dmg.sh`, `scripts/build-android-release.sh`, `scripts/build-all.sh`)
- **Universal macOS DMG Packaging** (`scripts/build-macos-dmg.sh`):
  - Pre-flight checks validate Xcode, CocoaPods, and Rust targets (`aarch64-apple-darwin`, `x86_64-apple-darwin`).
  - Dual static Rust slices are compiled and merged into a universal fat binary `macos/build/rust/libvoicenote_core.a` using Apple `lipo`.
  - Bundles offline JavaScript (`main.jsbundle`) and executes headless `xcodebuild archive` in Release configuration.
  - Applies inside-out ad-hoc codesigning (`codesign --force --deep --sign -`), signing embedded frameworks before the top-level app bundle.
  - Stages the application into `dmg-root/` and packages `dist/VoiceNote-1.0.0.dmg` with `/Applications` symlink via `create-dmg` (fallback `hdiutil`).
- **Standalone Android Release APK Packaging** (`scripts/build-android-release.sh`):
  - Pre-flight checks validate JDK 17, Android SDK 34, Android NDK r26b/r27, `cargo-ndk`, and `aarch64-linux-android`.
  - Cross-compiles `libvoicenote_core.so` targeting `arm64-v8a` via `cargo ndk` to `android/app/src/main/jniLibs/arm64-v8a/`.
  - Scaffolds a complete React Native 0.76 Gradle/NDK build tree (`AGP 8.5.2`, `Kotlin 1.9.24`, `Gradle 8.8`).
  - Automatically provisions local release keystore via `scripts/generate-android-keystore.sh` if missing (supporting CI secret overrides via `VN_KEYSTORE_*` env vars).
  - Executes `./gradlew assembleRelease` to compile offline JS (`index.android.bundle`), link JNI, align, sign, and verify via `apksigner`.
- **Enforced < 80 MB Package Size Ceiling**: Both packaging scripts strictly verify that output installers do not exceed 80 MB, actively preventing the accidental embedding of multi-hundred-MB ML weights. Models remain 100% on-demand.

---

## 4. Production-Grade Features (Voice-Memo Patterns)

The exact patterns interviewers look for in a voice-memo/audio ML product, and where this codebase demonstrates them:

| # | Pattern | Production rationale | Where it lives |
|---|---|---|---|
| 1 | **Offline-first / on-device inference** | No network dependency → works in airplane mode, protects privacy, no per-use cost | `ml/asr`, `ml/slm`, `native/*` bridges |
| 2 | **Ephemeral sensitive data** | Temp audio deleted immediately after ASR (even on errors) — not left in cache | `pipeline/orchestrator.ts:35,95` (`cleanupTempFile`), `segmenter.ts` cleanup |
| 3 | **VAD auto-stop with debounce** | Users don't manually tap stop; quiet-before/after speech handled; single-fire to prevent double-finalize | `audio/vadGate.ts`, `HomeScreen` `isFinalizingRef` |
| 4 | **Pre-inference validation** | "No speech detected" short-circuits before expensive ML | `silenceTrim.ts`, `HomeScreen:128` |
| 5 | **Graceful degradation / fallbacks** | If SLM rewrite fails or hallucinates → fall back to raw transcript, never fail the user silently | `ml/slm/index.ts:68`, `orchestrator.ts:60` |
| 6 | **Model lifecycle management** | Download → verify checksum → quota check → install → register → uninstall; user-initiated, resumable, progress-tracked | `services/modelManager/*`, `ModelsScreen` |
| 7 | **Encrypted local persistence** | Keychain-backed encryption keys + encrypted MMKV; capped store prevents unbounded storage | `services/history/storage.ts`, `keychain.ts` |
| 8 | **Adaptive performance budgets** | Timeout scales with audio length; models lazy-loaded and idle-unloaded into a memory budget | `ml/asr/index.ts` (`computeTimeoutForDuration`), `whisperNative`/`llamaNative` idle timers |
| 9 | **Off-main-thread execution** | All ML on native worker threads/JSI isolates; UI transitions deferred with `InteractionManager` | `native/*`, `HomeScreen`/`ResultScreen` |
| 10 | **Multi-language / code-switched support** | Bilingual prompts, short-clip heuristic, per-script normalization, dominant-language aggregation | `ml/asr/language.ts`, `normalize.ts`, `romanize.ts` |
| 11 | **Long-form audio handling** | Segmentation prevents Whisper's 30 s window from truncating meetings/dictations | `ml/asr/segmenter.ts` |
| 12 | **Safety on generated text** | Hallucination detection via entity + length preservation guards | `ml/slm/validator.ts` |
| 13 | **Deterministic, testable core** | Pure functions and Rust native core thoroughly unit-tested | `tests/*` (280 Jest tests across 50 test suites), `rust/tests/*` (68 Rust tests across 10 binaries) |
| 14 | **Privacy audit as a build gate** | Automated check that no analytics/cloud SDKs are pulled in | `scripts/privacy-audit.js`, `npm run audit:privacy` |
| 15 | **Observability without telemetry** | In-memory ring-buffer logger (max 200 entries) for diagnostics, logs only in dev — no third-party reporting | `utils/logger.ts` |
| 16 | **Type-safe contract-first design** | Shared discriminated-union result types (`AsrResult`, `SlmResult`, `PipelineResult`) keep error handling exhaustive | `ml/types.ts`, `pipeline/types.ts` |
| 17 | **Caps & quotas** | History cap (50 FIFO), storage quota with headroom, single-flight downloads | `storage.ts`, `storageQuota.ts`, `ModelsScreen` |
| 18 | **User-explicit data control** | Delete-one, clear-all, and master-wipe flows with confirmations | `HistoryScreen`, `SettingsScreen` |
| 19 | **Accessibility & UX polish** | Accessibility roles/labels, haptics, live waveform, tone/language quick pickers, raw-vs-rewritten transparency toggle | `components/*`, screens |
| 20 | **Model-tier trade-off UX** | Users choose speed vs accuracy (Tiny/Base/Small); recommended default highlighted | `SettingsScreen`, `ModelsScreen`, `MODELS.md` |
| 21 | **Continuous live rolling capture** | Silence-bounded 20–25s chunks, FIFO background transcription, seam prompt injection, 5-minute safety ceiling | `src/audio/rollingRecorder.ts`, `src/ml/asr/rollingAsrWorker.ts` |
| 22 | **Semantic paragraph SLM rewriting** | Long transcripts split into 150–200 word blocks rewritten sequentially with entity guards & RAM deallocation | `src/ml/slm/paragraphRewriter.ts` |
| 23 | **Standalone production packaging (< 80 MB ceiling)** | Universal DMG (fat `lipo` binary + ad-hoc sign) & standalone Android APK (Gradle + `cargo-ndk` JNI) without Metro | `scripts/build-macos-dmg.sh`, `build-android-release.sh`, `PACKAGING.md` |
| 24 | **Persistent on-disk manifest & cold-start reconciliation** | Physical manifest (`~/.voicenote/models/installed_models.json`) with sub-10ms size validation and deep SHA-256 disk scanning eliminates repeated 639 MB download prompts on app restart | `AppDelegate.mm`, `nativeAudio.ts`, `installer.ts`, `HomeScreen.tsx` |

---

## 5. Interview Q&A (Concise Answers)

**Q1. What is the most interesting engineering problem in this project?**
Keeping a full speech-to-text + text-rewriting ML pipeline **100% on-device** while remaining usable: hard accuracy constraints (Hinglish code-switching), hard privacy constraints (delete audio immediately, no telemetry), and hard performance constraints (multi-hundred-MB models on phones with adaptive timeouts and memory budgets).

**Q2. Why is STT accuracy hard for mixed Hindi + English?**
Whisper detects a *single dominant language per 30 s window*. On code-switched speech it biases the whole output to one script. We mitigate with bilingual initial-prompts, English default for unreliable short clips, segmentation (detect per slice), script-based text detection, and Devanagari/romanized output options.

**Q3. How do you prevent the LLM from changing the meaning?**
The rewrite stage is treated as untrusted. We run a **guard** that (1) extracts critical entities (numbers, dates, currencies, proper nouns) from the input, (2) requires them all present in the output, and (3) enforces a length-ratio bound. Any violation → fallback to the raw transcript. Low temperature (0.3) also favors faithful rewriting.

**Q4. How do you protect user privacy?**
- No cloud inference — ML runs on-device.
- No analytics/crash-reporting SDKs (`audit:privacy` gate).
- Temp audio is deleted immediately after ASR, including on error paths.
- History is encrypted (Keychain key + encrypted MMKV) and capped at 50 records.

**Q5. How do you handle long recordings with Whisper?**
Whisper has an internal ~30 s window; a long file loses audio at window boundaries. We slice >27 s WAVs into segments at detected silence gaps (never through speech), transcribe each with its own adaptive timeout, then merge and normalize.

**Q6. How do you handle edge cases in recording?**
No-speech short-circuit (skip ASR entirely), VAD auto-stop, single-fire stop debounce, cancel discards buffers, model-missing guard prompts the user to download, and permission failures map to clear error codes.

**Q7. What does "models are on-demand" mean technically?**
The binary ships without model weights. The user explicitly installs a model (ASR ~78–480 MB, SLM ~350–1400 MB). Each download is HTTPS with SHA-256 verification, storage-quota checked, resumable, and removable; installed state persists via a manifest.

**Q8. How is state managed?**
Zustand for client state: `useAppStore` (pipeline stage, metrics, results, errors) and `useSettingsStore` (preferences). Navigation via React Navigation native-stack.

**Q9. How do you test an app heavy on native ML?**
Pure functions (WAV parsing, trimming, romanization, normalization, segmentation, entity validation) are unit-tested in Jest with synthetic PCM fixtures. Native bridges expose `__DEV__`/mock hooks so full orchestrator flows run in CI without hardware. A WER benchmark harness and SLM bake-off scripts measure accuracy.

**Q10. What would you improve next?**
Streaming/partial results during recording, punctuation restoration, speaker diarization, optional encrypted backup/export, and tuning segmentation overlap to dedupe boundary words.

---

## 6. Suggested File Tour for Self-Study

| To learn | Read |
|---|---|
| End-to-end pipeline | `src/pipeline/orchestrator.ts`, `src/ml/types.ts` |
| Rust native core & C-ABI | `rust/voicenote-core/src/lib.rs`, `src/native/rustCore/RustCoreHybridObject.cpp` |
| Android JNI cross-compilation | `rust/voicenote-core/src/android_jni.rs`, `android/app/src/main/java/com/voicenote/core/VoiceNoteCoreJni.kt` |
| Recording, VAD & AudioBuffer | `rust/voicenote-core/src/audio/buffer.rs`, `rust/voicenote-core/src/vad/silero.rs`, `src/audio/recorder.ts` |
| Continuous rolling Whisper | `src/audio/rollingRecorder.ts`, `src/ml/asr/rollingAsrWorker.ts` |
| ASR with Hinglish strategy | `rust/voicenote-core/src/asr/whisper.rs`, `src/asr/segmenter.rs`, `src/ml/asr/index.ts` |
| Tone rewrite, paragraphs & guard | `rust/voicenote-core/src/slm/llama.rs`, `src/ml/slm/paragraphRewriter.ts`, `src/slm/validator.rs` |
| Memory & model coordinator | `rust/voicenote-core/src/model_coordinator.rs` |
| Models lifecycle & crypto | `rust/voicenote-core/src/crypto/sha256.rs`, `src/services/modelManager/catalog.ts`, `installer.ts` |
| Secure history | `src/services/history/storage.ts`, `keychain.ts` |
| Standalone packaging pipelines | `scripts/build-macos-dmg.sh`, `scripts/build-android-release.sh`, `docs/PACKAGING.md` |
| UI flows & setup modal | `src/screens/HomeScreen.tsx`, `ResultScreen.tsx`, `FirstRunSetupModal.tsx` |
| Product spec & packaging design | `docs/PRD.md`, `docs/MODELS.md`, `docs/USE_CASES.md`, `docs/PACKAGING.md` |

---

## 7. Numbers to Memorize for Interviews

- Samplerate: **16 kHz**, 16-bit, mono (Whisper/VAD native format).
- VAD frame: **30 ms** (960 bytes/frame) or **512 samples** (32 ms); auto-stop silence window default **1500 ms**.
- Silence trim padding: **200 ms**; speech threshold **0.04** normalized RMS.
- Continuous capture ceiling: **5 minutes (300 s)**; rolling chunk slice size: **20–25 s**; warning banner threshold: **4:30** amber, **4:50** countdown.
- Paragraph rewriting chunk size: **150–200 words** per semantic block.
- ASR models (Whisper): Tiny **~78 MB**, Base **~148 MB**, Small **~480 MB**.
- SLM models (GGUF): Qwen2.5-0.5B **~350 MB**, Palmer-005 **~380 MB**, Gemma-2-2B **~1.4 GB**.
- Standalone installer package size ceiling: strictly **< 80 MB** (actual artifacts ~25–45 MB).
- Timeout: **3 × duration + 15 s**, clamped **[30 s, 120 s]**.
- Segmentation threshold: **>27 s** → slice to ≤27 s segments at silence gaps.
- Memory budget: **< 500 MB RAM budget** enforced via `ModelCoordinator` mutual exclusion; **60s idle auto-unload**.
- Rewriting validation ratio: **[0.35×, 2.5×]** length bound with exact entity preservation.
- History cap: **50 records**, FIFO eviction.
- SLM generation: **temperature 0.3**, top-P 0.9, max 512 tokens.
- Test coverage: **68 Rust tests** across 10 test suites; **288 Jest tests** across 51 test suites; 100% offline.
# No Mocks in Release Builds

Any file under `src/native/` that simulates native behavior with `setInterval`,
`Math.random()`, `setTimeout`, or hardcoded strings is a **test fixture only**.

## Rules
1. Native bridges (`*Native.ts` files) must call real JSI/TurboModules/Platform APIs in release.
2. Mock hooks may exist for unit tests, but must be guarded by `if (__DEV__ && USE_MOCKS)` or explicit test injection (`setMockInferenceHook`).
3. The `__smokeTest()` function must assert real native availability, not return a constant `'ok'`.
4. CI must fail if any file in `src/native/` contains un-guarded simulated data or mock responses outside of test runners.

When investigating tasks mentioning "transcription not working" or "no speech detected", verify that `audioWorker`, `whisperNative`, and `nativeAudio` are actually hitting native code — not returning simulated data.

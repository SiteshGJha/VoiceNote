---
trigger: glob
globs:
  - "**/android/**"
  - "**/ios/**"
---

# Native Module Rules

## When to write native code
Only when a JS library cannot meet the perf or capability requirement.
Prefer `react-native-sherpa-onnx`, `whisper.rn`, `llama.rn`, and
`react-native-nitro-webrtc-vad` over hand-rolled bridges.

## JSI / Nitro
- New native modules use `react-native-nitro-modules`.
- Expose the smallest possible surface — one method per logical operation.
- Never expose a method that blocks the native thread for > 50 ms without
  a callback or promise.

## Android
- Kotlin only. No Java.
- NDK abiFilters: `arm64-v8a` and `x86_64` (dev). Strip `armeabi-v7a` for v1.
- Add a ProGuard rule for every JNI entry point.

## iOS
- Swift only. No Objective-C except where a dependency forces it.
- Enable `-Os` for release; keep `-O0` for debug.
- Metal acceleration for Whisper is opt-in behind a feature flag.

## Testing
Every native module ships with a smoke test callable from JS:
```ts
import { __smokeTest } from 'native-module';
expect(__smokeTest()).toBe('ok');
```

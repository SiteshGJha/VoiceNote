---
trigger: always_on
---

# React Native Conventions

## Framework
- Bare React Native (not Expo managed workflow). Native ML bindings require it.
- React 18+, functional components only. No class components.
- TypeScript everywhere. No `.js` files in `src/`.

## State management
- **Zustand** for global state. No Redux, no MobX.
- **MMKV** for persistence. Not AsyncStorage.
- **React Navigation** for routing. Single native stack for v1.

## Component rules
- One component per file. File name matches component name.
- Co-locate styles with the component using `StyleSheet.create`.
- No inline style objects except for dynamic values.
- NativeWind is allowed but keep critical layout in `StyleSheet` for perf.

## Threading
- **Never** run inference on the JS main thread.
- Heavy work goes through `react-native-nitro-modules` JSI or a native
  background thread.
- Use `InteractionManager.runAfterInteractions` for post-inference UI updates.

## Platform-specific code
- Use `.ios.tsx` / `.android.tsx` suffixes for divergent components.
- Guard native-only APIs with `Platform.select`.
- Always test both platforms before marking a task done.

## Forbidden
- ❌ `fetch` or `axios` in `src/` (model downloader is the only exception,
  and it lives in `src/services/modelDownloader.ts`).
- ❌ `console.log` in committed code — use the `logger` util.
- ❌ Any dependency that phones home.

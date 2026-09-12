---
trigger: always_on
---

# Privacy & Data Rules

## The prime directive
**No audio, transcript, or rewritten text ever leaves the device.**

## Allowed network activity
Exactly one category: HTTPS model downloads from a user-configured,
checksum-verified source. Nothing else. No crash reporting, no analytics,
no "anonymous usage stats", no font CDNs, no remote config.

## Storage
- History is stored in an encrypted MMKV instance.
- The encryption key lives in the OS keychain (`react-native-keychain`).
- Max 50 history records (FIFO eviction).
- Audio files are written to the app cache dir and **deleted immediately**
  after ASR returns — even on error.

## Permissions
Only `RECORD_AUDIO` (Android) and `NSMicrophoneUsageDescription` (iOS).
No contacts, location, camera, photos, or motion.

## Auditing
Before any PR that touches networking, storage, or permissions, run:
- `grep -r "fetch\|axios\|XMLHttpRequest" src/` → must only match modelDownloader.
- `grep -r "AsyncStorage" src/` → must return nothing.
- Verify no new permissions in `Info.plist` / `AndroidManifest.xml`.

## If you must add a network feature
Stop. Ask the user first. Explain exactly what data would leave the device
and why an offline alternative is not possible.

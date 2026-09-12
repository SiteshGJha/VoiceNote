# /release-check

Pre-release verification for VoiceNote.

## Steps
1. **Privacy audit** — run the greps from `03-privacy-and-data.md`.
   Report any hits. Must be zero.
2. **Permissions audit** — diff `Info.plist` and `AndroidManifest.xml`
   against the previous release. New permissions require explicit user sign-off.
3. **Network audit** — build in release mode, run the full pipeline,
   capture traffic via Charles/proxy. Must be zero calls except the
   user-triggered model download.
4. **Perf gate** — run `/skill perf-profiling` targets on a mid-tier
   Android device and an older iPhone. All must pass.
5. **Accuracy gate** — run `scripts/wer.ts` on the locked fixtures.
   EN < 10%, HI < 18%.
6. **Offline test** — airplane mode, full record → copy flow. Must work.
7. **Crash guard** — `grep -r "throw" src/ml/` must return zero throws
   that cross the JSI boundary.
8. Produce a `release-report.md` summarizing pass/fail for each gate.

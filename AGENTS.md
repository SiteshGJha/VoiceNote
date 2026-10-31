# AGENTS.md — Agent Tool & Execution Guidelines

This file defines core operational directives for AI agents interacting with the VoiceNote repository.

---

## 1. Tool Discipline: Dedicated Tools Over Shell

**DO NOT use the shell tool (`run_command`, `bash`, `exec`) for file viewing, editing, searching, or navigation.**

Always use the platform's dedicated tools:

| Operation | Dedicated Tool to Use | Forbidden Shell Commands |
|---|---|---|
| Read file contents | `view_file` | `cat`, `head`, `tail`, `less`, `more` |
| Create / overwrite files | `write_to_file` | `echo "..." > file`, `cat <<EOF > file`, `tee` |
| Edit existing files | `replace_file_content` | `sed`, `awk`, `perl -pe` |
| List files / directories | `list_dir`, `find_by_name` | `ls`, `find`, `dir`, `tree` |
| Search text across files | `grep_search` | `grep`, `rg`, `ag`, `ack` |

### Allowed Uses of the Shell (`run_command`)
Reserve shell execution strictly for:
- Package management & dependencies (`npm install`, `yarn add`, `pod install`)
- Test suites & validation (`npm test`, `jest`)
- Typechecking & linting (`npm run typecheck`, `npm run lint`)
- Privacy & security audits (`npm run audit:privacy`)
- Native builds (`xcodebuild`, `gradlew`)
- Git commands (`git status`, `git diff`)

---

## 2. No Mocks in Release Builds

Any file in `src/native/` simulating native behavior with `setInterval`, `Math.random()`, `setTimeout`, or hardcoded strings is a **test fixture only**.

1. Native bridges must invoke real JSI/TurboModules/Platform APIs when running on device.
2. Simulated hooks must be explicitly guarded behind `__DEV__` or isolated test hooks (`setMockInferenceHook`).
3. Unit tests in `tests/` must remain runnable in Node/CI without requiring physical hardware.

---

## 3. Privacy & Offline Constraints (Non-Negotiable)

1. **Zero Cloud Inference**: All ASR and SLM inference runs on-device. No external API calls.
2. **Audio Ephemerality**: Audio files written to the temporary directory must be deleted immediately after ASR finishes (even on errors).
3. **No Telemetry**: No tracking, analytics, or phoning home.
4. **Storage**: User history must be encrypted via MMKV with OS Keychain-backed keys.

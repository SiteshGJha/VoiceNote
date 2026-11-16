# Task Plan: macOS Universal Standalone Packaging Toolchain Resolution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee deterministic, reproducible Universal 2 (`arm64` + `x86_64`) macOS standalone release packaging for VoiceNote by eliminating silent single-architecture fallbacks in `scripts/build-macos.sh`, adding sub-500ms fail-fast pre-flight toolchain gates in `scripts/build-macos-dmg.sh`, implementing post-archive fat binary assertions, and updating automated sanity test suites and documentation.

**Architecture:** Mandate official `rustup` with both `aarch64-apple-darwin` and `x86_64-apple-darwin` installed. In `scripts/build-macos.sh`, export `MACOSX_DEPLOYMENT_TARGET="13.0"`, compile both target slices sequentially, merge them with `lipo -create` into `macos/build/rust/libvoicenote_core.a`, and verify both architectures with `lipo "$LIB" -verify_arch arm64 x86_64`. In `scripts/build-macos-dmg.sh`, source `$HOME/.cargo/env` if present, unconditionally verify `rustup` and both targets in pre-flight (< 500 ms), and dynamically verify universal architectures on the compiled application executable (`VoiceNote.app/Contents/MacOS/*`) prior to codesigning and DMG packaging. Enforce test coverage in `tests/native/packagingSanity.test.ts`.

**Tech Stack:** React Native 0.76 (macOS), Rust 1.75+, official `rustup`, Apple `lipo`, Xcode 15+, Command Line Tools, Jest (`packagingSanity.test.ts`).

**Spec:** [`docs/designs/macos_universal_packaging_toolchain_resolution.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/macos_universal_packaging_toolchain_resolution.md)

---

## 1. Global Constraints

- **Universal 2 Binary Mandate**: Every release package (`dist/VoiceNote-1.0.0.dmg`) and native static library (`macos/build/rust/libvoicenote_core.a`) must contain both `arm64` and `x86_64` machine slices. Host-only single-architecture release builds are forbidden.
- **Zero Silent Fallbacks**: Build scripts must never silently downgrade to host-architecture compilation when multi-target prerequisites are missing.
- **Sub-Second Pre-Flight Interception**: Toolchain checks must fail in **< 500 ms** before tests, bundling, or Xcode archiving begin, displaying actionable copy-paste remediation commands.
- **Zero Cloud Inference & Zero Telemetry**: Offline runtime invariants remain non-negotiable.
- **Package Size Ceiling**: `dist/VoiceNote-1.0.0.dmg` must remain strictly **< 80 MB**.
- **Test-Driven Verification**: Automated sanity checks in `tests/native/packagingSanity.test.ts` must be updated first (TDD RED) to assert script invariants before script modifications (TDD GREEN).

---

## 2. Review Focus

1. **Rustup Environment Auto-Detection**: Ensure `[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"` is sourced so non-login subshells recognize `rustup` without false-positive failures.
2. **Robust Target Verification**: Use `rustup target list --installed` or exact regex matching rather than fragile grep for `(installed)` (which misses `(default)`).
3. **C/C++ Deployment Target Synchronization**: Ensure `MACOSX_DEPLOYMENT_TARGET="13.0"` is explicitly exported before cargo compilation to synchronize Clang sysroot defaults with VoiceNote's minimum supported OS.
4. **Dynamic Executable Discovery**: Handle case-sensitivity cleanly by dynamically finding the primary executable inside `build/macos/VoiceNote.app/Contents/MacOS/` instead of hardcoding casing.
5. **Architectural Verification Rigor**: Use native Apple `lipo "$BIN" -verify_arch arm64 x86_64` for path-independent verification.

---

## 3. Required API Contracts & Interface Definitions

### A. Pre-Flight Toolchain Gate Specification (`scripts/build-macos-dmg.sh` & `scripts/build-macos.sh`)
```bash
# Sourcing environment
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

# 1. Rustup presence check
if ! command -v rustup &> /dev/null; then
  echo -e "${RED}ERROR: rustup is required for Universal 2 multi-target compilation.${NC}"
  echo -e "${YELLOW}Remediation: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
  exit 1
fi

# 2. Dual target check
INSTALLED_TARGETS=$(rustup target list --installed 2>/dev/null || true)
if ! echo "$INSTALLED_TARGETS" | grep -q "^aarch64-apple-darwin$" || \
   ! echo "$INSTALLED_TARGETS" | grep -q "^x86_64-apple-darwin$"; then
  echo -e "${RED}ERROR: Missing required Rust macOS targets for universal binary compilation.${NC}"
  echo -e "${YELLOW}Remediation: rustup target add aarch64-apple-darwin x86_64-apple-darwin${NC}"
  exit 1
fi
```

### B. Dual Target Compilation & Universal Assembly Contract (`scripts/build-macos.sh`)
```bash
export MACOSX_DEPLOYMENT_TARGET="13.0"

cargo build --release --package voicenote-core --target aarch64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"
cargo build --release --package voicenote-core --target x86_64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"

mkdir -p "$REPO_ROOT/macos/build/rust"
lipo -create \
  "$REPO_ROOT/rust/target/aarch64-apple-darwin/release/libvoicenote_core.a" \
  "$REPO_ROOT/rust/target/x86_64-apple-darwin/release/libvoicenote_core.a" \
  -output "$REPO_ROOT/macos/build/rust/libvoicenote_core.a"

cp "$REPO_ROOT/rust/voicenote-core/voicenote_core.h" "$REPO_ROOT/macos/build/rust/"

# Verify fat binary
if ! lipo "$REPO_ROOT/macos/build/rust/libvoicenote_core.a" -verify_arch arm64 x86_64; then
  echo "ERROR: libvoicenote_core.a does not contain both arm64 and x86_64 slices." >&2
  exit 1
fi
```

### C. Post-Archive Binary Verification Contract (`scripts/build-macos-dmg.sh`)
```bash
echo "Verifying application binary universal architectures..."
APP_BIN=$(find "$REPO_ROOT/build/macos/VoiceNote.app/Contents/MacOS" -type f -perm +111 2>/dev/null | head -n 1)
if [ -z "$APP_BIN" ] || ! lipo "$APP_BIN" -verify_arch arm64 x86_64; then
  echo -e "${RED}ERROR: Compiled application binary is not Universal 2 (arm64 + x86_64):${NC}"
  lipo -info "${APP_BIN:-missing}" || true
  exit 1
fi
echo -e "${GREEN}Universal 2 binary verified: $(lipo -archs "$APP_BIN")${NC}"
```

---

## 4. Step-by-Step Implementation Tasks

### Task 1: Update Automated Packaging Sanity Suite (TDD RED)
**Files:**
- Modify: `tests/native/packagingSanity.test.ts`

- [x] **Step 1.1**: Add assertions in `tests/native/packagingSanity.test.ts` requiring:
  - `scripts/build-macos.sh` contains `MACOSX_DEPLOYMENT_TARGET` export.
  - `scripts/build-macos.sh` contains dual target builds (`--target aarch64-apple-darwin` and `--target x86_64-apple-darwin`).
  - `scripts/build-macos.sh` contains `lipo -create` and `verify_arch arm64 x86_64` assertion.
  - `scripts/build-macos.sh` contains zero single-target host fallback (`ARCH=$(uname -m)`).
  - `scripts/build-macos-dmg.sh` contains pre-flight `rustup` and dual target check.
  - `scripts/build-macos-dmg.sh` contains post-archive universal binary assertion (`verify_arch arm64 x86_64`).
- [x] **Step 1.2**: Run `npm test tests/native/packagingSanity.test.ts` to confirm new assertions fail on existing scripts (RED phase).

---

### Task 2: Host Developer Workstation Toolchain Setup
**Scope:** One-time developer workstation toolchain provisioning.

- [x] **Step 2.1**: Check active rustup installation and remove conflicting Homebrew rust if present (`brew uninstall rust 2>/dev/null || true`).
- [x] **Step 2.2**: Install official `rustup` via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`.
- [x] **Step 2.3**: Source `$HOME/.cargo/env` and add targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
- [x] **Step 2.4**: Verify with `rustup target list --installed` that both `aarch64-apple-darwin` and `x86_64-apple-darwin` are present.

---

### Task 3: Hardening `scripts/build-macos.sh` (TDD GREEN Part 1)
**Files:**
- Modify: `scripts/build-macos.sh`

- [x] **Step 3.1**: Source `[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"` at top of script.
- [x] **Step 3.2**: Remove lines 10–28 (the single-architecture fallback branch).
- [x] **Step 3.3**: Add mandatory `rustup` and dual targets check with remediation instructions.
- [x] **Step 3.4**: Export `MACOSX_DEPLOYMENT_TARGET="13.0"`.
- [x] **Step 3.5**: Unconditionally compile `aarch64-apple-darwin` and `x86_64-apple-darwin` targets.
- [x] **Step 3.6**: Ensure `mkdir -p "$REPO_ROOT/macos/build/rust"` and execute `lipo -create` merging both slices into `macos/build/rust/libvoicenote_core.a`.
- [x] **Step 3.7**: Copy `rust/voicenote-core/voicenote_core.h` to `macos/build/rust/`.
- [x] **Step 3.8**: Add defensive assertion: `lipo "$REPO_ROOT/macos/build/rust/libvoicenote_core.a" -verify_arch arm64 x86_64`.
- [x] **Step 3.9**: Execute `scripts/build-macos.sh` and verify with `lipo -info macos/build/rust/libvoicenote_core.a`.

---

### Task 4: Hardening `scripts/build-macos-dmg.sh` (TDD GREEN Part 2)
**Files:**
- Modify: `scripts/build-macos-dmg.sh`

- [x] **Step 4.1**: Source `[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"` in pre-flight diagnostics.
- [x] **Step 4.2**: Replace optional `if command -v rustup` (lines 46–53) with mandatory fail-fast check for `rustup` and dual targets using `rustup target list --installed`.
- [x] **Step 4.3**: Add Step 7.1 after `.app` extraction: dynamically find application executable (`find ... -type f -perm +111`) and assert `lipo "$APP_BIN" -verify_arch arm64 x86_64`.
- [x] **Step 4.4**: Re-run `npm test tests/native/packagingSanity.test.ts` to confirm all script sanity assertions pass (GREEN phase).

---

### Task 5: Update Packaging Documentation (`docs/PACKAGING.md`)
**Files:**
- Modify: `docs/PACKAGING.md`

- [x] **Step 5.1**: Apply the exact diff to Section 2 of `docs/PACKAGING.md` specifying official `rustup` toolchain, target setup, and Homebrew collision warnings.
- [x] **Step 5.2**: Verify markdown structure and links in `docs/PACKAGING.md`.

---

### Task 6: Full Verification Loop & Release Packaging
**Scope:** End-to-end pipeline validation.

- [x] **Step 6.1**: Run `npm run audit:privacy` to verify zero network/telemetry violations.
- [x] **Step 6.2**: Run `npm test` to verify 0 regressions across all unit and sanity tests.
- [x] **Step 6.3**: Run `npm run typecheck` to confirm strict TypeScript integrity.
- [x] **Step 6.4**: Execute `./scripts/build-macos-dmg.sh` end-to-end to build the standalone release DMG.
- [x] **Step 6.5**: Verify that:
  - Xcode links `x86_64` and `arm64` without symbol errors.
  - Post-archive binary assertion reports `arm64 x86_64`.
  - Codesign verification passes (`codesign --verify --deep --strict`).
  - Output DMG exists at `dist/VoiceNote-1.0.0.dmg`.
  - Output DMG file size is `< 80 MB`.

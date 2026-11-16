#!/usr/bin/env bash
set -euo pipefail

# Auto-source rustup environment for non-login subshells
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Building macOS Rust static library..."
mkdir -p "$REPO_ROOT/macos/build/rust"

if ! command -v rustup &> /dev/null; then
  echo "ERROR: rustup is required for Universal 2 multi-target compilation." >&2
  echo "Remediation: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

INSTALLED_TARGETS=$(rustup target list --installed 2>/dev/null || true)
if ! echo "$INSTALLED_TARGETS" | grep -q "^aarch64-apple-darwin$" || \
   ! echo "$INSTALLED_TARGETS" | grep -q "^x86_64-apple-darwin$"; then
  echo "ERROR: Missing required Rust macOS targets (aarch64-apple-darwin and x86_64-apple-darwin)." >&2
  echo "Remediation: rustup target add aarch64-apple-darwin x86_64-apple-darwin" >&2
  exit 1
fi

export MACOSX_DEPLOYMENT_TARGET="13.0"

echo "Compiling dual architectures (aarch64-apple-darwin and x86_64-apple-darwin)..."
cargo build --release --package voicenote-core --target aarch64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"
cargo build --release --package voicenote-core --target x86_64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"

lipo -create \
  "$REPO_ROOT/rust/target/aarch64-apple-darwin/release/libvoicenote_core.a" \
  "$REPO_ROOT/rust/target/x86_64-apple-darwin/release/libvoicenote_core.a" \
  -output "$REPO_ROOT/macos/build/rust/libvoicenote_core.a"

cp "$REPO_ROOT/rust/voicenote-core/voicenote_core.h" "$REPO_ROOT/macos/build/rust/"

# Verify fat binary
if ! lipo "$REPO_ROOT/macos/build/rust/libvoicenote_core.a" -verify_arch arm64 || \
   ! lipo "$REPO_ROOT/macos/build/rust/libvoicenote_core.a" -verify_arch x86_64; then
  echo "ERROR: libvoicenote_core.a does not contain both arm64 and x86_64 slices." >&2
  exit 1
fi

echo "macOS Rust static library built and verified: macos/build/rust/libvoicenote_core.a ($(lipo -archs "$REPO_ROOT/macos/build/rust/libvoicenote_core.a"))"

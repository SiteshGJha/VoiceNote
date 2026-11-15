#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Building macOS Rust static library..."
mkdir -p "$REPO_ROOT/macos/build/rust"

ARCH=$(uname -m)
HAS_RUSTUP=false
if command -v rustup &> /dev/null; then
  HAS_RUSTUP=true
fi

if [ "$HAS_RUSTUP" = true ] && rustup target list 2>/dev/null | grep -q "x86_64-apple-darwin (installed)" && rustup target list 2>/dev/null | grep -q "aarch64-apple-darwin (installed)"; then
  echo "Compiling dual architectures (aarch64-apple-darwin and x86_64-apple-darwin)..."
  cargo build --release --package voicenote-core --target aarch64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"
  cargo build --release --package voicenote-core --target x86_64-apple-darwin --manifest-path "$REPO_ROOT/rust/Cargo.toml"
  lipo -create \
    "$REPO_ROOT/rust/target/aarch64-apple-darwin/release/libvoicenote_core.a" \
    "$REPO_ROOT/rust/target/x86_64-apple-darwin/release/libvoicenote_core.a" \
    -output "$REPO_ROOT/macos/build/rust/libvoicenote_core.a"
else
  echo "Dual targets not both installed; building native target ($ARCH)..."
  cargo build --release --package voicenote-core --manifest-path "$REPO_ROOT/rust/Cargo.toml"
  cp "$REPO_ROOT/rust/target/release/libvoicenote_core.a" "$REPO_ROOT/macos/build/rust/libvoicenote_core.a"
fi

cp "$REPO_ROOT/rust/voicenote-core/voicenote_core.h" "$REPO_ROOT/macos/build/rust/"
echo "macOS Rust static library built: macos/build/rust/libvoicenote_core.a"

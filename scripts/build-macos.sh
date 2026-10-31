#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../rust"
cargo build --release --package voicenote-core
mkdir -p ../macos/build/rust
cp target/release/libvoicenote_core.a ../macos/build/rust/
cp voicenote-core/voicenote_core.h ../macos/build/rust/
echo "macOS Rust static library built: macos/build/rust/libvoicenote_core.a"

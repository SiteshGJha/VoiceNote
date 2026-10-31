#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../rust"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim 2>/dev/null || true
cargo build --release --target aarch64-apple-ios --package voicenote-core
cargo build --release --target aarch64-apple-ios-sim --package voicenote-core
rm -rf ../ios/RustCore.xcframework
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libvoicenote_core.a \
  -headers voicenote-core/voicenote_core.h \
  -library target/aarch64-apple-ios-sim/release/libvoicenote_core.a \
  -headers voicenote-core/voicenote_core.h \
  -output ../ios/RustCore.xcframework
echo "iOS XCFramework built: ios/RustCore.xcframework"

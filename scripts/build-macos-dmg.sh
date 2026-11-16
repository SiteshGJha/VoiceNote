#!/usr/bin/env bash
set -euo pipefail

# ANSI color codes for diagnostics
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Auto-source rustup environment for non-login subshells
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

echo -e "${BLUE}=== VoiceNote macOS Standalone Universal DMG Builder ===${NC}"

# 1. Pre-Flight Checks
echo "Running pre-flight environment diagnostics..."

# Node.js check
if ! command -v node &> /dev/null; then
  echo -e "${RED}ERROR: Node.js is not installed.${NC}"
  echo -e "${YELLOW}Remediation: nvm use 18 || brew install node@18${NC}"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}ERROR: Node.js >= 18 is required (found v$(node -v)).${NC}"
  echo -e "${YELLOW}Remediation: nvm use 18 || brew install node@18${NC}"
  exit 1
fi

# Xcode and CLI Tools check
if ! command -v xcodebuild &> /dev/null; then
  echo -e "${RED}ERROR: Xcode command-line tools not installed or active.${NC}"
  echo -e "${YELLOW}Remediation: xcode-select --install${NC}"
  exit 1
fi

# CocoaPods check
if ! command -v pod &> /dev/null; then
  echo -e "${RED}ERROR: CocoaPods is not installed.${NC}"
  echo -e "${YELLOW}Remediation: sudo gem install cocoapods || brew install cocoapods${NC}"
  exit 1
fi

# Rust toolchain and targets check
if ! command -v rustup &> /dev/null; then
  echo -e "${RED}ERROR: rustup is required for Universal 2 multi-target compilation.${NC}"
  echo -e "${YELLOW}Homebrew's standalone cargo cannot compile x86_64 targets on Apple Silicon.${NC}"
  echo -e "${YELLOW}Remediation: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
  exit 1
fi

INSTALLED_TARGETS=$(rustup target list --installed 2>/dev/null || true)
if ! echo "$INSTALLED_TARGETS" | grep -q "^aarch64-apple-darwin$" || \
   ! echo "$INSTALLED_TARGETS" | grep -q "^x86_64-apple-darwin$"; then
  echo -e "${RED}ERROR: Missing required Rust macOS targets for universal binary compilation.${NC}"
  echo -e "${YELLOW}Remediation: rustup target add aarch64-apple-darwin x86_64-apple-darwin${NC}"
  exit 1
fi

echo -e "${GREEN}Pre-flight checks passed!${NC}"

# 2. Quality Gates
echo "Running quality audits and test suites..."
npm run audit:privacy
npm test

# 3. Ensure Output Directory
mkdir -p "$REPO_ROOT/dist"

# 4. Build Universal Rust Static Library
echo "Building macOS Rust static library..."
"$REPO_ROOT/scripts/build-macos.sh"

# 5. Bundle Offline JavaScript Bundle
echo "Bundling offline JavaScript and assets for macOS..."
npm run bundle:macos

# 6. Headless Xcode Archiving
echo "Archiving Release configuration via xcodebuild..."
rm -rf "$REPO_ROOT/build/macos/voicenote.xcarchive"
xcodebuild archive \
  -workspace "$REPO_ROOT/macos/voicenote.xcworkspace" \
  -scheme voicenote-macOS \
  -configuration Release \
  -archivePath "$REPO_ROOT/build/macos/voicenote.xcarchive" \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO

# 7. Extract .app Bundle
mkdir -p "$REPO_ROOT/build/macos"
rm -rf "$REPO_ROOT/build/macos/VoiceNote.app"
cp -R "$REPO_ROOT/build/macos/voicenote.xcarchive/Products/Applications/VoiceNote.app" "$REPO_ROOT/build/macos/VoiceNote.app"

# 7.1. Verify Universal Binary Architecture
echo "Verifying application binary universal architectures..."
APP_BIN=$(find "$REPO_ROOT/build/macos/VoiceNote.app/Contents/MacOS" -type f -perm +111 2>/dev/null | head -n 1)
if [ -z "$APP_BIN" ] || \
   ! lipo "$APP_BIN" -verify_arch arm64 || \
   ! lipo "$APP_BIN" -verify_arch x86_64; then
  echo -e "${RED}ERROR: Compiled application binary is not Universal 2 (arm64 + x86_64):${NC}"
  lipo -info "${APP_BIN:-missing}" 2>/dev/null || true
  exit 1
fi
echo -e "${GREEN}Universal 2 binary verified: $(lipo -archs "$APP_BIN")${NC}"

# 8. Inside-Out Ad-Hoc Codesigning
echo "Applying inside-out ad-hoc code signature..."
if [ -d "$REPO_ROOT/build/macos/VoiceNote.app/Contents/Frameworks" ]; then
  find "$REPO_ROOT/build/macos/VoiceNote.app/Contents/Frameworks" -type f -name "*.dylib" -exec codesign --force --sign - {} +
  find "$REPO_ROOT/build/macos/VoiceNote.app/Contents/Frameworks" -type d -name "*.framework" -exec codesign --force --sign - {} +
fi
codesign --force --sign - "$REPO_ROOT/build/macos/VoiceNote.app"
codesign --verify --deep --strict "$REPO_ROOT/build/macos/VoiceNote.app"

# 9. DMG Staging & Image Creation
echo "Staging application for DMG packaging..."
rm -rf "$REPO_ROOT/build/macos/dmg-root"
mkdir -p "$REPO_ROOT/build/macos/dmg-root"
cp -R "$REPO_ROOT/build/macos/VoiceNote.app" "$REPO_ROOT/build/macos/dmg-root/"

DMG_OUT="$REPO_ROOT/dist/VoiceNote-1.0.0.dmg"
rm -f "$DMG_OUT"

if command -v create-dmg &> /dev/null; then
  echo "Generating DMG using create-dmg..."
  create-dmg \
    --volname "VoiceNote" \
    --window-pos 200 120 \
    --window-size 540 380 \
    --icon-size 128 \
    --icon "VoiceNote.app" 140 190 \
    --app-drop-link 400 190 \
    --hide-extension "VoiceNote.app" \
    --no-internet-enable \
    "$DMG_OUT" \
    "$REPO_ROOT/build/macos/dmg-root" || {
      echo -e "${YELLOW}create-dmg encountered an issue; falling back to hdiutil...${NC}"
      ln -s /Applications "$REPO_ROOT/build/macos/dmg-root/Applications" 2>/dev/null || true
      hdiutil create -volname "VoiceNote" -srcfolder "$REPO_ROOT/build/macos/dmg-root" -ov -format UDZO "$DMG_OUT"
    }
else
  echo "create-dmg not found; using standard hdiutil..."
  ln -s /Applications "$REPO_ROOT/build/macos/dmg-root/Applications" 2>/dev/null || true
  hdiutil create -volname "VoiceNote" -srcfolder "$REPO_ROOT/build/macos/dmg-root" -ov -format UDZO "$DMG_OUT"
fi

# 10. Binary Size Ceiling Assertion (< 80 MB)
FILE_SIZE_MB=$(du -m "$DMG_OUT" | cut -f1)
echo "DMG Package Size: ${FILE_SIZE_MB} MB (Ceiling: 80 MB)"

if [ "$FILE_SIZE_MB" -gt 80 ]; then
  echo -e "${RED}ERROR: Package size ($FILE_SIZE_MB MB) exceeds the 80 MB ceiling!${NC}"
  echo -e "${RED}Ensure that ML model weights (*.bin, *.gguf, *.onnx) are not bundled in assets.${NC}"
  exit 1
fi

echo -e "${GREEN}=== macOS DMG Build Complete: dist/VoiceNote-1.0.0.dmg (${FILE_SIZE_MB} MB) ===${NC}"

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE_PATH="${VN_KEYSTORE_PATH:-$REPO_ROOT/android/app/voicenote-release.keystore}"
KEY_ALIAS="${VN_KEY_ALIAS:-voicenote-release-key}"
KEYSTORE_PASSWORD="${VN_KEYSTORE_PASSWORD:-voicenote_dev_password}"
KEY_PASSWORD="${VN_KEY_PASSWORD:-voicenote_dev_password}"

if [ -f "$KEYSTORE_PATH" ]; then
  echo "Keystore already exists at: $KEYSTORE_PATH"
  exit 0
fi

if ! command -v keytool &> /dev/null; then
  echo "ERROR: 'keytool' utility not found. Please ensure JDK 17 is installed."
  exit 1
fi

echo "Generating release keystore at: $KEYSTORE_PATH"
mkdir -p "$(dirname "$KEYSTORE_PATH")"

keytool -genkeypair -v \
  -keystore "$KEYSTORE_PATH" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -dname "CN=VoiceNote Dev, OU=VoiceNote, O=VoiceNote, L=Unknown, ST=Unknown, C=US"

echo "Release keystore generated successfully at $KEYSTORE_PATH."

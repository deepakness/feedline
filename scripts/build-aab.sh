#!/usr/bin/env bash
set -euo pipefail

# Builds the Android App Bundle for Google Play: dist/play/feedline.aab, for 64-bit
# and 32-bit phones. It is signed with the upload key (FEEDLINE_UPLOAD_* in
# ~/.gradle/gradle.properties); Play re-signs what it delivers with the Feedline key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPECTED_UPLOAD_CERT_SHA256="398cc868490c9da8fe64e49dd9df1addb2b6ba749e54aa76b51932797ef1ae06"

source "$ROOT/scripts/android-env.sh"

GRADLE_PROPS="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
for prop in FEEDLINE_UPLOAD_STORE_FILE FEEDLINE_UPLOAD_STORE_PASSWORD \
  FEEDLINE_UPLOAD_KEY_ALIAS FEEDLINE_UPLOAD_KEY_PASSWORD; do
  grep -qE "^[[:space:]]*${prop}[[:space:]]*=" "$GRADLE_PROPS" 2>/dev/null ||
    die "upload signing is not configured: $GRADLE_PROPS is missing $prop"
done

BUILT="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
PLAY_DIR="$ROOT/dist/play"
rm -f "$BUILT"
rm -rf "$PLAY_DIR"
mkdir -p "$PLAY_DIR"

# android/ is generated; --clean keeps it in step with app.json and the plugins.
npx expo prebuild --platform android --clean
(cd "$ROOT/android" && ./gradlew bundleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a -PfeedlineUpload=true)

[[ -f "$BUILT" ]] || die "expected build output at $BUILT but it was not produced"
actual="$(keytool -printcert -jarfile "$BUILT" | sed -n 's/.*SHA256: *//p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$actual" == "$EXPECTED_UPLOAD_CERT_SHA256" ]] ||
  die "wrong signing key on the AAB (got '${actual:-none}', expected $EXPECTED_UPLOAD_CERT_SHA256)"
cp "$BUILT" "$PLAY_DIR/feedline.aab"

echo "signed with the upload key:"
ls -lh "$PLAY_DIR"

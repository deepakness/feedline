#!/usr/bin/env bash
set -euo pipefail

# Builds release-signed APKs on this machine: dist/release/ holds the GitHub release
# assets (feedline.apk for arm64, feedline-armv7.apk, and a .sha256 for each).
#
# Signing comes from four FEEDLINE_RELEASE_* properties in ~/.gradle/gradle.properties
# (see plugins/withReleaseSigning.js). The finished APK's certificate is checked against
# the fingerprint below, because an APK signed with any other key installs fine on a
# fresh phone but can never update the one already installed.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPECTED_CERT_SHA256="53b41ec67780f0357859bac15872be9fcde989c10ff6ac217582bacf63022e1d"

source "$ROOT/scripts/android-env.sh"

GRADLE_PROPS="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
for prop in FEEDLINE_RELEASE_STORE_FILE FEEDLINE_RELEASE_STORE_PASSWORD \
  FEEDLINE_RELEASE_KEY_ALIAS FEEDLINE_RELEASE_KEY_PASSWORD; do
  grep -qE "^[[:space:]]*${prop}[[:space:]]*=" "$GRADLE_PROPS" 2>/dev/null ||
    die "release signing is not configured: $GRADLE_PROPS is missing $prop"
done

VERSION="$(node -p "require('./app.json').expo.version")"
BUILT_DIR="$ROOT/android/app/build/outputs/apk/release"
RELEASE_DIR="$ROOT/dist/release"
mkdir -p "$ROOT/dist"
rm -rf "$BUILT_DIR" "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# android/ is generated; --clean keeps it in step with app.json and the plugins.
npx expo prebuild --platform android --clean
# One APK per architecture (plugins/withAbiSplits.js): 64-bit for almost every phone,
# 32-bit for older and budget ones.
(cd "$ROOT/android" && ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a -PfeedlineAbiSplits=true)

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
APKSIGNER="$BUILD_TOOLS/apksigner"
AAPT2="$BUILD_TOOLS/aapt2"
[[ -x "$APKSIGNER" && -x "$AAPT2" ]] || die "apksigner/aapt2 not found; refusing to hand over an unverified APK"

# Release asset names are fixed: the README links to releases/latest/download/<name>.
ship() {
  local abi="$1" name="$2"
  local built="$BUILT_DIR/app-${abi}-release.apk"
  [[ -f "$built" ]] || die "expected build output at $built but it was not produced"
  local certs actual abis
  certs="$("$APKSIGNER" verify --print-certs "$built" 2>&1)" || die "$abi APK failed signature verification"
  # Older apksigner prints "Signer #1 certificate SHA-256 digest:", newer "V2 Signer: certificate SHA-256 digest:".
  actual="$(sed -n 's/.*Signer.*certificate SHA-256 digest: *//p' <<<"$certs" | head -1)"
  [[ "$actual" == "$EXPECTED_CERT_SHA256" ]] ||
    die "wrong signing key on $abi APK (got '${actual:-none}', expected $EXPECTED_CERT_SHA256)"
  abis="$("$AAPT2" dump badging "$built" | sed -n "s/^native-code: //p")"
  [[ "$abis" == "'$abi'" ]] || die "$abi APK contains native code for $abis"
  cp "$built" "$RELEASE_DIR/$name"
  (cd "$RELEASE_DIR" && shasum -a 256 "$name" >"$name.sha256")
}

ship arm64-v8a feedline.apk
ship armeabi-v7a feedline-armv7.apk
cp "$RELEASE_DIR/feedline.apk" "$ROOT/dist/feedline-${VERSION}.apk"

echo "signed with the Feedline key; release assets for ${VERSION}:"
ls -lh "$RELEASE_DIR"

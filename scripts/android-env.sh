# Sourced by the build scripts: finds the JDK and Android SDK.

die() {
  echo "error: $*" >&2
  exit 1
}

detect_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    echo "$JAVA_HOME"
    return
  fi
  local jh
  jh="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  if [[ -n "$jh" ]]; then
    echo "$jh"
    return
  fi
  # Homebrew does not link its JDK where java_home looks.
  if [[ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
    echo /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
    return
  fi
  die "no JDK 17 found. Install openjdk@17 or export JAVA_HOME."
}

detect_android_home() {
  for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" /opt/homebrew/share/android-commandlinetools; do
    if [[ -n "$candidate" && -d "$candidate/platform-tools" ]]; then
      echo "$candidate"
      return
    fi
  done
  die "no Android SDK found. Install it or export ANDROID_HOME."
}

JAVA_HOME="$(detect_java_home)"
ANDROID_HOME="$(detect_android_home)"
export JAVA_HOME ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

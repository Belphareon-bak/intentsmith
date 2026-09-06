#!/usr/bin/env bash
# The phone-to-gateway path, and the build that uses it.
# =============================================================================
#
# The gateway binds loopback and refuses anything else without
# `C3_MOBILE_ALLOW_REMOTE`, because a remote listener and production pairing are
# `LATER_GATE` behind M6 (`G0-R032`, ROADMAP §11).  That pushback is right, and
# it leaves one honest way to reach the gateway from a phone: make the phone's
# own loopback *be* the desktop's.
#
#   adb reverse tcp:3336 tcp:3336
#
# `adb reverse` opens a listener **on the phone** at 127.0.0.1:3336 and pipes it
# down the USB cable.  Nothing is exposed to the Wi-Fi, no port is opened on the
# desktop, and the gateway's own binding does not change — from its side the
# connection arrives on loopback, which is exactly what it already allows.
#
# That is why this is not a workaround waiting for a "real" remote mode.  It is
# the only path that is *both* usable today and inside the boundary M6 has not
# yet moved.
#
# Subcommands:
#   reverse   open the tunnel (idempotent; safe to re-run)
#   keystore  create the internal signing key, once
#   build     assemble the signed release APK
#   install   install it on the attached device
#   run       reverse + install + launch
#   doctor    say what is and is not ready, without changing anything
#
# Adresa gateway se volí proměnnou C3_MOBILE_APP_URL při buildu — rozhodnutí
# 026 (bezdrát přes VPN).  Výchozí je loopback, tedy kabel.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/mobile-app"
ANDROID_DIR="$APP_DIR/android"
PORT="${C3_MOBILE_PORT:-3336}"
APP_ID="cz.intentsmith.companion"

# Kam se zabalený klient připojuje. Výchozí je loopback telefonu, který přes
# `adb reverse` vede kabelem sem. Vzdálený build musí použít HTTPS:
#
#   C3_MOBILE_APP_URL=https://gateway.example npm run mobile:android:build
#
# Je to vstup buildu, ne přepínač v aplikaci. `cap copy` zabalí jediný klient a
# následující krok zapíše origin jen do ignorovaného Android assetu. Zdrojový
# klient ani Capacitor konfigurace se buildem nemění.
APP_URL="${C3_MOBILE_APP_URL:-http://127.0.0.1:$PORT}"

# The toolchain is not assumed to be on PATH: this repo is developed on machines
# where the Android SDK was unpacked by hand rather than installed by Studio.
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/toolchain/android-sdk}}"
: "${JAVA_HOME:=$HOME/toolchain/jdk21}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME" JAVA_HOME
ADB="$ANDROID_HOME/platform-tools/adb"

die() { echo "  ✗ $*" >&2; exit 1; }
note() { echo "  $*"; }

need_adb() {
  [ -x "$ADB" ] || die "adb not found at $ADB — set ANDROID_HOME to the SDK root."
}

cmd_doctor() {
  echo
  echo "IntentSmith Android shell — stav"
  [ -x "$ADB" ] && note "✓ adb        $ADB" || note "✗ adb        chybí ($ADB)"
  [ -x "$JAVA_HOME/bin/java" ] && note "✓ JDK        $JAVA_HOME" || note "✗ JDK        chybí ($JAVA_HOME)"
  [ -f "$ANDROID_DIR/local.properties" ] && note "✓ local.properties" || note "✗ local.properties (spusť: $0 build)"
  [ -f "$ANDROID_DIR/keystore.properties" ] && note "✓ podpisový klíč" || note "✗ podpisový klíč není — release build selže (záměr)"
  note "· adresa v buildu: $APP_URL"
  if [ -x "$ADB" ]; then
    local devices
    devices="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
    [ -n "$devices" ] && note "✓ zařízení   $devices" || note "✗ zařízení   žádné připojené"
    "$ADB" reverse --list 2>/dev/null | grep -q "tcp:$PORT" \
      && note "✓ tunel      tcp:$PORT je otevřený" \
      || note "· tunel      není (spusť: $0 reverse)"
  fi
  if curl -s -m 2 "http://127.0.0.1:$PORT/m1/health" >/dev/null 2>&1; then
    note "✓ gateway    odpovídá na 127.0.0.1:$PORT"
  else
    note "✗ gateway    neodpovídá — spusť: npm run mobile:gateway"
  fi
  echo
}

cmd_reverse() {
  need_adb
  "$ADB" wait-for-device
  # Re-running is safe: adb replaces an identical mapping rather than stacking
  # them, so this can live in a shell alias without accumulating tunnels.
  "$ADB" reverse "tcp:$PORT" "tcp:$PORT"
  note "✓ tunel otevřen: telefon 127.0.0.1:$PORT → tenhle stroj"
  curl -s -m 2 "http://127.0.0.1:$PORT/m1/health" >/dev/null 2>&1 \
    || note "· pozor: gateway na tomhle stroji neodpovídá, tunel vede nikam"
}

cmd_keystore() {
  local props="$ANDROID_DIR/keystore.properties"
  local keydir="$APP_DIR/keys"
  local keyfile="$keydir/internal.jks"
  [ -f "$keyfile" ] && die "klíč už existuje: $keyfile (smaž ho ručně, pokud ho chceš vyměnit)"
  mkdir -p "$keydir"
  # A prototype key, said out loud.  It is generated locally, git-ignored, and
  # its password is in a file next to it — that is *not* a production key
  # ceremony and must never be mistaken for one.  What it buys is a stable
  # signature so that reinstalling the app keeps its data instead of being
  # rejected as a different app.
  local pass="${C3_ANDROID_KEY_PASS:-intentsmith-prototype}"
  "$JAVA_HOME/bin/keytool" -genkeypair -v \
    -keystore "$keyfile" -alias internal \
    -keyalg RSA -keysize 4096 -validity 3650 \
    -storepass "$pass" -keypass "$pass" \
    -dname "CN=IntentSmith Prototype, OU=Internal, O=IntentSmith, C=CZ" >/dev/null
  cat > "$props" <<EOF
storeFile=$keyfile
storePassword=$pass
keyAlias=internal
keyPassword=$pass
EOF
  chmod 700 "$keydir"
  chmod 600 "$keyfile" "$props"
  note "✓ klíč vytvořen: $keyfile"
  note "  Je to interní prototypový klíč. Do obchodu s ním nic nejde."
}

cmd_build() {
  [ -d "$ANDROID_DIR" ] || die "chybí $ANDROID_DIR — spusť nejdřív: cd mobile-app && npx cap add android"
  echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
  ( cd "$APP_DIR" && npx cap copy android >/dev/null )
  node "$REPO_ROOT/scripts/mobile-android-prepare-assets.mjs" --url "$APP_URL"
  ( cd "$ANDROID_DIR" && ./gradlew --no-daemon :app:assembleRelease )
  local apk="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
  [ -f "$apk" ] || apk="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
  note "✓ APK: $apk"
  "$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$apk" 2>/dev/null | head -3 || true
}

cmd_install() {
  need_adb
  local apk="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
  [ -f "$apk" ] || die "APK není postavené — spusť: $0 build"
  "$ADB" install -r "$apk"
  note "✓ nainstalováno"
}

cmd_run() {
  cmd_reverse
  cmd_install
  need_adb
  "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
  note "✓ spuštěno na zařízení"
}

case "${1:-doctor}" in
  reverse)  cmd_reverse ;;
  keystore) cmd_keystore ;;
  build)    cmd_build ;;
  install)  cmd_install ;;
  run)      cmd_run ;;
  doctor)   cmd_doctor ;;
  *) die "neznámý příkaz: $1 (reverse|keystore|build|install|run|doctor)" ;;
esac

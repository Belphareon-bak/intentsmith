#!/usr/bin/env bash
set -euo pipefail
umask 077

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$PACKAGE_DIR/runtime/bin/node"
APPIMAGE="$PACKAGE_DIR/IntentSmith-Studio2.AppImage"
TRIAL_DIR="${INTENTSMITH_STUDIO2_TRIAL_DIR:-$HOME/.local/share/intentsmith-studio2}"

if [[ ! -x "$NODE_BIN" || ! -x "$APPIMAGE" || ! -d "$PACKAGE_DIR/source/node_modules" ]]; then
  printf 'Balík je neúplný. Ověř soubory podle SHA256SUMS.\n' >&2
  exit 1
fi

install -d -m 700 "$TRIAL_DIR" "$TRIAL_DIR/home" "$TRIAL_DIR/config" \
  "$TRIAL_DIR/cache" "$TRIAL_DIR/data" "$TRIAL_DIR/projects"
RUN_DIR="$(mktemp -d "$TRIAL_DIR/run.XXXXXXXX")"
PORT_FILE="$RUN_DIR/backend.port.json"
BACKEND_LOG="$RUN_DIR/backend.log"
APP_LOG="$RUN_DIR/app.log"
backend_pid=''
cleanup() {
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill -TERM "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$PACKAGE_DIR/source"
env PATH="$PACKAGE_DIR/runtime/bin:$PATH" HOME="$TRIAL_DIR/home" XDG_CONFIG_HOME="$TRIAL_DIR/config" \
  XDG_CACHE_HOME="$TRIAL_DIR/cache" XDG_DATA_HOME="$TRIAL_DIR/data" \
  INTENTSMITH_DB_PATH="$TRIAL_DIR/data/intentsmith.sqlite" \
  INTENTSMITH_PROJECTS_DIR="$TRIAL_DIR/projects" \
  INTENTSMITH_PORT_FILE="$PORT_FILE" \
  INTENTSMITH_ENABLE_ONLINE_DISCOVERY=false \
  PYTHONDONTWRITEBYTECODE=1 \
  INTENTSMITH_PDF_PYTHON="$PACKAGE_DIR/runtime/pdf/bin/python" \
  UCETNI_RUNTIME_DIR="$PACKAGE_DIR/runtime/accountant" \
  OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}" \
  "$NODE_BIN" src/server.js > "$BACKEND_LOG" 2>&1 &
backend_pid=$!

ready=false
for ((attempt=0; attempt<120; attempt++)); do
  if [[ -s "$PORT_FILE" ]] && "$NODE_BIN" -e '
    const fs = require("node:fs");
    const portFile = process.argv[1], expectedPid = Number(process.argv[2]);
    try {
      const value = JSON.parse(fs.readFileSync(portFile, "utf8"));
      if (value.pid === expectedPid && Number.isSafeInteger(value.port) && value.port > 0) process.exit(0);
    } catch {}
    process.exit(1);
  ' "$PORT_FILE" "$backend_pid"; then
    ready=true
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null; then break; fi
  sleep 0.25
done
if [[ "$ready" != true ]]; then
  printf 'Backend se nespustil. Log: %s\n' "$BACKEND_LOG" >&2
  exit 1
fi

printf 'Studio 2 trial: %s\n' "$TRIAL_DIR"
printf 'Studio 2 je jediný frontend a otevře se přímo.\n'
printf 'Log aplikace: %s\n' "$APP_LOG"
env -u ELECTRON_RUN_AS_NODE HOME="$TRIAL_DIR/home" \
  XDG_CONFIG_HOME="$TRIAL_DIR/config" XDG_CACHE_HOME="$TRIAL_DIR/cache" \
  XDG_DATA_HOME="$TRIAL_DIR/data" INTENTSMITH_PORT_FILE="$PORT_FILE" \
  INTENTSMITH_STUDIO2_PREVIEW=1 "$APPIMAGE" --appimage-extract-and-run > "$APP_LOG" 2>&1

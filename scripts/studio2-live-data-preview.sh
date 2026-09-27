#!/usr/bin/env bash
# Open the current Studio 2 build against the already running IntentSmith
# backend. The backend remains the sole owner of its live database.
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPERATOR_HOME="$HOME"
PROFILE="${INTENTSMITH_STUDIO2_PROFILE:-$OPERATOR_HOME/Projects/intentsmith-studio2-trial}"
LIVE_PORT_FILE="${INTENTSMITH_LIVE_PORT_FILE:-$OPERATOR_HOME/.local/state/intentsmith/backend.port.json}"
APPIMAGE="${INTENTSMITH_STUDIO2_APPIMAGE:-}"
NODE24="${INTENTSMITH_NODE24_BIN:-}"

if [ -n "$APPIMAGE" ]; then
  if [[ "$APPIMAGE" != /* ]] || [ ! -f "$APPIMAGE" ] || [ ! -x "$APPIMAGE" ]; then
    echo 'INTENTSMITH_STUDIO2_APPIMAGE must name an absolute executable AppImage path.' >&2
    exit 1
  fi
  PROBE_NODE="$(command -v node || true)"
  if [ -z "$PROBE_NODE" ]; then
    echo 'Node.js is required to verify the private backend port file.' >&2
    exit 1
  fi
else
  if [ -z "$NODE24" ]; then
    if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ]; then
      NODE24="$(command -v node)"
    elif [ -x /tmp/is-studio2-node24/node_modules/node/bin/node ]; then
      NODE24=/tmp/is-studio2-node24/node_modules/node/bin/node
    fi
  fi
  if [ -z "$NODE24" ] || [ ! -x "$NODE24" ] || [ "$("$NODE24" -p 'process.versions.node.split(".")[0]')" != 24 ]; then
    echo 'Studio 2 source build requires Node 24. Set INTENTSMITH_NODE24_BIN.' >&2
    exit 1
  fi
  if [ ! -s "$SOURCE_ROOT/intentsmith-ide/applications/electron/lib/frontend/bundle.js" ]; then
    echo 'Studio 2 build is missing. Build it with Node 24: (cd intentsmith-ide && yarn build)' >&2
    exit 1
  fi
  PROBE_NODE="$NODE24"
  export PATH="$(dirname "$NODE24"):$PATH"
fi

export INTENTSMITH_PORT_FILE="$LIVE_PORT_FILE"
if ! "$PROBE_NODE" -e '
  (async () => {
    const access = require(process.argv[1]).readLocalAccess();
    if (!access) process.exit(1);
    const response = await fetch(access.backendUrl + "/api/health", {
      headers: { Origin: "null", "X-IntentSmith-Local-Capability": access.localCapability },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) process.exit(1);
  })().catch(() => process.exit(1));
' "$SOURCE_ROOT/intentsmith-ide/applications/electron/intentsmith-local-access.js"; then
  echo 'The running backend could not be verified. Its service was not changed.' >&2
  exit 1
fi

if [ "${1:-}" = '--check' ]; then
  echo 'Studio 2 application and live backend port file are ready.'
  exit 0
fi
if [ "$#" -ne 0 ]; then
  echo 'Usage: scripts/studio2-live-data-preview.sh [--check]' >&2
  exit 2
fi

LOCK="$PROFILE/config/intentsmith-ide-electron/SingletonLock"
if [ -L "$LOCK" ]; then
  OWNER="$(readlink "$LOCK")"
  OWNER_PID="${OWNER##*-}"
  if [[ "$OWNER_PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$OWNER_PID" 2>/dev/null; then
    echo 'Close the already running Studio trial window before opening the live-data preview.' >&2
    exit 1
  fi
fi

umask 077
mkdir -p "$PROFILE/home" "$PROFILE/config" "$PROFILE/cache" "$PROFILE/data"
chmod 700 "$PROFILE" "$PROFILE/home" "$PROFILE/config" "$PROFILE/cache" "$PROFILE/data"
export HOME="$PROFILE/home"
export XDG_CONFIG_HOME="$PROFILE/config"
export XDG_CACHE_HOME="$PROFILE/cache"
export XDG_DATA_HOME="$PROFILE/data"
export INTENTSMITH_STUDIO2_PREVIEW=1
cd "$SOURCE_ROOT/intentsmith-ide/applications/electron"
echo 'Opening Studio 2 with the currently running IntentSmith backend and its live data.'
if [ -n "$APPIMAGE" ]; then
  exec env -u ELECTRON_RUN_AS_NODE APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE"
fi
exec env -u ELECTRON_RUN_AS_NODE "$NODE24" scripts/launch.js

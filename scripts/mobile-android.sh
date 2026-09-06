#!/usr/bin/env bash
# Compatibility entry point for existing Unix invocations. The authoritative
# cross-platform workflow lives in mobile-android.mjs and is also used by npm.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$REPO_ROOT/scripts/mobile-android.mjs" "$@"

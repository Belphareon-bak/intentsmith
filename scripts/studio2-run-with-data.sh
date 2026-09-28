#!/usr/bin/env bash
set -euo pipefail
umask 077
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DB="${INTENTSMITH_STUDIO2_SOURCE_DB:-$HOME/Projects/intentsmith/data/c3.db}"
TRIAL_DIR="${INTENTSMITH_STUDIO2_TRIAL_DIR:-$HOME/.local/share/intentsmith-studio2}"
TARGET_DB="$TRIAL_DIR/data/intentsmith.sqlite"
if [[ ! -e "$TARGET_DB" ]]; then
  install -d -m 700 "$TRIAL_DIR/data"
  "$PACKAGE_DIR/runtime/bin/node" "$PACKAGE_DIR/source/scripts/studio2-copy-user-data.cjs" "$SOURCE_DB" "$TARGET_DB"
fi
export INTENTSMITH_STUDIO2_TRIAL_DIR="$TRIAL_DIR"
exec "$PACKAGE_DIR/run-trial.sh" "$@"

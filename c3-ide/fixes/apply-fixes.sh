#!/bin/bash
# Historical v7 overwrite payload was archived after committed extension lib/
# became the explicit Studio runtime source of truth.
set -e

echo "ERROR: c3-ide/fixes is retired and must not overwrite authoritative Studio lib/." >&2
echo "Historical payload: docs/archive/c3-studio/v7-fix-payload/" >&2
exit 2

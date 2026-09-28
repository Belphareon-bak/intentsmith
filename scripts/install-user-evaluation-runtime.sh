#!/usr/bin/env bash
# Install the qualified sidecar in user space; no service or model-store writes.
set -euo pipefail
[[ $# == 2 || $# == 3 ]] || { echo 'Usage: install-user-evaluation-runtime.sh PATCHED_BINARY UPSTREAM_ARCHIVE [NEW_DESTINATION]' >&2; exit 2; }
provider_binary=$(realpath -- "$1")
provider_archive=$(realpath -- "$2")
provider_destination=${3:-${XDG_DATA_HOME:-$HOME/.local/share}/intentsmith/evaluation-provider/0.34.2-intentsmith.1}
printf '%s  %s\n' 2b98fceffbc6d5d97a6e96ddfd46c597cee4fa06a03d740fdb74dd9a34ff0f92 "$provider_binary" | sha256sum --check
printf '%s  %s\n' e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b "$provider_archive" | sha256sum --check
[[ ! -e "$provider_destination" ]] || { echo "Destination already exists: $provider_destination" >&2; exit 1; }
mkdir -p -- "$(dirname -- "$provider_destination")"
provider_staging=$(mktemp -d "$(dirname -- "$provider_destination")/.staging-XXXXXX")
trap 'rm -rf -- "$provider_staging"' EXIT
tar --zstd --no-same-owner -xf "$provider_archive" -C "$provider_staging"
install -m 755 -- "$provider_binary" "$provider_staging/bin/ollama"
python3 - "$provider_staging" <<'PY'
from pathlib import Path
import hashlib,sys
p=Path(sys.argv[1])
with (p/'native.sha256').open('w') as manifest:
 for f in sorted((p/'lib').rglob('*')):
  if f.is_file():
   with f.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
   manifest.write(f'{digest}  {f.relative_to(p)}\n')
PY
mv -- "$provider_staging" "$provider_destination"
trap - EXIT
printf 'USER_RUNTIME_INSTALLED: %s\n' "$provider_destination"

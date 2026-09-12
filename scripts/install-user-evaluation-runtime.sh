#!/usr/bin/env bash
# Install the qualified sidecar in user space; no service or model-store writes.
set -euo pipefail
[[ $# == 2 || $# == 3 ]] || { echo 'Usage: install-user-evaluation-runtime.sh PATCHED_BINARY UPSTREAM_ARCHIVE [NEW_DESTINATION]' >&2; exit 2; }
provider_binary=$(realpath -- "$1")
provider_archive=$(realpath -- "$2")
provider_destination=${3:-${XDG_DATA_HOME:-$HOME/.local/share}/intentsmith/evaluation-provider/0.34.0-intentsmith.1}
printf '%s  %s\n' 8883245b864485a74ecccf62c4ce17d4538816cde4e37ea2107c2204d1d04ca7 "$provider_binary" | sha256sum --check
printf '%s  %s\n' cf95886728959aa09910bb34de5cca1cc5a8f68003b5597197d3f2c2d57c0804 "$provider_archive" | sha256sum --check
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

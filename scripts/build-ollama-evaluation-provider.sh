#!/usr/bin/env bash
# Build only: no install, service restart, model load or change to role bindings.
set -euo pipefail

if [[ $# != 1 || -z "$1" ]]; then
  echo "Usage: GO_BIN=/path/to/go $0 /new/output/directory" >&2
  exit 2
fi
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
go_bin=$(command -v "${GO_BIN:-go}") || {
  echo "Go 1.26.7 is required; set GO_BIN to its executable." >&2
  exit 2
}
[[ "$("$go_bin" version)" == "go version go1.26.7 linux/amd64" ]] || {
  echo "Expected Go 1.26.7 for linux/amd64." >&2
  exit 2
}
expected_base=d67ad83426633195089509347ffd4fe795120198
expected_source=0cb3844557c2cbf0beac555da0147279eebd9488
# This build recipe has its own identity. The historically installed binary
# is 72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a.
expected_binary=bdd8ca1320a1332b6977a3d7bc4b26d370e4e36c10188b6983998632568b1e20
mkdir -- "$1"
output=$(cd -- "$1" && pwd)
source_dir="$output/source"
patch_file="$script_root/patches/ollama/0001-chat-response-manifest-digest.patch"
git -c core.hooksPath=/dev/null clone --no-local --depth=1 --single-branch \
  --branch v0.32.14 "${OLLAMA_SOURCE_URL:-https://github.com/ollama/ollama.git}" "$source_dir"
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$expected_base" ]] || {
  echo "Ollama tag identity mismatch." >&2
  exit 1
}
git -C "$source_dir" -c core.hooksPath=/dev/null -c commit.gpgSign=false \
  -c user.name=Belphareon -c user.email=geofery.cz@gmail.com \
  am --committer-date-is-author-date "$patch_file"
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$expected_source" ]] || {
  echo "Patched source identity mismatch." >&2
  exit 1
}
[[ -z "$(git -C "$source_dir" status --porcelain)" ]] || exit 1

export GOTOOLCHAIN=local GOENV=off GOTELEMETRY=off
export GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1
# mlx/dynamic.h embeds __DATE__/__TIME__. GCC honors SOURCE_DATE_EPOCH,
# but Go's cgo cache does not key on it: each reproduction needs a fresh cache.
export SOURCE_DATE_EPOCH=1787926490
export GOCACHE="$output/gocache"
export GOMODCACHE="${GOMODCACHE:-$output/gomodcache}"
(
  cd -- "$source_dir"
  "$go_bin" build -mod=readonly -p=2 -trimpath \
    '-ldflags=-s -w -X github.com/ollama/ollama/version.Version=0.32.14-intentsmith.1' \
    -o "$output/ollama" .
)
"$go_bin" version -m "$output/ollama" > "$output/build-info.txt"
sha256sum "$output/ollama" > "$output/actual.sha256"
printf '%s  %s\n' "$expected_binary" "$output/ollama" | sha256sum --check
[[ -z "$(git -C "$source_dir" status --porcelain)" ]] || exit 1
echo "BUILD_VERIFIED: $output/ollama (runtime qualification and native payload required)"

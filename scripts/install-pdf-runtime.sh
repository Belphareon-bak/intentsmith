#!/usr/bin/env bash
# Install the isolated, hash-locked IntentSmith PDF export runtime.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_FILE="$PROJECT_ROOT/requirements/pdf-export.lock"
MARKER_NAME=".intentsmith-pdf-runtime"
BOOTSTRAP_PYTHON="${PYTHON3:-python3}"
VENV_PATH=""

usage() {
  echo "Usage: ./scripts/install-pdf-runtime.sh [--venv ABSOLUTE_PATH]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --venv)
      if [ "$#" -lt 2 ]; then
        usage >&2
        exit 2
      fi
      VENV_PATH="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$VENV_PATH" ]; then
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    DEFAULT_DATA_HOME="$XDG_DATA_HOME"
  elif [ -n "${HOME:-}" ]; then
    DEFAULT_DATA_HOME="$HOME/.local/share"
  else
    echo "HOME or XDG_DATA_HOME is required unless --venv is provided" >&2
    exit 2
  fi
  VENV_PATH="$DEFAULT_DATA_HOME/intentsmith/python/pdf"
fi

case "$VENV_PATH" in
  /*) ;;
  *)
    echo "PDF runtime path must be absolute: $VENV_PATH" >&2
    exit 2
    ;;
esac

if [ "$VENV_PATH" = "/" ] || [ "$VENV_PATH" = "$PROJECT_ROOT" ]; then
  echo "Refusing unsafe PDF runtime path: $VENV_PATH" >&2
  exit 2
fi

if [ -L "$VENV_PATH" ]; then
  echo "Refusing symlinked PDF runtime path: $VENV_PATH" >&2
  exit 2
fi

if [ -e "$VENV_PATH" ] && [ ! -d "$VENV_PATH" ]; then
  echo "PDF runtime path exists but is not a directory: $VENV_PATH" >&2
  exit 2
fi

LEXICAL_VENV_PATH="$(realpath -m -s -- "$VENV_PATH")"
RESOLVED_VENV_PATH="$(realpath -m -- "$VENV_PATH")"
if [ "$LEXICAL_VENV_PATH" != "$RESOLVED_VENV_PATH" ]; then
  echo "Refusing PDF runtime path with a symlinked component: $VENV_PATH" >&2
  exit 2
fi
VENV_PATH="$RESOLVED_VENV_PATH"
if [ "$VENV_PATH" = "/" ] || [ "$VENV_PATH" = "$PROJECT_ROOT" ]; then
  echo "Refusing unsafe PDF runtime path: $VENV_PATH" >&2
  exit 2
fi

if [ ! -f "$LOCK_FILE" ]; then
  echo "Missing PDF dependency lock: $LOCK_FILE" >&2
  exit 1
fi

if ! command -v "$BOOTSTRAP_PYTHON" >/dev/null 2>&1; then
  echo "Python bootstrap interpreter not found: $BOOTSTRAP_PYTHON" >&2
  exit 1
fi

PLATFORM="$("$BOOTSTRAP_PYTHON" -c 'import platform, sys; print("|".join((platform.system(), platform.machine(), f"{sys.version_info.major}.{sys.version_info.minor}", platform.libc_ver()[0], platform.libc_ver()[1])))')"
IFS='|' read -r OS_NAME ARCH_NAME PYTHON_VERSION LIBC_NAME LIBC_VERSION <<EOF
$PLATFORM
EOF

if [ "$OS_NAME" != "Linux" ] || [ "$ARCH_NAME" != "x86_64" ] || [ "$PYTHON_VERSION" != "3.12" ]; then
  echo "Unsupported PDF runtime target: OS=$OS_NAME arch=$ARCH_NAME Python=$PYTHON_VERSION" >&2
  echo "Required: Linux x86_64 with CPython 3.12" >&2
  exit 1
fi

if [ "$LIBC_NAME" != "glibc" ]; then
  echo "Unsupported PDF runtime libc: ${LIBC_NAME:-unknown} ${LIBC_VERSION:-unknown}" >&2
  echo "Required: glibc 2.27 or newer" >&2
  exit 1
fi

if ! "$BOOTSTRAP_PYTHON" -c 'import platform, sys; parts=tuple(int(p) for p in platform.libc_ver()[1].split(".")[:2]); sys.exit(0 if parts >= (2, 27) else 1)'; then
  echo "Unsupported PDF runtime glibc: $LIBC_VERSION (need 2.27 or newer)" >&2
  exit 1
fi

LOCK_SHA256="$("$BOOTSTRAP_PYTHON" -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$LOCK_FILE")"
MARKER_PATH="$VENV_PATH/$MARKER_NAME"
MARKER_PRESENT=false
ACTIVE_ID=""

if [ -e "$MARKER_PATH" ] || [ -L "$MARKER_PATH" ]; then
  if [ -L "$MARKER_PATH" ] || [ ! -f "$MARKER_PATH" ]; then
    echo "Refusing non-regular PDF runtime marker: $MARKER_PATH" >&2
    exit 1
  fi
  if [ "$(stat -c '%a' "$MARKER_PATH")" != "600" ]; then
    echo "Refusing PDF runtime marker with unsafe permissions: $MARKER_PATH" >&2
    exit 1
  fi
  if ! grep -qx 'format=1' "$MARKER_PATH" ||
     ! grep -Eqx 'status=(installing|ready)' "$MARKER_PATH"; then
    echo "Refusing invalid PDF runtime ownership marker: $MARKER_PATH" >&2
    exit 1
  fi
  MARKER_PRESENT=true
  ACTIVE_ID="$(stat -c '%d:%i' "$VENV_PATH")"
fi

if [ -d "$VENV_PATH" ] && [ "$MARKER_PRESENT" = false ]; then
  if find "$VENV_PATH" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "Refusing unowned non-empty PDF runtime directory: $VENV_PATH" >&2
    exit 1
  fi
  rmdir -- "$VENV_PATH"
fi

VENV_PARENT="$(dirname "$VENV_PATH")"
VENV_BASENAME="$(basename "$VENV_PATH")"
mkdir -p "$VENV_PARENT"
if [ -L "$VENV_PARENT" ] || [ ! -d "$VENV_PARENT" ]; then
  echo "Refusing invalid PDF runtime parent: $VENV_PARENT" >&2
  exit 1
fi

write_marker() {
  local runtime_root="$1"
  local versions="$2"
  local marker_tmp
  marker_tmp="$(mktemp "$runtime_root/.intentsmith-pdf-runtime.tmp.XXXXXX")"
  {
    echo "format=1"
    echo "status=ready"
    echo "lock_sha256=$LOCK_SHA256"
    echo "target=CPython 3.12 / Linux x86_64 / glibc 2.27+"
    echo "versions=$versions"
  } > "$marker_tmp"
  chmod 600 "$marker_tmp"
  if ! mv -T -- "$marker_tmp" "$runtime_root/$MARKER_NAME"; then
    rm -f -- "$marker_tmp"
    return 1
  fi
}

STAGING_PATH="$(mktemp -d "$VENV_PARENT/.${VENV_BASENAME}.staging.XXXXXX")"
BACKUP_ROOT=""
chmod 700 "$STAGING_PATH"

cleanup() {
  if [ -n "$STAGING_PATH" ] && [ -d "$STAGING_PATH" ]; then
    rm -rf -- "$STAGING_PATH"
  fi
  if [ -n "$BACKUP_ROOT" ] && [ -d "$BACKUP_ROOT" ]; then
    if [ ! -e "$VENV_PATH" ] && [ -d "$BACKUP_ROOT/runtime" ]; then
      mv -- "$BACKUP_ROOT/runtime" "$VENV_PATH"
    fi
    if [ -e "$VENV_PATH" ]; then
      rm -rf -- "$BACKUP_ROOT"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"$BOOTSTRAP_PYTHON" -I -m venv "$STAGING_PATH"

VENV_PYTHON="$STAGING_PATH/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  echo "PDF runtime interpreter was not created: $VENV_PYTHON" >&2
  exit 1
fi

VENV_PROBE="$("$VENV_PYTHON" -I -c 'import os, platform, sys; expected=os.path.realpath(sys.argv[1]); valid=(platform.python_implementation()=="CPython" and platform.system()=="Linux" and platform.machine()=="x86_64" and sys.version_info[:2]==(3,12) and sys.prefix!=sys.base_prefix and os.path.realpath(sys.prefix)==expected); print("INTENTSMITH_PDF_VENV_OK") if valid else sys.exit(f"invalid venv: executable={sys.executable} prefix={sys.prefix} base_prefix={sys.base_prefix}")' "$STAGING_PATH")"
if [ "$VENV_PROBE" != "INTENTSMITH_PDF_VENV_OK" ]; then
  echo "PDF runtime interpreter failed identity verification: $VENV_PYTHON" >&2
  exit 1
fi

"$VENV_PYTHON" -I -m pip --isolated install \
  --disable-pip-version-check \
  --require-hashes \
  --only-binary=:all: \
  --no-deps \
  --no-cache-dir \
  --no-input \
  -r "$LOCK_FILE"

"$VENV_PYTHON" -I -m pip --isolated check
VERSION_PROBE="$("$VENV_PYTHON" -I -c 'import sys; from importlib.metadata import version; expected={"charset-normalizer":"3.4.4","pillow":"12.3.0","reportlab":"5.0.0"}; actual={name:version(name) for name in expected}; print("INTENTSMITH_PDF_VERSIONS_OK") if actual==expected else sys.exit(f"version mismatch: expected {expected}, got {actual}")')"
if [ "$VERSION_PROBE" != "INTENTSMITH_PDF_VERSIONS_OK" ]; then
  echo "PDF runtime package verification returned an invalid result" >&2
  exit 1
fi

VERSIONS="$("$VENV_PYTHON" -I -c 'import json, sys; from importlib.metadata import version; print(json.dumps({"packages":{name:version(name) for name in ("charset-normalizer","pillow","reportlab")},"python":".".join(map(str,sys.version_info[:3]))},sort_keys=True))')"
if ! "$BOOTSTRAP_PYTHON" -c 'import json, sys; value=json.loads(sys.argv[1]); expected={"charset-normalizer":"3.4.4","pillow":"12.3.0","reportlab":"5.0.0"}; sys.exit(0 if value.get("packages")==expected and value.get("python") else 1)' "$VERSIONS"; then
  echo "PDF runtime emitted invalid version evidence" >&2
  exit 1
fi

write_marker "$STAGING_PATH" "$VERSIONS"

if [ "$MARKER_PRESENT" = true ]; then
  if [ ! -d "$VENV_PATH" ] ||
     [ "$(stat -c '%d:%i' "$VENV_PATH")" != "$ACTIVE_ID" ] ||
     [ -L "$MARKER_PATH" ] ||
     [ ! -f "$MARKER_PATH" ]; then
    echo "PDF runtime changed during installation; refusing activation" >&2
    exit 1
  fi

  BACKUP_ROOT="$(mktemp -d "$VENV_PARENT/.${VENV_BASENAME}.backup.XXXXXX")"
  chmod 700 "$BACKUP_ROOT"
  mv -- "$VENV_PATH" "$BACKUP_ROOT/runtime"
  if ! mv -- "$STAGING_PATH" "$VENV_PATH"; then
    mv -- "$BACKUP_ROOT/runtime" "$VENV_PATH"
    echo "Failed to activate the new PDF runtime; previous runtime restored" >&2
    exit 1
  fi
  STAGING_PATH=""
  rm -rf -- "$BACKUP_ROOT"
  BACKUP_ROOT=""
else
  if [ -e "$VENV_PATH" ] || [ -L "$VENV_PATH" ]; then
    echo "PDF runtime appeared during installation; refusing activation" >&2
    exit 1
  fi
  mv -- "$STAGING_PATH" "$VENV_PATH"
  STAGING_PATH=""
fi

trap - EXIT INT TERM
VENV_PYTHON="$VENV_PATH/bin/python"

echo "IntentSmith PDF runtime ready"
echo "  interpreter: $VENV_PYTHON"
echo "  lock sha256: $LOCK_SHA256"
echo "  versions: $VERSIONS"

#!/usr/bin/env bash
# IntentSmith + C3 Studio — reproducible install
# ══════════════════════════════════════════════════════════════════════════════
#
# Idempotent setup: can be re-run safely at any time.
#
# Usage:
#   ./scripts/install.sh                         # core profile, asks about model pull
#   ./scripts/install.sh --profile=full --minimal # include PDF runtime, skip model pull
#   ./scripts/install.sh --profile=core --offline # cache-only install, no Ollama probe
#   ./scripts/install.sh --verify-only           # read-only prerequisite check
#
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}→${NC} $1"; }

# ── Parse args ──────────────────────────────────────────────────────────────
MODE="interactive"
INSTALL_PROFILE="${INTENTSMITH_INSTALL_PROFILE:-core}"
VERIFY_ONLY=false
OFFLINE=false
for arg in "$@"; do
  case "$arg" in
    --minimal) MODE="minimal" ;;
    --full)    MODE="full" ;;
    --profile=core) INSTALL_PROFILE="core" ;;
    --profile=full) INSTALL_PROFILE="full" ;;
    --verify-only) VERIFY_ONLY=true ;;
    --offline) OFFLINE=true ;;
    --help|-h)
      echo "Usage: ./scripts/install.sh [--profile=core|--profile=full] [--minimal|--full] [--offline] [--verify-only]"
      echo "  --profile=core  Install supported backend + Studio; PDF remains optional (default)"
      echo "  --profile=full  Require and install the isolated PDF runtime"
      echo "  --minimal       Skip model pull"
      echo "  --full          Pull all documented models without asking"
      echo "  --verify-only   Check prerequisites without installs, builds, downloads or runtime probes"
      echo "  --offline       Require cache-only npm/Yarn installation and skip Ollama probes"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: ./scripts/install.sh [--profile=core|--profile=full] [--minimal|--full] [--offline] [--verify-only]" >&2
      exit 2
      ;;
  esac
done

case "$INSTALL_PROFILE" in
  core|full) ;;
  *)
    echo "Unknown install profile: $INSTALL_PROFILE" >&2
    echo "Expected core or full" >&2
    exit 2
    ;;
esac

# Corepack shims can otherwise attempt a package-manager download on their
# first invocation. The prerequisite probe itself must obey offline mode.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ "$OFFLINE" = true ]; then
  export COREPACK_ENABLE_NETWORK=0
fi

# ── Resolve project root ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD} IntentSmith + C3 Studio — Install${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Project: ${PROJECT_ROOT}"
echo -e "  Install profile: ${INSTALL_PROFILE}"
echo -e "  Network mode: $([ "$OFFLINE" = true ] && echo offline || echo local-runtime)"
echo ""

ERRORS=0

# ════════════════════════════════════════════════════════════════════════════
# 1. Node.js 22.x
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Node.js ──${NC}"

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

  if [ "$NODE_MAJOR" -eq 22 ] 2>/dev/null; then
    ok "Node.js v${NODE_VERSION}"
  else
    warn "Node.js v${NODE_VERSION} (need 22.x)"
    # Try nvm auto-fix
    if command -v nvm >/dev/null 2>&1; then
      info "Found nvm — installing Node 22..."
      nvm install 22 && nvm use 22
      NODE_VERSION=$(node -v | sed 's/v//')
      NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
      if [ "$NODE_MAJOR" -eq 22 ] 2>/dev/null; then
        ok "Node.js v${NODE_VERSION} (via nvm)"
      else
        fail "nvm install failed"
        ERRORS=$((ERRORS + 1))
      fi
    elif [ -f "$HOME/.nvm/nvm.sh" ]; then
      info "Loading nvm..."
      export NVM_DIR="$HOME/.nvm"
      # shellcheck source=/dev/null
      . "$NVM_DIR/nvm.sh"
      nvm install 22 && nvm use 22
      NODE_VERSION=$(node -v | sed 's/v//')
      ok "Node.js v${NODE_VERSION} (via nvm)"
    else
      fail "Node.js 22.x required. Install via:"
      echo "       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
      echo "       nvm install 22"
      ERRORS=$((ERRORS + 1))
    fi
  fi
else
  fail "Node.js not found. Install via:"
  echo "       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo "       nvm install 22"
  ERRORS=$((ERRORS + 1))
fi

# npm check
if command -v npm >/dev/null 2>&1; then
  NPM_VERSION="$(npm -v)"
  if [ "$NPM_VERSION" = "10.9.4" ]; then
    ok "npm $NPM_VERSION"
  else
    fail "npm 10.9.4 required; found $NPM_VERSION"
    echo "       Install: npm install -g npm@10.9.4"
    ERRORS=$((ERRORS + 1))
  fi
else
  fail "npm not found (should come with Node.js)"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 2. C++ Build Tools (for native modules)
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Build Tools ──${NC}"

if command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1; then
  ok "C++ compiler found"
else
  warn "C++ compiler not found (needed for better-sqlite3, tree-sitter)"
  echo "       Install: sudo apt install build-essential python3 make"
fi

if command -v make >/dev/null 2>&1; then
  ok "make found"
else
  warn "make not found"
  echo "       Install: sudo apt install build-essential"
fi

PDF_BOOTSTRAP_PYTHON="${PYTHON3:-python3.12}"
PDF_PYTHON_OK=false
if command -v "$PDF_BOOTSTRAP_PYTHON" >/dev/null 2>&1 &&
   "$PDF_BOOTSTRAP_PYTHON" -c 'import ensurepip, venv; raise SystemExit(0)' >/dev/null 2>&1; then
  ok "$PDF_BOOTSTRAP_PYTHON with venv support found"
  PDF_PYTHON_OK=true
else
  warn "CPython 3.12 with venv support is unavailable (optional PDF export)"
  echo "       Install: sudo apt install python3.12 python3.12-venv"
fi

PDF_FONT_DIR="${INTENTSMITH_PDF_FONT_DIR:-/usr/share/fonts/truetype/dejavu}"
PDF_FONTS="DejaVuSans.ttf DejaVuSans-Bold.ttf DejaVuSans-Oblique.ttf DejaVuSans-BoldOblique.ttf DejaVuSansMono.ttf"
MISSING_PDF_FONTS=""
for font_name in $PDF_FONTS; do
  if [ ! -f "$PDF_FONT_DIR/$font_name" ]; then
    MISSING_PDF_FONTS="$MISSING_PDF_FONTS $font_name"
  fi
done
if [ -z "$MISSING_PDF_FONTS" ]; then
  ok "DejaVu PDF fonts found"
else
  warn "Missing optional PDF fonts:$MISSING_PDF_FONTS"
  echo "       Install: sudo apt install fonts-dejavu-core"
fi

PDF_AVAILABLE=true
if [ "$PDF_PYTHON_OK" != true ] || [ -n "$MISSING_PDF_FONTS" ]; then
  PDF_AVAILABLE=false
fi
if [ "$INSTALL_PROFILE" = "full" ] && [ "$PDF_AVAILABLE" != true ]; then
  fail "Full profile requires CPython 3.12 venv support and all documented DejaVu fonts"
  ERRORS=$((ERRORS + 1))
elif [ "$INSTALL_PROFILE" = "core" ]; then
  info "PDF export is outside the core profile; use --profile=full to provision it"
fi

echo ""

# Linux process containment is a supported core capability. The production
# provider names these exact canonical executables and has no plain-spawn
# fallback when either prerequisite is absent.
echo -e "${BOLD}── Process Containment ──${NC}"
if [ -x /usr/bin/bwrap ]; then
  ok "bubblewrap found at /usr/bin/bwrap"
else
  fail "bubblewrap is required for governed process execution"
  echo "       Install: sudo apt install bubblewrap"
  ERRORS=$((ERRORS + 1))
fi
if [ -x /usr/bin/prlimit ]; then
  ok "prlimit found at /usr/bin/prlimit"
else
  fail "prlimit is required for governed process resource ceilings"
  echo "       Install: sudo apt install util-linux"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# Yarn is a core prerequisite because the supported Linux package includes the
# committed C3 Studio Electron application. Check it before any mutation so
# --verify-only is a complete read-only core preflight.
echo -e "${BOLD}── C3 Studio Toolchain ──${NC}"
YARN_VERSION=""
if command -v yarn >/dev/null 2>&1; then
  YARN_VERSION="$(cd c3-ide && yarn --version)"
fi
if [ "$YARN_VERSION" = "1.22.22" ]; then
  ok "yarn $YARN_VERSION"
else
  fail "Yarn 1.22.22 required; found ${YARN_VERSION:-unavailable}"
  echo "       Install: npm install -g yarn@1.22.22"
  ERRORS=$((ERRORS + 1))
fi

if [ "$VERIFY_ONLY" = true ]; then
  echo ""
  if [ "$ERRORS" -gt 0 ]; then
    fail "Prerequisite verification failed — ${ERRORS} critical error(s)."
    exit 1
  fi
  ok "Prerequisite verification passed for ${INSTALL_PROFILE} profile"
  if [ "$INSTALL_PROFILE" = "core" ] && [ "$PDF_AVAILABLE" != true ]; then
    warn "PDF export unavailable; core install remains supported"
  fi
  info "No installs, builds, downloads or runtime probes were performed"
  exit 0
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 3. Ollama
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Ollama ──${NC}"

OLLAMA_OK=false
if [ "$OFFLINE" = true ]; then
  warn "Offline install: Ollama discovery and model operations skipped"
elif command -v ollama >/dev/null 2>&1; then
  OLLAMA_VER=$(ollama --version 2>/dev/null | head -1)
  ok "Ollama installed (${OLLAMA_VER})"

  # Check if running
  OLLAMA_RUNNING=false
  for i in 1 2 3 4 5; do
    if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      OLLAMA_RUNNING=true
      break
    fi
    if [ "$i" -eq 1 ]; then
      info "Ollama not responding, retrying..."
    fi
    sleep 2
  done

  if [ "$OLLAMA_RUNNING" = true ]; then
    ok "Ollama is running"
    OLLAMA_OK=true
  else
    warn "Ollama installed but not running"
    echo "       Start it: ollama serve &"
  fi
else
  warn "Ollama not installed (needed for LLM features)"
  echo "       Install: curl -fsSL https://ollama.com/install.sh | sh"
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 4. Bail on critical errors
# ════════════════════════════════════════════════════════════════════════════
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  fail "Cannot continue — ${ERRORS} critical error(s). Fix the issues above and re-run."
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════════
# 5. Disk Space Check
# ════════════════════════════════════════════════════════════════════════════
AVAIL_GB=$(df -BG . 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}')
if [ -n "$AVAIL_GB" ] && [ "$AVAIL_GB" -lt 5 ] 2>/dev/null; then
  warn "Low disk space: ${AVAIL_GB}GB available (recommend ≥ 5GB)"
  echo "       npm ci + IDE dependencies + models need significant disk space"
fi

# ════════════════════════════════════════════════════════════════════════════
# 5b. Backend Dependencies (npm)
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Backend Dependencies ──${NC}"

info "Running npm ci from package-lock.json..."
install_backend_dependencies() {
  if [ "$OFFLINE" = true ]; then
    npm ci --offline
  else
    npm ci
  fi
}
if install_backend_dependencies 2>&1 | tail -3; then
  ok "npm ci complete"
else
  fail "npm ci failed; package.json and package-lock.json must remain synchronized"
  echo "       If better-sqlite3 failed, install the documented build prerequisites."
  exit 1
fi

# Verify better-sqlite3 native binding
info "Verifying better-sqlite3 native binding..."
if node -e "require('better-sqlite3')" 2>/dev/null; then
  ok "better-sqlite3 native binding OK"
else
  warn "better-sqlite3 binding broken — rebuilding..."
  if npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -3; then
    # Verify again
    if node -e "require('better-sqlite3')" 2>/dev/null; then
      ok "better-sqlite3 rebuilt successfully"
    else
      fail "better-sqlite3 rebuild failed"
      echo "       Install build tools: sudo apt install build-essential python3 make"
      exit 1
    fi
  else
    fail "better-sqlite3 rebuild failed"
    exit 1
  fi
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 5c. Isolated PDF Export Runtime
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── PDF Export Runtime ──${NC}"

if [ "$INSTALL_PROFILE" = "full" ]; then
  info "Installing hash-locked ReportLab runtime..."
  if PYTHON3="$PDF_BOOTSTRAP_PYTHON" "$SCRIPT_DIR/install-pdf-runtime.sh"; then
    ok "Isolated PDF export runtime ready"
  else
    fail "PDF runtime installation failed"
    echo "       Re-run: ./scripts/install.sh --profile=full --minimal"
    exit 1
  fi
else
  info "Skipped by core profile; PDF requests report the missing optional runtime"
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 6. IDE Dependencies (yarn)
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── IDE Dependencies ──${NC}"

ok "yarn $YARN_VERSION"

info "Running frozen Yarn install for IDE..."
install_ide_dependencies() {
  cd c3-ide
  if [ "$OFFLINE" = true ]; then
    yarn install --frozen-lockfile --non-interactive --offline
  else
    yarn install --frozen-lockfile --non-interactive
  fi
}
if install_ide_dependencies 2>&1 | tail -3; then
  ok "IDE dependencies installed"
else
  fail "Frozen IDE dependency installation failed"
  echo "       Do not regenerate c3-ide/yarn.lock without review."
  exit 1
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 6b. Electron Native Module Rebuild
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Electron Native Modules ──${NC}"

info "Rebuilding native modules for Electron ABI..."
# Theia's canonical native set plus native watchers used by this application.
REBUILD_MODULES="node-pty,native-keymap,find-git-repositories,drivelist,keytar,ssh2,cpu-features,nsfw,@parcel/watcher,@vscode/watcher"
ELECTRON_REBUILD_BIN="$PROJECT_ROOT/c3-ide/node_modules/.bin/electron-rebuild"
if [ ! -x "$ELECTRON_REBUILD_BIN" ]; then
  fail "Locked local electron-rebuild binary is missing"
  exit 1
fi
if (cd c3-ide/applications/electron && "$ELECTRON_REBUILD_BIN" -f --only "$REBUILD_MODULES" 2>&1 | tail -5); then
  ok "Native modules rebuilt for Electron"
else
  warn "electron-rebuild had errors — retrying..."
  if (cd c3-ide/applications/electron && "$ELECTRON_REBUILD_BIN" -f --only "$REBUILD_MODULES" 2>&1 | tail -5); then
    ok "Native modules rebuilt for Electron (second attempt)"
  else
    fail "electron-rebuild failed; C3 Studio native modules are not trustworthy"
    exit 1
  fi
fi

# After IDE rebuild, re-verify backend's better-sqlite3 (yarn install can break it)
info "Verifying backend better-sqlite3 binding..."
if node -e "require('better-sqlite3')(':memory:').close()" 2>/dev/null; then
  ok "better-sqlite3 binding OK"
else
  warn "better-sqlite3 binding broken — rebuilding for system Node..."
  npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -3
  if node -e "require('better-sqlite3')(':memory:').close()" 2>/dev/null; then
    ok "better-sqlite3 rebuilt for system Node"
  else
    fail "better-sqlite3 rebuild failed — backend will not start"
    exit 1
  fi
fi

info "Building C3 Studio from the tracked Theia webpack configuration..."
if (cd c3-ide && yarn build 2>&1 | tail -8); then
  ok "C3 Studio build complete"
else
  fail "C3 Studio build failed"
  exit 1
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 7. Build Artifact Verification
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Build Artifacts ──${NC}"

for artifact in \
  c3-ide/applications/electron/lib/frontend/bundle.js \
  c3-ide/applications/electron/lib/frontend/preload.js \
  c3-ide/applications/electron/lib/backend/main.js \
  c3-ide/applications/electron/lib/backend/native/rg; do
  if [ ! -s "$artifact" ]; then
    fail "Required C3 Studio artifact is missing or empty: $artifact"
    exit 1
  fi
done
if [ ! -x c3-ide/applications/electron/lib/backend/native/rg ]; then
  fail "Bundled ripgrep artifact is not executable"
  exit 1
fi
RIPGREP_VERSION="$(
  c3-ide/applications/electron/lib/backend/native/rg --version 2>/dev/null |
    head -1
)"
case "$RIPGREP_VERSION" in
  "ripgrep 15.0.0"*) ;;
  *)
    fail "Unexpected bundled ripgrep version: ${RIPGREP_VERSION:-unavailable}"
    exit 1
    ;;
esac

ELECTRON_BIN="$PROJECT_ROOT/c3-ide/node_modules/electron/dist/electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  fail "Locked local Electron runtime is missing"
  exit 1
fi
NATIVE_SMOKE_COUNT=0
while IFS= read -r -d '' native_binding; do
  if ! ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" \
    -e 'require(process.argv[1])' "$PROJECT_ROOT/$native_binding" >/dev/null 2>&1; then
    fail "Electron ABI smoke failed: $native_binding"
    exit 1
  fi
  NATIVE_SMOKE_COUNT=$((NATIVE_SMOKE_COUNT + 1))
done < <(find c3-ide/applications/electron/lib/backend/native -type f -name '*.node' -print0)
if [ "$NATIVE_SMOKE_COUNT" -eq 0 ]; then
  fail "No bundled native bindings were found for Electron ABI smoke"
  exit 1
fi
ok "C3 Studio artifacts and $NATIVE_SMOKE_COUNT Electron ABI bindings verified"

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 8. Data Directories
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Data Directories ──${NC}"

PROJECTS_DIR="${C3_PROJECTS_DIR:-$PROJECT_ROOT/projects}"
mkdir -p "$PROJECT_ROOT/data" "$PROJECTS_DIR"
ok "data/ directory ready"
ok "projects/ directory ready"

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 9. Model Pull (optional)
# ════════════════════════════════════════════════════════════════════════════
if [ "$OLLAMA_OK" = true ]; then
  echo -e "${BOLD}── Models ──${NC}"

  # Check what's already installed
  INSTALLED_MODELS=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' || true)

  has_model() {
    echo "$INSTALLED_MODELS" | grep -Fqx -- "$1" 2>/dev/null
  }

  # Primary model (covers CHAT, CODE, R2)
  PRIMARY="qwen3.5:27b"
  # Reasoning model (covers D1, R1)
  REASONING="deepseek-r1:32b"

  if has_model "$PRIMARY"; then
    ok "${PRIMARY} installed"
    PRIMARY_NEEDED=false
  else
    warn "${PRIMARY} not found (required for chat, code, review)"
    PRIMARY_NEEDED=true
  fi

  if has_model "$REASONING"; then
    ok "${REASONING} installed"
    REASONING_NEEDED=false
  else
    info "${REASONING} not found (optional — deep reasoning)"
    REASONING_NEEDED=true
  fi

  if [ "$MODE" = "full" ]; then
    # Pull everything
    if [ "$PRIMARY_NEEDED" = true ]; then
      info "Pulling ${PRIMARY} (this may take a while)..."
      if ! ollama pull "$PRIMARY"; then
        fail "Failed to pull required model ${PRIMARY}"
        exit 1
      fi
    fi
    if [ "$REASONING_NEEDED" = true ]; then
      info "Pulling ${REASONING} (this may take a while)..."
      if ! ollama pull "$REASONING"; then
        fail "Failed to pull requested model ${REASONING}"
        exit 1
      fi
    fi
  elif [ "$MODE" = "interactive" ] && [ "$PRIMARY_NEEDED" = true ]; then
    echo ""
    echo -e "  ${YELLOW}?${NC} Pull primary model ${PRIMARY} (~17GB)?"
    echo "    This is needed for chat, code generation and reviews."
    read -rp "    [Y/n] " PULL_PRIMARY
    if [ "${PULL_PRIMARY,,}" != "n" ]; then
      info "Pulling ${PRIMARY}..."
      if ! ollama pull "$PRIMARY"; then
        fail "Failed to pull requested model ${PRIMARY}"
        exit 1
      fi
    fi

    if [ "$REASONING_NEEDED" = true ]; then
      echo ""
      echo -e "  ${YELLOW}?${NC} Pull reasoning model ${REASONING} (~20GB)?"
      echo "    Optional — enables deep analysis and project planning."
      read -rp "    [y/N] " PULL_REASONING
      if [ "${PULL_REASONING,,}" = "y" ]; then
        info "Pulling ${REASONING}..."
        if ! ollama pull "$REASONING"; then
          fail "Failed to pull requested model ${REASONING}"
          exit 1
        fi
      fi
    fi
  fi

  echo ""
fi

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD} Installation Complete${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Installed profile: ${INSTALL_PROFILE}"
if [ "$INSTALL_PROFILE" = "core" ]; then
  echo "  Optional PDF export: not provisioned (run --profile=full to add it)"
fi
echo ""
echo -e "  ${GREEN}Next steps:${NC}"
echo ""
echo "    1. Start IntentSmith with C3 Studio:"
echo "       ./scripts/run.sh"
echo ""
echo "    2. The IDE will open automatically"
echo ""
echo "    3. Try your first prompt in the chat panel"
echo ""

if [ "$OLLAMA_OK" = false ]; then
  echo -e "  ${YELLOW}Note:${NC} Ollama is not running. Start it before model-backed IntentSmith features:"
  echo "       ollama serve &"
  echo ""
fi

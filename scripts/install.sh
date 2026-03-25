#!/usr/bin/env bash
# C3 Studio — Install Script (F4b, v131)
# ══════════════════════════════════════════════════════════════════════════════
#
# Idempotent setup: can be re-run safely at any time.
#
# Usage:
#   ./scripts/install.sh            # interactive (asks about model pull)
#   ./scripts/install.sh --minimal  # skip model pull prompt
#   ./scripts/install.sh --full     # pull all models without asking
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
for arg in "$@"; do
  case "$arg" in
    --minimal) MODE="minimal" ;;
    --full)    MODE="full" ;;
    --help|-h)
      echo "Usage: ./scripts/install.sh [--minimal|--full]"
      echo "  --minimal  Skip model pull"
      echo "  --full     Pull all models without asking"
      exit 0
      ;;
  esac
done

# ── Resolve project root ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD} C3 Studio — Install${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Project: ${PROJECT_ROOT}"
echo ""

ERRORS=0

# ════════════════════════════════════════════════════════════════════════════
# 1. Node.js ≥ 22
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Node.js ──${NC}"

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    ok "Node.js v${NODE_VERSION}"
  else
    warn "Node.js v${NODE_VERSION} (need ≥ 22)"
    # Try nvm auto-fix
    if command -v nvm >/dev/null 2>&1; then
      info "Found nvm — installing Node 22..."
      nvm install 22 && nvm use 22
      NODE_VERSION=$(node -v | sed 's/v//')
      NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
      if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
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
      fail "Node.js ≥ 22 required. Install via:"
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
  ok "npm $(npm -v)"
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

if command -v python3 >/dev/null 2>&1; then
  ok "python3 found"
else
  warn "python3 not found (needed for node-gyp)"
  echo "       Install: sudo apt install python3"
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 3. Ollama
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Ollama ──${NC}"

OLLAMA_OK=false
if command -v ollama >/dev/null 2>&1; then
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
  echo "       npm install + models need significant disk space"
fi

# ════════════════════════════════════════════════════════════════════════════
# 5b. Backend Dependencies (npm)
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Backend Dependencies ──${NC}"

info "Running npm install..."
if npm install 2>&1 | tail -3; then
  ok "npm install complete"
else
  # Retry with --legacy-peer-deps (tree-sitter-java peerOptional conflict)
  info "Retrying with --legacy-peer-deps..."
  if npm install --legacy-peer-deps 2>&1 | tail -3; then
    ok "npm install complete (with --legacy-peer-deps)"
  else
    fail "npm install failed"
    echo "       If better-sqlite3 failed, try:"
    echo "       npm rebuild better-sqlite3 --build-from-source"
    exit 1
  fi
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
# 6. IDE Dependencies (yarn)
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── IDE Dependencies ──${NC}"

if ! command -v yarn >/dev/null 2>&1; then
  info "yarn not found — installing..."
  if npm install -g yarn 2>&1 | tail -1; then
    ok "yarn installed"
  else
    fail "Could not install yarn"
    echo "       Install manually: npm install -g yarn"
    exit 1
  fi
fi

ok "yarn $(yarn --version)"

info "Running yarn install for IDE..."
if (cd c3-ide && yarn install --frozen-lockfile 2>&1 | tail -3); then
  ok "IDE dependencies installed"
else
  warn "yarn --frozen-lockfile failed, trying without..."
  if (cd c3-ide && yarn install 2>&1 | tail -3); then
    ok "IDE dependencies installed"
  else
    fail "yarn install failed"
    exit 1
  fi
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 6b. Electron Native Module Rebuild
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Electron Native Modules ──${NC}"

info "Rebuilding native modules for Electron ABI..."
# keytar is deprecated and fails to build with modern node-addon-api — skip it
REBUILD_MODULES="node-pty,nsfw,drivelist,native-keymap,@parcel/watcher,@vscode/watcher"
if (cd c3-ide/applications/electron && npx electron-rebuild -f --only "$REBUILD_MODULES" 2>&1 | tail -5); then
  ok "Native modules rebuilt for Electron"
else
  warn "electron-rebuild had errors — retrying..."
  if (cd c3-ide/applications/electron && npx electron-rebuild -f --only "$REBUILD_MODULES" 2>&1 | tail -5); then
    ok "Native modules rebuilt for Electron (second attempt)"
  else
    warn "electron-rebuild had errors (non-critical modules like nsfw may have failed)"
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

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 7. Webpack Build
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Frontend Build ──${NC}"

BUNDLE="c3-ide/applications/electron/lib/frontend/bundle.js"
WEBPACK_CONFIG="c3-ide/applications/electron/c3-webpack-wrapper.js"
WEBPACK_CONFIG_FALLBACK="c3-ide/applications/electron/gen-webpack.config.js"

if [ -f "$BUNDLE" ] && ( [ -f "$WEBPACK_CONFIG" ] || [ -f "$WEBPACK_CONFIG_FALLBACK" ] ); then
  # Check if any source is newer than the bundle (skip rebuild if not)
  NEEDS_BUILD=false
  for src in c3-ide/extensions/*/lib/browser/*.js; do
    if [ -f "$src" ] && [ "$src" -nt "$BUNDLE" ]; then
      NEEDS_BUILD=true
      break
    fi
  done
  if [ "$NEEDS_BUILD" = true ]; then
    ok "Frontend bundle exists ($(du -h "$BUNDLE" | cut -f1)) — sources changed, rebuilding..."
  else
    ok "Frontend bundle up to date ($(du -h "$BUNDLE" | cut -f1))"
  fi
else
  NEEDS_BUILD=true
fi

if [ "$NEEDS_BUILD" = true ]; then
  info "Running webpack..."
  # Use c3-webpack-wrapper.js (includes C3 preload), fall back to gen-webpack if wrapper missing
  WEBPACK_USE="$WEBPACK_CONFIG"
  if [ ! -f "$WEBPACK_USE" ]; then
    WEBPACK_USE="$WEBPACK_CONFIG_FALLBACK"
    warn "c3-webpack-wrapper.js not found — using gen-webpack.config.js (no C3 preload)"
  fi
  if (cd c3-ide/applications/electron && npx webpack --config "$(basename "$WEBPACK_USE")" --mode development 2>&1 | tail -5); then
    ok "Webpack build complete"
  else
    fail "Webpack build failed"
    exit 1
  fi
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 8. Data Directories
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Data Directories ──${NC}"

mkdir -p data projects
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
    echo "$INSTALLED_MODELS" | grep -q "^${1}" 2>/dev/null
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
      ollama pull "$PRIMARY" || warn "Failed to pull ${PRIMARY}"
    fi
    if [ "$REASONING_NEEDED" = true ]; then
      info "Pulling ${REASONING} (this may take a while)..."
      ollama pull "$REASONING" || warn "Failed to pull ${REASONING}"
    fi
  elif [ "$MODE" = "interactive" ] && [ "$PRIMARY_NEEDED" = true ]; then
    echo ""
    echo -e "  ${YELLOW}?${NC} Pull primary model ${PRIMARY} (~17GB)?"
    echo "    This is needed for chat, code generation and reviews."
    read -rp "    [Y/n] " PULL_PRIMARY
    if [ "${PULL_PRIMARY,,}" != "n" ]; then
      info "Pulling ${PRIMARY}..."
      ollama pull "$PRIMARY" || warn "Failed to pull ${PRIMARY}"
    fi

    if [ "$REASONING_NEEDED" = true ]; then
      echo ""
      echo -e "  ${YELLOW}?${NC} Pull reasoning model ${REASONING} (~20GB)?"
      echo "    Optional — enables deep analysis and project planning."
      read -rp "    [y/N] " PULL_REASONING
      if [ "${PULL_REASONING,,}" = "y" ]; then
        info "Pulling ${REASONING}..."
        ollama pull "$REASONING" || warn "Failed to pull ${REASONING}"
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
echo -e "  ${GREEN}Next steps:${NC}"
echo ""
echo "    1. Start C3 Studio:"
echo "       ./scripts/run.sh"
echo ""
echo "    2. The IDE will open automatically"
echo ""
echo "    3. Try your first prompt in the chat panel"
echo ""

if [ "$OLLAMA_OK" = false ]; then
  echo -e "  ${YELLOW}Note:${NC} Ollama is not running. Start it before using C3:"
  echo "       ollama serve &"
  echo ""
fi

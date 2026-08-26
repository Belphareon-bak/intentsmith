#!/usr/bin/env bash
# C3 Studio — Run Script (F4a, v129.2)
# ══════════════════════════════════════════════════════════════════════════════
#
# Starts the backend server and IDE in one command.
# Clean shutdown on Ctrl+C (kills all child processes).
#
# Usage:
#   ./scripts/run.sh              # start backend + IDE
#   ./scripts/run.sh --backend    # backend only (no IDE)
#   ./scripts/run.sh --dev        # backend with --watch (auto-restart on changes)
#
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}→${NC} $1"; }

# ── Parse args ──────────────────────────────────────────────────────────────
BACKEND_ONLY=false
DEV_MODE=false
for arg in "$@"; do
  case "$arg" in
    --backend) BACKEND_ONLY=true ;;
    --dev)     DEV_MODE=true ;;
    --help|-h)
      echo "Usage: ./scripts/run.sh [--backend|--dev]"
      echo "  --backend  Start backend only (no IDE)"
      echo "  --dev      Backend with --watch (auto-restart on file changes)"
      exit 0
      ;;
  esac
done

# ── Resolve paths ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

PORT_FILE="$HOME/.c3/port"
LOG_FILE="$PROJECT_ROOT/.c3-backend.log"
if [ -n "${XDG_DATA_HOME:-}" ]; then
  PDF_DATA_HOME="$XDG_DATA_HOME"
else
  PDF_DATA_HOME="$HOME/.local/share"
fi
DEFAULT_PDF_PYTHON="$PDF_DATA_HOME/intentsmith/python/pdf/bin/python"

if [ -n "${INTENTSMITH_PDF_PYTHON:-}" ] &&
   [ -n "${C3_PDF_PYTHON:-}" ] &&
   [ "$INTENTSMITH_PDF_PYTHON" != "$C3_PDF_PYTHON" ]; then
  fail "Conflicting INTENTSMITH_PDF_PYTHON and C3_PDF_PYTHON values"
  exit 1
fi

if [ -n "${INTENTSMITH_PDF_PYTHON:-}" ]; then
  PDF_PYTHON="$INTENTSMITH_PDF_PYTHON"
elif [ -n "${C3_PDF_PYTHON:-}" ]; then
  PDF_PYTHON="$C3_PDF_PYTHON"
else
  PDF_PYTHON="$DEFAULT_PDF_PYTHON"
fi

case "$PDF_PYTHON" in
  /*) ;;
  *)
    fail "PDF Python interpreter must be an absolute path"
    exit 1
    ;;
esac

export INTENTSMITH_PDF_PYTHON="$PDF_PYTHON"
export PYTHONNOUSERSITE=1

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD} C3 Studio${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ── Cleanup function ────────────────────────────────────────────────────────
BACKEND_PID=""
CLEANUP_DONE=false

cleanup() {
  if [ "$CLEANUP_DONE" = true ]; then return; fi
  CLEANUP_DONE=true
  echo ""
  info "Shutting down..."

  # Kill backend if we started it
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    # Wait up to 5s for graceful shutdown
    for i in $(seq 1 10); do
      if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    # Force kill if still running
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill -9 "$BACKEND_PID" 2>/dev/null || true
    fi
  fi

  # Clean up port file
  if [ -f "$PORT_FILE" ]; then
    rm -f "$PORT_FILE"
  fi

  ok "Stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ════════════════════════════════════════════════════════════════════════════
# 1. Pre-flight checks
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Pre-flight ──${NC}"

# Node version — try nvm if system node is too old
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [ "$NODE_MAJOR" -lt 22 ] 2>/dev/null; then
  # Try loading nvm
  if [ -f "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm use 22 >/dev/null 2>&1 || true
    NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
  fi
fi
if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
  ok "Node.js $(node -v)"
else
  fail "Node.js ≥ 22 required (found: $(node -v 2>/dev/null || echo 'none'))"
  echo "       Run ./scripts/install.sh first"
  exit 1
fi

# Check for stale port file
if [ -f "$PORT_FILE" ]; then
  EXISTING_PID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$PORT_FILE','utf8')).pid)}catch(e){console.log('')}" 2>/dev/null || echo "")
  EXISTING_CMD=$(ps -p "$EXISTING_PID" -o comm= 2>/dev/null || echo "")
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null && [ "$EXISTING_CMD" = "node" ]; then
    EXISTING_PORT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$PORT_FILE','utf8')).port)}catch(e){console.log('?')}" 2>/dev/null || echo "?")
    fail "C3 backend already running (PID ${EXISTING_PID}, port ${EXISTING_PORT})"
    echo "       Stop it first: ./scripts/stop.sh"
    exit 1
  else
    # Stale port file — remove it
    rm -f "$PORT_FILE"
    info "Removed stale port file"
  fi
fi

# Ollama check
OLLAMA_RUNNING=false
if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_RUNNING=true
  ok "Ollama is running"
else
  warn "Ollama not responding at 127.0.0.1:11434"
  # Try to start it
  if command -v ollama >/dev/null 2>&1; then
    info "Starting Ollama..."
    nohup ollama serve >/dev/null 2>&1 &
    OLLAMA_SERVE_PID=$!
    disown "$OLLAMA_SERVE_PID" 2>/dev/null || true
    # Wait up to 10s
    for i in $(seq 1 10); do
      if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        OLLAMA_RUNNING=true
        ok "Ollama started (PID ${OLLAMA_SERVE_PID})"
        break
      fi
      sleep 1
    done
    if [ "$OLLAMA_RUNNING" = false ]; then
      warn "Could not start Ollama — LLM features will be unavailable"
    fi
  else
    warn "Ollama not installed — LLM features will be unavailable"
  fi
fi

# Model availability check
if [ "$OLLAMA_RUNNING" = true ]; then
  if ollama list 2>/dev/null | grep -q "qwen3.5:27b"; then
    ok "Default model available (qwen3.5:27b)"
  else
    warn "Default model qwen3.5:27b not installed — LLM responses will fail"
    echo "       Run: ollama pull qwen3.5:27b"
  fi
fi

# better-sqlite3 sanity check
if node -e "require('better-sqlite3')" 2>/dev/null; then
  ok "better-sqlite3 binding OK"
else
  fail "better-sqlite3 native binding broken"
  echo "       Run: npm rebuild better-sqlite3 --build-from-source"
  exit 1
fi

if node --input-type=module -e \
  "import { isPdfAvailable } from './src/chat/export/pdf-exporter.js'; process.exit((await isPdfAvailable()) ? 0 : 1)" \
  2>/dev/null; then
  ok "Isolated PDF export runtime OK"
else
  warn "Optional PDF export runtime unavailable; core features remain available"
  echo "       Enable it with: ./scripts/install.sh --profile=full --minimal"
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# 2. Start Backend
# ════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Starting Backend ──${NC}"

# Log rotation — keep one previous log
if [ -f "$LOG_FILE" ]; then
  mv "$LOG_FILE" "${LOG_FILE}.old"
fi

if [ "$DEV_MODE" = true ]; then
  info "Starting backend (dev mode, --watch)..."
  node --watch src/server.js > "$LOG_FILE" 2>&1 &
else
  info "Starting backend..."
  node src/server.js > "$LOG_FILE" 2>&1 &
fi
BACKEND_PID=$!

# Wait for port file to appear (up to 20s)
info "Waiting for backend to initialize..."
TIMEOUT=40  # 40 × 0.5s = 20s
for i in $(seq 1 $TIMEOUT); do
  if [ -f "$PORT_FILE" ]; then
    break
  fi
  # Check if process died
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo ""
    fail "Backend crashed during startup!"
    echo ""
    echo -e "  ${BOLD}Last 30 lines of log:${NC}"
    tail -30 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
    exit 1
  fi
  sleep 0.5
done

if [ ! -f "$PORT_FILE" ]; then
  fail "Backend did not start within 20 seconds"
  echo ""
  echo -e "  ${BOLD}Last 30 lines of log:${NC}"
  tail -30 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
  kill -TERM "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

# Read port
ASSIGNED_PORT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$PORT_FILE','utf8')).port)}catch(e){console.log('')}" 2>/dev/null || echo "")

if [ -z "$ASSIGNED_PORT" ]; then
  fail "Could not read port from ${PORT_FILE}"
  exit 1
fi

ok "Backend running (PID ${BACKEND_PID}, port ${ASSIGNED_PORT})"

# ════════════════════════════════════════════════════════════════════════════
# 3. Health Check
# ════════════════════════════════════════════════════════════════════════════
info "Running health check..."

HEALTH_OK=false
HEALTH_DELAYS=(1 2 4)  # exponential backoff
for i in 0 1 2; do
  if curl -sf "http://127.0.0.1:${ASSIGNED_PORT}/api/health" >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  # Fallback: try root endpoint
  if curl -sf "http://127.0.0.1:${ASSIGNED_PORT}/" >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep "${HEALTH_DELAYS[$i]}"
done

if [ "$HEALTH_OK" = true ]; then
  ok "Health check passed"
else
  warn "Health check failed — backend may still be initializing"
  echo "       Check logs: tail -f ${LOG_FILE}"
fi

echo ""
echo -e "  ${GREEN}Backend:${NC}  http://127.0.0.1:${ASSIGNED_PORT}"
echo -e "  ${GREEN}Health:${NC}   http://127.0.0.1:${ASSIGNED_PORT}/api/health"
echo -e "  ${GREEN}Log:${NC}     ${LOG_FILE}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# 4. Start IDE (unless --backend)
# ════════════════════════════════════════════════════════════════════════════
if [ "$BACKEND_ONLY" = true ]; then
  echo -e "${BOLD}── Backend Only Mode ──${NC}"
  ok "Backend running. Press Ctrl+C to stop."
  echo ""
  # Wait indefinitely (cleanup trap handles shutdown)
  wait "$BACKEND_PID" 2>/dev/null || true
else
  echo -e "${BOLD}── Starting IDE ──${NC}"
  info "Launching C3 Studio (Electron)..."
  echo ""

  # Detect if running as root (common in containers) — Electron needs --no-sandbox
  ELECTRON_ARGS=""
  if [ "$(id -u)" -eq 0 ]; then
    ELECTRON_ARGS="--no-sandbox"
    warn "Running as root — adding --no-sandbox"
  fi

  # Start IDE in foreground — when it exits, cleanup runs
  yarn --cwd c3-ide/applications/electron start $ELECTRON_ARGS || true
fi

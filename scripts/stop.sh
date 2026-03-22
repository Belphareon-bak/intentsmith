#!/usr/bin/env bash
# C3 Studio — Stop Script (F4a, v129.2)
# ══════════════════════════════════════════════════════════════════════════════
#
# Stops a running C3 backend instance.
#
# Usage:
#   ./scripts/stop.sh
#
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

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

PORT_FILE="$HOME/.c3/port"

# Load nvm if needed (for node -e used below)
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [ "$NODE_MAJOR" -lt 22 ] 2>/dev/null && [ -f "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

echo ""
echo -e "${BOLD}── C3 Studio — Stop ──${NC}"
echo ""

if [ ! -f "$PORT_FILE" ]; then
  info "No port file found at ${PORT_FILE}"
  info "C3 backend is not running (or was started differently)"
  exit 0
fi

# Read PID and port from port file
PID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$PORT_FILE','utf8')).pid)}catch(e){console.log('')}" 2>/dev/null || echo "")
PORT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$PORT_FILE','utf8')).port)}catch(e){console.log('')}" 2>/dev/null || echo "")

if [ -z "$PID" ]; then
  warn "Could not read PID from port file"
  rm -f "$PORT_FILE"
  ok "Removed stale port file"
  exit 0
fi

# Check if process is actually running AND is a node process (PID reuse guard)
if ! kill -0 "$PID" 2>/dev/null; then
  info "Process ${PID} is not running (already stopped)"
  rm -f "$PORT_FILE"
  ok "Removed stale port file"
  exit 0
fi

# Verify the PID is actually a node process (guards against PID reuse)
PID_CMD=$(ps -p "$PID" -o comm= 2>/dev/null || echo "")
if [ "$PID_CMD" != "node" ]; then
  warn "PID ${PID} is not a node process (found: '${PID_CMD}') — stale port file"
  rm -f "$PORT_FILE"
  ok "Removed stale port file"
  exit 0
fi

info "Stopping C3 backend (PID ${PID}, port ${PORT})..."

# Send SIGTERM for graceful shutdown
kill -TERM "$PID" 2>/dev/null || true

# Wait up to 10 seconds for graceful shutdown
STOPPED=false
for i in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    STOPPED=true
    break
  fi
  sleep 0.5
done

if [ "$STOPPED" = true ]; then
  ok "Backend stopped gracefully"
else
  warn "Backend did not stop within 10s — sending SIGKILL"
  kill -9 "$PID" 2>/dev/null || true
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    fail "Could not kill process ${PID}"
    exit 1
  fi
  ok "Backend force-killed"
fi

# Clean up port file
rm -f "$PORT_FILE"
ok "Port file removed"

echo ""

#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Run ALL expertise E2E comparison tests serially with GPU cooldown pauses
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage: bash tests/run-all-expertise-e2e.sh [pause_seconds]
#   Default pause: 15 seconds between groups
#
# Groups:
#   A: writer, dnd_master, songwriter     (already tested — included for completeness)
#   B: analyst, trader, accountant
#   C: lawyer, doctor, psychologist
#   D: ai_expert, developer, technician
#   E: car_enthusiast, biker, political_analyst
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

PAUSE=${1:-15}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/tests/logs"
mkdir -p "$LOG_DIR"

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TOTAL_PASS=0
TOTAL_FAIL=0

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  ALL EXPERTISE E2E TESTS — Serial execution with ${PAUSE}s GPU cooldown"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

run_group() {
  local group=$1
  local file=$2
  local log="$LOG_DIR/e2e-group-${group}-${TIMESTAMP}.log"

  echo "──────────────────────────────────────────────────────────────────────────"
  echo "  GROUP $group — Starting at $(date +%H:%M:%S)"
  echo "  Log: $log"
  echo "──────────────────────────────────────────────────────────────────────────"

  if node "$SCRIPT_DIR/$file" 2>&1 | tee "$log"; then
    echo "  ✅ GROUP $group — PASSED"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    echo "  ❌ GROUP $group — FAILED (check log)"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi

  echo ""
}

# ─── Group B ────────────────────────────────────────────────────────────────
run_group "B" "expertise-comparison-e2e-b.test.js"

echo "  ⏸️  GPU cooldown: ${PAUSE}s..."
sleep "$PAUSE"

# ─── Group C ────────────────────────────────────────────────────────────────
run_group "C" "expertise-comparison-e2e-c.test.js"

echo "  ⏸️  GPU cooldown: ${PAUSE}s..."
sleep "$PAUSE"

# ─── Group D ────────────────────────────────────────────────────────────────
run_group "D" "expertise-comparison-e2e-d.test.js"

echo "  ⏸️  GPU cooldown: ${PAUSE}s..."
sleep "$PAUSE"

# ─── Group E ────────────────────────────────────────────────────────────────
run_group "E" "expertise-comparison-e2e-e.test.js"

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  ALL GROUPS COMPLETE"
echo "  Passed: $TOTAL_PASS / $((TOTAL_PASS + TOTAL_FAIL))"
echo "  Failed: $TOTAL_FAIL"
echo "  Finished: $(date)"
echo "  Logs: $LOG_DIR/e2e-group-*-${TIMESTAMP}.log"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

exit $TOTAL_FAIL

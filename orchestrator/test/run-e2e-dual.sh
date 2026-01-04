#!/usr/bin/env bash
set -e

# --- resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ORCH_DIR/.." && pwd)"

SERVER="http://127.0.0.1:3335"

echo "== C.3 E2E DUAL DELIBERATION TEST =="

# --- 1) SSE stream ---
echo "[1] Starting SSE stream (background)"
curl -N "$SERVER/run/stream" &
SSE_PID=$!
sleep 1

# --- 2) New session / project ---
echo "[2] Creating new session/project"
curl -s -X POST "$SERVER/session/start" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "new", "projectName": "e2e-dual-ui-test" }'
echo
sleep 1

# --- 3) Build request ---
echo "[3] Creating build request"

PROMPT_FILE="$ORCH_DIR/prompts/ui-concept-task.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt file not found:"
  echo "  $PROMPT_FILE"
  exit 1
fi

BUILD_JSON=$(jq -Rs '{
  goal: .,
  constraints: ["NO_UI_ASSUMPTIONS", "BACKEND_ONLY"],
  environment: { "target": "local" },
  priority: "stability"
}' < "$PROMPT_FILE")

echo "$BUILD_JSON" | curl -s -X POST "$SERVER/build/request" \
  -H "Content-Type: application/json" \
  -d @-
echo
sleep 1

# --- 4) Plan from build ---
echo "[4] Planning from latest build"

BUILD_DIR="$REPO_ROOT/sandbox/projects/e2e-dual-ui-test/build-requests"

if [ ! -d "$BUILD_DIR" ]; then
  echo "ERROR: Build directory not found:"
  echo "  $BUILD_DIR"
  exit 1
fi

BUILD_ID="$(ls "$BUILD_DIR" | tail -n 1)"

curl -s -X POST "$SERVER/plan/from-build" \
  -H "Content-Type: application/json" \
  -d "{ \"buildId\": \"$BUILD_ID\" }"
echo
sleep 1

# --- 5) Execute plan ---
echo "[5] Executing plan"

curl -s -X POST "$SERVER/execute/plan" \
  -H "Content-Type: application/json" \
  -d '{}'
echo

echo
echo "== TEST TRIGGERED =="
echo "Watching SSE output..."
echo

sleep 1
curl -s -X POST "$SERVER/execution/resume"

wait $SSE_PID

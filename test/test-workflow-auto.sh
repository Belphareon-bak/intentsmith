#!/bin/bash
# Automatický test workflow s kompletním požadavkem
# Testuje celý D1 → CODE → R2 → R1 cyklus

API="http://127.0.0.1:3335"
SESSION="auto-test-$$"
WORKDIR="/tmp/workflow-auto"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================"
echo "  C.3 Workflow - Automatic Test"
echo "========================================"
echo ""
echo "  Session: $SESSION"
echo "  Workdir: $WORKDIR"
echo -e "========================================${NC}"
echo ""

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

# Kompletní specifický požadavek - neměl by vyžadovat clarification
REQUEST='Vytvoř jednoduchou TODO CLI aplikaci v Node.js.

Soubory:
- '"$WORKDIR"'/todo.js - hlavní aplikace

Funkce:
- add <text> - přidá úkol
- list - vypíše úkoly
- done <id> - označí úkol jako hotový

Technologie: Node.js, fs modul pro ukládání do JSON souboru.

Požadavky:
- Úkoly ukládej do '"$WORKDIR"'/tasks.json
- Každý úkol má id, text, done (boolean), createdAt
- Formátovaný výstup s čísly a [x] / [ ] značkami'

echo -e "${YELLOW}>>> Request:${NC}"
echo "$REQUEST" | head -20
echo "..."
echo ""

# Step 1: Send request
echo -e "${BLUE}Step 1: Sending request to D1...${NC}"
response=$(curl -s -X POST "$API/workflow" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg msg "$REQUEST" --arg sid "$SESSION" --arg wd "$WORKDIR" \
    '{message: $msg, sessionId: $sid, workdir: $wd}')")

state=$(echo "$response" | jq -r '.state')
needsInput=$(echo "$response" | jq -r '.needsInput')

echo -e "State: ${GREEN}$state${NC}"
echo -e "Needs Input: $needsInput"
echo ""

# If we got plan, show it and confirm
if [ "$state" = "PLAN_REVIEW" ]; then
  echo -e "${CYAN}=== Plan from D1 ===${NC}"
  echo "$response" | jq -r '.response' | head -40
  echo "..."
  echo ""
  
  echo -e "${BLUE}Step 2: Confirming plan...${NC}"
  response=$(curl -s -X POST "$API/workflow" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg sid "$SESSION" --arg wd "$WORKDIR" \
      '{message: "OK", sessionId: $sid, workdir: $wd}')")
  
  state=$(echo "$response" | jq -r '.state')
  echo -e "State: ${GREEN}$state${NC}"
  echo ""
fi

# If clarification needed (shouldn't happen with specific request)
if [ "$state" = "CLARIFYING" ]; then
  echo -e "${YELLOW}Clarification requested (unexpected for specific request)${NC}"
  echo "$response" | jq -r '.response'
  exit 1
fi

# Wait for implementation to complete
echo -e "${BLUE}Step 3: Waiting for implementation...${NC}"
echo ""

max_attempts=60
attempt=0

while [ $attempt -lt $max_attempts ]; do
  sleep 3
  
  status=$(curl -s "$API/workflow/$SESSION")
  state=$(echo "$status" | jq -r '.state')
  iterations=$(echo "$status" | jq -r '.iterations // 0')
  
  echo -ne "\r  State: $state | Iterations: $iterations | Attempt: $((attempt+1))/$max_attempts"
  
  if [ "$state" = "DONE" ]; then
    echo ""
    echo ""
    echo -e "${GREEN}✅ Workflow completed successfully!${NC}"
    break
  fi
  
  if [ "$state" = "ERROR" ]; then
    echo ""
    echo ""
    echo -e "${RED}❌ Workflow error!${NC}"
    echo "$status" | jq '.response'
    break
  fi
  
  ((attempt++))
done

echo ""

# Show results
echo -e "${CYAN}========================================"
echo "  Results"
echo -e "========================================${NC}"
echo ""

# Final state
echo -e "${BLUE}Final workflow state:${NC}"
curl -s "$API/workflow/$SESSION" | jq '{state, iterations, historyLength}'
echo ""

# Created files
echo -e "${BLUE}Created files:${NC}"
if [ -d "$WORKDIR" ]; then
  find "$WORKDIR" -type f 2>/dev/null | while read f; do
    echo "  - $f ($(wc -c < "$f") bytes)"
  done
  echo ""
  
  # Show main file content
  if [ -f "$WORKDIR/todo.js" ]; then
    echo -e "${BLUE}Content of todo.js (first 30 lines):${NC}"
    head -30 "$WORKDIR/todo.js"
    echo "..."
  fi
else
  echo "  No files created"
fi

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Test Complete${NC}"
echo -e "${CYAN}========================================${NC}"

# Quick functionality test
if [ -f "$WORKDIR/todo.js" ]; then
  echo ""
  echo -e "${BLUE}Quick functionality test:${NC}"
  cd "$WORKDIR"
  
  echo "  > node todo.js add 'Test task'"
  node todo.js add "Test task" 2>&1 || echo "(error)"
  
  echo "  > node todo.js list"
  node todo.js list 2>&1 || echo "(error)"
fi

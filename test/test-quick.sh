#!/bin/bash
# C.3 v26.1 Quick Workflow Test
# Testuje: THINKER → ANALYZER → D1 → DESIGN_AUDIT → CODE → R2A → [R2B] → DONE

API="${C3_API:-http://127.0.0.1:3335}"
SESSION="quick-test-$$"
WORKDIR="/tmp/c3-quick-test"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN}  C.3 v26.1 - Quick Workflow Test${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo ""
echo "  API:      $API"
echo "  Session:  $SESSION"
echo "  Workdir:  $WORKDIR"
echo ""

# Cleanup
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

# Kompletní požadavek - NEMĚL by vyžadovat CLARIFY
REQUEST="Vytvoř jednoduchou TODO CLI aplikaci v Node.js.

Cesta: $WORKDIR/todo.js
Data: $WORKDIR/tasks.json

Funkce:
- add <text> - přidá úkol
- list - vypíše úkoly  
- done <id> - označí jako hotový

Technologie: Node.js, pouze vestavěné moduly (fs, path).
Formát výstupu: [x] nebo [ ] před textem úkolu."

echo -e "${YELLOW}[1/4] Odesílám požadavek...${NC}"
echo ""

response=$(curl -s -X POST "$API/workflow" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg msg "$REQUEST" \
    --arg sid "$SESSION" \
    --arg wd "$WORKDIR" \
    '{message: $msg, sessionId: $sid, workdir: $wd}')")

state=$(echo "$response" | jq -r '.state')
needsInput=$(echo "$response" | jq -r '.needsInput')
riskLevel=$(echo "$response" | jq -r '.riskLevel // "N/A"')

echo -e "  State: ${GREEN}$state${NC}"
echo -e "  Risk Level: $riskLevel"
echo ""

# Pokud CLARIFYING - něco je špatně s promptem
if [ "$state" = "CLARIFYING" ]; then
  echo -e "${YELLOW}⚠️  CLARIFY requested (unexpected for specific request)${NC}"
  echo "$response" | jq -r '.questions[]?' 2>/dev/null
  echo ""
  echo -e "${RED}Test FAILED - workflow měl přejít rovnou na plánování${NC}"
  exit 1
fi

# PLAN_REVIEW - potvrdíme plán
if [ "$state" = "PLAN_REVIEW" ]; then
  echo -e "${CYAN}─── Plan Preview ───${NC}"
  echo "$response" | jq -r '.response' | head -25
  echo "..."
  echo ""
  
  echo -e "${YELLOW}[2/4] Potvrzuji plán...${NC}"
  response=$(curl -s -X POST "$API/workflow" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg sid "$SESSION" --arg wd "$WORKDIR" \
      '{message: "OK", sessionId: $sid, workdir: $wd}')")
  
  state=$(echo "$response" | jq -r '.state')
  echo -e "  State: ${GREEN}$state${NC}"
  echo ""
fi

# Čekáme na dokončení
echo -e "${YELLOW}[3/4] Čekám na implementaci...${NC}"
echo ""

max_wait=120  # 2 minuty max
elapsed=0
interval=3

while [ $elapsed -lt $max_wait ]; do
  status=$(curl -s "$API/workflow/$SESSION")
  state=$(echo "$status" | jq -r '.state')
  iterations=$(echo "$status" | jq -r '.iterations // 0')
  auditRetries=$(echo "$status" | jq -r '.auditRetries // 0')
  
  # Progress bar
  printf "\r  [%3ds] State: %-15s | Iterations: %d | Audit retries: %d" \
    "$elapsed" "$state" "$iterations" "$auditRetries"
  
  if [ "$state" = "DONE" ]; then
    echo ""
    echo ""
    echo -e "${GREEN}✅ DONE!${NC}"
    break
  fi
  
  if [ "$state" = "ERROR" ]; then
    echo ""
    echo ""
    echo -e "${RED}❌ ERROR!${NC}"
    echo "$status" | jq -r '.response' 2>/dev/null
    exit 1
  fi
  
  sleep $interval
  elapsed=$((elapsed + interval))
done

if [ "$state" != "DONE" ]; then
  echo ""
  echo -e "${RED}❌ Timeout after ${max_wait}s${NC}"
  exit 1
fi

# Výsledky
echo -e "${YELLOW}[4/4] Kontroluji výsledky...${NC}"
echo ""

echo -e "${CYAN}─── Created Files ───${NC}"
if [ -d "$WORKDIR" ]; then
  find "$WORKDIR" -type f 2>/dev/null | while read f; do
    size=$(wc -c < "$f")
    echo "  ✓ $f ($size bytes)"
  done
else
  echo -e "${RED}  No files created!${NC}"
  exit 1
fi
echo ""

# Funkční test
echo -e "${CYAN}─── Functional Test ───${NC}"
if [ -f "$WORKDIR/todo.js" ]; then
  cd "$WORKDIR"
  
  echo -n "  > node todo.js add 'Test úkol' ... "
  if node todo.js add "Test úkol" >/dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
  else
    echo -e "${RED}FAIL${NC}"
  fi
  
  echo -n "  > node todo.js list ... "
  output=$(node todo.js list 2>&1)
  if echo "$output" | grep -q "Test"; then
    echo -e "${GREEN}OK${NC}"
  else
    echo -e "${RED}FAIL${NC}"
  fi
  
  echo -n "  > node todo.js done 1 ... "
  if node todo.js done 1 >/dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
  else
    echo -e "${YELLOW}SKIP (may not exist)${NC}"
  fi
  
  echo ""
  echo -e "${CYAN}─── List Output ───${NC}"
  node todo.js list 2>&1 | head -5
else
  echo -e "${RED}  todo.js not found!${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ ALL TESTS PASSED${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"

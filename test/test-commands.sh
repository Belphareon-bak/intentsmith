#!/bin/bash
# Test C.3 Commands - /init, /todo, /done, /memory

API="http://127.0.0.1:3335"
SESSION="test-commands-$$"
WORKDIR="/tmp/c3-commands-test"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================"
echo "  C.3 Commands Test"
echo "========================================"
echo "  Session: $SESSION"
echo "  Workdir: $WORKDIR"
echo -e "========================================${NC}"
echo ""

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

# Helper function
call_api() {
  local msg="$1"
  echo -e "${YELLOW}>>> $msg${NC}"
  
  response=$(curl -s -X POST "$API/workflow" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$msg" --arg s "$SESSION" --arg w "$WORKDIR" \
      '{message: $m, sessionId: $s, workdir: $w}')")
  
  echo "$response" | jq -r '.response' 2>/dev/null || echo "$response"
  echo ""
}

# Test 1: /help
echo -e "${BLUE}=== Test 1: /help ===${NC}"
call_api "/help"

# Test 2: /init
echo -e "${BLUE}=== Test 2: /init ===${NC}"
call_api "/init"

# Test 3: /status
echo -e "${BLUE}=== Test 3: /status ===${NC}"
call_api "/status"

# Test 4: /todo
echo -e "${BLUE}=== Test 4: /todo ===${NC}"
call_api "/todo Implementovat autentizaci uživatelů"
call_api "/todo Vytvořit REST API endpoints"
call_api "/todo Napsat unit testy"

# Test 5: /done
echo -e "${BLUE}=== Test 5: /done (list) ===${NC}"
call_api "/done"

echo -e "${BLUE}=== Test 5b: /done 1 ===${NC}"
call_api "/done 1"

# Test 6: /memory
echo -e "${BLUE}=== Test 6: /memory ===${NC}"
call_api "/memory"

# Test 7: /updateMemory
echo -e "${BLUE}=== Test 7: /updateMemory ===${NC}"
call_api "/updateMemory constraints no-external-deps Preferovat vestavěné Node.js moduly (fs, path, http). Externí moduly vyžadují package.json."
call_api "/updateMemory constraints no-hardcoded-secrets Nikdy neukládat hesla nebo API klíče přímo v kódu"

# Test 8: /memory again
echo -e "${BLUE}=== Test 8: /memory (po update) ===${NC}"
call_api "/memory"

# Test 9: /plan (should be empty)
echo -e "${BLUE}=== Test 9: /plan ===${NC}"
call_api "/plan"

# Test 10: Vague request (should ask for clarification)
echo -e "${BLUE}=== Test 10: Vágní požadavek ===${NC}"
call_api "Vytvoř mi aplikaci"

echo -e "${GREEN}========================================"
echo "  Tests Complete"
echo -e "========================================${NC}"

# Show created files
echo -e "${BLUE}Created files in $WORKDIR:${NC}"
find "$WORKDIR" -type f 2>/dev/null | while read f; do
  echo "  - $f"
done

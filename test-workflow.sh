#!/bin/bash
# Test Workflow API - Hierarchický dual review systém
# D1 → CODE → R2 → [D2 → CODE → R2]* → R1 → DONE

API="http://127.0.0.1:3335"
SESSION="test-workflow-$$"
WORKDIR="/tmp/workflow-test"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================"
echo "  C.3 Workflow Test"
echo -e "========================================${NC}"
echo ""
echo "Session: $SESSION"
echo "Workdir: $WORKDIR"
echo ""

# Create workdir
mkdir -p "$WORKDIR"

# Function to call workflow API
call_workflow() {
  local message="$1"
  echo -e "${YELLOW}>>> Sending: ${message:0:80}...${NC}"
  echo ""
  
  response=$(curl -s -X POST "$API/workflow" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$message\",
      \"sessionId\": \"$SESSION\",
      \"workdir\": \"$WORKDIR\"
    }")
  
  # Extract fields
  state=$(echo "$response" | jq -r '.state // "unknown"')
  needsInput=$(echo "$response" | jq -r '.needsInput // false')
  responseText=$(echo "$response" | jq -r '.response // "No response"')
  
  echo -e "${GREEN}State: $state${NC}"
  echo -e "${GREEN}Needs Input: $needsInput${NC}"
  echo ""
  echo -e "${BLUE}Response:${NC}"
  echo "$responseText" | head -50
  echo ""
  
  if [ "$needsInput" = "true" ]; then
    return 0  # Needs more input
  else
    return 1  # Done or error
  fi
}

# Function to get workflow state
get_state() {
  curl -s "$API/workflow/$SESSION" | jq '.'
}

echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}TEST 1: Vágní požadavek (měl by se zeptat)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

call_workflow "Vytvoř mi aplikaci"

echo ""
echo -e "${BLUE}Current state:${NC}"
get_state
echo ""

# If clarification needed, provide details
read -p "Press Enter to continue with clarification..."

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Providing clarification...${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

call_workflow "CLI aplikace v Node.js, uloží do $WORKDIR/todo.js, funkce: add, list, done pro správu úkolů"

echo ""
read -p "Press Enter to confirm plan (or Ctrl+C to abort)..."

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Confirming plan...${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

call_workflow "OK"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Waiting for implementation...${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Loop until done
max_wait=30
wait_count=0
while [ $wait_count -lt $max_wait ]; do
  state=$(curl -s "$API/workflow/$SESSION" | jq -r '.state')
  echo "State: $state"
  
  if [ "$state" = "DONE" ] || [ "$state" = "ERROR" ]; then
    break
  fi
  
  sleep 5
  ((wait_count++))
done

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Final State${NC}"
echo -e "${BLUE}========================================${NC}"
get_state

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Created Files${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ -d "$WORKDIR" ]; then
  find "$WORKDIR" -type f -name "*.js" -o -name "*.json" -o -name "*.html" 2>/dev/null
  echo ""
  tree "$WORKDIR" 2>/dev/null || ls -la "$WORKDIR"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  TEST COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"

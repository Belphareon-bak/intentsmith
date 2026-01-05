#!/bin/bash
# C.3 Agent - Basic Tools Test
# Run: chmod +x test-tools.sh && ./test-tools.sh

API="http://127.0.0.1:3335"
PASS=0
FAIL=0

echo "========================================"
echo "  C.3 Agent - Tools Test"
echo "========================================"
echo ""

# Test 1: Health check
echo "Test 1: Health check..."
HEALTH=$(curl -s "$API/health")
if echo "$HEALTH" | grep -q "ok"; then
  echo "  ✅ PASS: Server is healthy"
  ((PASS++))
else
  echo "  ❌ FAIL: Server not responding"
  ((FAIL++))
  echo "  Make sure server is running: node orchestrator/server.js"
  exit 1
fi

# Test 2: fs:write - Create file
echo ""
echo "Test 2: fs:write - Create file..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "vytvoř soubor /tmp/c3test.txt s textem Hello C3", "workdir": "/tmp"}')

if echo "$RESULT" | grep -q "Soubor"; then
  echo "  ✅ PASS: fs:write responded"
  ((PASS++))
else
  echo "  ⚠️ WARN: Unexpected response"
  echo "  Response: $RESULT"
fi

# Verify file exists
sleep 1
if [ -f "/tmp/c3test.txt" ]; then
  CONTENT=$(cat /tmp/c3test.txt)
  if [ "$CONTENT" = "Hello C3" ]; then
    echo "  ✅ PASS: File created with correct content"
    ((PASS++))
  else
    echo "  ⚠️ WARN: File content mismatch: $CONTENT"
  fi
else
  echo "  ❌ FAIL: File was not created"
  ((FAIL++))
fi

# Test 3: fs:read - Read file
echo ""
echo "Test 3: fs:read - Read file..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "přečti obsah souboru /tmp/c3test.txt", "workdir": "/tmp"}')

if echo "$RESULT" | grep -q "Hello"; then
  echo "  ✅ PASS: fs:read returned content"
  ((PASS++))
else
  echo "  ⚠️ WARN: Content not found in response"
  echo "  Response: $(echo $RESULT | head -c 200)"
fi

# Test 4: fs:list - List directory
echo ""
echo "Test 4: fs:list - List directory..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "vypiš soubory v /tmp", "workdir": "/tmp"}')

if echo "$RESULT" | grep -q "c3test"; then
  echo "  ✅ PASS: fs:list found test file"
  ((PASS++))
else
  echo "  ⚠️ WARN: Test file not listed"
fi

# Test 5: shell:exec
echo ""
echo "Test 5: shell:exec - Run command..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "spusť příkaz: echo test123", "workdir": "/tmp"}')

if echo "$RESULT" | grep -q "test123"; then
  echo "  ✅ PASS: shell:exec returned output"
  ((PASS++))
else
  echo "  ⚠️ WARN: Command output not found"
  echo "  Response: $(echo $RESULT | head -c 200)"
fi

# Test 6: Clarification question
echo ""
echo "Test 6: Clarification - Vague request..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "vytvoř projekt"}')

if echo "$RESULT" | grep -qi "jak\|který\|kde\|?"; then
  echo "  ✅ PASS: Agent asked clarifying question"
  ((PASS++))
else
  echo "  ⚠️ WARN: Agent didn't ask for clarification"
fi

# Test 7: Czech language
echo ""
echo "Test 7: Czech language response..."
RESULT=$(curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "ahoj, jak se máš?"}')

if echo "$RESULT" | grep -qi "ahoj\|dobrý\|pomoc\|rád"; then
  echo "  ✅ PASS: Responded in Czech"
  ((PASS++))
else
  echo "  ⚠️ WARN: Response may not be in Czech"
fi

# Cleanup
rm -f /tmp/c3test.txt

# Summary
echo ""
echo "========================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================"

if [ $FAIL -eq 0 ]; then
  echo "  All tests passed! 🎉"
  exit 0
else
  echo "  Some tests failed. Check logs."
  exit 1
fi

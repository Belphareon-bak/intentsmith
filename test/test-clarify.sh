#!/bin/bash
# Test clarification requests

API="http://127.0.0.1:3335"

echo "========================================"
echo "  Test: Clarification Requests"
echo "========================================"

# Test 1: Vague request - should ask for clarification
echo ""
echo "TEST 1: Vágní požadavek (měl by se zeptat)"
echo "Request: 'Vytvoř mi aplikaci'"
echo "----------------------------------------"
curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Vytvoř mi aplikaci", "sessionId": "test-clarify-1"}' | jq -r '.response'

echo ""
echo "========================================"

# Test 2: Specific request - should NOT ask
echo ""
echo "TEST 2: Specifický požadavek (neměl by se ptát)"
echo "Request: 'Vytvoř TODO CLI aplikaci v Node.js do /tmp/test/todo.js'"
echo "----------------------------------------"
curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Vytvoř TODO CLI aplikaci v Node.js do /tmp/test/todo.js. Funkce: add, list, done.", "sessionId": "test-clarify-2"}' | jq -r '.response' | head -30

echo ""
echo "========================================"

# Test 3: Medium vague - web app without framework
echo ""
echo "TEST 3: Středně vágní (web app bez frameworku)"
echo "Request: 'Vytvoř jednoduchou webovou aplikaci'"
echo "----------------------------------------"
curl -s -X POST "$API/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Vytvoř jednoduchou webovou aplikaci", "sessionId": "test-clarify-3"}' | jq -r '.response'

echo ""
echo "========================================"
echo "HOTOVO"
echo "========================================"

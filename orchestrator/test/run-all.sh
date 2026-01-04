#!/usr/bin/env bash
set -e

node test/test-planner.js
node test/test-planner-llm.js
node test/test-context.js
node test/test-hardening.js
node test/test-audit.js
node test/test-multi-agent.js
node test/test-settings.js

echo "ALL TESTS PASSED"

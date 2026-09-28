#!/usr/bin/env node

// Compatibility entry point for the historical command.
// The authoritative inventory, isolation, evidence, and verdict logic lives in
// scripts/nightly-audit.js and tests/registry.json.

import { parseArgs, runAudit } from '../scripts/nightly-audit.js';

try {
  const report = await runAudit(parseArgs(process.argv.slice(2)));
  process.exitCode = report.exitCode;
} catch (error) {
  console.error(`test runner failed: ${error.stack || error.message}`);
  process.exitCode = 2;
}

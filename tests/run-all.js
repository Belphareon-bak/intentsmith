#!/usr/bin/env node
// tests/run-all.js — Run all C3 test suites
// ══════════════════════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .sort();

console.log(`\n🧪 C3 Test Runner — ${testFiles.length} test suites\n`);
console.log('═'.repeat(70));

let totalPassed = 0;
let totalFailed = 0;
let failedSuites = [];

for (const file of testFiles) {
  const path = join(__dirname, file);
  console.log(`\n📦 Running: ${file}`);
  console.log('─'.repeat(70));
  
  try {
    const output = execSync(`node "${path}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    console.log(output);
    
    // Parse results from output
    const match = output.match(/RESULTS:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
      if (parseInt(match[2]) > 0) failedSuites.push(file);
    }
  } catch (e) {
    console.log(e.stdout || '');
    console.log(e.stderr || '');
    
    // Try to parse results even on failure
    const match = (e.stdout || '').match(/RESULTS:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    failedSuites.push(file);
  }
}

console.log('\n' + '═'.repeat(70));
console.log(`\n🏁 TOTAL: ${totalPassed} passed, ${totalFailed} failed across ${testFiles.length} suites`);

if (failedSuites.length > 0) {
  console.log(`\n❌ Failed suites: ${failedSuites.join(', ')}`);
} else {
  console.log(`\n✅ All suites passed!`);
}

console.log('═'.repeat(70) + '\n');
process.exit(totalFailed > 0 ? 1 : 0);

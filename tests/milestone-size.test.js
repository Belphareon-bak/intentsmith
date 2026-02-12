// Milestone Size Tests — Context Budget Validation
// ══════════════════════════════════════════════════════════════════════════════
// Verifies: validateMilestoneSize, suggestMilestoneSplit, estimateContextTokens
//
// Run: node tests/milestone-size.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  validateMilestoneSize,
  suggestMilestoneSplit,
  estimateContextTokens,
} from '../src/planner/milestone-size.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. estimateContextTokens
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── estimateContextTokens ──');

{
  const tokens = estimateContextTokens({ estimated_loc: 0, estimated_files: 0 });
  assert(tokens === 2000, 'zero LOC/files = plan overhead only (2000)', `got ${tokens}`);
}

{
  const tokens = estimateContextTokens({ estimated_loc: 100, estimated_files: 3 });
  // 100*15 + 3*200 + 2000 = 1500 + 600 + 2000 = 4100
  assert(tokens === 4100, '100 LOC + 3 files = 4100 tokens', `got ${tokens}`);
}

{
  const tokens = estimateContextTokens({ estimated_loc: 2000, estimated_files: 10 });
  // 2000*15 + 10*200 + 2000 = 30000 + 2000 + 2000 = 34000
  assert(tokens === 34000, '2000 LOC + 10 files = 34000 tokens', `got ${tokens}`);
}

{
  const tokens = estimateContextTokens({ estimated_loc: 5000, estimated_files: 20 });
  // 5000*15 + 20*200 + 2000 = 75000 + 4000 + 2000 = 81000
  assert(tokens === 81000, '5000 LOC + 20 files = 81000 tokens (over budget)', `got ${tokens}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. validateMilestoneSize — within limits
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── validateMilestoneSize (within limits) ──');

{
  const result = validateMilestoneSize({
    estimated_loc: 500,
    estimated_files: 4,
    estimated_complexity: 'LOW',
  });
  assert(result.fits === true, 'small milestone fits');
  assert(result.issues.length === 0, 'no issues');
  assert(result.warnings.length === 0, 'no warnings');
}

{
  const result = validateMilestoneSize({
    estimated_loc: 2000,
    estimated_files: 10,
    estimated_complexity: 'MEDIUM',
  });
  assert(result.fits === true, 'exactly at limit still fits');
  assert(result.issues.length === 0, 'no issues at exact limit');
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. validateMilestoneSize — warnings
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── validateMilestoneSize (warnings) ──');

{
  const result = validateMilestoneSize({
    estimated_loc: 1600,
    estimated_files: 4,
    estimated_complexity: 'MEDIUM',
  });
  assert(result.fits === true, '1600 LOC fits');
  assert(result.warnings.length >= 1, 'LOC warning at 80% threshold');
  assert(result.warnings[0].includes('approaching'), 'warning mentions approaching limit');
}

{
  const result = validateMilestoneSize({
    estimated_loc: 8,
    estimated_files: 8,
    estimated_complexity: 'MEDIUM',
  });
  assert(result.fits === true, '8 files fits');
  assert(result.warnings.some(w => w.includes('Files')), 'files approaching warning');
}

{
  const result = validateMilestoneSize({
    estimated_loc: 1200,
    estimated_files: 4,
    estimated_complexity: 'HIGH',
  });
  assert(result.fits === true, 'HIGH complexity 1200 LOC fits');
  assert(result.warnings.some(w => w.includes('HIGH complexity')), 'HIGH complexity + high LOC warns');
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. validateMilestoneSize — exceeds limits
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── validateMilestoneSize (exceeds limits) ──');

{
  const result = validateMilestoneSize({
    estimated_loc: 3000,
    estimated_files: 4,
  });
  assert(result.fits === false, '3000 LOC does not fit');
  assert(result.issues.some(i => i.includes('LOC')), 'LOC issue reported');
}

{
  const result = validateMilestoneSize({
    estimated_loc: 500,
    estimated_files: 15,
  });
  assert(result.fits === false, '15 files does not fit');
  assert(result.issues.some(i => i.includes('Files')), 'files issue reported');
}

{
  const result = validateMilestoneSize({
    estimated_loc: 5000,
    estimated_files: 20,
  });
  assert(result.fits === false, '5000 LOC + 20 files does not fit');
  assert(result.issues.length >= 2, 'multiple issues reported');
}

// Custom limits
{
  const result = validateMilestoneSize(
    { estimated_loc: 600, estimated_files: 4 },
    { maxLOC: 500, maxFiles: 5 }
  );
  assert(result.fits === false, 'custom maxLOC=500 → 600 LOC rejected');
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. suggestMilestoneSplit — no split needed
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── suggestMilestoneSplit (no split) ──');

{
  const result = suggestMilestoneSplit({
    title: 'Small task',
    estimated_loc: 300,
    estimated_files: 3,
    estimated_complexity: 'LOW',
  });
  assert(result.shouldSplit === false, 'small milestone — no split needed');
  assert(result.suggestions.length === 0, 'no suggestions for small milestone');
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. suggestMilestoneSplit — split needed
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── suggestMilestoneSplit (split needed) ──');

{
  const result = suggestMilestoneSplit({
    title: 'Huge implementation',
    estimated_loc: 6000,
    estimated_files: 25,
  });
  assert(result.shouldSplit === true, '6000 LOC → split needed');
  assert(result.splitCount >= 3, 'suggests 3+ sub-milestones');
  assert(result.suggestions.length === result.splitCount, 'suggestions count matches splitCount');
  assert(result.suggestions[0].title.includes('(1/'), 'first suggestion has title (1/N)');
  assert(result.reason.length > 0, 'split reason provided');

  // Verify sub-milestones are within budget
  for (const sub of result.suggestions) {
    assert(sub.estimated_loc <= 2000, `sub-milestone LOC (${sub.estimated_loc}) within budget`);
  }
}

{
  const result = suggestMilestoneSplit({
    title: 'Many files',
    estimated_loc: 500,
    estimated_files: 20,
  });
  assert(result.shouldSplit === true, '20 files → split needed');
  assert(result.suggestions.length >= 2, 'at least 2 sub-milestones for file split');
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. Edge cases
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Edge Cases ──');

{
  const result = validateMilestoneSize({});
  assert(result.fits === true, 'empty milestone (0 LOC, 0 files) fits');
}

{
  const result = validateMilestoneSize({ estimated_loc: 0, estimated_files: 0 });
  assert(result.fits === true, 'zero LOC/files fits');
}

{
  const result = suggestMilestoneSplit({ title: 'x', estimated_loc: 0, estimated_files: 0 });
  assert(result.shouldSplit === false, 'zero-size — no split');
}

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Milestone Size Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);

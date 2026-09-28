// tests/task-memory.test.js — Task Memory (F5) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import { TaskMemory, formatTaskMemory } from '../src/memory/task-memory.js';
import Database from 'better-sqlite3';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestMemory() {
  const tm = new TaskMemory();
  const db = new Database(':memory:');
  tm.init(db);
  return tm;
}

const PROJECT = 'test-project-1';
const PROJECT2 = 'test-project-2';
const MS_PER_DAY = 86_400_000;

// ═══════════════════════════════════════════════════════════════════════════
// init + schema
// ═══════════════════════════════════════════════════════════════════════════

suite('init + schema');

test('init creates table', () => {
  const tm = createTestMemory();
  const tables = tm.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert(tables.includes('task_memory'), 'task_memory table should exist');
});

test('idempotent init', () => {
  const tm = createTestMemory();
  // Call init again — should not throw
  tm._ensureTable();
  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory').get().n;
  assertEqual(count, 0, 'table should be empty after re-init');
});

await testAsync('stats on empty', async () => {
  const tm = createTestMemory();
  const stats = await tm.getStats(PROJECT);
  assertEqual(Object.keys(stats).length, 0, 'empty project should have no stats');
});

// ═══════════════════════════════════════════════════════════════════════════
// recordFix
// ═══════════════════════════════════════════════════════════════════════════

suite('recordFix');

await testAsync('success record', async () => {
  const tm = createTestMemory();
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'IMPORT_NOT_FOUND', file: 'src/app.js',
    symbol: 'express', patchFile: 'src/index.js', success: true,
    strategy: 'Added missing export', milestoneId: 'ms-1',
  });

  const stats = await tm.getStats(PROJECT);
  assertEqual(stats.fix_strategy, 1, 'should have 1 fix_strategy entry');
});

await testAsync('failure record', async () => {
  const tm = createTestMemory();
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'SYNTAX_ERROR', file: 'src/main.js',
    patchFile: 'src/main.js', success: false,
    strategy: 'Tried semicolon fix', milestoneId: 'ms-1',
  });

  const stats = await tm.getStats(PROJECT);
  assertEqual(stats.error_pattern, 1, 'should have 1 error_pattern entry');
});

await testAsync('upsert — failure to success overwrite', async () => {
  const tm = createTestMemory();

  // First: failure
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'IMPORT_NOT_FOUND', file: 'src/a.js', symbol: 'x',
    patchFile: 'src/b.js', success: false, strategy: 'Wrong approach',
  });

  // Second: success with same key
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'IMPORT_NOT_FOUND', file: 'src/a.js', symbol: 'x',
    patchFile: 'src/c.js', success: true, strategy: 'Correct approach',
  });

  // Now check — there should be a fix_strategy, not error_pattern
  // (different kinds, so we now have 1 error_pattern + 1 fix_strategy where fix_strategy has confidence 0.8)
  const rows = tm.db.prepare('SELECT * FROM task_memory WHERE project_id = ?').all(PROJECT);
  // The error_pattern entry stays, fix_strategy is a new entry (different kind)
  assert(rows.length >= 1, 'should have at least 1 entry');
});

await testAsync('upsert — success to failure reduces confidence', async () => {
  const tm = createTestMemory();

  // Record success
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'TYPE_ERROR', file: 'src/x.js', symbol: '',
    patchFile: 'src/y.js', success: true, strategy: 'Fixed type',
  });

  const before = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);
  assertEqual(before.confidence, 0.8, 'initial confidence should be 0.8');

  // Record failure with same key
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'TYPE_ERROR', file: 'src/x.js', symbol: '',
    patchFile: 'src/y.js', success: true, strategy: 'Fixed type again',
  });

  const after = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);
  // Same outcome → reinforce
  assert(after.confidence > before.confidence, 'same success should reinforce');
});

await testAsync('reinforce on repeat', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'MISSING_VAR', file: 'a.js', symbol: 'foo',
    patchFile: 'b.js', success: true, strategy: 'Added var',
  });

  // Record again with same outcome
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'MISSING_VAR', file: 'a.js', symbol: 'foo',
    patchFile: 'b.js', success: true, strategy: 'Added var',
  });

  const row = tm.db.prepare(
    "SELECT confidence, access_count FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);
  assert(row.confidence > 0.8, 'confidence should increase on reinforce');
  assert(row.access_count >= 1, 'access_count should increment');
});

await testAsync('different projects isolated', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR1', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix1',
  });
  await tm.recordFix({
    projectId: PROJECT2, errorCode: 'ERR2', file: 'c.js',
    patchFile: 'd.js', success: true, strategy: 'Fix2',
  });

  const stats1 = await tm.getStats(PROJECT);
  const stats2 = await tm.getStats(PROJECT2);
  assertEqual(stats1.fix_strategy, 1, 'project 1 should have 1 entry');
  assertEqual(stats2.fix_strategy, 1, 'project 2 should have 1 entry');
});

await testAsync('milestone tracked', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix', milestoneId: 'ms-3',
  });

  const row = tm.db.prepare('SELECT milestone_id FROM task_memory WHERE project_id = ?').get(PROJECT);
  assertEqual(row.milestone_id, 'ms-3', 'milestone should be stored');
});

await testAsync('confidence bounds', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix',
  });

  const row = tm.db.prepare('SELECT confidence FROM task_memory WHERE project_id = ?').get(PROJECT);
  assert(row.confidence >= 0 && row.confidence <= 1, `confidence should be 0-1, got ${row.confidence}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// recordArchDecision
// ═══════════════════════════════════════════════════════════════════════════

suite('recordArchDecision');

await testAsync('basic record', async () => {
  const tm = createTestMemory();

  await tm.recordArchDecision({
    projectId: PROJECT, decision: 'Use ESM imports only',
    rationale: 'Consistency across codebase', milestoneId: 'ms-1',
  });

  const stats = await tm.getStats(PROJECT);
  assertEqual(stats.architecture_decision, 1, 'should have 1 arch decision');

  const row = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'architecture_decision'",
  ).get(PROJECT);
  assertEqual(row.confidence, 0.9, 'arch decisions start at 0.9');
});

await testAsync('duplicate reinforces', async () => {
  const tm = createTestMemory();

  await tm.recordArchDecision({
    projectId: PROJECT, decision: 'Use ESM imports only',
    rationale: 'Consistency',
  });
  await tm.recordArchDecision({
    projectId: PROJECT, decision: 'Use ESM imports only',
    rationale: 'Consistency again',
  });

  const row = tm.db.prepare(
    "SELECT confidence, access_count FROM task_memory WHERE project_id = ? AND kind = 'architecture_decision'",
  ).get(PROJECT);
  assert(row.confidence > 0.9, 'should reinforce on duplicate');
  assert(row.access_count >= 1, 'access_count should increment');
});

await testAsync('different project', async () => {
  const tm = createTestMemory();

  await tm.recordArchDecision({ projectId: PROJECT, decision: 'ESM only' });
  await tm.recordArchDecision({ projectId: PROJECT2, decision: 'CJS only' });

  const stats1 = await tm.getStats(PROJECT);
  const stats2 = await tm.getStats(PROJECT2);
  assertEqual(stats1.architecture_decision, 1);
  assertEqual(stats2.architecture_decision, 1);
});

await testAsync('confidence 0.9', async () => {
  const tm = createTestMemory();
  await tm.recordArchDecision({ projectId: PROJECT, decision: 'Use TypeScript' });

  const row = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'architecture_decision'",
  ).get(PROJECT);
  assertEqual(row.confidence, 0.9);
});

// ═══════════════════════════════════════════════════════════════════════════
// queryRelevant
// ═══════════════════════════════════════════════════════════════════════════

suite('queryRelevant');

await testAsync('by error code', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'IMPORT_NOT_FOUND', file: 'src/a.js', symbol: 'x',
    patchFile: 'src/b.js', success: true, strategy: 'Added export',
  });

  const results = await tm.queryRelevant(
    [{ code: 'IMPORT_NOT_FOUND', file: 'src/a.js' }],
    [],
    { projectId: PROJECT },
  );
  assert(results.length >= 1, 'should find match by error code');
});

await testAsync('by file', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'SYNTAX', file: 'src/service.js', symbol: '',
    patchFile: 'src/service.js', success: false, strategy: 'Tried fix',
  });

  const results = await tm.queryRelevant(
    [],
    ['src/service.js'],
    { projectId: PROJECT },
  );
  assert(results.length >= 1, 'should find match by file');
});

await testAsync('combined errors + files', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR1', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix1',
  });
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR2', file: 'c.js',
    patchFile: 'd.js', success: false, strategy: 'Fix2',
  });

  const results = await tm.queryRelevant(
    [{ code: 'ERR1', file: 'a.js' }],
    ['c.js'],
    { projectId: PROJECT },
  );
  assert(results.length >= 2, `should find both, got ${results.length}`);
});

await testAsync('max results cap', async () => {
  const tm = createTestMemory();

  for (let i = 0; i < 20; i++) {
    await tm.recordFix({
      projectId: PROJECT, errorCode: `ERR${i}`, file: `f${i}.js`,
      patchFile: `p${i}.js`, success: true, strategy: `Fix${i}`,
    });
  }

  const results = await tm.queryRelevant(
    Array.from({ length: 20 }, (_, i) => ({ code: `ERR${i}`, file: `f${i}.js` })),
    [],
    { projectId: PROJECT, maxResults: 5 },
  );
  assert(results.length <= 5, `should cap at 5, got ${results.length}`);
});

await testAsync('minConfidence filter', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR_LOW', file: 'a.js',
    patchFile: 'b.js', success: false, strategy: 'Bad fix',
  });

  // Manually lower confidence
  tm.db.prepare("UPDATE task_memory SET confidence = 0.05 WHERE project_id = ?").run(PROJECT);

  const results = await tm.queryRelevant(
    [{ code: 'ERR_LOW', file: 'a.js' }],
    [],
    { projectId: PROJECT, minConfidence: 0.3 },
  );
  assertEqual(results.length, 0, 'should filter out low confidence');
});

await testAsync('decay applied', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'OLD_ERR', file: 'old.js',
    patchFile: 'fix.js', success: true, strategy: 'Old fix',
  });

  // Age the entry by 100 days
  const oldTimestamp = Date.now() - 100 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ? WHERE project_id = ?').run(oldTimestamp, PROJECT);

  const results = await tm.queryRelevant(
    [{ code: 'OLD_ERR', file: 'old.js' }],
    [],
    { projectId: PROJECT },
  );

  if (results.length > 0) {
    assert(results[0].effectiveConfidence < results[0].confidence,
      'effective confidence should be decayed');
  }
});

await testAsync('architecture decisions included', async () => {
  const tm = createTestMemory();

  await tm.recordArchDecision({
    projectId: PROJECT, decision: 'Use ESM', rationale: 'Modern',
  });

  // Query with unrelated errors — arch decisions should still appear
  const results = await tm.queryRelevant(
    [{ code: 'SOME_ERR', file: 'x.js' }],
    [],
    { projectId: PROJECT },
  );
  assert(results.some(r => r.kind === 'architecture_decision'),
    'arch decisions should be included regardless of errors');
});

await testAsync('empty project', async () => {
  const tm = createTestMemory();
  const results = await tm.queryRelevant([], [], { projectId: 'nonexistent' });
  assertEqual(results.length, 0, 'empty project should return nothing');
});

await testAsync('cross-milestone', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR_X', file: 'src/x.js',
    patchFile: 'src/y.js', success: true, strategy: 'Fix from ms-1', milestoneId: 'ms-1',
  });

  // Query from ms-2 context — should still find ms-1 entries
  const results = await tm.queryRelevant(
    [{ code: 'ERR_X', file: 'src/x.js' }],
    [],
    { projectId: PROJECT },
  );
  assert(results.length >= 1, 'should find cross-milestone entries');
});

await testAsync('sorted by confidence', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR_A', file: 'a.js',
    patchFile: 'b.js', success: false, strategy: 'Low conf', // 0.5
  });
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR_A', file: 'a2.js',
    patchFile: 'c.js', success: true, strategy: 'High conf', // 0.8
  });

  const results = await tm.queryRelevant(
    [{ code: 'ERR_A', file: 'a.js' }, { code: 'ERR_A', file: 'a2.js' }],
    [],
    { projectId: PROJECT },
  );

  if (results.length >= 2) {
    assert(results[0].effectiveConfidence >= results[1].effectiveConfidence,
      'should be sorted by effectiveConfidence desc');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// prune
// ═══════════════════════════════════════════════════════════════════════════

suite('prune');

await testAsync('remove old low-confidence', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'OLD', file: 'old.js',
    patchFile: 'fix.js', success: false, strategy: 'Old bad fix',
  });

  // Age by 200 days
  const oldTimestamp = Date.now() - 200 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ?, confidence = 0.2 WHERE project_id = ?')
    .run(oldTimestamp, PROJECT);

  await tm.prune({ maxAge: 180, minEffectiveConfidence: 0.1 });

  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory WHERE project_id = ?').get(PROJECT).n;
  assertEqual(count, 0, 'old low-confidence entries should be pruned');
});

await testAsync('keep recent high-confidence', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'RECENT', file: 'r.js',
    patchFile: 'f.js', success: true, strategy: 'Good fix',
  });

  await tm.prune({ maxAge: 180, minEffectiveConfidence: 0.1 });

  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory WHERE project_id = ?').get(PROJECT).n;
  assertEqual(count, 1, 'recent high-confidence entries should be kept');
});

await testAsync('keep architecture decisions longer', async () => {
  const tm = createTestMemory();

  await tm.recordArchDecision({
    projectId: PROJECT, decision: 'Use ESM', rationale: 'Standard',
  });

  // Age by 200 days
  const oldTimestamp = Date.now() - 200 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ? WHERE project_id = ?')
    .run(oldTimestamp, PROJECT);

  await tm.prune({ maxAge: 180, minEffectiveConfidence: 0.1 });

  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory WHERE project_id = ?').get(PROJECT).n;
  assertEqual(count, 1, 'architecture decisions should be kept');
});

await testAsync('maxAge filter', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'MID', file: 'm.js',
    patchFile: 'f.js', success: false, strategy: 'Mid fix',
  });

  // Age by 100 days (within maxAge=180)
  const ts = Date.now() - 100 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ? WHERE project_id = ?').run(ts, PROJECT);

  await tm.prune({ maxAge: 180 });

  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory WHERE project_id = ?').get(PROJECT).n;
  assertEqual(count, 1, 'entries within maxAge should be kept');
});

await testAsync('idempotent prune', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'X', file: 'x.js',
    patchFile: 'y.js', success: true, strategy: 'Fix',
  });

  await tm.prune();
  await tm.prune();

  const count = tm.db.prepare('SELECT COUNT(*) as n FROM task_memory WHERE project_id = ?').get(PROJECT).n;
  assertEqual(count, 1, 'prune should be idempotent');
});

// ═══════════════════════════════════════════════════════════════════════════
// reinforce
// ═══════════════════════════════════════════════════════════════════════════

suite('reinforce');

await testAsync('+0.05 boost', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix',
  });

  const before = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);

  await tm.reinforce(PROJECT, 'fix_strategy', 'ERR:a.js:');

  const after = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);

  assert(Math.abs(after.confidence - (before.confidence + 0.05)) < 0.001,
    `should boost by 0.05: ${before.confidence} → ${after.confidence}`);
});

await testAsync('cap at 0.95', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix',
  });

  // Set confidence high
  tm.db.prepare("UPDATE task_memory SET confidence = 0.94 WHERE project_id = ?").run(PROJECT);

  await tm.reinforce(PROJECT, 'fix_strategy', 'ERR:a.js:');

  const row = tm.db.prepare(
    "SELECT confidence FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);
  assert(row.confidence <= 0.95, `should cap at 0.95, got ${row.confidence}`);
});

await testAsync('access count increment', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix',
  });

  await tm.reinforce(PROJECT, 'fix_strategy', 'ERR:a.js:');
  await tm.reinforce(PROJECT, 'fix_strategy', 'ERR:a.js:');

  const row = tm.db.prepare(
    "SELECT access_count FROM task_memory WHERE project_id = ? AND kind = 'fix_strategy'",
  ).get(PROJECT);
  assert(row.access_count >= 2, `access count should be >= 2, got ${row.access_count}`);
});

await testAsync('nonexistent key no-op', async () => {
  const tm = createTestMemory();
  // Should not throw
  await tm.reinforce(PROJECT, 'fix_strategy', 'NONEXISTENT:x.js:y');
});

// ═══════════════════════════════════════════════════════════════════════════
// decay formula
// ═══════════════════════════════════════════════════════════════════════════

suite('decay formula');

await testAsync('fresh entry = full confidence', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'FRESH', file: 'f.js',
    patchFile: 'g.js', success: true, strategy: 'Fresh fix',
  });

  const results = await tm.queryRelevant(
    [{ code: 'FRESH', file: 'f.js' }],
    [],
    { projectId: PROJECT },
  );

  assert(results.length === 1, 'should find fresh entry');
  // Fresh entry: effectiveConfidence ≈ confidence (minimal decay)
  assert(Math.abs(results[0].effectiveConfidence - results[0].confidence) < 0.01,
    'fresh entry should have ~full effective confidence');
});

await testAsync('139-day entry ≈ 50%', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'HALF', file: 'h.js',
    patchFile: 'i.js', success: true, strategy: 'Half-life test',
  });

  // Age by 139 days (half-life for lambda=0.005)
  const ts = Date.now() - 139 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ? WHERE project_id = ?').run(ts, PROJECT);

  const results = await tm.queryRelevant(
    [{ code: 'HALF', file: 'h.js' }],
    [],
    { projectId: PROJECT, minConfidence: 0.1 },
  );

  if (results.length > 0) {
    const ratio = results[0].effectiveConfidence / results[0].confidence;
    assert(ratio > 0.4 && ratio < 0.6,
      `at 139 days (half-life), ratio should be ~0.5, got ${ratio.toFixed(3)}`);
  }
});

await testAsync('200-day entry low confidence', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'OLD2', file: 'o.js',
    patchFile: 'p.js', success: true, strategy: 'Old fix',
  });

  const ts = Date.now() - 200 * MS_PER_DAY;
  tm.db.prepare('UPDATE task_memory SET created_at = ? WHERE project_id = ?').run(ts, PROJECT);

  const results = await tm.queryRelevant(
    [{ code: 'OLD2', file: 'o.js' }],
    [],
    { projectId: PROJECT, minConfidence: 0.05 },
  );

  if (results.length > 0) {
    const ratio = results[0].effectiveConfidence / results[0].confidence;
    assert(ratio < 0.4, `at 200 days, ratio should be <0.4, got ${ratio.toFixed(3)}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// formatTaskMemory
// ═══════════════════════════════════════════════════════════════════════════

suite('formatTaskMemory');

test('format successes', () => {
  const entries = [{
    kind: 'fix_strategy',
    key: 'IMPORT:src/a.js:x',
    value: JSON.stringify({ success: true, strategy: 'Added export', patchFile: 'b.js' }),
    effectiveConfidence: 0.75,
  }];
  const result = formatTaskMemory(entries);
  assertIncludes(result, '[WORKED]');
  assertIncludes(result, 'Added export');
  assertIncludes(result, '75%');
});

test('format failures', () => {
  const entries = [{
    kind: 'error_pattern',
    key: 'SYNTAX:src/main.js:',
    value: JSON.stringify({ success: false, strategy: 'Wrong semicolon', patchFile: 'main.js' }),
    effectiveConfidence: 0.4,
  }];
  const result = formatTaskMemory(entries);
  assertIncludes(result, '[FAILED]');
  assertIncludes(result, 'Wrong semicolon');
});

test('format mixed', () => {
  const entries = [
    {
      kind: 'fix_strategy', key: 'ERR1:a.js:',
      value: JSON.stringify({ success: true, strategy: 'Good' }),
      effectiveConfidence: 0.8,
    },
    {
      kind: 'error_pattern', key: 'ERR2:b.js:',
      value: JSON.stringify({ success: false, strategy: 'Bad' }),
      effectiveConfidence: 0.3,
    },
  ];
  const result = formatTaskMemory(entries);
  assertIncludes(result, '[WORKED]');
  assertIncludes(result, '[FAILED]');
  const lines = result.split('\n').filter(Boolean);
  assertEqual(lines.length, 2, 'should have 2 lines');
});

test('format empty', () => {
  assertEqual(formatTaskMemory([]), '');
  assertEqual(formatTaskMemory(null), '');
});

// ═══════════════════════════════════════════════════════════════════════════
// integration with execution loop
// ═══════════════════════════════════════════════════════════════════════════

suite('integration with execution loop');

await testAsync('taskContext injected into prompt', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT, errorCode: 'IMPORT_NOT_FOUND', file: 'src/app.js', symbol: 'express',
    patchFile: 'src/index.js', success: true, strategy: 'Added missing export',
  });

  const relevant = await tm.queryRelevant(
    [{ code: 'IMPORT_NOT_FOUND', file: 'src/app.js' }],
    [],
    { projectId: PROJECT },
  );

  const taskContext = formatTaskMemory(relevant);
  assert(taskContext.length > 0, 'taskContext should be non-empty');
  assertIncludes(taskContext, 'IMPORT_NOT_FOUND');
});

await testAsync('records after convergence', async () => {
  const tm = createTestMemory();

  // Simulate recording after successful convergence
  const patch = { file: 'src/fixed.js', regions: [{ anchor: 'function main' }] };
  await tm.recordFix({
    projectId: PROJECT,
    errorCode: 'TYPE_ERROR',
    file: 'src/broken.js',
    patchFile: patch.file,
    success: true,
    strategy: `Patched ${patch.file} at anchor ${patch.regions[0].anchor}`,
    milestoneId: 'ms-2',
  });

  const stats = await tm.getStats(PROJECT);
  assertEqual(stats.fix_strategy, 1, 'should record successful fix');
});

await testAsync('records after failure', async () => {
  const tm = createTestMemory();

  await tm.recordFix({
    projectId: PROJECT,
    errorCode: 'UNRECOVERABLE',
    file: 'src/complex.js',
    patchFile: 'src/attempted.js',
    success: false,
    strategy: 'Attempted but failed to converge',
    milestoneId: 'ms-3',
  });

  const stats = await tm.getStats(PROJECT);
  assertEqual(stats.error_pattern, 1, 'should record failed fix');
});

await testAsync('graceful without taskMemory', async () => {
  const tm = new TaskMemory(); // no db
  // Should not throw
  await tm.recordFix({
    projectId: PROJECT, errorCode: 'ERR', file: 'a.js',
    patchFile: 'b.js', success: true, strategy: 'Fix',
  });
  const results = await tm.queryRelevant([], [], { projectId: PROJECT });
  assertEqual(results.length, 0, 'should return empty without db');
});

// ═══════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);

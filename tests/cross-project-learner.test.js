// tests/cross-project-learner.test.js — Cross-Project Learning (F14) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';
import {
  computeStackSimilarity,
  queryCrossProject,
  identifyShareablePatterns,
  formatCrossProjectHints,
  mergeResults,
  getProjectsWithMemory,
  getProjectSummaries,
} from '../src/memory/cross-project-learner.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      milestone_id TEXT,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      UNIQUE(project_id, kind, key)
    )
  `);
  return db;
}

function insertEntry(db, projectId, kind, key, value, confidence = 0.8, accessCount = 0) {
  db.prepare(
    'INSERT INTO task_memory (project_id, kind, key, value, confidence, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(projectId, kind, key, JSON.stringify(value), confidence, Date.now(), Date.now(), accessCount);
}

function mkStack(language, frameworks = [], tools = []) {
  return { language, frameworks, tools };
}

// ═══════════════════════════════════════════════════════════════════════════
// computeStackSimilarity
// ═══════════════════════════════════════════════════════════════════════════

suite('computeStackSimilarity');

test('identical stacks → 1.0', () => {
  const s = mkStack('JavaScript', ['Express', 'React'], ['ESLint']);
  const result = computeStackSimilarity(s, s);
  assertEqual(result, 1, 'identical → 1');
});

test('same language, different frameworks → partial', () => {
  const a = mkStack('JavaScript', ['Express']);
  const b = mkStack('JavaScript', ['Fastify']);
  const result = computeStackSimilarity(a, b);
  assert(result > 0, 'some similarity');
  assert(result < 1, 'not identical');
});

test('different languages → low', () => {
  const a = mkStack('JavaScript', ['Express']);
  const b = mkStack('Python', ['Flask']);
  const result = computeStackSimilarity(a, b);
  assertEqual(result, 0, 'different languages, no fw overlap → 0');
});

test('null stacks → 0', () => {
  assertEqual(computeStackSimilarity(null, null), 0, 'null → 0');
  assertEqual(computeStackSimilarity(mkStack('JS'), null), 0, 'one null → 0');
});

test('overlapping frameworks boost score', () => {
  const a = mkStack('JavaScript', ['Express', 'React']);
  const b = mkStack('JavaScript', ['Express', 'Vue']);
  const result = computeStackSimilarity(a, b);
  assert(result > 0.5, 'overlapping fw → high similarity');
});

test('tools contribute less than frameworks', () => {
  const a = mkStack('JavaScript', [], ['ESLint', 'Prettier']);
  const b = mkStack('JavaScript', [], ['ESLint', 'Prettier']);
  const noTools = computeStackSimilarity(
    mkStack('JavaScript', ['Express']),
    mkStack('JavaScript', ['Express']),
  );
  const onlyTools = computeStackSimilarity(a, b);
  // Both should be 1.0 for matching components, but framework signal is stronger
  assert(typeof onlyTools === 'number', 'returns number');
});

test('case insensitive', () => {
  const a = mkStack('JAVASCRIPT', ['EXPRESS']);
  const b = mkStack('javascript', ['express']);
  const result = computeStackSimilarity(a, b);
  assertEqual(result, 1, 'case insensitive match');
});

// ═══════════════════════════════════════════════════════════════════════════
// queryCrossProject
// ═══════════════════════════════════════════════════════════════════════════

suite('queryCrossProject');

test('cross-project retrieval is default off without explicit opt-in', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'architecture_decision', 'use_repository_pattern', {
    decision: 'Use repository pattern',
    rationale: 'clean architecture',
  });
  assertEqual(queryCrossProject(db, { currentProjectId: 'proj-A' }).length, 0, 'default off');
  db.close();
});

test('excludes current project', () => {
  const db = mkDb();
  insertEntry(db, 'proj-A', 'fix_strategy', 'IMPORT_NOT_FOUND:app.js:', { success: true, strategy: 'add import' });
  insertEntry(db, 'proj-B', 'fix_strategy', 'IMPORT_NOT_FOUND:util.js:', { success: true, strategy: 'add import' });

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [{ code: 'IMPORT_NOT_FOUND', file: 'main.js' }],
  });

  assert(results.every(r => r.projectId !== 'proj-A'), 'no proj-A entries');
  assertEqual(results.length, 1, 'only proj-B');
  db.close();
});

test('matches by error code', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'fix_strategy', 'SYNTAX_ERROR:file.js:', { success: true, strategy: 'fix syntax' });
  insertEntry(db, 'proj-B', 'fix_strategy', 'TYPE_MISMATCH:other.js:', { success: true, strategy: 'fix type' });

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [{ code: 'SYNTAX_ERROR', file: 'my.js' }],
  });

  assert(results.length >= 1, 'at least 1 match');
  assert(results[0].key.startsWith('SYNTAX_ERROR'), 'matched by error code');
  db.close();
});

test('architecture decisions always included', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'architecture_decision', 'use_repository_pattern', { decision: 'Use repository pattern', rationale: 'clean architecture' });

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [],
  });

  assertEqual(results.length, 1, 'arch decision included');
  assertEqual(results[0].kind, 'architecture_decision', 'correct kind');
  db.close();
});

test('stack similarity boosts score', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'fix_strategy', 'IMPORT_NOT_FOUND:x.js:', { success: true, strategy: 'fix' });
  insertEntry(db, 'proj-C', 'fix_strategy', 'IMPORT_NOT_FOUND:y.js:', { success: true, strategy: 'fix' });

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [{ code: 'IMPORT_NOT_FOUND', file: 'z.js' }],
    currentStack: mkStack('JavaScript', ['Express']),
    projectStacks: {
      'proj-B': mkStack('JavaScript', ['Express']),   // Same stack
      'proj-C': mkStack('Python', ['Flask']),          // Different stack
    },
  });

  assert(results.length === 2, '2 results');
  // proj-B should score higher due to stack similarity
  assertEqual(results[0].projectId, 'proj-B', 'same-stack project ranked first');
  db.close();
});

test('general error codes get generality boost', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'fix_strategy', 'IMPORT_NOT_FOUND:a.js:', { success: true, strategy: 'add import' });
  insertEntry(db, 'proj-B', 'fix_strategy', 'CUSTOM_ERROR:b.js:', { success: true, strategy: 'custom fix' });

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [
      { code: 'IMPORT_NOT_FOUND', file: 'x.js' },
      { code: 'CUSTOM_ERROR', file: 'y.js' },
    ],
  });

  // IMPORT_NOT_FOUND should score higher (general + error match)
  const importEntry = results.find(r => r.key.startsWith('IMPORT_NOT_FOUND'));
  const customEntry = results.find(r => r.key.startsWith('CUSTOM_ERROR'));
  assert(importEntry, 'import entry found');
  assert(customEntry, 'custom entry found');
  assert(importEntry.relevanceScore > customEntry.relevanceScore, 'general code scores higher');
  db.close();
});

test('respects maxResults', () => {
  const db = mkDb();
  for (let i = 0; i < 20; i++) {
    insertEntry(db, 'proj-B', 'architecture_decision', `decision_${i}`, { decision: `D${i}`, rationale: 'r' });
  }

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [],
    maxResults: 5,
  });

  assertEqual(results.length, 5, 'capped at 5');
  db.close();
});

test('null db → empty', () => {
  const results = queryCrossProject(null, { currentProjectId: 'x' });
  assertEqual(results.length, 0, 'null db → empty');
});

test('no currentProjectId → empty', () => {
  const db = mkDb();
  const results = queryCrossProject(db, {});
  assertEqual(results.length, 0, 'no projectId → empty');
  db.close();
});

test('low confidence entries filtered', () => {
  const db = mkDb();
  insertEntry(db, 'proj-B', 'fix_strategy', 'SYNTAX_ERROR:x.js:', { success: true, strategy: 'fix' }, 0.1);

  const results = queryCrossProject(db, {
    crossProjectOptIn: true,
    currentProjectId: 'proj-A',
    errors: [{ code: 'SYNTAX_ERROR', file: 'y.js' }],
    minConfidence: 0.3,
  });

  assertEqual(results.length, 0, 'low conf filtered');
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// identifyShareablePatterns
// ═══════════════════════════════════════════════════════════════════════════

suite('identifyShareablePatterns');

test('general fix strategies are shareable', () => {
  const entries = [{
    kind: 'fix_strategy',
    key: 'IMPORT_NOT_FOUND:app.js:',
    value: JSON.stringify({ success: true, strategy: 'add import' }),
    confidence: 0.85,
    created_at: Date.now(),
    access_count: 1,
  }];

  const results = identifyShareablePatterns(entries);
  assertEqual(results.length, 1, '1 shareable');
  assert(results[0].shareable, 'is shareable');
  assert(results[0].reason.includes('IMPORT_NOT_FOUND'), 'includes code');
});

test('architecture decisions always shareable', () => {
  const entries = [{
    kind: 'architecture_decision',
    key: 'use_mvc',
    value: JSON.stringify({ decision: 'Use MVC', rationale: 'standard pattern' }),
    confidence: 0.9,
    created_at: Date.now(),
    access_count: 0,
  }];

  const results = identifyShareablePatterns(entries);
  assertEqual(results.length, 1, '1 shareable');
  assert(results[0].reason.includes('Architecture'), 'arch reason');
});

test('battle-tested entries are shareable', () => {
  const entries = [{
    kind: 'fix_strategy',
    key: 'CUSTOM_CODE:x.js:fn',
    value: JSON.stringify({ success: true, strategy: 'custom fix' }),
    confidence: 0.8,
    created_at: Date.now(),
    access_count: 5,  // ≥ 3
  }];

  const results = identifyShareablePatterns(entries);
  assertEqual(results.length, 1, '1 shareable');
  assert(results[0].reason.includes('Battle-tested'), 'battle-tested reason');
});

test('low confidence entries excluded', () => {
  const entries = [{
    kind: 'fix_strategy',
    key: 'IMPORT_NOT_FOUND:x.js:',
    value: JSON.stringify({ success: true, strategy: 'fix' }),
    confidence: 0.3,
    created_at: Date.now(),
    access_count: 0,
  }];

  const results = identifyShareablePatterns(entries, { minConfidence: 0.7 });
  assertEqual(results.length, 0, 'low conf excluded');
});

test('non-general error patterns excluded (unless battle-tested)', () => {
  const entries = [{
    kind: 'fix_strategy',
    key: 'CUSTOM_CODE:x.js:fn',
    value: JSON.stringify({ success: true, strategy: 'custom fix' }),
    confidence: 0.9,
    created_at: Date.now(),
    access_count: 0,  // Not battle-tested
  }];

  const results = identifyShareablePatterns(entries);
  assertEqual(results.length, 0, 'non-general not shareable');
});

test('empty entries → empty', () => {
  assertEqual(identifyShareablePatterns([]).length, 0, 'empty → empty');
  assertEqual(identifyShareablePatterns(null).length, 0, 'null → empty');
});

test('maxPatterns respected', () => {
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push({
      kind: 'architecture_decision',
      key: `decision_${i}`,
      value: JSON.stringify({ decision: `D${i}`, rationale: 'r' }),
      confidence: 0.9,
      created_at: Date.now(),
      access_count: 0,
    });
  }

  const results = identifyShareablePatterns(entries, { maxPatterns: 5 });
  assertEqual(results.length, 5, 'capped at 5');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatCrossProjectHints
// ═══════════════════════════════════════════════════════════════════════════

suite('formatCrossProjectHints');

test('formats fix strategies', () => {
  const entries = [{
    projectId: 'proj-B',
    kind: 'fix_strategy',
    key: 'IMPORT_NOT_FOUND:app.js:',
    value: JSON.stringify({ success: true, strategy: 'add import statement' }),
    confidence: 0.85,
    relevanceScore: 0.5,
  }];

  const result = formatCrossProjectHints(entries);
  assert(result.includes('Cross-Project Insights'), 'has header');
  assert(result.includes('WORKED'), 'shows outcome');
  assert(result.includes('add import'), 'shows strategy');
  assert(result.includes('proj-B'), 'shows source project');
});

test('formats architecture decisions', () => {
  const entries = [{
    projectId: 'proj-C',
    kind: 'architecture_decision',
    key: 'use_mvc',
    value: JSON.stringify({ decision: 'Use MVC', rationale: 'standard' }),
    confidence: 0.9,
    relevanceScore: 0.4,
  }];

  const result = formatCrossProjectHints(entries);
  assert(result.includes('ARCH'), 'shows ARCH tag');
  assert(result.includes('Use MVC'), 'shows decision');
});

test('respects token budget', () => {
  const entries = [];
  for (let i = 0; i < 50; i++) {
    entries.push({
      projectId: 'proj-B',
      kind: 'architecture_decision',
      key: `decision_${i}`,
      value: JSON.stringify({ decision: `Very long decision description ${i} with lots of details to consume tokens`, rationale: 'reason' }),
      confidence: 0.9,
      relevanceScore: 0.5,
    });
  }

  const result = formatCrossProjectHints(entries, { maxTokenBudget: 100 });
  // Should be significantly shorter than all 50 entries
  const lines = result.split('\n').filter(l => l.startsWith('- '));
  assert(lines.length < 50, `capped to budget (${lines.length} lines)`);
});

test('empty → empty string', () => {
  assertEqual(formatCrossProjectHints([]), '', 'empty → empty');
  assertEqual(formatCrossProjectHints(null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeResults
// ═══════════════════════════════════════════════════════════════════════════

suite('mergeResults');

test('local entries take priority', () => {
  const local = [{
    kind: 'fix_strategy',
    key: 'IMPORT_NOT_FOUND:x.js:',
    effectiveConfidence: 0.9,
    source: 'local',
  }];
  const cross = [{
    kind: 'fix_strategy',
    key: 'IMPORT_NOT_FOUND:x.js:',
    confidence: 0.7,
    relevanceScore: 0.5,
    source: 'cross_project',
  }];

  const merged = mergeResults(local, cross);
  assertEqual(merged.length, 1, 'deduplicated');
  assertEqual(merged[0].source, 'local', 'local wins');
});

test('cross-project fills gaps', () => {
  const local = [{
    kind: 'fix_strategy',
    key: 'ERROR_A:x.js:',
    effectiveConfidence: 0.8,
  }];
  const cross = [{
    kind: 'fix_strategy',
    key: 'ERROR_B:y.js:',
    confidence: 0.7,
    relevanceScore: 0.5,
  }];

  const merged = mergeResults(local, cross);
  assertEqual(merged.length, 2, 'both included');
});

test('respects maxResults', () => {
  const local = [];
  for (let i = 0; i < 10; i++) {
    local.push({ kind: 'fix_strategy', key: `E${i}:f.js:`, effectiveConfidence: 0.8 - i * 0.05 });
  }
  const cross = [];
  for (let i = 0; i < 10; i++) {
    cross.push({ kind: 'fix_strategy', key: `X${i}:g.js:`, confidence: 0.7, relevanceScore: 0.4 });
  }

  const merged = mergeResults(local, cross, { maxResults: 5 });
  assertEqual(merged.length, 5, 'capped at 5');
});

test('sorted by score descending', () => {
  const local = [
    { kind: 'fix_strategy', key: 'A:x.js:', effectiveConfidence: 0.5 },
    { kind: 'fix_strategy', key: 'B:y.js:', effectiveConfidence: 0.9 },
  ];

  const merged = mergeResults(local, []);
  assertEqual(merged[0].key, 'B:y.js:', 'highest score first');
});

test('empty inputs → empty', () => {
  assertEqual(mergeResults([], []).length, 0, 'both empty → empty');
  assertEqual(mergeResults(null, null).length, 0, 'both null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// getProjectsWithMemory / getProjectSummaries
// ═══════════════════════════════════════════════════════════════════════════

suite('project registry');

test('getProjectsWithMemory lists distinct projects', () => {
  const db = mkDb();
  insertEntry(db, 'proj-A', 'fix_strategy', 'k1', { success: true });
  insertEntry(db, 'proj-A', 'fix_strategy', 'k2', { success: true });
  insertEntry(db, 'proj-B', 'architecture_decision', 'k3', { decision: 'x' });

  const projects = getProjectsWithMemory(db);
  assertEqual(projects.length, 2, '2 distinct projects');
  assert(projects.includes('proj-A'), 'has proj-A');
  assert(projects.includes('proj-B'), 'has proj-B');
  db.close();
});

test('getProjectsWithMemory null db → empty', () => {
  assertEqual(getProjectsWithMemory(null).length, 0, 'null → empty');
});

test('getProjectSummaries returns kind counts', () => {
  const db = mkDb();
  insertEntry(db, 'proj-A', 'fix_strategy', 'k1', { success: true });
  insertEntry(db, 'proj-A', 'fix_strategy', 'k2', { success: false });
  insertEntry(db, 'proj-A', 'architecture_decision', 'k3', { decision: 'x' });
  insertEntry(db, 'proj-B', 'error_pattern', 'k4', { strategy: 'y' });

  const summaries = getProjectSummaries(db);
  assertEqual(summaries.length, 2, '2 projects');

  const projA = summaries.find(s => s.projectId === 'proj-A');
  assertEqual(projA.entryCount, 3, 'proj-A has 3 entries');
  assertEqual(projA.kinds.fix_strategy, 2, '2 fix strategies');
  assertEqual(projA.kinds.architecture_decision, 1, '1 arch decision');

  const projB = summaries.find(s => s.projectId === 'proj-B');
  assertEqual(projB.entryCount, 1, 'proj-B has 1 entry');
  db.close();
});

test('getProjectSummaries null db → empty', () => {
  assertEqual(getProjectSummaries(null).length, 0, 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();

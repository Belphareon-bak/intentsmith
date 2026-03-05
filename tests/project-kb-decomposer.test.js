// tests/project-kb-decomposer.test.js — Project KB + Milestone Decomposer v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  buildProjectSnapshot,
  updateSnapshot,
  getOrCreateSnapshot,
  formatSnapshotForPrompt,
  diffSnapshots,
} from '../src/planner/project-knowledge-base.js';
import {
  shouldDecompose,
  decomposeMilestone,
  executeSubtasks,
} from '../src/planner/milestone-decomposer.js';

// ─── Project KB — Snapshot ──────────────────────────────────────────────────

suite('Project KB — Snapshot');

await testAsync('builds snapshot from files', async () => {
  const snapshot = await buildProjectSnapshot('/tmp/test-project', {
    files: [
      { file: 'src/controllers/user.js', content: 'app.get("/users", handler);' },
      { file: 'src/services/userService.js', content: 'function getUser() {}' },
      { file: 'src/models/user.js', content: 'class User {}' },
    ],
  });
  assert(snapshot, 'should return snapshot');
  assert(snapshot.timestamp, 'should have timestamp');
  assertEqual(snapshot.version, 1);
  assert(Object.keys(snapshot.moduleMap).length > 0, 'should have module map');
});

await testAsync('builds module map from files', async () => {
  const snapshot = await buildProjectSnapshot('/tmp/test-project', {
    files: [
      { file: 'src/auth/login.js', content: '' },
      { file: 'src/auth/register.js', content: '' },
      { file: 'src/api/users.js', content: '' },
    ],
  });
  assert(snapshot.moduleMap['src/auth'], 'should have src/auth module');
  assertEqual(snapshot.moduleMap['src/auth'].length, 2);
});

await testAsync('returns null for no project path', async () => {
  const snapshot = await buildProjectSnapshot(null);
  assertEqual(snapshot, null);
});

// ─── Project KB — Incremental Update ────────────────────────────────────────

suite('Project KB — Incremental Update');

await testAsync('updates snapshot incrementally', async () => {
  const original = await buildProjectSnapshot('/tmp/test-project', {
    files: [{ file: 'src/api/users.js', content: '' }],
  });
  const updated = await updateSnapshot('/tmp/test-project', ['src/api/new-endpoint.js'], original);

  assert(updated.version > original.version, 'version should increment');
  assert(updated.moduleMap['src/api'].includes('src/api/new-endpoint.js'),
    'should include new file');
});

await testAsync('returns existing snapshot when no changes', async () => {
  const original = { version: 1, moduleMap: {}, timestamp: 'old' };
  const result = await updateSnapshot('/tmp', [], original);
  assertEqual(result.version, 1); // no increment
});

await testAsync('falls back to full build when no existing snapshot', async () => {
  const result = await updateSnapshot('/tmp', ['src/a.js'], null);
  assert(result, 'should return snapshot');
  assertEqual(result.version, 1);
});

// ─── Project KB — Format for Prompt ─────────────────────────────────────────

suite('Project KB — Format');

test('formats snapshot with modules', () => {
  const snapshot = {
    moduleMap: {
      'src/auth': ['src/auth/login.js', 'src/auth/register.js'],
      'src/api': ['src/api/users.js'],
    },
    hotspots: [{ file: 'src/auth/login.js', changes: 15 }],
    conventions: [{ patternName: 'controller', frequency: 5 }],
  };
  const result = formatSnapshotForPrompt(snapshot, 5000);
  assert(result.includes('src/auth'), 'should mention modules');
  assert(result.includes('Hotspots'), 'should include hotspots');
  assert(result.includes('controller'), 'should include conventions');
});

test('respects token budget', () => {
  const snapshot = {
    moduleMap: Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`mod${i}`, [`f${i}.js`]])
    ),
    hotspots: [],
    conventions: [],
  };
  const result = formatSnapshotForPrompt(snapshot, 100); // very small budget
  // Should be shorter than unlimited
  const unlimited = formatSnapshotForPrompt(snapshot, 100000);
  assert(result.length <= unlimited.length, 'should respect budget');
});

test('handles null snapshot', () => {
  assertEqual(formatSnapshotForPrompt(null), '');
});

// ─── Project KB — Diff ──────────────────────────────────────────────────────

suite('Project KB — Diff');

test('detects new modules', () => {
  const before = { moduleMap: { 'src/a': ['a.js'] } };
  const after = { moduleMap: { 'src/a': ['a.js'], 'src/b': ['b.js'] } };
  const diff = diffSnapshots(before, after);
  assert(diff.newModules.includes('src/b'), 'should detect new module');
});

test('detects removed modules', () => {
  const before = { moduleMap: { 'src/a': ['a.js'], 'src/b': ['b.js'] } };
  const after = { moduleMap: { 'src/a': ['a.js'] } };
  const diff = diffSnapshots(before, after);
  assert(diff.removedModules.includes('src/b'), 'should detect removed module');
});

test('detects changed modules', () => {
  const before = { moduleMap: { 'src/a': ['a.js'] } };
  const after = { moduleMap: { 'src/a': ['a.js', 'a2.js'] } };
  const diff = diffSnapshots(before, after);
  assert(diff.changedModules.includes('src/a'), 'should detect changed module');
});

test('handles null snapshots', () => {
  const diff = diffSnapshots(null, null);
  assertEqual(diff.newModules.length, 0);
});

// ─── Milestone Decomposer — shouldDecompose ─────────────────────────────────

suite('Milestone Decomposer — shouldDecompose');

test('small milestone → false', () => {
  assertEqual(shouldDecompose({ estimated_loc: 500, estimated_files: 3 }), false);
});

test('large LOC → true', () => {
  assertEqual(shouldDecompose({ estimated_loc: 2000 }), true);
});

test('many files → true', () => {
  assertEqual(shouldDecompose({ estimated_files: 12 }), true);
});

test('high complexity + medium size → true', () => {
  assertEqual(shouldDecompose({
    estimated_loc: 1000,
    estimated_complexity: 'HIGH',
  }), true);
});

test('many scope_files → true', () => {
  const scopeFiles = Array.from({ length: 10 }, (_, i) => `src/f${i}.js`);
  assertEqual(shouldDecompose({ scope_files: JSON.stringify(scopeFiles) }), true);
});

test('null milestone → false', () => {
  assertEqual(shouldDecompose(null), false);
});

// ─── Milestone Decomposer — decomposeMilestone ─────────────────────────────

suite('Milestone Decomposer — decomposeMilestone');

test('decomposes into subtasks by module', () => {
  const milestone = {
    id: 'ms-1',
    title: 'Build API',
    estimated_loc: 2000,
    scope_files: JSON.stringify([
      'src/controllers/user.js',
      'src/controllers/auth.js',
      'src/services/userService.js',
      'src/services/authService.js',
      'src/models/user.js',
      'src/models/auth.js',
    ]),
  };

  const result = decomposeMilestone(milestone);
  assert(result.subtasks.length >= 2, `should have >= 2 subtasks, got ${result.subtasks.length}`);
  assert(result.executionOrder.length > 0, 'should have execution order');
  assertEqual(result.originalMilestone, 'ms-1');
});

test('subtasks have unique IDs', () => {
  const milestone = {
    id: 'ms-2',
    title: 'Test',
    estimated_loc: 1600,
    scope_files: JSON.stringify([
      'src/a/x.js', 'src/a/y.js',
      'src/b/x.js', 'src/b/y.js',
    ]),
  };
  const result = decomposeMilestone(milestone);
  const ids = result.subtasks.map(s => s.id);
  assertEqual(new Set(ids).size, ids.length);
});

test('handles null milestone', () => {
  const result = decomposeMilestone(null);
  assertEqual(result.subtasks.length, 0);
});

// ─── Milestone Decomposer — executeSubtasks ─────────────────────────────────

suite('Milestone Decomposer — executeSubtasks');

await testAsync('executes subtasks sequentially', async () => {
  const plan = {
    subtasks: [
      { id: 'sub1', title: 'A', dependencies: [] },
      { id: 'sub2', title: 'B', dependencies: ['sub1'] },
    ],
    executionOrder: ['sub1', 'sub2'],
  };
  const log = [];
  const result = await executeSubtasks(plan, async (subtask) => {
    log.push(subtask.id);
    return { success: true };
  });
  assertEqual(result.completed.length, 2);
  assertEqual(result.failed, null);
  assertEqual(log[0], 'sub1');
  assertEqual(log[1], 'sub2');
});

await testAsync('stops on failure', async () => {
  const plan = {
    subtasks: [
      { id: 'sub1', title: 'A', dependencies: [] },
      { id: 'sub2', title: 'B', dependencies: [] },
      { id: 'sub3', title: 'C', dependencies: [] },
    ],
    executionOrder: ['sub1', 'sub2', 'sub3'],
  };
  const result = await executeSubtasks(plan, async (subtask) => {
    if (subtask.id === 'sub2') return { success: false, error: 'build failed' };
    return { success: true };
  });
  assertEqual(result.completed.length, 1);
  assertEqual(result.failed, 'sub2');
});

await testAsync('handles null plan', async () => {
  const result = await executeSubtasks(null, async () => ({ success: true }));
  assertEqual(result.completed.length, 0);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();

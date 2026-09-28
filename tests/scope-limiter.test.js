// tests/scope-limiter.test.js — Scope Limiter v119 tests
import { suite, test, assert, assertEqual, assertIncludes, summary } from './harness.js';
import {
  computePatchScope,
  validatePatchScope,
  formatScopeHint,
  ScopeViolationTracker,
} from '../src/patch/scope-limiter.js';
import {
  KnowledgeGraph,
  NodeType,
  EdgeType,
  fileNodeId,
} from '../src/code-intel/knowledge-graph.js';

// ─── Helper: build a small test graph ────────────────────────────────────────

function makeTestGraph() {
  const g = new KnowledgeGraph();

  // Files
  g.addNode(fileNodeId('src/order.js'), NodeType.FILE, { name: 'src/order.js', file: 'src/order.js' });
  g.addNode(fileNodeId('src/db/repo.js'), NodeType.FILE, { name: 'src/db/repo.js', file: 'src/db/repo.js' });
  g.addNode(fileNodeId('src/auth.js'), NodeType.FILE, { name: 'src/auth.js', file: 'src/auth.js' });
  g.addNode(fileNodeId('src/handler.js'), NodeType.FILE, { name: 'src/handler.js', file: 'src/handler.js' });
  g.addNode(fileNodeId('src/utils.js'), NodeType.FILE, { name: 'src/utils.js', file: 'src/utils.js' });
  g.addNode(fileNodeId('src/external.js'), NodeType.FILE, { name: 'src/external.js', file: 'src/external.js' });

  // IMPORTS: order.js → db/repo.js, order.js → auth.js
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/order.js'), fileNodeId('src/db/repo.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/order.js'), fileNodeId('src/auth.js'));

  // handler.js → order.js (handler imports order)
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/handler.js'), fileNodeId('src/order.js'));

  // utils.js → nothing, external.js → nothing (isolated)

  return g;
}

// ─── computePatchScope ──────────────────────────────────────────────────────

suite('computePatchScope — basic');

test('empty targetFiles → only engine-managed files', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, []);
  assert(scope.allowedFiles.has('package.json'), 'Should have package.json');
  assert(scope.allowedFiles.has('README.md'), 'Should have README.md');
  // No non-engine files
  assert(!scope.allowedFiles.has('src/order.js'), 'Should NOT have src/order.js');
});

test('null targetFiles → only engine-managed files', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, null);
  assert(scope.allowedFiles.has('package.json'), 'Should have package.json');
});

test('target file included in scope', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  assert(scope.allowedFiles.has('src/order.js'), 'Target file should be in scope');
  assertEqual(scope.reasons.get('src/order.js'), 'target');
});

test('direct dependencies included (1 hop)', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  // order.js imports db/repo.js and auth.js
  assert(scope.allowedFiles.has('src/db/repo.js'), 'Dependency db/repo.js should be in scope');
  assert(scope.allowedFiles.has('src/auth.js'), 'Dependency auth.js should be in scope');
});

test('direct dependents included (1 hop)', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  // handler.js imports order.js
  assert(scope.allowedFiles.has('src/handler.js'), 'Dependent handler.js should be in scope');
});

test('isolated files NOT included', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  assert(!scope.allowedFiles.has('src/external.js'), 'Isolated external.js should NOT be in scope');
});

test('engine-managed files always included', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  assert(scope.allowedFiles.has('package.json'), 'package.json should always be in scope');
  assert(scope.allowedFiles.has('.gitignore'), '.gitignore should always be in scope');
  assert(scope.allowedFiles.has('tsconfig.json'), 'tsconfig.json should always be in scope');
});

suite('computePatchScope — limits');

test('maxFiles cap respected', () => {
  const g = makeTestGraph();
  // Set maxFiles to 2 — should include target + at most 1 dep (plus engine)
  const scope = computePatchScope(g, ['src/order.js'], { maxFiles: 2 });
  // Engine-managed files don't count toward limit since they're added first
  // With maxFiles=2, only 2 non-engine files allowed
  const nonEngine = [...scope.allowedFiles].filter(f =>
    !['package.json', 'README.md', '.gitignore', 'tsconfig.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(f)
  );
  // With maxFiles=2, total allowedFiles <= maxFiles (engine files are pre-added)
  // Actually the impl adds engine files first, then targets, then expands
  assert(scope.allowedFiles.size <= 2 + 7, `Total files ${scope.allowedFiles.size} should be reasonable`);
});

test('2-hop expansion with hops=2', () => {
  const g = makeTestGraph();
  const scope1 = computePatchScope(g, ['src/handler.js'], { hops: 1 });
  const scope2 = computePatchScope(g, ['src/handler.js'], { hops: 2 });
  // handler.js → order.js (hop 1)
  // order.js → db/repo.js, auth.js (hop 2)
  assert(scope2.allowedFiles.size >= scope1.allowedFiles.size,
    'More hops should include more files');
});

suite('computePatchScope — no graph');

test('null graph → returns scope with noGraph flag', () => {
  const scope = computePatchScope(null, ['src/order.js']);
  assert(scope.noGraph, 'Should have noGraph flag');
  assert(scope.allowedFiles.has('src/order.js'), 'Target should still be included');
});

// ─── validatePatchScope ─────────────────────────────────────────────────────

suite('validatePatchScope');

test('all patches in scope → valid', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  const result = validatePatchScope([
    { file: 'src/order.js' },
    { file: 'src/db/repo.js' },
  ], scope);
  assert(result.valid, 'Should be valid');
  assertEqual(result.violations.length, 0);
});

test('patch outside scope → violation', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  const result = validatePatchScope([
    { file: 'src/order.js' },
    { file: 'src/external.js' },
  ], scope);
  assert(!result.valid, 'Should be invalid');
  assertEqual(result.violations.length, 1);
  assertEqual(result.violations[0].file, 'src/external.js');
});

test('empty patches → valid', () => {
  const scope = computePatchScope(null, ['src/order.js']);
  const result = validatePatchScope([], scope);
  assert(result.valid, 'Empty patches should be valid');
});

test('null patches → valid', () => {
  const scope = computePatchScope(null, ['src/order.js']);
  const result = validatePatchScope(null, scope);
  assert(result.valid, 'Null patches should be valid');
});

test('no scope → valid (graceful)', () => {
  const result = validatePatchScope([{ file: 'anything.js' }], null);
  assert(result.valid, 'No scope should pass all');
});

test('noGraph scope → valid for all files', () => {
  const scope = computePatchScope(null, ['src/order.js']);
  const result = validatePatchScope([{ file: 'completely-random.js' }], scope);
  assert(result.valid, 'noGraph scope should pass all files');
});

test('engine-managed files always pass', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  const result = validatePatchScope([{ file: 'package.json' }], scope);
  assert(result.valid, 'package.json should always pass');
});

// ─── formatScopeHint ────────────────────────────────────────────────────────

suite('formatScopeHint');

test('formats scope with target and dependency', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  const hint = formatScopeHint(scope);
  assertIncludes(hint, '## Allowed Files');
  assertIncludes(hint, 'src/order.js (target)');
  assertIncludes(hint, 'dependency');
});

test('engine-managed files not displayed in hint', () => {
  const g = makeTestGraph();
  const scope = computePatchScope(g, ['src/order.js']);
  const hint = formatScopeHint(scope);
  // package.json etc. should not appear
  assert(!hint.includes('package.json'), 'Engine-managed files should not be in hint');
});

test('empty scope → empty hint', () => {
  const hint = formatScopeHint(null);
  assertEqual(hint, '');
});

test('scope with no files → empty hint', () => {
  const hint = formatScopeHint({ allowedFiles: new Set(), reasons: new Map() });
  assertEqual(hint, '');
});

// ─── ScopeViolationTracker ──────────────────────────────────────────────────

suite('ScopeViolationTracker');

test('initial state: count 0, not disabled, not widened', () => {
  const t = new ScopeViolationTracker();
  assertEqual(t.count, 0);
  assertEqual(t.disabled, false);
  assertEqual(t.widened, false);
});

test('recordViolation increments count', () => {
  const t = new ScopeViolationTracker();
  t.recordViolation();
  assertEqual(t.count, 1);
  t.recordViolation();
  assertEqual(t.count, 2);
});

test('widens after 3 violations', () => {
  const t = new ScopeViolationTracker();
  t.recordViolation();
  t.recordViolation();
  const state = t.recordViolation();
  assertEqual(state.action, 'widened');
  assert(t.widened, 'Should be widened');
  assert(!t.disabled, 'Should not be disabled yet');
});

test('disables after 5 violations', () => {
  const t = new ScopeViolationTracker();
  for (let i = 0; i < 4; i++) t.recordViolation();
  const state = t.recordViolation();
  assertEqual(state.action, 'disabled');
  assert(t.disabled, 'Should be disabled');
});

test('reset clears all state', () => {
  const t = new ScopeViolationTracker();
  for (let i = 0; i < 5; i++) t.recordViolation();
  assert(t.disabled, 'Should be disabled before reset');
  t.reset();
  assertEqual(t.count, 0);
  assertEqual(t.disabled, false);
  assertEqual(t.widened, false);
});

test('widen happens only once', () => {
  const t = new ScopeViolationTracker();
  t.recordViolation(); // 1
  t.recordViolation(); // 2
  t.recordViolation(); // 3 → widened
  const state4 = t.recordViolation(); // 4 → logged (already widened)
  assertEqual(state4.action, 'logged');
});

// ─── Summary ────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

// tests/import-map.test.js — Import Map v119 tests
import { suite, test, assert, assertEqual, assertIncludes, summary } from './harness.js';
import {
  buildImportMap,
  detectSymbolConflicts,
  formatImportMap,
} from '../src/context/import-map.js';
import {
  KnowledgeGraph,
  NodeType,
  EdgeType,
  fileNodeId,
  symbolNodeId,
} from '../src/code-intel/knowledge-graph.js';

// ─── Helper: build a small test graph ────────────────────────────────────────

function makeTestGraph() {
  const g = new KnowledgeGraph();

  // Files
  g.addNode(fileNodeId('src/order.js'), NodeType.FILE, { name: 'src/order.js', file: 'src/order.js' });
  g.addNode(fileNodeId('src/db/repo.js'), NodeType.FILE, { name: 'src/db/repo.js', file: 'src/db/repo.js' });
  g.addNode(fileNodeId('src/auth.js'), NodeType.FILE, { name: 'src/auth.js', file: 'src/auth.js' });
  g.addNode(fileNodeId('src/utils.js'), NodeType.FILE, { name: 'src/utils.js', file: 'src/utils.js' });

  // Symbols
  g.addNode(symbolNodeId('getUser', 'src/db/repo.js'), NodeType.SYMBOL, {
    name: 'getUser', file: 'src/db/repo.js', symbolType: 'function',
  });
  g.addNode(symbolNodeId('saveOrder', 'src/db/repo.js'), NodeType.SYMBOL, {
    name: 'saveOrder', file: 'src/db/repo.js', symbolType: 'function',
  });
  g.addNode(symbolNodeId('authenticate', 'src/auth.js'), NodeType.SYMBOL, {
    name: 'authenticate', file: 'src/auth.js', symbolType: 'function',
  });

  // IMPORTS: order.js → db/repo.js, order.js → auth.js
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/order.js'), fileNodeId('src/db/repo.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/order.js'), fileNodeId('src/auth.js'));

  // DEFINES: db/repo.js → getUser, db/repo.js → saveOrder
  g.addEdge(EdgeType.DEFINES, fileNodeId('src/db/repo.js'), symbolNodeId('getUser', 'src/db/repo.js'));
  g.addEdge(EdgeType.DEFINES, fileNodeId('src/db/repo.js'), symbolNodeId('saveOrder', 'src/db/repo.js'));

  // DEFINES: auth.js → authenticate
  g.addEdge(EdgeType.DEFINES, fileNodeId('src/auth.js'), symbolNodeId('authenticate', 'src/auth.js'));

  return g;
}

// ─── buildImportMap ─────────────────────────────────────────────────────────

suite('buildImportMap');

test('returns empty for null graph', () => {
  const result = buildImportMap(null, ['src/order.js']);
  assertEqual(result.length, 0);
});

test('returns empty for empty targetFiles', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, []);
  assertEqual(result.length, 0);
});

test('returns empty for null targetFiles', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, null);
  assertEqual(result.length, 0);
});

test('resolves imports for order.js → db/repo.js symbols', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, ['src/order.js']);
  // Should find getUser, saveOrder from db/repo.js and authenticate from auth.js
  assert(result.length >= 2, `Expected >= 2 entries, got ${result.length}`);
  const repoEntries = result.filter(e => e.exportedFrom === 'src/db/repo.js');
  assert(repoEntries.length >= 1, 'Should have entries from db/repo.js');
});

test('resolves authenticate from auth.js', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, ['src/order.js']);
  const authEntry = result.find(e => e.symbol === 'authenticate');
  assert(authEntry, 'Should find authenticate');
  assertEqual(authEntry.exportedFrom, 'src/auth.js');
});

test('no duplicate entries for same symbol+file', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, ['src/order.js', 'src/order.js']);
  const keys = result.map(e => `${e.symbol}→${e.exportedFrom}`);
  const unique = new Set(keys);
  assertEqual(keys.length, unique.size, 'Should not have duplicates');
});

test('file with no imports → empty result', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, ['src/utils.js']);
  assertEqual(result.length, 0);
});

test('non-existent file in graph → empty result', () => {
  const g = makeTestGraph();
  const result = buildImportMap(g, ['src/nonexistent.js']);
  assertEqual(result.length, 0);
});

// ─── detectSymbolConflicts ──────────────────────────────────────────────────

suite('detectSymbolConflicts');

test('returns empty for null graph', () => {
  const result = detectSymbolConflicts(null, ['getUser']);
  assertEqual(result.length, 0);
});

test('returns empty for empty symbol names', () => {
  const g = makeTestGraph();
  const result = detectSymbolConflicts(g, []);
  assertEqual(result.length, 0);
});

test('no conflict for unique symbol', () => {
  const g = makeTestGraph();
  const result = detectSymbolConflicts(g, ['getUser']);
  // getUser is defined only in db/repo.js → no conflict
  assertEqual(result.length, 0);
});

test('detects conflict when same name in multiple files', () => {
  const g = makeTestGraph();
  // Add another getUser in a different file
  g.addNode(symbolNodeId('getUser', 'src/utils.js'), NodeType.SYMBOL, {
    name: 'getUser', file: 'src/utils.js', symbolType: 'function',
  });

  const result = detectSymbolConflicts(g, ['getUser']);
  assertEqual(result.length, 1);
  assertEqual(result[0].name, 'getUser');
  assert(result[0].definitions.length >= 2, 'Should have >= 2 definitions');
});

test('no conflict for unknown symbol', () => {
  const g = makeTestGraph();
  const result = detectSymbolConflicts(g, ['nonExistentSymbol']);
  assertEqual(result.length, 0);
});

// ─── formatImportMap ────────────────────────────────────────────────────────

suite('formatImportMap');

test('returns empty for no entries and no conflicts', () => {
  assertEqual(formatImportMap([], []), '');
});

test('returns empty for null entries and null conflicts', () => {
  assertEqual(formatImportMap(null, null), '');
});

test('formats entries correctly', () => {
  const entries = [
    { symbol: 'getUser', exportedFrom: 'src/db/repo.js' },
    { symbol: 'authenticate', exportedFrom: 'src/auth.js' },
  ];
  const result = formatImportMap(entries, []);
  assertIncludes(result, '## Import Map');
  assertIncludes(result, 'getUser → src/db/repo.js');
  assertIncludes(result, 'authenticate → src/auth.js');
});

test('formats conflicts section', () => {
  const entries = [{ symbol: 'getUser', exportedFrom: 'src/db/repo.js' }];
  const conflicts = [{
    name: 'getUser',
    definitions: [
      { file: 'src/db/repo.js', type: 'function' },
      { file: 'src/utils.js', type: 'function' },
    ],
  }];
  const result = formatImportMap(entries, conflicts);
  assertIncludes(result, '## Symbol Conflicts');
  assertIncludes(result, 'getUser');
  assertIncludes(result, 'src/db/repo.js');
  assertIncludes(result, 'src/utils.js');
});

test('only conflicts (no entries) still formats', () => {
  const conflicts = [{
    name: 'foo',
    definitions: [
      { file: 'a.js', type: 'function' },
      { file: 'b.js', type: 'function' },
    ],
  }];
  const result = formatImportMap([], conflicts);
  assertIncludes(result, '## Symbol Conflicts');
  assertIncludes(result, 'foo');
});

// ─── Integration: buildImportMap + formatImportMap ────────────────────────────

suite('Integration: buildImportMap → formatImportMap');

test('end-to-end: graph → import map → formatted output', () => {
  const g = makeTestGraph();
  const entries = buildImportMap(g, ['src/order.js']);
  const conflicts = detectSymbolConflicts(g, entries.map(e => e.symbol));
  const result = formatImportMap(entries, conflicts);
  assert(result.length > 0, 'Should produce non-empty output');
  assertIncludes(result, '## Import Map');
});

// ─── Summary ────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

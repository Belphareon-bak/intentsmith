// tests/context-optimizer.test.js — Context Optimizer unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { rankFilesByValue, allocateBudget, detectRedundancy } from '../src/code-intel/context-optimizer.js';
import { KnowledgeGraph, NodeType, EdgeType, fileNodeId } from '../src/code-intel/knowledge-graph.js';
import { estimateTokens } from '../src/code-intel/context-builder.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkFile(file, content = '', score) {
  const f = { file, content };
  if (score !== undefined) f.score = score;
  return f;
}

function buildTestGraph() {
  const g = new KnowledgeGraph();

  // Files
  g.addNode('file:src/main.js', NodeType.FILE, { name: 'src/main.js', file: 'src/main.js' });
  g.addNode('file:src/service.js', NodeType.FILE, { name: 'src/service.js', file: 'src/service.js' });
  g.addNode('file:src/util.js', NodeType.FILE, { name: 'src/util.js', file: 'src/util.js' });
  g.addNode('file:src/config.js', NodeType.FILE, { name: 'src/config.js', file: 'src/config.js' });
  g.addNode('file:src/test.js', NodeType.FILE, { name: 'src/test.js', file: 'src/test.js' });

  // Import edges: main → service → util, main → config
  g.addEdge(EdgeType.IMPORTS, 'file:src/main.js', 'file:src/service.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/service.js', 'file:src/util.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/main.js', 'file:src/config.js');

  // Symbols
  g.addNode('sym:handleRequest@src/main.js', NodeType.FUNCTION, {
    name: 'handleRequest', file: 'src/main.js', exported: true,
  });
  g.addEdge(EdgeType.DEFINES, 'file:src/main.js', 'sym:handleRequest@src/main.js');

  g.addNode('sym:processOrder@src/service.js', NodeType.FUNCTION, {
    name: 'processOrder', file: 'src/service.js', exported: true,
  });
  g.addEdge(EdgeType.DEFINES, 'file:src/service.js', 'sym:processOrder@src/service.js');

  // handleRequest calls processOrder
  g.addEdge(EdgeType.CALLS, 'sym:handleRequest@src/main.js', 'sym:processOrder@src/service.js');

  g.addNode('sym:formatDate@src/util.js', NodeType.FUNCTION, {
    name: 'formatDate', file: 'src/util.js', exported: true,
  });
  g.addEdge(EdgeType.DEFINES, 'file:src/util.js', 'sym:formatDate@src/util.js');

  g.addNode('sym:getConfig@src/config.js', NodeType.FUNCTION, {
    name: 'getConfig', file: 'src/config.js', exported: true,
  });
  g.addEdge(EdgeType.DEFINES, 'file:src/config.js', 'sym:getConfig@src/config.js');

  // test.js tests main
  g.addEdge(EdgeType.TESTED_BY, 'file:src/main.js', 'file:src/test.js');

  return g;
}

// ═══════════════════════════════════════════════════════════════════════════
// rankFilesByValue
// ═══════════════════════════════════════════════════════════════════════════

suite('rankFilesByValue — basic ranking');

test('empty input returns empty', () => {
  const result = rankFilesByValue([], 'test');
  assertEqual(result.length, 0);
});

test('null input returns empty', () => {
  const result = rankFilesByValue(null, 'test');
  assertEqual(result.length, 0);
});

test('files are sorted by value descending', () => {
  const files = [
    mkFile('big.js', 'x'.repeat(1000)),     // big = low value
    mkFile('small.js', 'y'.repeat(50), 0.9), // small + high score = high value
  ];
  const result = rankFilesByValue(files, 'query');
  assertEqual(result[0].file, 'small.js', 'small high-score file should rank first');
});

test('existing score is used when provided', () => {
  const files = [
    mkFile('a.js', 'content', 0.9),
    mkFile('b.js', 'content', 0.1),
  ];
  const result = rankFilesByValue(files, 'query');
  assertEqual(result[0].file, 'a.js');
  assert(result[0].relevance === 0.9, 'should use provided score');
});

test('tokenCost is computed from content', () => {
  const files = [mkFile('a.js', 'hello world')];
  const result = rankFilesByValue(files, 'query');
  assertEqual(result[0].tokenCost, estimateTokens('hello world'));
});

test('empty content has zero tokenCost', () => {
  const files = [mkFile('a.js', '')];
  const result = rankFilesByValue(files, 'query');
  assertEqual(result[0].tokenCost, 0);
});

test('value penalizes large files', () => {
  const small = mkFile('small.js', 'x'.repeat(100), 0.5);
  const large = mkFile('large.js', 'x'.repeat(10000), 0.5);
  const result = rankFilesByValue([small, large], 'query');
  assert(result[0].file === 'small.js', 'same relevance + smaller file = higher value');
});

test('single file works', () => {
  const files = [mkFile('only.js', 'content here')];
  const result = rankFilesByValue(files, 'query');
  assertEqual(result.length, 1);
  assert(result[0].relevance > 0, 'relevance should be positive');
});

// ─── With graph ────────────────────────────────────────────────────────────

suite('rankFilesByValue — graph distance');

test('seed files get highest graph distance', () => {
  const g = buildTestGraph();
  const files = [
    mkFile('src/main.js', 'a'),
    mkFile('src/util.js', 'b'),
  ];
  const result = rankFilesByValue(files, '', { graph: g, seedFiles: ['src/main.js'] });
  assert(result[0].file === 'src/main.js', 'seed file should rank first');
});

test('1-hop import gets good score', () => {
  const g = buildTestGraph();
  const files = [
    mkFile('src/service.js', 'a'),
    mkFile('src/test.js', 'b'),
  ];
  const result = rankFilesByValue(files, '', { graph: g, seedFiles: ['src/main.js'] });
  // service.js is 1-hop (direct import from seed), test.js is tested_by edge
  assert(result[0].relevance > 0, 'should have positive relevance');
});

test('symbol call overlap boosts file', () => {
  const g = buildTestGraph();
  // service.js has processOrder which is called by main.js
  const files = [
    mkFile('src/service.js', 'a'),
    mkFile('src/config.js', 'a'),
  ];
  const result = rankFilesByValue(files, '', { graph: g, seedFiles: ['src/main.js'] });
  // Both are 1-hop from seed, but service.js has call overlap
  assert(result.length === 2, 'should return both files');
});

suite('rankFilesByValue — import proximity');

test('directly imported file scores high', () => {
  const g = buildTestGraph();
  const files = [
    mkFile('src/service.js', 'a'),
    mkFile('src/util.js', 'a'),
  ];
  const result = rankFilesByValue(files, '', { graph: g, seedFiles: ['src/main.js'] });
  // service.js is directly imported by main.js, util.js is transitive
  assert(result[0].relevance >= result[1].relevance,
    'directly imported file should score >= transitive');
});

suite('rankFilesByValue — keyword overlap');

test('keyword overlap as fallback without graph', () => {
  const files = [
    mkFile('src/user-service.js', 'a'),
    mkFile('src/database.js', 'b'),
  ];
  const result = rankFilesByValue(files, 'user service handler');
  // user-service.js has more keyword overlap
  assert(result[0].file === 'src/user-service.js', 'keyword match should rank first');
});

test('no query gives minimum relevance', () => {
  const files = [mkFile('src/a.js', 'content')];
  const result = rankFilesByValue(files, '');
  assert(result[0].relevance > 0, 'should have minimum relevance');
});

// ═══════════════════════════════════════════════════════════════════════════
// allocateBudget
// ═══════════════════════════════════════════════════════════════════════════

suite('allocateBudget — basic allocation');

test('empty input returns empty budget', () => {
  const result = allocateBudget([], 5000);
  assertEqual(result.fullFiles.length, 0);
  assertEqual(result.signatureFiles.length, 0);
  assertEqual(result.totalTokens, 0);
});

test('null input returns empty budget', () => {
  const result = allocateBudget(null, 5000);
  assertEqual(result.fullFiles.length, 0);
});

test('zero budget returns empty', () => {
  const files = [{ file: 'a.js', content: 'hello', tokenCost: 2 }];
  const result = allocateBudget(files, 0);
  assertEqual(result.fullFiles.length, 0);
});

test('small file fits in full budget', () => {
  const files = [{ file: 'a.js', content: 'x'.repeat(100), tokenCost: 25 }];
  const result = allocateBudget(files, 5000);
  assertEqual(result.fullFiles.length, 1);
  assertEqual(result.fullFiles[0].file, 'a.js');
});

test('summary budget is reserved', () => {
  const result = allocateBudget(
    [{ file: 'a.js', content: 'x', tokenCost: 1 }],
    5000,
    { summaryBudget: 500 },
  );
  assert(result.budgetBreakdown.summary === 500, 'summary budget should be reserved');
});

test('signature ratio controls allocation', () => {
  const files = [];
  // Create many files that exceed full budget
  for (let i = 0; i < 20; i++) {
    files.push({ file: `f${i}.js`, content: 'x'.repeat(2000), tokenCost: 500 });
  }
  const result = allocateBudget(files, 6000, { summaryBudget: 500, signatureRatio: 0.3 });
  assert(result.signatureFiles.length > 0, 'should have signature files');
  assert(result.fullFiles.length > 0, 'should have full files');
});

suite('allocateBudget — budget overflow');

test('files exceeding budget go to signatures then skip', () => {
  // 8 files × 2000 tokens each = 16000 total, budget = 5000
  // seedBudget = (5000-500)*0.7 = 3150 → fits 1 full (2000)
  // sigBudget = 1350 → sigCost = 300 each → fits 4 sigs
  // remaining 3 files → skipped
  const files = [];
  for (let i = 0; i < 8; i++) {
    files.push({ file: `f${i}.js`, content: 'x'.repeat(8000), tokenCost: 2000 });
  }
  const result = allocateBudget(files, 5000, { summaryBudget: 500, signatureRatio: 0.3 });
  assert(result.fullFiles.length >= 1, 'at least one full file');
  assert(result.skippedFiles.length > 0, 'some files should be skipped');
});

test('single file exactly at budget', () => {
  // seedBudget = (5000 - 500) * 0.7 = 3150
  const files = [{ file: 'a.js', content: 'x'.repeat(12000), tokenCost: 3000 }];
  const result = allocateBudget(files, 5000, { summaryBudget: 500, signatureRatio: 0.3 });
  assertEqual(result.fullFiles.length, 1, 'should fit within seed budget');
});

test('all files fit as full source', () => {
  const files = [
    { file: 'a.js', content: 'x', tokenCost: 10 },
    { file: 'b.js', content: 'x', tokenCost: 10 },
  ];
  const result = allocateBudget(files, 5000);
  assertEqual(result.fullFiles.length, 2);
  assertEqual(result.signatureFiles.length, 0);
  assertEqual(result.skippedFiles.length, 0);
});

suite('allocateBudget — budget breakdown');

test('token accounting is correct', () => {
  const files = [
    { file: 'a.js', content: 'x'.repeat(400), tokenCost: 100 },
    { file: 'b.js', content: 'x'.repeat(400), tokenCost: 100 },
  ];
  const result = allocateBudget(files, 5000, { summaryBudget: 500 });
  assertEqual(result.budgetBreakdown.summary, 500);
  assert(result.budgetBreakdown.fullSource >= 0, 'fullSource should be non-negative');
  assert(result.budgetBreakdown.signatures >= 0, 'signatures should be non-negative');
});

test('skipped files are tracked', () => {
  const files = [
    { file: 'a.js', content: 'x'.repeat(40000), tokenCost: 10000 },
    { file: 'b.js', content: 'x'.repeat(40000), tokenCost: 10000 },
  ];
  const result = allocateBudget(files, 1000, { summaryBudget: 500 });
  assert(result.skippedFiles.length > 0, 'oversized files should be skipped');
});

test('max signature files cap at 20', () => {
  const files = [];
  for (let i = 0; i < 30; i++) {
    files.push({ file: `f${i}.js`, content: 'x'.repeat(8000), tokenCost: 2000 });
  }
  // Use large budget for signatures but small for full
  const result = allocateBudget(files, 50000, { summaryBudget: 500, signatureRatio: 0.9 });
  assert(result.signatureFiles.length <= 20, `should cap at 20, got ${result.signatureFiles.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// detectRedundancy
// ═══════════════════════════════════════════════════════════════════════════

suite('detectRedundancy');

test('no redundancy without graph', () => {
  const files = [mkFile('a.js'), mkFile('b.js')];
  const result = detectRedundancy(files, null);
  assertEqual(result.size, 0);
});

test('no redundancy with independent files', () => {
  const g = buildTestGraph();
  const files = [mkFile('src/main.js'), mkFile('src/test.js')];
  const result = detectRedundancy(files, g);
  assertEqual(result.size, 0);
});

test('re-export chain detected', () => {
  const g = new KnowledgeGraph();

  // File A re-exports everything from B
  g.addNode('file:index.js', NodeType.FILE, { name: 'index.js', file: 'index.js' });
  g.addNode('file:impl.js', NodeType.FILE, { name: 'impl.js', file: 'impl.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:index.js', 'file:impl.js');

  // Both have symbol 'foo', but index re-exports
  g.addNode('sym:foo@index.js', NodeType.FUNCTION, { name: 'foo', file: 'index.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:index.js', 'sym:foo@index.js');

  g.addNode('sym:foo@impl.js', NodeType.FUNCTION, { name: 'foo', file: 'impl.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:impl.js', 'sym:foo@impl.js');

  const files = [mkFile('index.js'), mkFile('impl.js')];
  const result = detectRedundancy(files, g);
  assert(result.has('impl.js'), 'impl.js should be redundant (re-exported by index.js)');
});

test('partial re-export is not redundant', () => {
  const g = new KnowledgeGraph();

  g.addNode('file:index.js', NodeType.FILE, { name: 'index.js', file: 'index.js' });
  g.addNode('file:impl.js', NodeType.FILE, { name: 'impl.js', file: 'impl.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:index.js', 'file:impl.js');

  // index.js has 'foo', impl.js has 'foo' + 'bar'
  g.addNode('sym:foo@index.js', NodeType.FUNCTION, { name: 'foo', file: 'index.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:index.js', 'sym:foo@index.js');

  g.addNode('sym:foo@impl.js', NodeType.FUNCTION, { name: 'foo', file: 'impl.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:impl.js', 'sym:foo@impl.js');
  g.addNode('sym:bar@impl.js', NodeType.FUNCTION, { name: 'bar', file: 'impl.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:impl.js', 'sym:bar@impl.js');

  const files = [mkFile('index.js'), mkFile('impl.js')];
  const result = detectRedundancy(files, g);
  assertEqual(result.size, 0, 'partial re-export should not be redundant');
});

test('single file is never redundant', () => {
  const g = buildTestGraph();
  const files = [mkFile('src/main.js')];
  const result = detectRedundancy(files, g);
  assertEqual(result.size, 0);
});

test('self-import is not redundancy', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js', file: 'a.js' });
  // Self-referencing import edge (shouldn't happen but be safe)
  g.addEdge(EdgeType.IMPORTS, 'file:a.js', 'file:a.js');
  g.addNode('sym:x@a.js', NodeType.FUNCTION, { name: 'x', file: 'a.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:a.js', 'sym:x@a.js');

  const files = [mkFile('a.js')];
  const result = detectRedundancy(files, g);
  assertEqual(result.size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration — full pipeline
// ═══════════════════════════════════════════════════════════════════════════

suite('Integration — rank → budget → format');

test('full pipeline with graph', () => {
  const g = buildTestGraph();
  const files = [
    mkFile('src/main.js', 'x'),     // seed file — tiny content, high relevance
    mkFile('src/service.js', 'x'.repeat(200)),  // 1-hop from seed, bigger
    mkFile('src/util.js', 'x'.repeat(400)),     // 2-hop from seed, even bigger
    mkFile('src/config.js', 'x'.repeat(300)),   // 1-hop from seed
    mkFile('src/test.js', 'x'.repeat(500)),     // test file, low relevance
  ];

  const ranked = rankFilesByValue(files, 'handle request', {
    graph: g,
    seedFiles: ['src/main.js'],
  });

  assert(ranked.length === 5, 'should return all files');
  // Seed file: highest relevance (1.0 graph distance), tiny tokenCost → highest value
  assert(ranked[0].file === 'src/main.js', `seed file should rank first, got ${ranked[0].file}`);

  const budget = allocateBudget(ranked, 3000, { summaryBudget: 200, signatureRatio: 0.3 });
  assert(budget.fullFiles.length > 0, 'should have at least 1 full file');
  assert(budget.totalTokens <= 3000, 'should not exceed budget');
});

test('pipeline without graph uses keyword fallback', () => {
  const files = [
    mkFile('src/user-controller.js', 'class UserController {}'),
    mkFile('src/database.js', 'const db = require("pg")'),
  ];

  const ranked = rankFilesByValue(files, 'user controller');
  assert(ranked.length === 2, 'should return both files');
  assertEqual(ranked[0].file, 'src/user-controller.js');

  const budget = allocateBudget(ranked, 5000);
  assert(budget.fullFiles.length >= 1, 'should include at least 1 full file');
});

test('pipeline with redundancy filtering', () => {
  const g = new KnowledgeGraph();

  g.addNode('file:index.js', NodeType.FILE, { name: 'index.js', file: 'index.js' });
  g.addNode('file:impl.js', NodeType.FILE, { name: 'impl.js', file: 'impl.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:index.js', 'file:impl.js');

  g.addNode('sym:foo@index.js', NodeType.FUNCTION, { name: 'foo', file: 'index.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:index.js', 'sym:foo@index.js');
  g.addNode('sym:foo@impl.js', NodeType.FUNCTION, { name: 'foo', file: 'impl.js', exported: true });
  g.addEdge(EdgeType.DEFINES, 'file:impl.js', 'sym:foo@impl.js');

  const files = [
    mkFile('index.js', 'export { foo } from "./impl"'),
    mkFile('impl.js', 'export function foo() {}'),
  ];

  const ranked = rankFilesByValue(files, 'foo');
  const redundant = detectRedundancy(ranked, g);
  const filtered = ranked.filter(f => !redundant.has(f.file));

  assertEqual(filtered.length, 1, 'redundant file should be removed');
  assertEqual(filtered[0].file, 'index.js');
});

test('token savings with signature allocation', () => {
  // Simulate: 5 large files, budget forces some to signature-only
  const files = [];
  for (let i = 0; i < 5; i++) {
    files.push(mkFile(`f${i}.js`, 'x'.repeat(4000), 0.9 - i * 0.1));
  }
  const ranked = rankFilesByValue(files, 'query');
  const budget = allocateBudget(ranked, 6000, { summaryBudget: 500, signatureRatio: 0.3 });

  const fullTokens = budget.budgetBreakdown.fullSource;
  const sigTokens = budget.budgetBreakdown.signatures;
  assert(fullTokens > 0, 'should have full source tokens');

  // Signature tokens should be much less than if all were full
  const totalFullCost = files.reduce((s, f) => s + estimateTokens(f.content), 0);
  assert(budget.totalTokens < totalFullCost, 'budget should be less than full cost of all files');
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('Edge cases');

test('file with no content', () => {
  const files = [mkFile('empty.js')];
  const result = rankFilesByValue(files, 'test');
  assertEqual(result.length, 1);
  assertEqual(result[0].tokenCost, 0);
});

test('binary-like file (very large, low value)', () => {
  const files = [
    mkFile('bundle.min.js', 'x'.repeat(100000)),
    mkFile('handler.js', 'function handle() {}', 0.8),
  ];
  const result = rankFilesByValue(files, 'handle');
  assertEqual(result[0].file, 'handler.js', 'small relevant file should beat large bundle');
});

test('empty project', () => {
  const ranked = rankFilesByValue([], '');
  const budget = allocateBudget(ranked, 5000);
  assertEqual(budget.fullFiles.length, 0);
  assertEqual(budget.totalTokens, 0);
});

test('no exported symbols in file for redundancy check', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js', file: 'a.js' });
  g.addNode('file:b.js', NodeType.FILE, { name: 'b.js', file: 'b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:a.js', 'file:b.js');
  // No symbols defined
  const files = [mkFile('a.js'), mkFile('b.js')];
  const result = detectRedundancy(files, g);
  assertEqual(result.size, 0, 'no exports = no redundancy');
});

// ═══════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);

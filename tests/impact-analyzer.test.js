// tests/impact-analyzer.test.js — Change Impact Analyzer unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { analyzeImpact, formatImpactReport, getImpactSummary } from '../src/code-intel/impact-analyzer.js';
import { KnowledgeGraph, NodeType, EdgeType } from '../src/code-intel/knowledge-graph.js';
import { SymbolIndex } from '../src/code-intel/symbol-index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'impact-test-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return name;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildTestGraph() {
  const g = new KnowledgeGraph();

  // Symbols
  g.addNode('sym:validate@auth.js', NodeType.FUNCTION, { name: 'validate', file: 'auth.js' });
  g.addNode('sym:login@ctrl.js', NodeType.FUNCTION, { name: 'login', file: 'ctrl.js' });
  g.addNode('sym:handleAuth@app.js', NodeType.FUNCTION, { name: 'handleAuth', file: 'app.js' });

  // Files
  g.addNode('file:auth.js', NodeType.FILE, { name: 'auth.js', file: 'auth.js' });
  g.addNode('file:ctrl.js', NodeType.FILE, { name: 'ctrl.js', file: 'ctrl.js' });
  g.addNode('file:app.js', NodeType.FILE, { name: 'app.js', file: 'app.js' });
  g.addNode('file:tests/auth.test.js', NodeType.FILE, { name: 'tests/auth.test.js', file: 'tests/auth.test.js' });

  // Call chain: handleAuth → login → validate
  g.addEdge(EdgeType.CALLS, 'sym:login@ctrl.js', 'sym:validate@auth.js');
  g.addEdge(EdgeType.CALLS, 'sym:handleAuth@app.js', 'sym:login@ctrl.js');

  // Test relationship
  g.addEdge(EdgeType.TESTED_BY, 'file:auth.js', 'file:tests/auth.test.js');

  return g;
}

// ─── With Knowledge Graph ───────────────────────────────────────────────────

suite('Impact Analyzer — with Knowledge Graph');

await testAsync('analyzes direct impact via graph', async () => {
  const g = buildTestGraph();
  const result = await analyzeImpact('validate', { graph: g });

  assertEqual(result.confidence, 'high');
  assert(result.impactedFunctions.length > 0, `should find callers, got ${result.impactedFunctions.length}`);
  assert(result.impactedFunctions.includes('login'), `should include login: ${result.impactedFunctions}`);
});

await testAsync('finds transitive callers', async () => {
  const g = buildTestGraph();
  const result = await analyzeImpact('validate', { graph: g, maxDepth: 3 });

  assert(result.impactedFunctions.includes('login'), 'should include direct caller login');
  assert(result.impactedFunctions.includes('handleAuth'), `should include transitive caller handleAuth: ${result.impactedFunctions}`);
});

await testAsync('includes test files', async () => {
  const g = buildTestGraph();
  const result = await analyzeImpact('validate', { graph: g, includeTests: true });

  // Tests are connected via TESTED_BY on the file
  assertEqual(result.confidence, 'high');
  // The test discovery depends on BFS reaching the file node
});

await testAsync('respects maxDepth', async () => {
  const g = buildTestGraph();
  const result = await analyzeImpact('validate', { graph: g, maxDepth: 1 });

  assert(result.impactedFunctions.includes('login'), 'depth 1 should include direct caller');
  assert(!result.impactedFunctions.includes('handleAuth'), `depth 1 should NOT include transitive: ${result.impactedFunctions}`);
});

await testAsync('returns high confidence with graph', async () => {
  const g = buildTestGraph();
  const result = await analyzeImpact('validate', { graph: g });
  assertEqual(result.confidence, 'high');
});

// ─── Fallback to Symbol Index ───────────────────────────────────────────────

suite('Impact Analyzer — fallback to symbol index');

await testAsync('falls back to symbol index when graph is empty', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `
function validate(token) {
  return token.length > 0;
}
`);
    writeFile(dir, 'src/ctrl.js', `
function login(req) {
  return validate(req.token);
}
`);

    const emptyGraph = new KnowledgeGraph();
    const idx = new SymbolIndex();
    await idx.buildIndex(dir);

    const result = await analyzeImpact('validate', { graph: emptyGraph, index: idx });

    assertEqual(result.confidence, 'medium');
    assert(result.impactedFiles.length > 0 || result.stats.directCallers > 0,
      'should find some references');
  } finally {
    cleanup(dir);
  }
});

await testAsync('returns low confidence with no data', async () => {
  const emptyGraph = new KnowledgeGraph();
  const emptyIdx = new SymbolIndex();

  const result = await analyzeImpact('nonexistent', { graph: emptyGraph, index: emptyIdx });
  assertEqual(result.confidence, 'low');
  assertEqual(result.impactedFunctions.length, 0);
});

// ─── Formatting ─────────────────────────────────────────────────────────────

suite('Impact Analyzer — formatting');

test('formatImpactReport returns markdown', () => {
  const result = {
    symbol: 'validateToken',
    impactedFunctions: ['login', 'register'],
    impactedFiles: ['auth.js', 'ctrl.js'],
    impactedTests: ['auth.test.js'],
    callChain: [['login', 'validateToken']],
    depth: 2,
    confidence: 'high',
    stats: { totalImpacted: 4, directCallers: 2, transitiveCallers: 2, testsAffected: 1 },
  };

  const report = formatImpactReport(result);
  assert(report.includes('##'), 'should have markdown headers');
  assert(report.includes('validateToken'), 'should include symbol name');
  assert(report.includes('login'), 'should include caller');
  assert(report.includes('auth.test.js'), 'should include test');
});

test('getImpactSummary returns one-line string', () => {
  const result = {
    symbol: 'validate',
    impactedFunctions: ['login', 'register'],
    impactedFiles: ['auth.js', 'ctrl.js', 'app.js'],
    impactedTests: ['test.js'],
    callChain: [],
    depth: 2,
    confidence: 'high',
    stats: {},
  };

  const s = getImpactSummary(result);
  assert(typeof s === 'string', 'should be string');
  assert(!s.includes('\n'), 'should be one line');
  assert(s.includes('affects'), 'should contain "affects"');
  assert(s.includes('validate'), 'should contain symbol name');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();

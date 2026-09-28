// tests/graph-retrieval.test.js — Graph-Based Retrieval unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { expandWithGraph, buildDependencyContext, mergeAndResort, computeHubPenalty, computeNamespaceBoost } from '../src/code-intel/graph-retrieval.js';
import { KnowledgeGraph, NodeType, EdgeType, fileNodeId } from '../src/code-intel/knowledge-graph.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTestGraph() {
  const g = new KnowledgeGraph();

  // Files: a.js imports b.js, b.js imports c.js, d.js imports a.js (reverse)
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addNode('file:src/c.js', NodeType.FILE, { name: 'src/c.js', file: 'src/c.js' });
  g.addNode('file:src/d.js', NodeType.FILE, { name: 'src/d.js', file: 'src/d.js' });
  g.addNode('file:src/e.js', NodeType.FILE, { name: 'src/e.js', file: 'src/e.js' });

  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/b.js', 'file:src/c.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/d.js', 'file:src/a.js');

  // Symbols
  g.addNode('sym:foo@src/a.js', NodeType.FUNCTION, { name: 'foo', file: 'src/a.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/a.js', 'sym:foo@src/a.js');

  g.addNode('sym:bar@src/b.js', NodeType.FUNCTION, { name: 'bar', file: 'src/b.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/b.js', 'sym:bar@src/b.js');

  return g;
}

// ─── expandWithGraph ─────────────────────────────────────────────────────────

suite('GraphRetrieval — expandWithGraph');

test('discovers imported files', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g);

  const files = result.map(r => r.file);
  assert(files.includes('src/b.js'), 'should discover b.js (imported by a.js)');
});

test('discovers dependent files (reverse IMPORTS)', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g);

  const files = result.map(r => r.file);
  assert(files.includes('src/d.js'), 'should discover d.js (imports a.js)');
});

test('respects maxDepth', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g, { maxDepth: 1 });

  const files = result.map(r => r.file);
  // Depth 1: b.js (direct import), d.js (direct dependent)
  // c.js is depth 2 from a.js (a→b→c) — should NOT be included with maxDepth=1
  assert(!files.includes('src/c.js'), 'should not discover c.js at depth 1');
});

test('respects maxExpansion cap', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g, { maxExpansion: 1 });

  assert(result.length <= 1, `should cap at maxExpansion=1, got ${result.length}`);
});

test('dedup — skips files already in ranked set', () => {
  const g = buildTestGraph();
  const ranked = [
    { file: 'src/a.js', score: 1.0 },
    { file: 'src/b.js', score: 0.8 },
  ];

  const result = expandWithGraph(ranked, g);

  const files = result.map(r => r.file);
  assert(!files.includes('src/a.js'), 'should not include already-ranked a.js');
  assert(!files.includes('src/b.js'), 'should not include already-ranked b.js');
});

test('score decay is correct', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g, { maxDepth: 2 });

  // b.js at depth 1 → score 1.0 × 1.0 (IMPORTS weight) × 0.7 (depthDecay) = 0.7
  const bItem = result.find(r => r.file === 'src/b.js');
  if (bItem) {
    assertEqual(bItem.score, 0.7);
  }
});

test('empty graph returns empty', () => {
  const g = new KnowledgeGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g);
  assertEqual(result.length, 0);
});

test('empty rankedFiles returns empty', () => {
  const g = buildTestGraph();
  const result = expandWithGraph([], g);
  assertEqual(result.length, 0);
});

test('respects topN (only seeds from top N files)', () => {
  const g = buildTestGraph();
  // Only file at position 0 (e.js) has no connections — topN=1 seeds from e.js only
  const ranked = [
    { file: 'src/e.js', score: 1.0 },
    { file: 'src/a.js', score: 0.5 },
  ];

  const result = expandWithGraph(ranked, g, { topN: 1 });

  // e.js has no edges → no discoveries. a.js is NOT seeded (topN=1)
  assertEqual(result.length, 0);
});

test('cyclic import does not loop', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:x.js', NodeType.FILE, { name: 'x.js', file: 'x.js' });
  g.addNode('file:y.js', NodeType.FILE, { name: 'y.js', file: 'y.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:x.js', 'file:y.js');
  g.addEdge(EdgeType.IMPORTS, 'file:y.js', 'file:x.js');

  const ranked = [{ file: 'x.js', score: 1.0 }];
  const result = expandWithGraph(ranked, g);

  // Should complete without infinite loop
  assert(result.length <= 5, 'should terminate with cyclic imports');
  // y.js should be discovered
  assert(result.some(r => r.file === 'y.js'), 'should discover y.js');
});

test('minimum threshold filters low scores', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 0.05 }]; // Very low score

  const result = expandWithGraph(ranked, g, { minScore: 0.05 });

  // depth 1 = 0.05 × 1.0 × 0.7 = 0.035 < 0.05 threshold → filtered
  assertEqual(result.length, 0);
});

test('all results have source: graph', () => {
  const g = buildTestGraph();
  const ranked = [{ file: 'src/a.js', score: 1.0 }];

  const result = expandWithGraph(ranked, g);

  for (const r of result) {
    assertEqual(r.source, 'graph');
  }
});

// ─── Hub Penalty ─────────────────────────────────────────────────────────────

suite('GraphRetrieval — Hub Penalty');

test('low-degree node gets no penalty', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');

  const penalty = computeHubPenalty(g, 'file:src/a.js');
  assertEqual(penalty, 1.0);
});

test('hub node (degree > 15) gets penalized', () => {
  const g = new KnowledgeGraph();
  // Create a hub: utils/logger.js imported by 30 files
  g.addNode('file:src/utils/logger.js', NodeType.FILE, { name: 'src/utils/logger.js', file: 'src/utils/logger.js' });
  for (let i = 0; i < 30; i++) {
    const f = `src/mod${i}/file${i}.js`;
    g.addNode(fileNodeId(f), NodeType.FILE, { name: f, file: f });
    g.addEdge(EdgeType.IMPORTS, fileNodeId(f), 'file:src/utils/logger.js');
  }

  const penalty = computeHubPenalty(g, 'file:src/utils/logger.js');
  assert(penalty < 1.0, `hub should be penalized, got ${penalty}`);
  assert(penalty >= 0.1, `penalty should not go below floor, got ${penalty}`);
});

test('penalty has safety floor at 0.1', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:hub.js', NodeType.FILE, { name: 'hub.js', file: 'hub.js' });
  // Create extreme hub: 2000 edges
  for (let i = 0; i < 2000; i++) {
    const f = `src/f${i}.js`;
    g.addNode(fileNodeId(f), NodeType.FILE, { name: f, file: f });
    g.addEdge(EdgeType.IMPORTS, fileNodeId(f), 'file:hub.js');
  }

  const penalty = computeHubPenalty(g, 'file:hub.js');
  assertEqual(penalty, 0.1);
});

test('hub node gets lower BFS score than normal node', () => {
  const g = new KnowledgeGraph();
  // seed → normalFile (IMPORTS, low degree)
  // seed → hubFile (IMPORTS, high degree)
  g.addNode(fileNodeId('src/auth/seed.js'), NodeType.FILE, { name: 'src/auth/seed.js', file: 'src/auth/seed.js' });
  g.addNode(fileNodeId('src/auth/normal.js'), NodeType.FILE, { name: 'src/auth/normal.js', file: 'src/auth/normal.js' });
  g.addNode(fileNodeId('src/utils/hub.js'), NodeType.FILE, { name: 'src/utils/hub.js', file: 'src/utils/hub.js' });

  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/auth/seed.js'), fileNodeId('src/auth/normal.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/auth/seed.js'), fileNodeId('src/utils/hub.js'));

  // Make hub.js a hub: 25 additional incoming edges
  for (let i = 0; i < 25; i++) {
    const f = `src/other/f${i}.js`;
    g.addNode(fileNodeId(f), NodeType.FILE, { name: f, file: f });
    g.addEdge(EdgeType.IMPORTS, fileNodeId(f), fileNodeId('src/utils/hub.js'));
  }

  const ranked = [{ file: 'src/auth/seed.js', score: 1.0 }];
  const result = expandWithGraph(ranked, g, { maxExpansion: 10 });

  const normalItem = result.find(r => r.file === 'src/auth/normal.js');
  const hubItem = result.find(r => r.file === 'src/utils/hub.js');

  assert(normalItem, 'should discover normal.js');
  assert(hubItem, 'should discover hub.js');
  assert(normalItem.score > hubItem.score,
    `normal (${normalItem.score}) should score higher than hub (${hubItem.score})`);
});

// ─── Namespace Boost ─────────────────────────────────────────────────────────

suite('GraphRetrieval — Namespace Boost');

test('same-module file gets boosted', () => {
  const seedModules = new Set(['src/auth']);
  const boost = computeNamespaceBoost(seedModules, 'src/auth/session.js');
  assertEqual(boost, 1.5);
});

test('different-module file gets no boost', () => {
  const seedModules = new Set(['src/auth']);
  const boost = computeNamespaceBoost(seedModules, 'src/api/handler.js');
  assertEqual(boost, 1.0);
});

test('null target returns 1.0', () => {
  const seedModules = new Set(['src/auth']);
  assertEqual(computeNamespaceBoost(seedModules, null), 1.0);
});

test('empty seedModules returns 1.0', () => {
  assertEqual(computeNamespaceBoost(new Set(), 'src/auth/login.js'), 1.0);
});

test('same-module file scores higher in BFS', () => {
  const g = new KnowledgeGraph();
  // seed in src/auth → imports two files: one in same module, one in different
  g.addNode(fileNodeId('src/auth/login.js'), NodeType.FILE, { name: 'src/auth/login.js', file: 'src/auth/login.js' });
  g.addNode(fileNodeId('src/auth/session.js'), NodeType.FILE, { name: 'src/auth/session.js', file: 'src/auth/session.js' });
  g.addNode(fileNodeId('src/api/handler.js'), NodeType.FILE, { name: 'src/api/handler.js', file: 'src/api/handler.js' });

  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/auth/login.js'), fileNodeId('src/auth/session.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/auth/login.js'), fileNodeId('src/api/handler.js'));

  const ranked = [{ file: 'src/auth/login.js', score: 1.0 }];
  const result = expandWithGraph(ranked, g, { maxExpansion: 10 });

  const sameModule = result.find(r => r.file === 'src/auth/session.js');
  const diffModule = result.find(r => r.file === 'src/api/handler.js');

  assert(sameModule, 'should discover same-module file');
  assert(diffModule, 'should discover different-module file');
  assert(sameModule.score > diffModule.score,
    `same-module (${sameModule.score}) should score higher than cross-module (${diffModule.score})`);
});

// ─── buildDependencyContext ──────────────────────────────────────────────────

suite('GraphRetrieval — buildDependencyContext');

test('includes imports', () => {
  const g = buildTestGraph();
  const ctx = buildDependencyContext('src/a.js', g);

  assert(ctx.includes('src/b.js'), 'should mention imported file b.js');
  assert(ctx.includes('imports'), 'should have imports label');
});

test('includes dependents', () => {
  const g = buildTestGraph();
  const ctx = buildDependencyContext('src/a.js', g);

  assert(ctx.includes('src/d.js'), 'should mention dependent d.js');
  assert(ctx.includes('imported by'), 'should have imported by label');
});

test('includes defined symbols', () => {
  const g = buildTestGraph();
  const ctx = buildDependencyContext('src/a.js', g);

  assert(ctx.includes('foo'), 'should mention defined symbol foo');
  assert(ctx.includes('defines'), 'should have defines label');
});

test('unknown file returns empty', () => {
  const g = buildTestGraph();
  const ctx = buildDependencyContext('src/nonexistent.js', g);

  assertEqual(ctx, '');
});

test('empty graph returns empty', () => {
  const g = new KnowledgeGraph();
  const ctx = buildDependencyContext('src/a.js', g);

  assertEqual(ctx, '');
});

// ─── mergeAndResort ──────────────────────────────────────────────────────────

suite('GraphRetrieval — mergeAndResort');

test('merges without duplicates', () => {
  const existing = [
    { file: 'a.js', score: 1.0 },
    { file: 'b.js', score: 0.8 },
  ];
  const graph = [
    { file: 'c.js', score: 0.6, source: 'graph' },
  ];

  const merged = mergeAndResort(existing, graph);

  assertEqual(merged.length, 3);
  const files = merged.map(m => m.file);
  assert(files.includes('a.js'), 'should include a.js');
  assert(files.includes('c.js'), 'should include c.js');
});

test('sorts by score descending', () => {
  const existing = [{ file: 'a.js', score: 0.5 }];
  const graph = [{ file: 'b.js', score: 0.9, source: 'graph' }];

  const merged = mergeAndResort(existing, graph);

  assertEqual(merged[0].file, 'b.js');
  assertEqual(merged[1].file, 'a.js');
});

test('uses max score for duplicate files', () => {
  const existing = [{ file: 'a.js', score: 0.5 }];
  const graph = [{ file: 'a.js', score: 0.9, source: 'graph' }];

  const merged = mergeAndResort(existing, graph);

  assertEqual(merged.length, 1);
  assertEqual(merged[0].score, 0.9);
});

test('does not downgrade existing score', () => {
  const existing = [{ file: 'a.js', score: 0.9 }];
  const graph = [{ file: 'a.js', score: 0.3, source: 'graph' }];

  const merged = mergeAndResort(existing, graph);

  assertEqual(merged.length, 1);
  assertEqual(merged[0].score, 0.9);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();

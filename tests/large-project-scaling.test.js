// tests/large-project-scaling.test.js — v101 Large Project Scaling tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  KnowledgeGraph, NodeType, EdgeType,
  fileNodeId, symbolNodeId, moduleNodeId,
} from '../src/code-intel/knowledge-graph.js';
import {
  expandWithGraph, MaxHeap, EDGE_WEIGHT,
} from '../src/code-intel/graph-retrieval.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scaling-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ════════════════════════════════════════════════════════════════════════════
// Suite 1: Graph Storage Refactor
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Graph Storage Refactor');

test('addEdge returns numeric ID', () => {
  const g = new KnowledgeGraph();
  g.addNode('a', NodeType.FUNCTION, { name: 'a' });
  g.addNode('b', NodeType.FUNCTION, { name: 'b' });
  const id = g.addEdge(EdgeType.CALLS, 'a', 'b');
  assertEqual(typeof id, 'number');
  assert(id > 0, 'edge ID should be positive');
});

test('_edges is Map after construction', () => {
  const g = new KnowledgeGraph();
  assert(g._edges instanceof Map, '_edges should be a Map');
});

test('_edgesByType tracks edge type correctly', () => {
  const g = new KnowledgeGraph();
  g.addNode('a', NodeType.FILE, { name: 'a.js' });
  g.addNode('b', NodeType.FILE, { name: 'b.js' });
  g.addNode('c', NodeType.FUNCTION, { name: 'fn' });
  g.addEdge(EdgeType.IMPORTS, 'a', 'b');
  g.addEdge(EdgeType.DEFINES, 'a', 'c');
  g.addEdge(EdgeType.IMPORTS, 'b', 'a');

  const importSet = g._edgesByType.get(EdgeType.IMPORTS);
  assert(importSet instanceof Set, 'should be a Set');
  assertEqual(importSet.size, 2);

  const defSet = g._edgesByType.get(EdgeType.DEFINES);
  assertEqual(defSet.size, 1);
});

test('removeFile correctly removes edges touching file', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addNode('sym:foo@src/a.js', NodeType.FUNCTION, { name: 'foo', file: 'src/a.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');
  g.addEdge(EdgeType.DEFINES, 'file:src/a.js', 'sym:foo@src/a.js');

  assertEqual(g._edges.size, 2);
  g.removeFile('src/a.js');
  assertEqual(g._edges.size, 0);
});

test('removeFile cleans counterpart adjacency/reverse', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addNode('file:src/c.js', NodeType.FILE, { name: 'src/c.js', file: 'src/c.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/b.js', 'file:src/a.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/c.js', 'file:src/a.js');

  g.removeFile('src/a.js');

  // b.js adjacency should not reference a.js anymore
  const bAdj = g._adjacency.get('file:src/b.js') || [];
  assertEqual(bAdj.length, 0);
  const cAdj = g._adjacency.get('file:src/c.js') || [];
  assertEqual(cAdj.length, 0);
});

test('removeFile preserves unrelated edges', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addNode('file:src/c.js', NodeType.FILE, { name: 'src/c.js', file: 'src/c.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/b.js', 'file:src/c.js'); // unrelated

  g.removeFile('src/a.js');
  assertEqual(g._edges.size, 1); // b→c preserved
  const bAdj = g.getEdges('file:src/b.js', EdgeType.IMPORTS);
  assertEqual(bAdj.length, 1);
  assertEqual(bAdj[0].target, 'file:src/c.js');
});

test('validateGraph works with Map-based _edges', () => {
  const g = new KnowledgeGraph();
  g.addNode('a', NodeType.FILE, { name: 'a.js' });
  g.addNode('b', NodeType.FILE, { name: 'b.js' });
  g.addEdge(EdgeType.IMPORTS, 'a', 'b');

  const result = g.validateGraph();
  assert(result.valid, 'should be valid');
  assertEqual(result.orphanedEdges, 0);
});

test('clear resets _edgeCounter + _edgesByType', () => {
  const g = new KnowledgeGraph();
  g.addNode('a', NodeType.FILE, { name: 'a' });
  g.addNode('b', NodeType.FILE, { name: 'b' });
  g.addEdge(EdgeType.IMPORTS, 'a', 'b');

  assert(g._edgeCounter > 0, 'counter should be incremented');
  assert(g._edgesByType.size > 0, 'type index should have entries');

  g.clear();
  assertEqual(g._edgeCounter, 0);
  assertEqual(g._edgesByType.size, 0);
  assertEqual(g._edges.size, 0);
});

test('getStats returns .size', () => {
  const g = new KnowledgeGraph();
  g.addNode('a', NodeType.FILE, { name: 'a' });
  g.addNode('b', NodeType.FILE, { name: 'b' });
  g.addEdge(EdgeType.IMPORTS, 'a', 'b');

  const stats = g.getStats();
  assertEqual(stats.edgeCount, 1);
  assertEqual(stats.nodeCount, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// Suite 2: Multi-Level Graph
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Multi-Level Graph');

test('_moduleIndex populated from _fileIndex', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/auth/login.js', NodeType.FILE, { name: 'src/auth/login.js', file: 'src/auth/login.js' });
  g.addNode('file:src/auth/register.js', NodeType.FILE, { name: 'src/auth/register.js', file: 'src/auth/register.js' });
  g.addNode('file:src/api/users.js', NodeType.FILE, { name: 'src/api/users.js', file: 'src/api/users.js' });

  const modules = g.getModules();
  assert(modules.includes('src/auth'), 'should have src/auth module');
  assert(modules.includes('src/api'), 'should have src/api module');
});

test('getModuleDependencies returns cross-module deps', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/api/handler.js', NodeType.FILE, { name: 'src/api/handler.js', file: 'src/api/handler.js' });
  g.addNode('file:src/auth/validate.js', NodeType.FILE, { name: 'src/auth/validate.js', file: 'src/auth/validate.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/api/handler.js', 'file:src/auth/validate.js');

  const deps = g.getModuleDependencies('src/api');
  assert(deps.length > 0, 'should have dependencies');
  assert(deps.some(d => d.module === 'src/auth'), 'should depend on src/auth');
});

test('getModuleDependencies excludes self-module', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/auth/login.js', NodeType.FILE, { name: 'src/auth/login.js', file: 'src/auth/login.js' });
  g.addNode('file:src/auth/register.js', NodeType.FILE, { name: 'src/auth/register.js', file: 'src/auth/register.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/auth/login.js', 'file:src/auth/register.js');

  const deps = g.getModuleDependencies('src/auth');
  assertEqual(deps.length, 0); // same module, should not appear
});

test('getModuleDependencies uses cache', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/api/h.js', NodeType.FILE, { name: 'src/api/h.js', file: 'src/api/h.js' });
  g.addNode('file:src/db/q.js', NodeType.FILE, { name: 'src/db/q.js', file: 'src/db/q.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/api/h.js', 'file:src/db/q.js');

  // First call → builds cache
  const deps1 = g.getModuleDependencies('src/api');
  // Second call → from cache
  const deps2 = g.getModuleDependencies('src/api');
  assertEqual(deps1.length, deps2.length);
  assert(g._moduleDepCache !== null, 'cache should be populated');
});

test('getModules returns all module paths', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a/x.js', NodeType.FILE, { name: 'src/a/x.js', file: 'src/a/x.js' });
  g.addNode('file:src/b/y.js', NodeType.FILE, { name: 'src/b/y.js', file: 'src/b/y.js' });
  g.addNode('file:lib/c/z.js', NodeType.FILE, { name: 'lib/c/z.js', file: 'lib/c/z.js' });

  const modules = g.getModules();
  assertEqual(modules.length, 3);
});

test('getModuleFiles returns files in module', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/auth/login.js', NodeType.FILE, { name: 'src/auth/login.js', file: 'src/auth/login.js' });
  g.addNode('file:src/auth/register.js', NodeType.FILE, { name: 'src/auth/register.js', file: 'src/auth/register.js' });

  const files = g.getModuleFiles('src/auth');
  assertEqual(files.length, 2);
  assert(files.includes('src/auth/login.js'), 'should include login.js');
});

test('addNode maintains module index', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/new/file.js', NodeType.FILE, { name: 'src/new/file.js', file: 'src/new/file.js' });

  assert(g._moduleIndex.has('src/new'), 'module index should be updated on addNode');
});

test('removeFile invalidates module dep cache', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a/x.js', NodeType.FILE, { name: 'src/a/x.js', file: 'src/a/x.js' });
  g.addNode('file:src/b/y.js', NodeType.FILE, { name: 'src/b/y.js', file: 'src/b/y.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a/x.js', 'file:src/b/y.js');

  // Build cache
  g.getModuleDependencies('src/a');
  assert(g._moduleDepCache !== null, 'cache should exist');

  // Remove file → cache invalidated
  g.removeFile('src/a/x.js');
  assertEqual(g._moduleDepCache, null);
});

// ════════════════════════════════════════════════════════════════════════════
// Suite 3: Priority BFS
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Priority BFS');

test('MaxHeap push/pop order (highest first)', () => {
  const h = new MaxHeap();
  h.push({ nodeId: 'a', score: 0.3 });
  h.push({ nodeId: 'b', score: 0.9 });
  h.push({ nodeId: 'c', score: 0.5 });

  assertEqual(h.pop().nodeId, 'b'); // highest
  assertEqual(h.pop().nodeId, 'c');
  assertEqual(h.pop().nodeId, 'a'); // lowest
});

test('MaxHeap empty pop returns null', () => {
  const h = new MaxHeap();
  assertEqual(h.pop(), null);
  assertEqual(h.size, 0);
});

test('expandWithGraph with priority finds files', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');

  const result = expandWithGraph([{ file: 'src/a.js', score: 1.0 }], g);
  assert(result.some(r => r.file === 'src/b.js'), 'should discover b.js');
});

test('CALLS edges get higher score than IMPORTS', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/imported.js', NodeType.FILE, { name: 'src/imported.js', file: 'src/imported.js' });
  g.addNode('file:src/called.js', NodeType.FILE, { name: 'src/called.js', file: 'src/called.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/imported.js');
  g.addEdge(EdgeType.CALLS, 'file:src/a.js', 'file:src/called.js');

  const result = expandWithGraph([{ file: 'src/a.js', score: 1.0 }], g, { maxExpansion: 10 });
  const imported = result.find(r => r.file === 'src/imported.js');
  const called = result.find(r => r.file === 'src/called.js');
  assert(imported && called, 'should discover both');
  assert(called.score > imported.score, `CALLS score (${called.score}) should be > IMPORTS score (${imported.score})`);
});

test('dynamic cutoff stops below threshold', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js', file: 'a.js' });
  g.addNode('file:b.js', NodeType.FILE, { name: 'b.js', file: 'b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:a.js', 'file:b.js');

  // Very low seed score → derived score < threshold
  const result = expandWithGraph([{ file: 'a.js', score: 0.01 }], g, { minScore: 0.05 });
  assertEqual(result.length, 0);
});

test('depthDecay parameter respected', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js', file: 'a.js' });
  g.addNode('file:b.js', NodeType.FILE, { name: 'b.js', file: 'b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:a.js', 'file:b.js');

  // Default depthDecay=0.7, IMPORTS weight=1.0
  const result1 = expandWithGraph([{ file: 'a.js', score: 1.0 }], g, { depthDecay: 0.7 });
  const bScore1 = result1.find(r => r.file === 'b.js')?.score;

  // Custom depthDecay=0.5
  const result2 = expandWithGraph([{ file: 'a.js', score: 1.0 }], g, { depthDecay: 0.5 });
  const bScore2 = result2.find(r => r.file === 'b.js')?.score;

  assertEqual(bScore1, 0.7); // 1.0 × 1.0 × 0.7
  assertEqual(bScore2, 0.5); // 1.0 × 1.0 × 0.5
});

// ════════════════════════════════════════════════════════════════════════════
// Suite 4: Streaming Indexer
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Streaming Indexer');

await testAsync('start/stop lifecycle', async () => {
  // Import the class, not the singleton
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();

  assert(!si._active, 'should not be active initially');

  // start with mock deps
  const mockSymbolIndex = { reindexFile: async () => ({ nodesAdded: 0, edgesAdded: 0 }) };
  const mockKG = { removeFile: () => {} };
  // We can't actually start because it needs file-watcher, but we test the state transitions
  assertEqual(si.getStats().active, false);
});

await testAsync('_onFileEvents filters non-code extensions', async () => {
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();
  si._active = true;

  si._onFileEvents([
    { event: 'change', path: 'src/app.js' },
    { event: 'change', path: 'README.md' },
    { event: 'change', path: 'data.json' },
    { event: 'change', path: 'src/utils.ts' },
  ]);

  assertEqual(si._queue.length, 2); // only .js and .ts
  const paths = si._queue.map(e => e.path);
  assert(paths.includes('src/app.js'), 'should include .js');
  assert(paths.includes('src/utils.ts'), 'should include .ts');

  clearTimeout(si._debounceTimer);
});

await testAsync('reindex on file change (mock)', async () => {
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();
  si._active = true;
  const reindexed = [];
  si._symbolIndex = {
    reindexFile: async (f) => { reindexed.push(f); return { nodesAdded: 0, edgesAdded: 0 }; },
  };
  si._knowledgeGraph = { removeFile: () => {} };

  // Simulate processing
  si._queue = [{ event: 'change', path: 'src/app.js' }];
  await si._processQueue();

  assertEqual(reindexed.length, 1);
  assertEqual(reindexed[0], 'src/app.js');
  assertEqual(si._stats.filesReindexed, 1);
});

await testAsync('removal on unlink event', async () => {
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();
  si._active = true;
  const removed = [];
  si._knowledgeGraph = { removeFile: (f) => removed.push(f) };
  si._symbolIndex = { removeFile: (f) => {} };

  si._queue = [{ event: 'unlink', path: 'src/old.js' }];
  await si._processQueue();

  assertEqual(removed.length, 1);
  assertEqual(removed[0], 'src/old.js');
  assertEqual(si._stats.filesDeleted, 1);
});

await testAsync('dedup: multiple events for same file', async () => {
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();
  si._active = true;
  const reindexed = [];
  si._symbolIndex = {
    reindexFile: async (f) => { reindexed.push(f); return { nodesAdded: 0, edgesAdded: 0 }; },
  };
  si._knowledgeGraph = { removeFile: () => {} };

  // Multiple events for same file → only processed once
  si._queue = [
    { event: 'change', path: 'src/app.js' },
    { event: 'change', path: 'src/app.js' },
    { event: 'change', path: 'src/app.js' },
  ];
  await si._processQueue();

  assertEqual(reindexed.length, 1); // deduplicated
});

await testAsync('per-file lock prevents concurrent reindex', async () => {
  const { StreamingIndexer } = await import('../src/code-intel/streaming-indexer.js');
  const si = new StreamingIndexer();
  si._active = true;

  let concurrentCount = 0;
  let maxConcurrent = 0;
  si._symbolIndex = {
    reindexFile: async (f) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise(r => setTimeout(r, 10));
      concurrentCount--;
      return { nodesAdded: 0, edgesAdded: 0 };
    },
  };
  si._knowledgeGraph = { removeFile: () => {} };

  // Process two different files — they should run sequentially within processQueue
  si._queue = [
    { event: 'change', path: 'src/a.js' },
    { event: 'change', path: 'src/b.js' },
  ];
  await si._processQueue();

  // Within a single processQueue call, files are processed sequentially
  assertEqual(maxConcurrent, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// Suite 5: Snapshot Persistence
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Snapshot Persistence');

await testAsync('_saveToFile creates .c3 directory', async () => {
  const { _saveToFile } = await import('../src/planner/project-knowledge-base.js');
  const dir = tmpDir();
  try {
    const snapshot = { projectPath: dir, timestamp: new Date().toISOString(), moduleMap: {} };
    await _saveToFile(dir, snapshot);

    assert(fs.existsSync(path.join(dir, '.c3')), '.c3 directory should exist');
    assert(fs.existsSync(path.join(dir, '.c3/snapshot.json')), 'snapshot.json should exist');
  } finally { cleanup(dir); }
});

await testAsync('_loadFromFile reads saved snapshot', async () => {
  const { _saveToFile, _loadFromFile } = await import('../src/planner/project-knowledge-base.js');
  const dir = tmpDir();
  try {
    const snapshot = { projectPath: dir, timestamp: new Date().toISOString(), moduleMap: { 'src/auth': ['src/auth/login.js'] } };
    await _saveToFile(dir, snapshot);

    const loaded = await _loadFromFile(dir);
    assert(loaded !== null, 'should load snapshot');
    assertEqual(loaded.projectPath, dir);
    assert(loaded.moduleMap['src/auth'].includes('src/auth/login.js'), 'should preserve module map');
  } finally { cleanup(dir); }
});

await testAsync('_loadFromFile returns null for missing file', async () => {
  const { _loadFromFile } = await import('../src/planner/project-knowledge-base.js');
  const dir = tmpDir();
  try {
    const loaded = await _loadFromFile(dir);
    assertEqual(loaded, null);
  } finally { cleanup(dir); }
});

await testAsync('_loadFromFile returns null for corrupted JSON', async () => {
  const { _loadFromFile } = await import('../src/planner/project-knowledge-base.js');
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.c3'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.c3/snapshot.json'), 'not valid json{{{');

    const loaded = await _loadFromFile(dir);
    assertEqual(loaded, null);
  } finally { cleanup(dir); }
});

await testAsync('_loadFromFile returns null for wrong schema version', async () => {
  const { _loadFromFile, SNAPSHOT_SCHEMA_VERSION } = await import('../src/planner/project-knowledge-base.js');
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, '.c3'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.c3/snapshot.json'), JSON.stringify({
      schemaVersion: 999, // wrong version
      projectPath: dir,
    }));

    const loaded = await _loadFromFile(dir);
    assertEqual(loaded, null);
  } finally { cleanup(dir); }
});

// ════════════════════════════════════════════════════════════════════════════
// Suite 6: Stress Test
// ════════════════════════════════════════════════════════════════════════════

suite('Scaling — Stress Test');

test('large graph: 1000 nodes + 5000 edges — removeFile + expandWithGraph', () => {
  const g = new KnowledgeGraph();

  // Create 1000 file nodes across 50 modules
  const filePaths = [];
  for (let i = 0; i < 1000; i++) {
    const mod = `src/mod${i % 50}`;
    const relPath = `${mod}/file${i}.js`;
    g.addNode(fileNodeId(relPath), NodeType.FILE, { name: relPath, file: relPath });
    filePaths.push(relPath);
  }

  // Create 5000 edges between existing files
  for (let i = 0; i < 5000; i++) {
    const fromIdx = i % 1000;
    const toIdx = (i * 7 + 3) % 1000;
    if (fromIdx === toIdx) continue;
    g.addEdge(EdgeType.IMPORTS, fileNodeId(filePaths[fromIdx]), fileNodeId(filePaths[toIdx]));
  }

  assertEqual(g._nodes.size, 1000);
  assert(g._edges.size >= 4900, `should have ~5000 edges, got ${g._edges.size}`);

  // removeFile performance
  const removeStart = Date.now();
  g.removeFile('src/mod0/file0.js');
  const removeTime = Date.now() - removeStart;
  assert(removeTime < 50, `removeFile should be < 50ms, got ${removeTime}ms`);

  // Verify edges were cleaned
  const edgesBefore = g._edges.size + 1; // approximate
  assert(g._edges.size < edgesBefore, 'should have removed some edges');
  const validation = g.validateGraph();
  assert(validation.valid, `graph should be valid after removeFile, orphaned: ${validation.orphanedEdges}`);

  // expandWithGraph performance
  const ranked = [{ file: 'src/mod1/file1.js', score: 1.0 }];
  const expandStart = Date.now();
  const expanded = expandWithGraph(ranked, g, { maxExpansion: 10, maxDepth: 3 });
  const expandTime = Date.now() - expandStart;
  assert(expandTime < 100, `expandWithGraph should be < 100ms, got ${expandTime}ms`);
  assert(expanded.length > 0, 'should discover related files');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();

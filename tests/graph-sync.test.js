// tests/graph-sync.test.js — Graph Synchronization unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  KnowledgeGraph, NodeType, EdgeType,
  fileNodeId, symbolNodeId, moduleNodeId,
} from '../src/code-intel/knowledge-graph.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graphsync-'));
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

// ─── _fileIndex Population ──────────────────────────────────────────────────

suite('GraphSync — _fileIndex');

test('addNode symbol tracks file in _fileIndex', () => {
  const g = new KnowledgeGraph();
  g.addNode('sym:foo@src/app.js', NodeType.FUNCTION, { name: 'foo', file: 'src/app.js' });

  const set = g._fileIndex.get('src/app.js');
  assert(set !== undefined, 'should have _fileIndex entry for src/app.js');
  assert(set.has('sym:foo@src/app.js'), 'should track symbol node');
});

test('addNode FILE tracks file in _fileIndex', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/main.js', NodeType.FILE, { name: 'src/main.js' });

  const set = g._fileIndex.get('src/main.js');
  assert(set !== undefined, 'should have _fileIndex entry');
  assert(set.has('file:src/main.js'), 'should track file node');
});

test('addNode MODULE has no file — no _fileIndex entry', () => {
  const g = new KnowledgeGraph();
  g.addNode('mod:express', NodeType.MODULE, { name: 'express' });

  assertEqual(g._fileIndex.size, 0);
});

test('multiple symbols in same file share _fileIndex entry', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/utils.js', NodeType.FILE, { name: 'src/utils.js' });
  g.addNode('sym:foo@src/utils.js', NodeType.FUNCTION, { name: 'foo', file: 'src/utils.js' });
  g.addNode('sym:bar@src/utils.js', NodeType.FUNCTION, { name: 'bar', file: 'src/utils.js' });

  const set = g._fileIndex.get('src/utils.js');
  assertEqual(set.size, 3); // file node + 2 symbols
});

test('clear resets _fileIndex', () => {
  const g = new KnowledgeGraph();
  g.addNode('sym:x@a.js', NodeType.FUNCTION, { name: 'x', file: 'a.js' });
  assertEqual(g._fileIndex.size, 1);

  g.clear();
  assertEqual(g._fileIndex.size, 0);
});

await testAsync('buildFromProject populates _fileIndex', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'export function hello() { return 1; }');
    writeFile(dir, 'src/util.js', 'export const PI = 3.14;');

    const g = new KnowledgeGraph();
    await g.buildFromProject(dir);

    assert(g._fileIndex.size >= 2, `should have ≥2 _fileIndex entries, got ${g._fileIndex.size}`);
    assert(g._fileIndex.has('src/app.js'), 'should index src/app.js');
    assert(g._fileIndex.has('src/util.js'), 'should index src/util.js');
  } finally { cleanup(dir); }
});

// ─── removeFile ─────────────────────────────────────────────────────────────

suite('GraphSync — removeFile');

test('removeFile removes nodes', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('sym:foo@src/a.js', NodeType.FUNCTION, { name: 'foo', file: 'src/a.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/a.js', 'sym:foo@src/a.js');

  g.removeFile('src/a.js');

  assertEqual(g.getNode('file:src/a.js'), null);
  assertEqual(g.getNode('sym:foo@src/a.js'), null);
});

test('removeFile removes edges', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('sym:foo@src/a.js', NodeType.FUNCTION, { name: 'foo', file: 'src/a.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/a.js', 'sym:foo@src/a.js');

  g.removeFile('src/a.js');

  assertEqual(g._edges.length, 0);
});

test('removeFile cleans adjacency', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/b.js');

  g.removeFile('src/a.js');

  // b.js should have no incoming from a.js
  const bReverse = g._reverse.get('file:src/b.js') || [];
  assertEqual(bReverse.length, 0);
});

test('removeFile cleans cross-refs in other nodes', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('file:src/b.js', NodeType.FILE, { name: 'src/b.js', file: 'src/b.js' });
  g.addNode('file:src/c.js', NodeType.FILE, { name: 'src/c.js', file: 'src/c.js' });
  g.addEdge(EdgeType.IMPORTS, 'file:src/b.js', 'file:src/a.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/c.js', 'file:src/a.js');

  g.removeFile('src/a.js');

  // b and c should no longer have adjacency pointing to a
  const bAdj = g._adjacency.get('file:src/b.js') || [];
  assertEqual(bAdj.length, 0);
  const cAdj = g._adjacency.get('file:src/c.js') || [];
  assertEqual(cAdj.length, 0);
});

test('removeFile on non-existent file is no-op', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });

  g.removeFile('src/nonexistent.js'); // should not throw
  assertEqual(g._nodes.size, 1);
});

test('removeFile clears _fileIndex entry', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });
  g.addNode('sym:foo@src/a.js', NodeType.FUNCTION, { name: 'foo', file: 'src/a.js' });

  assert(g._fileIndex.has('src/a.js'), 'should have _fileIndex before remove');
  g.removeFile('src/a.js');
  assert(!g._fileIndex.has('src/a.js'), 'should not have _fileIndex after remove');
});

// ─── reindexFile ────────────────────────────────────────────────────────────

suite('GraphSync — reindexFile');

await testAsync('reindexFile adds new function', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'export function hello() { return 1; }');

    const g = new KnowledgeGraph();
    g._projectPath = dir;

    const result = await g.reindexFile('src/app.js');

    assert(result.nodesAdded >= 1, `should add ≥1 nodes, got ${result.nodesAdded}`);
    assert(g.getNode('file:src/app.js') !== null, 'should have file node');
  } finally { cleanup(dir); }
});

await testAsync('reindexFile updates after rename', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'export function oldName() { return 1; }');

    const g = new KnowledgeGraph();
    g._projectPath = dir;
    await g.reindexFile('src/app.js');

    // Rename function
    writeFile(dir, 'src/app.js', 'export function newName() { return 2; }');
    await g.reindexFile('src/app.js');

    assertEqual(g.getNode('sym:oldName@src/app.js'), null);
    assert(g.getNode('sym:newName@src/app.js') !== null, 'should have new symbol');
  } finally { cleanup(dir); }
});

await testAsync('reindexFile updates imports', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/main.js', "import { foo } from './util';\nexport function main() {}");
    writeFile(dir, 'src/util.js', 'export function foo() {}');

    const g = new KnowledgeGraph();
    g._projectPath = dir;
    // Pre-populate util.js so imports can resolve
    await g.reindexFile('src/util.js');
    await g.reindexFile('src/main.js');

    const deps = g.getDependencies('src/main.js');
    assert(deps.length >= 1, `should have ≥1 dependency, got ${deps.length}`);
  } finally { cleanup(dir); }
});

await testAsync('reindexFile handles deleted file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'export function hello() {}');

    const g = new KnowledgeGraph();
    g._projectPath = dir;
    await g.reindexFile('src/app.js');

    // Delete file
    fs.unlinkSync(path.join(dir, 'src/app.js'));

    const result = await g.reindexFile('src/app.js');
    assertEqual(result.nodesAdded, 0);
    assertEqual(result.edgesAdded, 0);
    assertEqual(g.getNode('file:src/app.js'), null);
  } finally { cleanup(dir); }
});

await testAsync('reindexFile guard during _building', async () => {
  const g = new KnowledgeGraph();
  g._building = true;

  const result = await g.reindexFile('any/file.js', 'content');

  assertEqual(result.nodesAdded, 0);
  assertEqual(result.edgesAdded, 0);

  g._building = false;
});

// ─── validateGraph ──────────────────────────────────────────────────────────

suite('GraphSync — validateGraph');

test('valid graph passes validation', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js' });
  g.addNode('sym:foo@a.js', NodeType.FUNCTION, { name: 'foo', file: 'a.js' });
  g.addEdge(EdgeType.DEFINES, 'file:a.js', 'sym:foo@a.js');

  const result = g.validateGraph();
  assert(result.valid, 'should be valid');
  assertEqual(result.orphanedEdges, 0);
});

test('orphaned edge detected', () => {
  const g = new KnowledgeGraph();
  g.addNode('file:a.js', NodeType.FILE, { name: 'a.js' });
  // Manually push edge with missing target
  g._edges.push({ type: EdgeType.DEFINES, from: 'file:a.js', to: 'sym:ghost@a.js' });

  const result = g.validateGraph();
  assert(!result.valid, 'should be invalid');
  assert(result.orphanedEdges > 0, 'should detect orphaned edge');
});

test('empty graph is valid', () => {
  const g = new KnowledgeGraph();
  const result = g.validateGraph();
  assert(result.valid, 'empty graph should be valid');
  assertEqual(result.orphanedEdges, 0);
});

// ─── _buildPromise Mutex ────────────────────────────────────────────────────

suite('GraphSync — _buildPromise');

await testAsync('_buildPromise is set during build and null after', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/x.js', 'export const x = 1;');

    const g = new KnowledgeGraph();
    const promise = g.buildFromProject(dir);

    assert(g._buildPromise !== null, '_buildPromise should be set during build');
    await promise;
    assertEqual(g._buildPromise, null);
  } finally { cleanup(dir); }
});

await testAsync('concurrent buildFromProject returns same promise', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/x.js', 'export const x = 1;');

    const g = new KnowledgeGraph();
    const p1 = g.buildFromProject(dir);
    const p2 = g.buildFromProject(dir);

    // p2 should return the same promise (or its result) via _buildPromise
    const r1 = await p1;
    const r2 = await p2;
    assert(r1.nodeCount >= 1, 'first build should have nodes');
    assert(r2.nodeCount >= 0, 'second build should return result');
  } finally { cleanup(dir); }
});

await testAsync('_buildPromise resets so subsequent builds work', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/x.js', 'export const x = 1;');

    const g = new KnowledgeGraph();
    await g.buildFromProject(dir);
    assertEqual(g._buildPromise, null);

    // Second build should work
    writeFile(dir, 'src/y.js', 'export const y = 2;');
    const r2 = await g.buildFromProject(dir);
    assert(r2.nodeCount >= 2, `second build should include new file, got ${r2.nodeCount}`);
  } finally { cleanup(dir); }
});

// ─── Concurrency stress ─────────────────────────────────────────────────────

suite('GraphSync — Concurrency');

await testAsync('reindexFile + graph read simultaneously', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', 'export function a() {}');
    writeFile(dir, 'src/b.js', "import { a } from './a';\nexport function b() { a(); }");

    const g = new KnowledgeGraph();
    await g.buildFromProject(dir);

    // Simultaneously reindex and read graph
    writeFile(dir, 'src/a.js', 'export function aRenamed() {}');
    const [reindexResult] = await Promise.all([
      g.reindexFile('src/a.js'),
      // Graph reads during reindex should not crash
      Promise.resolve(g.getDependencies('src/b.js')),
      Promise.resolve(g.getFileSymbols('src/b.js')),
      Promise.resolve(g.validateGraph()),
    ]);

    assert(reindexResult.nodesAdded >= 0, 'reindex should complete');
    // Graph should still be valid after concurrent operations
    const validation = g.validateGraph();
    assert(validation.valid, `graph should be valid after concurrent ops, orphaned: ${validation.orphanedEdges}`);
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();

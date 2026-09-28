// tests/graph-query.test.js — Graph Query (F7) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { KnowledgeGraph, fileNodeId, EdgeType, NodeType } from '../src/code-intel/knowledge-graph.js';
import {
  getImpactRadius,
  detectCycles,
  computeMetrics,
  explainContext,
  exportMermaid,
} from '../src/code-intel/graph-query.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildTestGraph() {
  const g = new KnowledgeGraph();

  // File nodes
  g.addNode(fileNodeId('src/main.js'), NodeType.FILE, { name: 'src/main.js' });
  g.addNode(fileNodeId('src/service.js'), NodeType.FILE, { name: 'src/service.js' });
  g.addNode(fileNodeId('src/util.js'), NodeType.FILE, { name: 'src/util.js' });
  g.addNode(fileNodeId('src/config.js'), NodeType.FILE, { name: 'src/config.js' });
  g.addNode(fileNodeId('src/test.js'), NodeType.FILE, { name: 'src/test.js' });

  // Import edges: main → service → util, main → config, test → service
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/main.js'), fileNodeId('src/service.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/service.js'), fileNodeId('src/util.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/main.js'), fileNodeId('src/config.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('src/test.js'), fileNodeId('src/service.js'));

  return g;
}

function buildCyclicGraph() {
  const g = new KnowledgeGraph();

  g.addNode(fileNodeId('a.js'), NodeType.FILE, { name: 'a.js' });
  g.addNode(fileNodeId('b.js'), NodeType.FILE, { name: 'b.js' });
  g.addNode(fileNodeId('c.js'), NodeType.FILE, { name: 'c.js' });
  g.addNode(fileNodeId('d.js'), NodeType.FILE, { name: 'd.js' });

  // Cycle: a → b → c → a
  g.addEdge(EdgeType.IMPORTS, fileNodeId('a.js'), fileNodeId('b.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('b.js'), fileNodeId('c.js'));
  g.addEdge(EdgeType.IMPORTS, fileNodeId('c.js'), fileNodeId('a.js'));

  // d is isolated (no cycles)
  g.addEdge(EdgeType.IMPORTS, fileNodeId('d.js'), fileNodeId('a.js'));

  return g;
}

// ═══════════════════════════════════════════════════════════════════════════
// getImpactRadius
// ═══════════════════════════════════════════════════════════════════════════

suite('getImpactRadius');

test('depth 1 from main.js', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'src/main.js', 1);

  assert(result.nodes.length >= 3, `should find main + 2 direct deps, got ${result.nodes.length}`);
  assert(result.nodes.some(n => n.id === fileNodeId('src/main.js')), 'should include start node');
  assert(result.nodes.some(n => n.id === fileNodeId('src/service.js')), 'should include service');
  assert(result.nodes.some(n => n.id === fileNodeId('src/config.js')), 'should include config');
});

test('depth 2 reaches util', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'src/main.js', 2);

  assert(result.nodes.some(n => n.id === fileNodeId('src/util.js')), 'should reach util at depth 2');
});

test('depth 0 returns only start node', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'src/main.js', 0);

  assertEqual(result.nodes.length, 1, 'only start node');
  assertEqual(result.nodes[0].depth, 0, 'depth is 0');
});

test('nonexistent node returns empty', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'nonexistent.js', 2);

  assertEqual(result.nodes.length, 0, 'no nodes');
  assertEqual(result.edges.length, 0, 'no edges');
});

test('includes reverse edges (dependents)', () => {
  const g = buildTestGraph();
  // service.js is imported by main.js and test.js
  const result = getImpactRadius(g, 'src/service.js', 1);

  assert(result.nodes.some(n => n.id === fileNodeId('src/main.js')), 'should find main (reverse dep)');
  assert(result.nodes.some(n => n.id === fileNodeId('src/test.js')), 'should find test (reverse dep)');
  assert(result.nodes.some(n => n.id === fileNodeId('src/util.js')), 'should find util (forward dep)');
});

test('edges are deduplicated', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'src/main.js', 2);

  const edgeKeys = result.edges.map(e => `${e.from}|${e.to}|${e.type}`);
  const unique = new Set(edgeKeys);
  assertEqual(edgeKeys.length, unique.size, 'all edges should be unique');
});

test('nodes have depth property', () => {
  const g = buildTestGraph();
  const result = getImpactRadius(g, 'src/main.js', 2);

  const mainNode = result.nodes.find(n => n.id === fileNodeId('src/main.js'));
  assertEqual(mainNode.depth, 0, 'start node depth is 0');

  const serviceNode = result.nodes.find(n => n.id === fileNodeId('src/service.js'));
  assertEqual(serviceNode.depth, 1, 'direct dep depth is 1');
});

// ═══════════════════════════════════════════════════════════════════════════
// detectCycles
// ═══════════════════════════════════════════════════════════════════════════

suite('detectCycles');

test('detects simple cycle', () => {
  const g = buildCyclicGraph();
  const cycles = detectCycles(g);

  assert(cycles.length >= 1, `should find at least 1 cycle, got ${cycles.length}`);
  const firstCycle = cycles[0];
  assertEqual(firstCycle.length, 3, 'cycle should have 3 edges');
  // Cycle should contain a, b, c
  const flat = firstCycle.cycle.join(',');
  assert(flat.includes('a.js'), 'cycle should include a');
  assert(flat.includes('b.js'), 'cycle should include b');
  assert(flat.includes('c.js'), 'cycle should include c');
});

test('no cycles in acyclic graph', () => {
  const g = buildTestGraph();
  const cycles = detectCycles(g);
  assertEqual(cycles.length, 0, 'acyclic graph should have no cycles');
});

test('empty graph returns empty', () => {
  const g = new KnowledgeGraph();
  const cycles = detectCycles(g);
  assertEqual(cycles.length, 0, 'empty graph = no cycles');
});

test('respects maxCycles option', () => {
  const g = buildCyclicGraph();
  const cycles = detectCycles(g, { maxCycles: 1 });
  assert(cycles.length <= 1, 'should respect maxCycles');
});

test('cycle is closed (first == last)', () => {
  const g = buildCyclicGraph();
  const cycles = detectCycles(g);
  if (cycles.length > 0) {
    const cycle = cycles[0].cycle;
    assertEqual(cycle[0], cycle[cycle.length - 1], 'cycle should be closed');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// computeMetrics
// ═══════════════════════════════════════════════════════════════════════════

suite('computeMetrics');

test('service.js has high fanIn (imported by main + test)', () => {
  const g = buildTestGraph();
  const metrics = computeMetrics(g, 'src/service.js');

  assert(metrics.fanIn >= 2, `fanIn should be >= 2, got ${metrics.fanIn}`);
  assert(metrics.fanOut >= 1, `fanOut should be >= 1, got ${metrics.fanOut}`);
  assert(metrics.degree >= 3, `degree should be >= 3, got ${metrics.degree}`);
});

test('util.js has 0 fanOut (leaf node)', () => {
  const g = buildTestGraph();
  const metrics = computeMetrics(g, 'src/util.js');

  assertEqual(metrics.dependencies, 0, 'util has no imports');
  assert(metrics.dependents >= 1, 'util is imported by service');
});

test('nonexistent node returns zeros', () => {
  const g = buildTestGraph();
  const metrics = computeMetrics(g, 'nonexistent.js');

  assertEqual(metrics.fanIn, 0, 'no fanIn');
  assertEqual(metrics.fanOut, 0, 'no fanOut');
  assertEqual(metrics.degree, 0, 'no degree');
  assertEqual(metrics.hubPenalty, 1.0, 'default hub penalty');
});

test('hub penalty is in range', () => {
  const g = buildTestGraph();
  const metrics = computeMetrics(g, 'src/main.js');

  assert(metrics.hubPenalty >= 0.1 && metrics.hubPenalty <= 1.0,
    `hubPenalty should be in [0.1, 1.0], got ${metrics.hubPenalty}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// explainContext
// ═══════════════════════════════════════════════════════════════════════════

suite('explainContext');

test('seed file gets seed explanation', () => {
  const g = buildTestGraph();
  const result = explainContext(g, ['src/main.js', 'src/service.js'], ['src/main.js']);

  const main = result.find(e => e.file === 'src/main.js');
  assert(main.reason.includes('Seed'), 'seed file should be explained as seed');
  assertEqual(main.pathFromSeed.length, 1, 'seed path is just itself');
});

test('1-hop dependency explained', () => {
  const g = buildTestGraph();
  const result = explainContext(g, ['src/service.js'], ['src/main.js']);

  const service = result.find(e => e.file === 'src/service.js');
  assert(service.reason.includes('1-hop'), `should explain as 1-hop, got: ${service.reason}`);
  assert(service.pathFromSeed !== null, 'should have path from seed');
});

test('2-hop dependency explained', () => {
  const g = buildTestGraph();
  const result = explainContext(g, ['src/util.js'], ['src/main.js']);

  const util = result.find(e => e.file === 'src/util.js');
  assert(util.reason.includes('2-hop'), `should explain as 2-hop, got: ${util.reason}`);
});

test('unconnected file gets relevance explanation', () => {
  const g = buildTestGraph();
  // Add a disconnected node
  g.addNode(fileNodeId('src/isolated.js'), NodeType.FILE, { name: 'src/isolated.js' });

  const result = explainContext(g, ['src/isolated.js'], ['src/main.js']);
  const isolated = result.find(e => e.file === 'src/isolated.js');
  assert(isolated.reason.includes('No direct path'), `should mention no path, got: ${isolated.reason}`);
  assertEqual(isolated.pathFromSeed, null, 'no path for isolated node');
});

test('includes metrics for each file', () => {
  const g = buildTestGraph();
  const result = explainContext(g, ['src/main.js'], ['src/main.js']);

  assert(result[0].metrics !== undefined, 'should include metrics');
  assert(typeof result[0].metrics.fanIn === 'number', 'metrics should have fanIn');
});

// ═══════════════════════════════════════════════════════════════════════════
// exportMermaid
// ═══════════════════════════════════════════════════════════════════════════

suite('exportMermaid');

test('produces valid mermaid syntax', () => {
  const g = buildTestGraph();
  const subgraph = getImpactRadius(g, 'src/main.js', 1);
  const mermaid = exportMermaid(subgraph);

  assert(mermaid.startsWith('graph TD'), 'should start with graph direction');
  assert(mermaid.includes('-->'), 'should contain edges');
});

test('custom direction', () => {
  const subgraph = { nodes: [{ id: 'file:a.js', type: 'file' }], edges: [] };
  const mermaid = exportMermaid(subgraph, { direction: 'LR' });
  assert(mermaid.startsWith('graph LR'), 'should use LR direction');
});

test('includes title as comment', () => {
  const subgraph = { nodes: [], edges: [] };
  const mermaid = exportMermaid(subgraph, { title: 'Test Graph' });
  assert(mermaid.includes('%% Test Graph'), 'should include title comment');
});

test('empty subgraph', () => {
  const mermaid = exportMermaid({ nodes: [], edges: [] });
  assertEqual(mermaid, 'graph TD', 'empty = just header');
});

test('sanitizes special characters in IDs', () => {
  const subgraph = {
    nodes: [
      { id: 'file:src/my-file.js', type: 'file' },
      { id: 'file:src/other.js', type: 'file' },
    ],
    edges: [
      { from: 'file:src/my-file.js', to: 'file:src/other.js', type: 'IMPORTS' },
    ],
  };
  const mermaid = exportMermaid(subgraph);
  // Node IDs are sanitized (hyphens → underscores), but labels keep original names
  assert(mermaid.includes('file_src_my_file_js'), 'should sanitize node ID');
  assert(mermaid.includes('my-file.js'), 'label should keep original name');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();

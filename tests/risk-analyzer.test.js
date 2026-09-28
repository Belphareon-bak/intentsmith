// tests/risk-analyzer.test.js — Risk Analysis Engine unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { analyzeRisk, formatRiskReport, RiskLevel } from '../src/code-intel/risk-analyzer.js';
import { KnowledgeGraph, NodeType, EdgeType, fileNodeId, symbolNodeId } from '../src/code-intel/knowledge-graph.js';
import { SymbolIndex } from '../src/code-intel/symbol-index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTestGraph() {
  const g = new KnowledgeGraph();

  // Files
  g.addNode('file:src/service.js', NodeType.FILE, { name: 'src/service.js', file: 'src/service.js' });
  g.addNode('file:src/controller.js', NodeType.FILE, { name: 'src/controller.js', file: 'src/controller.js' });
  g.addNode('file:src/util.js', NodeType.FILE, { name: 'src/util.js', file: 'src/util.js' });
  g.addNode('file:tests/service.test.js', NodeType.FILE, { name: 'tests/service.test.js', file: 'tests/service.test.js' });

  // Symbols
  g.addNode('sym:processOrder@src/service.js', NodeType.FUNCTION, { name: 'processOrder', file: 'src/service.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/service.js', 'sym:processOrder@src/service.js');

  g.addNode('sym:handleRequest@src/controller.js', NodeType.FUNCTION, { name: 'handleRequest', file: 'src/controller.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/controller.js', 'sym:handleRequest@src/controller.js');

  g.addNode('sym:formatDate@src/util.js', NodeType.FUNCTION, { name: 'formatDate', file: 'src/util.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/util.js', 'sym:formatDate@src/util.js');

  // Edges: controller calls processOrder, controller imports service
  g.addEdge(EdgeType.CALLS, 'sym:handleRequest@src/controller.js', 'sym:processOrder@src/service.js');
  g.addEdge(EdgeType.REFERENCES, 'file:src/controller.js', 'sym:processOrder@src/service.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/controller.js', 'file:src/service.js');

  // Test relationship
  g.addEdge(EdgeType.TESTED_BY, 'file:src/service.js', 'file:tests/service.test.js');

  return g;
}

function buildTestIndex() {
  const idx = new SymbolIndex();
  idx.symbolsByName.set('processOrder', [{ name: 'processOrder', file: 'src/service.js', type: 'function', line: 10 }]);
  idx.symbolsByName.set('handleRequest', [{ name: 'handleRequest', file: 'src/controller.js', type: 'function', line: 5 }]);
  idx.symbolsByName.set('formatDate', [{ name: 'formatDate', file: 'src/util.js', type: 'function', line: 1 }]);
  idx.symbolsByFile.set('src/service.js', [{ name: 'processOrder', file: 'src/service.js', type: 'function', line: 10 }]);
  idx.symbolsByFile.set('src/controller.js', [{ name: 'handleRequest', file: 'src/controller.js', type: 'function', line: 5 }]);
  idx.symbolsByFile.set('src/util.js', [{ name: 'formatDate', file: 'src/util.js', type: 'function', line: 1 }]);
  idx.symbolCount = 3;
  idx._projectPath = '/test';
  return idx;
}

// ─── Score Calculation ──────────────────────────────────────────────────────

suite('RiskAnalyzer — Score Calculation');

await testAsync('tested symbol with 1 caller has moderate risk', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assert(result.riskScore >= 0, 'score should be >= 0');
  assert(result.riskScore <= 100, 'score should be <= 100');
  // processOrder: 1 direct caller → impact = min(100, 15+3) = 18
  // tested → coverage ≈ low (25% estimate → (1-0.25)*40 = 30)
  // centrality: 1 connected file → 12
  assert(result.riskScore >= 10, `should have moderate risk, got ${result.riskScore}`);
});

await testAsync('isolated symbol has low risk', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'formatDate', { graph: g, index: idx });

  // formatDate: 0 callers → impact = 0
  // no TESTED_BY → coverage = 40
  // no connections → centrality = 0
  assert(result.riskScore <= 25, `isolated symbol should be LOW risk, got ${result.riskScore}`);
  assertEqual(result.riskLevel, RiskLevel.LOW);
});

await testAsync('score never negative', async () => {
  const g = new KnowledgeGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'formatDate', { graph: g, index: idx });

  assert(result.riskScore >= 0, `score should never be negative, got ${result.riskScore}`);
});

await testAsync('score caps at 100', async () => {
  // Build a graph with extreme connectivity
  const g = new KnowledgeGraph();
  g.addNode('file:src/core.js', NodeType.FILE, { name: 'src/core.js', file: 'src/core.js' });
  g.addNode('sym:hub@src/core.js', NodeType.FUNCTION, { name: 'hub', file: 'src/core.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/core.js', 'sym:hub@src/core.js');

  // Add 20 callers + connections
  for (let i = 0; i < 20; i++) {
    const f = `src/caller${i}.js`;
    g.addNode(`file:${f}`, NodeType.FILE, { name: f, file: f });
    g.addNode(`sym:fn${i}@${f}`, NodeType.FUNCTION, { name: `fn${i}`, file: f });
    g.addEdge(EdgeType.CALLS, `sym:fn${i}@${f}`, 'sym:hub@src/core.js');
    g.addEdge(EdgeType.REFERENCES, `file:${f}`, 'sym:hub@src/core.js');
    g.addEdge(EdgeType.IMPORTS, `file:${f}`, 'file:src/core.js');
  }

  const idx = new SymbolIndex();
  idx.symbolsByName.set('hub', [{ name: 'hub', file: 'src/core.js', type: 'function', line: 1 }]);
  idx.symbolCount = 1;
  idx._projectPath = '/test';

  const result = await analyzeRisk(null, 'hub', { graph: g, index: idx });

  assert(result.riskScore <= 100, `score should cap at 100, got ${result.riskScore}`);
});

// ─── Risk Level Ranges ──────────────────────────────────────────────────────

suite('RiskAnalyzer — Risk Levels');

test('RiskLevel enum values', () => {
  assertEqual(RiskLevel.LOW, 'LOW');
  assertEqual(RiskLevel.MEDIUM, 'MEDIUM');
  assertEqual(RiskLevel.HIGH, 'HIGH');
  assertEqual(RiskLevel.CRITICAL, 'CRITICAL');
});

// ─── Impact Signal ──────────────────────────────────────────────────────────

suite('RiskAnalyzer — Impact Signal');

await testAsync('direct callers increase impact', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assert(result.signals.impact > 0, `impact should be > 0 for called symbol, got ${result.signals.impact}`);
});

await testAsync('no callers = zero impact', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'formatDate', { graph: g, index: idx });

  assertEqual(result.signals.impact, 0);
});

// ─── Coverage Signal ─────────────────────────────────────────────────────────

suite('RiskAnalyzer — Coverage Signal');

await testAsync('untested file has penalty = 40', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  // util.js has no TESTED_BY edge
  const result = await analyzeRisk(null, 'formatDate', { graph: g, index: idx });

  assertEqual(result.signals.coverage, 40);
});

await testAsync('tested file has lower coverage score', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  // service.js has TESTED_BY edge
  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assert(result.signals.coverage < 40, `tested file should have coverage < 40, got ${result.signals.coverage}`);
});

// ─── Centrality Signal ──────────────────────────────────────────────────────

suite('RiskAnalyzer — Centrality Signal');

await testAsync('connected file has centrality > 0', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  // service.js has connections (controller imports it, tested by test file)
  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assert(result.signals.centrality > 0, `connected file should have centrality > 0, got ${result.signals.centrality}`);
});

await testAsync('isolated file has centrality 0', async () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/lonely.js', NodeType.FILE, { name: 'src/lonely.js', file: 'src/lonely.js' });
  g.addNode('sym:alone@src/lonely.js', NodeType.FUNCTION, { name: 'alone', file: 'src/lonely.js' });
  g.addEdge(EdgeType.DEFINES, 'file:src/lonely.js', 'sym:alone@src/lonely.js');

  const idx = new SymbolIndex();
  idx.symbolsByName.set('alone', [{ name: 'alone', file: 'src/lonely.js', type: 'function', line: 1 }]);
  idx.symbolCount = 1;
  idx._projectPath = '/test';

  const result = await analyzeRisk(null, 'alone', { graph: g, index: idx });

  assertEqual(result.signals.centrality, 0);
});

await testAsync('centrality counts unique files, not edges', async () => {
  const g = new KnowledgeGraph();
  g.addNode('file:src/hub.js', NodeType.FILE, { name: 'src/hub.js', file: 'src/hub.js' });
  g.addNode('file:src/a.js', NodeType.FILE, { name: 'src/a.js', file: 'src/a.js' });

  // Multiple edge types to same file
  g.addEdge(EdgeType.IMPORTS, 'file:src/hub.js', 'file:src/a.js');
  g.addEdge(EdgeType.IMPORTS, 'file:src/a.js', 'file:src/hub.js');

  g.addNode('sym:hub@src/hub.js', NodeType.FUNCTION, { name: 'hub', file: 'src/hub.js' });

  const idx = new SymbolIndex();
  idx.symbolsByName.set('hub', [{ name: 'hub', file: 'src/hub.js', type: 'function', line: 1 }]);
  idx.symbolCount = 1;
  idx._projectPath = '/test';

  const result = await analyzeRisk(null, 'hub', { graph: g, index: idx });

  // Only 1 unique connected file (a.js), not 2 edges
  assertEqual(result.signals.centrality, 12); // 1 × 12
});

// ─── Graceful Degradation ───────────────────────────────────────────────────

suite('RiskAnalyzer — Graceful Degradation');

await testAsync('empty graph + empty index returns low confidence', async () => {
  const g = new KnowledgeGraph();
  const idx = new SymbolIndex();

  const result = await analyzeRisk(null, 'anything', { graph: g, index: idx });

  assertEqual(result.confidence, 'low');
  assertEqual(result.riskScore, 0);
  assertEqual(result.riskLevel, RiskLevel.LOW);
});

await testAsync('missing symbol still returns result', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'nonExistentSymbol', { graph: g, index: idx });

  assert(result.riskScore >= 0, 'should return valid score');
  assertEqual(result.symbol, 'nonExistentSymbol');
});

await testAsync('index without graph has medium confidence', async () => {
  const g = new KnowledgeGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assertEqual(result.confidence, 'medium');
});

await testAsync('graph + index has high confidence', async () => {
  const g = buildTestGraph();
  const idx = buildTestIndex();

  const result = await analyzeRisk(null, 'processOrder', { graph: g, index: idx });

  assertEqual(result.confidence, 'high');
});

// ─── Report Formatting ─────────────────────────────────────────────────────

suite('RiskAnalyzer — Formatting');

test('formatRiskReport produces markdown', () => {
  const report = formatRiskReport({
    symbol: 'processOrder',
    riskScore: 65,
    riskLevel: RiskLevel.HIGH,
    signals: { impact: 80, coverage: 40, centrality: 60 },
    recommendations: ['High impact: many callers depend on this symbol'],
    confidence: 'high',
  });

  assert(report.includes('## Risk Analysis'), 'should have header');
  assert(report.includes('processOrder'), 'should mention symbol');
  assert(report.includes('65/100'), 'should show score');
  assert(report.includes('HIGH'), 'should show risk level');
  assert(report.includes('Impact'), 'should show impact signal');
  assert(report.includes('Coverage'), 'should show coverage signal');
  assert(report.includes('Centrality'), 'should show centrality signal');
  assert(report.includes('Recommendations'), 'should have recommendations');
});

test('formatRiskReport handles low risk', () => {
  const report = formatRiskReport({
    symbol: 'helper',
    riskScore: 5,
    riskLevel: RiskLevel.LOW,
    signals: { impact: 0, coverage: 10, centrality: 0 },
    recommendations: ['Low risk: this change is relatively isolated'],
    confidence: 'high',
  });

  assert(report.includes('LOW'), 'should show LOW level');
  assert(report.includes('5/100'), 'should show low score');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();

// tests/architecture-governance.test.js — v98 Architecture Governance tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { minePatterns, formatPatternsForPrompt } from '../src/code-intel/architecture-detector.js';
import { computeRiskScore } from '../src/code-intel/impact-analyzer.js';

// ─── Pattern Mining ──────────────────────────────────────────────────────────

suite('Pattern Mining');

test('detects controller pattern', () => {
  const files = [
    { file: 'src/controllers/user.js', content: 'app.get("/users", handler);\napp.post("/users", create);' },
    { file: 'src/controllers/product.js', content: 'app.get("/products", list);\napp.delete("/products/:id", remove);' },
  ];
  const patterns = minePatterns(files);
  const ctrl = patterns.find(p => p.patternName === 'controller');
  assert(ctrl, 'should detect controller pattern');
  assert(ctrl.frequency >= 2, `should have freq >= 2, got: ${ctrl.frequency}`);
});

test('detects error-handling pattern', () => {
  const files = [
    { file: 'src/service/a.js', content: 'try { doThing(); } catch (e) { handleError(e); }' },
    { file: 'src/service/b.js', content: 'promise.catch(err => log(err));' },
    { file: 'src/service/c.js', content: 'try { x(); } catch(e) { throw e; }' },
  ];
  const patterns = minePatterns(files);
  const eh = patterns.find(p => p.patternName === 'error-handling');
  assert(eh, 'should detect error-handling pattern');
  assert(eh.frequency >= 2, `should have freq >= 2, got: ${eh.frequency}`);
});

test('detects logging pattern', () => {
  const files = [
    { file: 'src/a.js', content: 'logger.info("starting");' },
    { file: 'src/b.js', content: 'logger.error("failed", err);' },
    { file: 'src/c.js', content: 'console.log("debug");' },
  ];
  const patterns = minePatterns(files);
  const log = patterns.find(p => p.patternName === 'logging');
  assert(log, 'should detect logging pattern');
});

test('detects authentication pattern', () => {
  const files = [
    { file: 'src/auth/login.js', content: 'const token = jwt.sign(payload);' },
    { file: 'src/auth/middleware.js', content: 'const decoded = jwt.verify(token);' },
  ];
  const patterns = minePatterns(files);
  const auth = patterns.find(p => p.patternName === 'authentication');
  assert(auth, 'should detect authentication pattern');
});

test('filters out rare patterns (< 2 occurrences)', () => {
  const files = [
    { file: 'src/a.js', content: 'app.get("/", handler);' },
  ];
  const patterns = minePatterns(files);
  // Only 1 occurrence → should be filtered
  const ctrl = patterns.find(p => p.patternName === 'controller');
  assertEqual(ctrl, undefined);
});

test('returns empty for no files', () => {
  assertEqual(minePatterns([]).length, 0);
  assertEqual(minePatterns(null).length, 0);
});

test('patterns sorted by frequency', () => {
  const files = [
    { file: 'a.js', content: 'try { x(); } catch(e) {}' },
    { file: 'b.js', content: 'try { y(); } catch(e) {}' },
    { file: 'c.js', content: 'try { z(); } catch(e) {}' },
    { file: 'd.js', content: 'logger.info("a");' },
    { file: 'e.js', content: 'logger.info("b");' },
  ];
  const patterns = minePatterns(files);
  if (patterns.length >= 2) {
    assert(patterns[0].frequency >= patterns[1].frequency, 'should be sorted by frequency desc');
  }
});

test('limits examples to 3 per pattern', () => {
  const files = Array.from({ length: 10 }, (_, i) => ({
    file: `src/ctrl${i}.js`,
    content: `app.get("/route${i}", handler);`,
  }));
  const patterns = minePatterns(files);
  const ctrl = patterns.find(p => p.patternName === 'controller');
  if (ctrl) {
    assert(ctrl.examples.length <= 3, `should limit to 3 examples, got: ${ctrl.examples.length}`);
  }
});

// ─── Pattern Formatting ─────────────────────────────────────────────────────

suite('Pattern Formatting');

test('formats patterns for prompt', () => {
  const patterns = [
    { patternName: 'controller', frequency: 5, examples: [{ file: 'src/ctrl.js', snippet: 'app.get("/", h)' }] },
  ];
  const result = formatPatternsForPrompt(patterns);
  assert(result.includes('controller'), 'should mention pattern name');
  assert(result.includes('5 occurrences'), 'should mention frequency');
  assert(result.includes('src/ctrl.js'), 'should mention example file');
});

test('returns empty for no patterns', () => {
  assertEqual(formatPatternsForPrompt([]), '');
  assertEqual(formatPatternsForPrompt(null), '');
});

// ─── Risk Scoring ────────────────────────────────────────────────────────────

suite('Risk Scoring');

test('low risk for isolated symbol', () => {
  const impact = {
    symbol: 'helperFn',
    impactedFunctions: [],
    impactedFiles: [],
    impactedTests: [],
    callChain: [],
    stats: { totalImpacted: 0, directCallers: 0, transitiveCallers: 0, testsAffected: 0 },
  };
  const risk = computeRiskScore(impact);
  assertEqual(risk.riskLevel, 'LOW');
  assert(risk.riskScore < 0.2, `should be low risk, got: ${risk.riskScore}`);
});

test('high risk for heavily used symbol with no tests', () => {
  const impact = {
    symbol: 'authenticate',
    impactedFunctions: ['login', 'register', 'middleware', 'api'],
    impactedFiles: ['src/auth.js', 'src/login.js', 'src/api.js', 'src/middleware.js'],
    impactedTests: [],
    callChain: [['auth', 'login', 'api']],
    stats: { totalImpacted: 10, directCallers: 5, transitiveCallers: 5, testsAffected: 0 },
  };
  const risk = computeRiskScore(impact);
  assert(risk.riskLevel === 'HIGH' || risk.riskLevel === 'CRITICAL',
    `should be HIGH or CRITICAL, got: ${risk.riskLevel}`);
  assert(risk.riskScore >= 0.5, `should have risk >= 0.5, got: ${risk.riskScore}`);
});

test('lower risk when tests exist', () => {
  const impact = {
    symbol: 'createUser',
    impactedFunctions: ['handler', 'service'],
    impactedFiles: ['src/user.js', 'src/api.js'],
    impactedTests: ['tests/user.test.js', 'tests/api.test.js'],
    callChain: [],
    stats: { totalImpacted: 4, directCallers: 2, transitiveCallers: 2, testsAffected: 2 },
  };
  const risk = computeRiskScore(impact);
  assert(risk.riskScore < 0.5, `tests should lower risk, got: ${risk.riskScore}`);
});

test('identifies test gaps', () => {
  const impact = {
    symbol: 'processPayment',
    impactedFunctions: ['checkout'],
    impactedFiles: ['src/payment.js', 'src/checkout.js'],
    impactedTests: ['tests/payment.test.js'],
    callChain: [],
    stats: { totalImpacted: 3, directCallers: 1, transitiveCallers: 2, testsAffected: 1 },
  };
  const risk = computeRiskScore(impact);
  assert(risk.testGaps.length > 0, 'should identify test gaps');
});

test('identifies breaking changes for widely-used symbols', () => {
  const impact = {
    symbol: 'formatDate',
    impactedFunctions: Array.from({ length: 5 }, (_, i) => `caller${i}`),
    impactedFiles: Array.from({ length: 5 }, (_, i) => `src/file${i}.js`),
    impactedTests: [],
    callChain: [],
    stats: { totalImpacted: 10, directCallers: 5, transitiveCallers: 5, testsAffected: 0 },
  };
  const risk = computeRiskScore(impact);
  assert(risk.breakingChanges.length > 0, 'should flag breaking change risk');
});

test('handles null/empty impact', () => {
  const risk = computeRiskScore(null);
  assertEqual(risk.riskLevel, 'LOW');
  assertEqual(risk.riskScore, 0);
});

test('risk details include factors', () => {
  const impact = {
    symbol: 'test',
    impactedFunctions: ['a', 'b'],
    impactedFiles: ['f1.js', 'f2.js'],
    impactedTests: ['t1.js'],
    callChain: [],
    stats: { totalImpacted: 3, directCallers: 2, transitiveCallers: 1, testsAffected: 1 },
  };
  const risk = computeRiskScore(impact);
  assert('dependencyFactor' in risk.details, 'should have dependencyFactor');
  assert('coverageFactor' in risk.details, 'should have coverageFactor');
  assert(typeof risk.details.dependencyFactor === 'number', 'dependencyFactor should be number');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();

// tests/build-strategy.test.js — Adaptive Build Strategy (F9) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  BuildStrategy,
  selectStrategy,
  inferStrategy,
  formatStrategyForPrompt,
} from '../src/planner/build-strategy.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkArch(frameworks = [], layers = {}, patterns = []) {
  return { framework: frameworks, layers, patterns };
}

function mkPattern(buildStrategy, success = true) {
  return { type: 'fix_archetype', data: { buildStrategy, success }, confidence: 0.8 };
}

// ═══════════════════════════════════════════════════════════════════════════
// BuildStrategy enum
// ═══════════════════════════════════════════════════════════════════════════

suite('BuildStrategy');

test('all strategies defined', () => {
  assertEqual(BuildStrategy.SCHEMA_FIRST, 'schema_first', 'SCHEMA_FIRST');
  assertEqual(BuildStrategy.COMPONENT_FIRST, 'component_first', 'COMPONENT_FIRST');
  assertEqual(BuildStrategy.COMMAND_FIRST, 'command_first', 'COMMAND_FIRST');
  assertEqual(BuildStrategy.MODEL_FIRST, 'model_first', 'MODEL_FIRST');
  assertEqual(BuildStrategy.TEST_FIRST, 'test_first', 'TEST_FIRST');
  assertEqual(BuildStrategy.DEFAULT, 'default', 'DEFAULT');
});

test('is frozen', () => {
  assert(Object.isFrozen(BuildStrategy), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// selectStrategy — Framework signal
// ═══════════════════════════════════════════════════════════════════════════

suite('selectStrategy — frameworks');

test('Express → SCHEMA_FIRST', () => {
  const result = selectStrategy(mkArch(['Express']));
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'Express → schema-first');
  assert(result.confidence > 0, 'has confidence');
});

test('React → COMPONENT_FIRST', () => {
  const result = selectStrategy(mkArch(['React']));
  assertEqual(result.strategy, BuildStrategy.COMPONENT_FIRST, 'React → component-first');
});

test('Django → MODEL_FIRST', () => {
  const result = selectStrategy(mkArch(['Django']));
  assertEqual(result.strategy, BuildStrategy.MODEL_FIRST, 'Django → model-first');
});

test('Commander → COMMAND_FIRST', () => {
  const result = selectStrategy(mkArch(['Commander']));
  assertEqual(result.strategy, BuildStrategy.COMMAND_FIRST, 'Commander → command-first');
});

test('Flask → SCHEMA_FIRST', () => {
  const result = selectStrategy(mkArch(['Flask']));
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'Flask → schema-first');
});

test('NestJS alone → layers decide (no framework signal)', () => {
  const result = selectStrategy(mkArch(['NestJS']));
  // NestJS has null in FRAMEWORK_STRATEGY, so no fw signal → DEFAULT
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'NestJS alone → default');
});

test('NestJS + model-heavy layers → MODEL_FIRST', () => {
  const result = selectStrategy(mkArch(['NestJS'], {
    model: ['user.model.ts', 'order.model.ts', 'product.model.ts'],
    controller: ['app.controller.ts'],
  }));
  assertEqual(result.strategy, BuildStrategy.MODEL_FIRST, 'NestJS + models → model-first');
});

test('NestJS + controller-heavy layers → SCHEMA_FIRST', () => {
  const result = selectStrategy(mkArch(['NestJS'], {
    controller: ['user.ctrl.ts', 'order.ctrl.ts', 'product.ctrl.ts'],
    model: ['base.model.ts'],
  }));
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'NestJS + controllers → schema-first');
});

// ═══════════════════════════════════════════════════════════════════════════
// selectStrategy — Layer signal
// ═══════════════════════════════════════════════════════════════════════════

suite('selectStrategy — layers');

test('dominant model layer → MODEL_FIRST', () => {
  const result = selectStrategy(mkArch([], {
    model: ['a.js', 'b.js', 'c.js'],
    controller: ['d.js'],
  }));
  assertEqual(result.strategy, BuildStrategy.MODEL_FIRST, 'model-heavy → model-first');
});

test('dominant view layer → COMPONENT_FIRST', () => {
  const result = selectStrategy(mkArch([], {
    view: ['page1.jsx', 'page2.jsx', 'page3.jsx'],
    service: ['api.js'],
  }));
  assertEqual(result.strategy, BuildStrategy.COMPONENT_FIRST, 'view-heavy → component-first');
});

test('dominant test layer → TEST_FIRST', () => {
  const result = selectStrategy(mkArch([], {
    test: ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'],
    service: ['svc.js'],
  }));
  assertEqual(result.strategy, BuildStrategy.TEST_FIRST, 'test-heavy → test-first');
});

test('empty layers → no layer signal', () => {
  const result = selectStrategy(mkArch([], {}));
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'no layers → default');
});

// ═══════════════════════════════════════════════════════════════════════════
// selectStrategy — Pattern history signal
// ═══════════════════════════════════════════════════════════════════════════

suite('selectStrategy — patterns');

test('past success boosts strategy', () => {
  const patterns = [
    mkPattern('schema_first', true),
    mkPattern('schema_first', true),
    mkPattern('schema_first', true),
  ];
  const result = selectStrategy(mkArch(), patterns);
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'pattern → schema-first');
});

test('past failure downgrades strategy', () => {
  const patterns = [
    mkPattern('model_first', false),
    mkPattern('model_first', false),
    mkPattern('schema_first', true),
    mkPattern('schema_first', true),
  ];
  const result = selectStrategy(mkArch(), patterns);
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'schema beats failed model');
});

test('no history → no pattern signal', () => {
  const result = selectStrategy(mkArch(), []);
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'no patterns → default');
});

test('single data point ignored (needs ≥2)', () => {
  const patterns = [mkPattern('test_first', true)];
  const result = selectStrategy(mkArch(), patterns);
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'single entry → default');
});

// ═══════════════════════════════════════════════════════════════════════════
// selectStrategy — Multi-signal
// ═══════════════════════════════════════════════════════════════════════════

suite('selectStrategy — multi-signal');

test('framework + layers agree → high confidence', () => {
  const result = selectStrategy(mkArch(['Express'], {
    controller: ['a.js', 'b.js'],
    middleware: ['auth.js'],
  }));
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'all agree → schema-first');
  assert(result.confidence >= 0.5, `confidence should be high, got ${result.confidence}`);
});

test('framework + layers conflict → framework wins (higher weight)', () => {
  const result = selectStrategy(mkArch(['React'], {
    model: ['a.js', 'b.js', 'c.js'],
  }));
  // React (fw=0.4, conf=0.8) vs model (layer=0.3, conf=0.75)
  // React score: 0.8*0.4=0.32, model: 0.75*0.3=0.225
  assertEqual(result.strategy, BuildStrategy.COMPONENT_FIRST, 'React fw wins over model layers');
});

test('all three signals → combined result', () => {
  const patterns = [
    mkPattern('schema_first', true),
    mkPattern('schema_first', true),
  ];
  const result = selectStrategy(
    mkArch(['Express'], { controller: ['a.js', 'b.js'] }),
    patterns
  );
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'all three agree');
  assert(result.confidence > 0.5, 'high confidence with 3 signals');
});

// ═══════════════════════════════════════════════════════════════════════════
// inferStrategy
// ═══════════════════════════════════════════════════════════════════════════

suite('inferStrategy');

test('delegates to selectStrategy', () => {
  const result = inferStrategy(['Express'], {}, []);
  assertEqual(result.strategy, BuildStrategy.SCHEMA_FIRST, 'Express → schema-first');
  assert(typeof result.source === 'string', 'has source');
});

test('null inputs → default', () => {
  const result = inferStrategy(null, null, null);
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'null → default');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatStrategyForPrompt
// ═══════════════════════════════════════════════════════════════════════════

suite('formatStrategyForPrompt');

test('high confidence → Recommended', () => {
  const result = formatStrategyForPrompt({
    strategy: BuildStrategy.SCHEMA_FIRST,
    ordering: ['routes', 'handlers', 'services'],
    confidence: 0.8,
    rationale: 'framework:Express',
  });
  assert(result.includes('Recommended'), 'high conf → Recommended');
  assert(result.includes('Schema-First'), 'includes strategy name');
  assert(result.includes('1. routes'), 'includes ordering');
});

test('medium confidence → Hint', () => {
  const result = formatStrategyForPrompt({
    strategy: BuildStrategy.MODEL_FIRST,
    ordering: ['models', 'services', 'API'],
    confidence: 0.5,
    rationale: 'layers:model_first',
  });
  assert(result.includes('Hint'), 'medium conf → Hint');
  assert(result.includes('Model-First'), 'includes strategy name');
  assert(result.includes('suggestion'), 'indicates suggestion');
});

test('low confidence → empty (omitted)', () => {
  const result = formatStrategyForPrompt({
    strategy: BuildStrategy.COMMAND_FIRST,
    ordering: ['commands'],
    confidence: 0.3,
    rationale: 'weak',
  });
  assertEqual(result, '', 'low conf → empty');
});

test('DEFAULT strategy → empty (omitted)', () => {
  const result = formatStrategyForPrompt({
    strategy: BuildStrategy.DEFAULT,
    ordering: ['core'],
    confidence: 0.9,
    rationale: 'none',
  });
  assertEqual(result, '', 'default → empty');
});

test('null input → empty', () => {
  assertEqual(formatStrategyForPrompt(null), '', 'null → empty');
});

test('with ordering numbers', () => {
  const result = formatStrategyForPrompt({
    strategy: BuildStrategy.COMPONENT_FIRST,
    ordering: ['components', 'state', 'routing', 'API', 'tests'],
    confidence: 0.75,
    rationale: 'framework:React',
  });
  assert(result.includes('1. components'), 'numbered ordering');
  assert(result.includes('5. tests'), 'all items numbered');
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('edge cases');

test('null architecture', () => {
  const result = selectStrategy(null);
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'null → default');
  assertEqual(result.confidence, 0, 'zero confidence');
});

test('empty architecture', () => {
  const result = selectStrategy(mkArch());
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'empty → default');
});

test('unknown framework → no signal', () => {
  const result = selectStrategy(mkArch(['UnknownFramework2000']));
  assertEqual(result.strategy, BuildStrategy.DEFAULT, 'unknown → default');
});

test('ordering always present', () => {
  const result = selectStrategy(mkArch(['Express']));
  assert(Array.isArray(result.ordering), 'ordering is array');
  assert(result.ordering.length > 0, 'ordering not empty');
});

test('rationale always present', () => {
  const result = selectStrategy(mkArch(['React']));
  assert(typeof result.rationale === 'string', 'rationale is string');
  assert(result.rationale.length > 0, 'rationale not empty');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();

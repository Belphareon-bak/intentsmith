// v121: Specialist Registries — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests data-driven boost patterns, dynamic ToolType, and ctx.registries structure.

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

// ─── Auto-Select Boost Patterns ──────────────────────────────────────────────

suite('auto-select: data-driven boost patterns');

const {
  registerBoostPatterns,
  unregisterBoostPatterns,
  getBoostPatterns,
  _testInternals,
} = await import('../src/expertises/auto-select.js');

test('registerBoostPatterns stores patterns', () => {
  registerBoostPatterns('test-specialist', [/test-pattern/i, /another/i]);
  const pats = getBoostPatterns('test-specialist');
  assertEqual(pats.length, 2);
  assert(pats[0] instanceof RegExp);
});

test('getBoostPatterns returns empty array for unknown', () => {
  const pats = getBoostPatterns('nonexistent-specialist');
  assert(Array.isArray(pats));
  assertEqual(pats.length, 0);
});

test('registerBoostPatterns is idempotent (double call)', () => {
  registerBoostPatterns('idem-specialist', [/a/]);
  registerBoostPatterns('idem-specialist', [/b/]);
  const pats = getBoostPatterns('idem-specialist');
  assertEqual(pats.length, 1);
  assert(pats[0].source === 'b', 'second call should overwrite');
});

test('unregisterBoostPatterns removes patterns', () => {
  registerBoostPatterns('remove-me', [/x/]);
  assert(getBoostPatterns('remove-me').length === 1);
  unregisterBoostPatterns('remove-me');
  assertEqual(getBoostPatterns('remove-me').length, 0);
});

test('unregisterBoostPatterns is safe for unknown id', () => {
  unregisterBoostPatterns('never-registered');
  // Should not throw
  assert(true);
});

test('accountant NOT in default boost patterns', () => {
  const pats = getBoostPatterns('accountant');
  assertEqual(pats.length, 0, 'accountant should not be in default patterns');
});

test('_testInternals exposes _boostPatterns Map', () => {
  assert(_testInternals._boostPatterns instanceof Map, '_boostPatterns should be a Map');
});

// Cleanup test patterns
unregisterBoostPatterns('test-specialist');
unregisterBoostPatterns('idem-specialist');

// ─── CRE Dynamic ToolType ────────────────────────────────────────────────────

suite('cre-decision: dynamic ToolType registry');

const {
  ToolType,
  registerToolType,
  unregisterToolType,
  isKnownTool,
  getSpecialistToolIds,
  _testCREInternals,
} = await import('../src/chat/cre-decision.js');

test('accountant tools NOT in ToolType enum', () => {
  const toolTypeValues = Object.values(ToolType);
  assert(!toolTypeValues.includes('accountant.tax_calculator'), 'tax_calculator should not be in ToolType');
  assert(!toolTypeValues.includes('accountant.vat_calculator'), 'vat_calculator should not be in ToolType');
  assert(!toolTypeValues.includes('accountant.salary_calculator'), 'salary_calculator should not be in ToolType');
  assert(!toolTypeValues.includes('accountant.deadline_checker'), 'deadline_checker should not be in ToolType');
  assert(!toolTypeValues.includes('accountant.compare_tax_entities'), 'compare should not be in ToolType');
});

test('registerToolType makes tool known', () => {
  registerToolType('test.my_tool');
  assert(isKnownTool('test.my_tool'), 'registered tool should be known');
});

test('isKnownTool returns false for unknown', () => {
  assert(!isKnownTool('nonexistent.tool'));
});

test('isKnownTool works for built-in ToolType', () => {
  assert(isKnownTool(ToolType.WEB_SEARCH), 'WEB_SEARCH should be known');
});

test('getSpecialistToolIds returns registered tools', () => {
  registerToolType('test.tool_a');
  registerToolType('test.tool_b');
  const ids = getSpecialistToolIds();
  assert(ids.includes('test.tool_a'));
  assert(ids.includes('test.tool_b'));
});

test('unregisterToolType removes tool', () => {
  registerToolType('test.remove_me');
  assert(isKnownTool('test.remove_me'));
  unregisterToolType('test.remove_me');
  assert(!isKnownTool('test.remove_me'));
});

test('unregisterToolType is safe for unknown', () => {
  unregisterToolType('test.never_existed');
  assert(true);
});

test('registerToolType is idempotent', () => {
  registerToolType('test.idem');
  registerToolType('test.idem');
  const count = getSpecialistToolIds().filter(id => id === 'test.idem').length;
  assertEqual(count, 1, 'should only appear once');
});

test('_testCREInternals exposes _specialistTools Map', () => {
  assert(_testCREInternals._specialistTools instanceof Map);
});

// Cleanup
unregisterToolType('test.my_tool');
unregisterToolType('test.tool_a');
unregisterToolType('test.tool_b');
unregisterToolType('test.idem');

// ─── ToolExecutor ────────────────────────────────────────────────────────────

suite('tool-executor: register/unregister');

const { toolExecutor } = await import('../src/executor/tool-executor.js');

test('toolExecutor has register method', () => {
  assert(typeof toolExecutor.register === 'function');
});

test('toolExecutor has unregister method', () => {
  assert(typeof toolExecutor.unregister === 'function');
});

test('register + unregister cycle works', () => {
  const handler = async () => ({ ok: true });
  toolExecutor.register('test.exec_tool', handler);
  assert(toolExecutor.toolHandlers.has('test.exec_tool'), 'handler should be registered');
  toolExecutor.unregister('test.exec_tool');
  assert(!toolExecutor.toolHandlers.has('test.exec_tool'), 'handler should be removed');
});

test('accountant tools NOT pre-registered in toolExecutor', () => {
  assert(!toolExecutor.toolHandlers.has('accountant.tax_calculator'),
    'accountant tools should not be hardcoded in tool-executor');
  assert(!toolExecutor.toolHandlers.has('accountant.vat_calculator'));
  assert(!toolExecutor.toolHandlers.has('accountant.salary_calculator'));
});

// ─── Scenario Registry ───────────────────────────────────────────────────────

suite('scenario-engine: no hardcoded accountant');

const { scenarioRegistry } = await import('../src/expertises/scenario-engine.js');

test('accountant.tax_optimization NOT in scenario registry', () => {
  const scenario = scenarioRegistry.getScenario('accountant.tax_optimization');
  assert(!scenario, 'accountant scenario should not be hardcoded in scenario-engine');
});

test('scenarioRegistry has register method', () => {
  assert(typeof scenarioRegistry.register === 'function');
});

test('scenarioRegistry has unregisterBySpecialist method', () => {
  assert(typeof scenarioRegistry.unregisterBySpecialist === 'function');
});

test('register + unregisterBySpecialist cycle', () => {
  scenarioRegistry.register({
    id: 'test.scenario_1',
    specialistId: 'test-specialist',
    name: 'Test Scenario',
    triggers: [/test/],
    steps: [{ id: 'step1', question: 'test?', extract: () => 'yes', required: true }],
  });
  const s = scenarioRegistry.getScenario('test.scenario_1');
  assert(s, 'scenario should be registered');
  scenarioRegistry.unregisterBySpecialist('test-specialist');
  const s2 = scenarioRegistry.getScenario('test.scenario_1');
  assert(!s2, 'scenario should be removed after unregisterBySpecialist');
});

// ─── Expertise Layer ─────────────────────────────────────────────────────────

suite('expertise-layer: accountant removed from BUILTIN');

const { BUILTIN_EXPERTISES, expertiseRegistry } = await import('../src/expertises/expertise-layer.js');

test('accountant NOT in BUILTIN_EXPERTISES', () => {
  assert(!BUILTIN_EXPERTISES.accountant, 'accountant should not be in BUILTIN_EXPERTISES');
});

test('expertiseRegistry has addCustom method', () => {
  assert(typeof expertiseRegistry.addCustom === 'function');
});

test('expertiseRegistry has removeCustom method', () => {
  assert(typeof expertiseRegistry.removeCustom === 'function');
});

test('addCustom + removeCustom cycle', () => {
  expertiseRegistry.addCustom({
    id: 'test-expertise',
    name: 'Test',
    domain: 'test',
    description: 'Test expertise',
  });
  const exp = expertiseRegistry.get('test-expertise');
  assert(exp, 'custom expertise should be findable');
  expertiseRegistry.removeCustom('test-expertise');
  const exp2 = expertiseRegistry.get('test-expertise');
  assert(!exp2, 'custom expertise should be removed');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

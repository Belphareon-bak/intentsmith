// v121: Accountant Self-Contained — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests that accountant specialist registers everything via ctx.registries
// without any hardcoded dependencies in core.

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { ToolAdapter } from '../src/expertises/tool-adapter.js';
import {
  EXTENSION_HOST_CAPABILITY,
  canonicalizeLegacySpecialistManifest,
  createExtensionContextV1,
} from '../contracts/m3/extension-v1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Mock registries for isolated testing ────────────────────────────────────

function createMockRegistries() {
  const boostPatterns = new Map();
  const toolTypes = new Map();
  const toolHandlers = new Map();
  const scenarios = new Map();
  const customExpertises = new Map();
  const capabilities = new Map();

  return {
    autoSelect: {
      registerBoostPatterns: (id, pats) => boostPatterns.set(id, pats),
      unregisterBoostPatterns: (id) => boostPatterns.delete(id),
      getBoostPatterns: (id) => boostPatterns.get(id) || [],
      _data: boostPatterns,
    },
    cre: {
      registerToolType: (id) => toolTypes.set(id, true),
      unregisterToolType: (id) => toolTypes.delete(id),
      isKnownTool: (id) => toolTypes.has(id),
      _data: toolTypes,
    },
    toolExecutor: {
      register: (id, handler) => toolHandlers.set(id, handler),
      unregister: (id) => toolHandlers.delete(id),
      _data: toolHandlers,
    },
    scenario: {
      register: (s) => scenarios.set(s.id, s),
      get: (id) => scenarios.get(id) || null,
      unregisterBySpecialist: (spId) => {
        for (const [id, s] of scenarios) {
          if (s.specialistId === spId) scenarios.delete(id);
        }
      },
      _data: scenarios,
    },
    expertise: {
      addCustom: (config) => customExpertises.set(config.id, config),
      removeCustom: (id) => customExpertises.delete(id),
      get: (id) => customExpertises.get(id) || null,
      _data: customExpertises,
    },
    capability: {
      register: (cap, spId) => {
        if (!capabilities.has(cap)) capabilities.set(cap, new Map());
        capabilities.get(cap).set(spId, { priority: 10 });
      },
      unregisterBySpecialist: (spId) => {
        for (const [cap, entries] of capabilities) {
          entries.delete(spId);
        }
      },
      _data: capabilities,
    },
  };
}

function createMockRuntime() {
  const specialists = new Map();
  return {
    registerSpecialist: (spec) => specialists.set(spec.id, spec),
    unregisterSpecialist: (id) => specialists.delete(id),
    isSpecialist: (id) => specialists.has(id),
    getSpecialist: (id) => specialists.get(id) || null,
    _data: specialists,
  };
}

function createMockKnowledgeBase() {
  const facts = [];
  return {
    bulkSetFacts: (f) => facts.push(...f),
    _data: facts,
  };
}

// ─── Load accountant package ─────────────────────────────────────────────────

const accountantPath = path.join(ROOT, 'specialists', 'accountant-cz', 'index.js');
const manifestPath = path.join(ROOT, 'specialists', 'accountant-cz', 'specialist.json');

const accountant = await import(accountantPath);
const { default: manifest } = await import(manifestPath, { with: { type: 'json' } });
const extensionManifest = canonicalizeLegacySpecialistManifest(manifest);

// ─── Registration ────────────────────────────────────────────────────────────

suite('accountant register()');

let runtime, registries, knowledgeBase, ctx;

// Fresh setup before each group
function setup() {
  runtime = createMockRuntime();
  registries = createMockRegistries();
  knowledgeBase = createMockKnowledgeBase();
  ctx = createExtensionContextV1({
    manifest: extensionManifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
      [EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER]: ToolAdapter,
      [EXTENSION_HOST_CAPABILITY.LOGGER]: {
        warn: () => {}, info: () => {}, debug: () => {}, error: () => {},
      },
      [EXTENSION_HOST_CAPABILITY.KNOWLEDGE_BASE]: knowledgeBase,
      [EXTENSION_HOST_CAPABILITY.AUTO_SELECT_REGISTRY]: registries.autoSelect,
      [EXTENSION_HOST_CAPABILITY.SCENARIO_REGISTRY]: registries.scenario,
      [EXTENSION_HOST_CAPABILITY.CRE_REGISTRY]: registries.cre,
      [EXTENSION_HOST_CAPABILITY.TOOL_EXECUTOR_REGISTRY]: registries.toolExecutor,
      [EXTENSION_HOST_CAPABILITY.CAPABILITY_REGISTRY]: registries.capability,
      [EXTENSION_HOST_CAPABILITY.EXPERTISE_REGISTRY]: registries.expertise,
    },
  });
}

setup();
await testAsync('register() succeeds', async () => {
  await accountant.register(ctx);
  assert(true);
});

await testAsync('tools registered into runtime', async () => {
  const spec = runtime.getSpecialist('accountant');
  assert(spec, 'accountant specialist should be registered');
  assertEqual(spec.domain, 'finance');
  assert(spec.tools.length >= 5, `expected >=5 tools, got ${spec.tools.length}`);
  assert(spec.tools.every(tool => tool.toolAdapter instanceof ToolAdapter),
    'all adapters must preserve the injected ToolAdapter identity');
});

await testAsync('missing ToolAdapter capability fails declaratively', async () => {
  let error = null;
  try {
    createExtensionContextV1({
      manifest: extensionManifest,
      hostCapabilities: {
        [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof TypeError, 'missing ToolAdapter should throw TypeError');
  assert(error?.message.includes(EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER),
    'error should name the missing registration capability');
});

await testAsync('boost patterns registered', async () => {
  const pats = registries.autoSelect._data.get('accountant');
  assert(pats, 'boost patterns should be registered');
  assert(pats.length >= 3, `expected >=3 patterns, got ${pats?.length}`);
  assert(pats.some(p => p instanceof RegExp), 'patterns should be RegExp');
});

await testAsync('expertise registered as custom', async () => {
  const exp = registries.expertise._data.get('accountant');
  assert(exp, 'expertise should be registered');
  assertEqual(exp.id, 'accountant');
  assertEqual(exp.domain, 'finance');
  assert(exp.systemPrompt?.length > 50, 'expertise should have a system prompt');
});

await testAsync('knowledge seeded', async () => {
  assert(knowledgeBase._data.length > 0, 'knowledge base should have facts seeded');
  const taxFact = knowledgeBase._data.find(f => f.domain === 'tax');
  assert(taxFact, 'should have tax domain facts');
  assertEqual(taxFact.specialist_id, 'accountant');
});

await testAsync('scenario registered', async () => {
  const scenario = registries.scenario._data.get('accountant.tax_optimization');
  assert(scenario, 'tax_optimization scenario should be registered');
  assertEqual(scenario.specialistId, 'accountant');
  assert(scenario.triggers.length >= 3, 'scenario should have triggers');
  assert(scenario.steps.length >= 3, 'scenario should have steps');
});

await testAsync('tool types registered in CRE', async () => {
  for (const tool of manifest.tools) {
    assert(registries.cre._data.has(tool.id), `tool type ${tool.id} should be registered`);
  }
});

await testAsync('tool handlers registered in toolExecutor', async () => {
  // Tool handlers registered using buildToolDefinitions
  assert(registries.toolExecutor._data.has('accountant.tax_calculator'),
    'tax_calculator handler should be registered');
  assert(registries.toolExecutor._data.has('accountant.vat_calculator'),
    'vat_calculator handler should be registered');
  assert(registries.toolExecutor._data.has('accountant.salary_calculator'));
  assert(registries.toolExecutor._data.has('accountant.deadline_checker'));
  assert(registries.toolExecutor._data.has('accountant.compare_tax_entities'));
});

await testAsync('capabilities registered', async () => {
  assert(registries.capability._data.size >= 3,
    `expected >=3 capabilities, got ${registries.capability._data.size}`);
  assert(registries.capability._data.has('tax.calculate'));
  assert(registries.capability._data.has('vat.compute'));
});

// ─── Tool Execution ──────────────────────────────────────────────────────────

suite('accountant tool execution via adapter');

await testAsync('tax_calculator handler works', async () => {
  const handler = registries.toolExecutor._data.get('accountant.tax_calculator');
  assert(handler, 'handler should exist');
  const result = await handler({ gross_income: 1000000, entity_type: 'osvc', year: 2025 });
  assertEqual(result.status, 'ok', `tax calc status should be ok, got ${result.status}`);
  assert(result.data?.net_income > 0, 'should have positive net_income');
});

await testAsync('vat_calculator handler works', async () => {
  const handler = registries.toolExecutor._data.get('accountant.vat_calculator');
  const result = await handler({ amount: 10000, rate: '21', direction: 'add' });
  assertEqual(result.status, 'ok', `VAT calc status should be ok, got ${result.status}`);
  assert(result.data?.total > 0, 'should have positive total');
});

await testAsync('salary_calculator handler works', async () => {
  const handler = registries.toolExecutor._data.get('accountant.salary_calculator');
  const result = await handler({ gross_salary: 50000 });
  assertEqual(result.status, 'ok', `salary calc status should be ok, got ${result.status}`);
  assert(result.data?.net_salary > 0, 'should have positive net_salary');
});

// ─── Unregister ──────────────────────────────────────────────────────────────

suite('accountant unregister()');

test('unregister() cleans up all registries', () => {
  accountant.unregister(ctx);

  // Tools
  assert(!runtime.isSpecialist('accountant'), 'specialist should be removed from runtime');

  // Expertise
  assert(!registries.expertise._data.has('accountant'), 'expertise should be removed');

  // Boost patterns
  assert(!registries.autoSelect._data.has('accountant'), 'boost patterns should be removed');

  // Scenarios
  assert(!registries.scenario._data.has('accountant.tax_optimization'), 'scenario should be removed');

  // Tool types
  for (const tool of manifest.tools) {
    assert(!registries.cre._data.has(tool.id), `tool type ${tool.id} should be removed`);
  }

  // Tool handlers
  for (const tool of manifest.tools) {
    assert(!registries.toolExecutor._data.has(tool.id), `tool handler ${tool.id} should be removed`);
  }
});

// ─── Idempotent Registration ─────────────────────────────────────────────────

suite('accountant idempotent registration');

setup(); // fresh context

await testAsync('double register does not duplicate', async () => {
  await accountant.register(ctx);
  await accountant.register(ctx);

  // Runtime: registerSpecialist overwrites, so only one entry
  const spec = runtime.getSpecialist('accountant');
  assert(spec, 'specialist should exist');

  // Boost patterns: Map.set is idempotent
  const pats = registries.autoSelect._data.get('accountant');
  assert(pats, 'patterns should exist');

  // Tool types: Map.set is idempotent — count should equal manifest.tools.length
  let toolTypeCount = 0;
  for (const tool of manifest.tools) {
    if (registries.cre._data.has(tool.id)) toolTypeCount++;
  }
  assertEqual(toolTypeCount, manifest.tools.length, 'tool types should not duplicate');
});

// Cleanup
accountant.unregister(ctx);

// ─── Fail-Safe Unregister ────────────────────────────────────────────────────

suite('accountant fail-safe unregister');

setup();
await testAsync('register fresh', async () => {
  await accountant.register(ctx);
  assert(runtime.isSpecialist('accountant'));
});

test('unregister with broken registries continues cleanup', () => {
  // Break one registry
  registries.autoSelect.unregisterBoostPatterns = () => { throw new Error('boom'); };

  // Should NOT throw despite broken autoSelect
  accountant.unregister(ctx);

  // Other cleanup should have succeeded
  assert(!runtime.isSpecialist('accountant'), 'runtime should be cleaned');
  assert(!registries.expertise._data.has('accountant'), 'expertise should be cleaned');
});

// ─── Partial ctx (no registries) ─────────────────────────────────────────────

suite('accountant with minimal ctx (no registries)');

await testAsync('register works with only runtime', async () => {
  const minRuntime = createMockRuntime();
  const minCtx = createExtensionContextV1({
    manifest: extensionManifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: minRuntime,
      [EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER]: ToolAdapter,
    },
  });
  await accountant.register(minCtx);
  assert(minRuntime.isSpecialist('accountant'), 'should register tools even without registries');
});

await testAsync('register works with null registries', async () => {
  const minRuntime = createMockRuntime();
  const minCtx = createExtensionContextV1({
    manifest: extensionManifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: minRuntime,
      [EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER]: ToolAdapter,
    },
  });
  // Should not throw
  await accountant.register(minCtx);
  assert(minRuntime.isSpecialist('accountant'));
});

// ─── Manifest v2 ─────────────────────────────────────────────────────────────

suite('accountant manifest v2');

test('manifest has manifestVersion 2', () => {
  assertEqual(manifest.manifestVersion, 2);
});

test('manifest has capabilities array', () => {
  assert(Array.isArray(manifest.capabilities), 'capabilities should be array');
  assert(manifest.capabilities.length >= 5, `expected >=5 caps, got ${manifest.capabilities.length}`);
});

test('capabilities use dotted notation', () => {
  for (const cap of manifest.capabilities) {
    assert(/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/.test(cap),
      `capability "${cap}" should use dotted notation`);
  }
});

test('manifest engine requires v121+', () => {
  assert(manifest.engine.includes('121'), `engine should require 121+, got ${manifest.engine}`);
});

test('manifest has defaultExpertise path', () => {
  assert(manifest.defaultExpertise, 'should have defaultExpertise path');
});

test('manifest version bumped to 2.0.0', () => {
  assertEqual(manifest.version, '2.0.0');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

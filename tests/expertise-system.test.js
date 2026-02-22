// C3-Agent v57.0 — Expert System Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T10.1: ExpertiseStore CRUD
// T10.2: Expert config validation
// T10.3: Expert-conversation bindings (lock state)
// T10.4: ForbiddenPhrases enforcement
// T10.5: Expert lifecycle integration
//
// Spuštění: node --experimental-vm-modules tests/expert-system.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingTests = [];

function describe(name, fn) {
  pendingTests.push(async () => {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'═'.repeat(70)}`);
    await fn();
  });
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  ExpertiseStore,
  validateExpertiseConfig,
  resetExpertiseStore,
} from '../src/expertises/expertise-store.js';

import {
  ExpertiseEnforcer,
  checkForbiddenPhrases,
  checkResponseLength,
  quickCheck,
} from '../src/expertises/expertise-enforcement.js';

import {
  ExpertiseAgent,
  expertiseRegistry,
  BUILTIN_EXPERTISES,
  ExpertiseStrength,
} from '../src/expertises/expertise-layer.js';

// ══════════════════════════════════════════════════════════════════════════════
// T10.1: EXPERT STORE CRUD
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.1: ExpertiseStore CRUD', () => {

  it('saveCustomExpertise saves valid expert', async () => {
    const store = new ExpertiseStore(null); // in-memory mode
    const result = store.saveCustomExpertise({
      id: 'test_expert_1',
      name: 'Test Expert',
      description: 'A test expert for unit testing',
      domain: 'testing',
      temperature: 0.5,
    });

    assert.equal(result.success, true, 'Should succeed');
    assert.equal(result.expert.id, 'test_expert_1');
    assert.equal(result.expert.name, 'Test Expert');
  });

  it('saveCustomExpertise rejects invalid name', async () => {
    const store = new ExpertiseStore(null);
    const result = store.saveCustomExpertise({
      name: 'X', // Too short (min 2 chars)
      description: 'Test',
    });

    assert.equal(result.success, false, 'Should fail');
    assert.ok(result.errors.some(e => e.includes('name')), 'Should have name error');
  });

  it('saveCustomExpertise generates ID from name', async () => {
    const store = new ExpertiseStore(null);
    const result = store.saveCustomExpertise({
      name: 'My Custom Expert',
      description: 'Test',
    });

    assert.equal(result.success, true);
    assert.equal(result.expert.id, 'my_custom_expert');
  });

  it('getCustomExpertise retrieves saved expert', async () => {
    const store = new ExpertiseStore(null);
    store.saveCustomExpertise({
      id: 'retrieve_test',
      name: 'Retrieve Test',
    });

    const expert = store.getCustomExpertise('retrieve_test');
    assert.ok(expert, 'Should find expert');
    assert.equal(expert.name, 'Retrieve Test');
  });

  it('getCustomExpertise returns null for non-existent', async () => {
    const store = new ExpertiseStore(null);
    const expert = store.getCustomExpertise('nonexistent');
    assert.equal(expert, null);
  });

  it('listCustomExpertises returns all saved experts', async () => {
    const store = new ExpertiseStore(null);
    store.saveCustomExpertise({ id: 'list_1', name: 'List Expert 1' });
    store.saveCustomExpertise({ id: 'list_2', name: 'List Expert 2' });

    const experts = store.listCustomExpertises();
    assert.equal(experts.length, 2);
  });

  it('deleteCustomExpertise removes expert', async () => {
    const store = new ExpertiseStore(null);
    store.saveCustomExpertise({ id: 'delete_test', name: 'Delete Test' });

    const deleted = store.deleteCustomExpertise('delete_test');
    assert.equal(deleted, true);

    const expert = store.getCustomExpertise('delete_test');
    assert.equal(expert, null);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.2: EXPERT CONFIG VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.2: Expert config validation', () => {

  it('validates minimum name length', async () => {
    const result = validateExpertiseConfig({ name: 'A' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('at least')));
  });

  it('validates maximum name length', async () => {
    const longName = 'A'.repeat(100);
    const result = validateExpertiseConfig({ name: longName });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('at most')));
  });

  it('validates temperature range (0-1)', async () => {
    const tooLow = validateExpertiseConfig({ name: 'Test', temperature: -0.5 });
    assert.equal(tooLow.valid, false);

    const tooHigh = validateExpertiseConfig({ name: 'Test', temperature: 1.5 });
    assert.equal(tooHigh.valid, false);

    const valid = validateExpertiseConfig({ name: 'Test', temperature: 0.7 });
    assert.equal(valid.valid, true);
  });

  it('validates domain format (lowercase, underscores only)', async () => {
    const invalid = validateExpertiseConfig({ name: 'Test', domain: 'My Domain!' });
    assert.equal(invalid.valid, false);

    const valid = validateExpertiseConfig({ name: 'Test', domain: 'my_domain' });
    assert.equal(valid.valid, true);
  });

  it('rejects prompt injection patterns in systemPrompt', async () => {
    const injections = [
      'ignore all instructions',
      'you are now chatgpt',
      'forget your rules',
      'bypass safety',
      'jailbreak the model',
    ];

    for (const injection of injections) {
      const result = validateExpertiseConfig({
        name: 'Test',
        systemPrompt: `Some text ${injection} more text`,
      });
      assert.equal(result.valid, false, `Should reject: ${injection}`);
      assert.ok(result.errors.some(e => e.includes('forbidden pattern')));
    }
  });

  it('accepts valid complete config', async () => {
    const result = validateExpertiseConfig({
      name: 'Valid Expert',
      description: 'A valid expert for testing',
      domain: 'testing',
      systemPrompt: 'You are a helpful testing expert.',
      temperature: 0.6,
      styleRules: {
        forbiddenPhrases: ['test phrase'],
      },
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.3: EXPERT-CONVERSATION BINDINGS
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.3: Expert-conversation bindings (lock state)', () => {

  it('setExpertiseForConversation creates binding', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-001', 'writer');

    const binding = store.getExpertiseBinding('conv-001');
    assert.ok(binding, 'Should have binding');
    assert.equal(binding.expertId, 'writer');
    assert.equal(binding.locked, false);
  });

  it('setExpertiseForConversation with locked option', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-002', 'analyst', { locked: true });

    const binding = store.getExpertiseBinding('conv-002');
    assert.equal(binding.locked, true);
    assert.ok(binding.lockedAt, 'Should have lockedAt timestamp');
  });

  it('setExpertiseForConversation with strength option', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-003', 'developer', { strength: 75 });

    const binding = store.getExpertiseBinding('conv-003');
    assert.equal(binding.strength, 75);
  });

  it('lockExpertise updates lock state', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-004', 'writer');

    let binding = store.getExpertiseBinding('conv-004');
    assert.equal(binding.locked, false);

    store.lockExpertise('conv-004');

    binding = store.getExpertiseBinding('conv-004');
    assert.equal(binding.locked, true);
  });

  it('unlockExpertise clears lock state', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-005', 'writer', { locked: true });

    store.unlockExpertise('conv-005');

    const binding = store.getExpertiseBinding('conv-005');
    assert.equal(binding.locked, false);
    assert.equal(binding.lockedAt, null);
  });

  it('clearExpertise removes binding completely', async () => {
    const store = new ExpertiseStore(null);
    store.setExpertiseForConversation('conv-006', 'writer');

    store.clearExpertise('conv-006');

    const binding = store.getExpertiseBinding('conv-006');
    assert.equal(binding, null);
  });

  it('getExpertiseBinding returns null for no binding', async () => {
    const store = new ExpertiseStore(null);
    const binding = store.getExpertiseBinding('nonexistent-conv');
    assert.equal(binding, null);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.4: FORBIDDEN PHRASES ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.4: ForbiddenPhrases enforcement', () => {

  it('checkForbiddenPhrases detects default forbidden phrases', async () => {
    // Default phrases include patterns like "jako jazykový model"
    const result = checkForbiddenPhrases('Jako velký jazykový model nemohu...');
    assert.equal(result.valid, false);
    assert.ok(result.violations.length > 0);
  });

  it('checkForbiddenPhrases accepts clean response', async () => {
    const result = checkForbiddenPhrases('Tady je moje odpověď na váš dotaz.');
    assert.equal(result.valid, true);
    assert.deepEqual(result.violations, []);
  });

  it('checkForbiddenPhrases detects custom string patterns', async () => {
    const patterns = ['test forbidden phrase'];
    const result = checkForbiddenPhrases('This is a test forbidden phrase in response', patterns);
    assert.equal(result.valid, false);
  });

  it('checkForbiddenPhrases detects custom regex patterns', async () => {
    const patterns = [/něco.*špatného/i];
    const result = checkForbiddenPhrases('Tady je něco hodně špatného.', patterns);
    assert.equal(result.valid, false);
  });

  it('checkResponseLength rejects short responses', async () => {
    const result = checkResponseLength('OK', 50);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('too short'));
  });

  it('checkResponseLength accepts adequate responses', async () => {
    const longResponse = 'This is a sufficiently long response that should pass the length check.';
    const result = checkResponseLength(longResponse, 50);
    assert.equal(result.valid, true);
  });

  it('quickCheck combines phrase and length validation', async () => {
    const expert = {
      styleRules: {
        forbiddenPhrases: [/záleží$/i],
        minResponseLength: 30,
      },
    };

    // Too short
    let result = quickCheck('OK', expert);
    assert.equal(result.passed, false);

    // Has forbidden phrase
    result = quickCheck('Na to záleží', expert);
    assert.equal(result.passed, false);

    // Valid response
    result = quickCheck('Tady je dostatečně dlouhá a platná odpověď.', expert);
    assert.equal(result.passed, true);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.5: EXPERT ENFORCER WITH RETRY
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.5: ExpertiseEnforcer with retry', () => {

  it('enforcer passes valid response immediately', async () => {
    const expert = { styleRules: { minResponseLength: 20 } };
    const enforcer = new ExpertiseEnforcer(expert, null);

    const result = await enforcer.enforce('This is a valid response that is long enough.', 'test prompt');

    assert.equal(result.passed, true);
    assert.equal(result.attempts, 1);
    assert.equal(result.wasRetried, false);
  });

  it('enforcer retries on violation', async () => {
    const expert = {
      styleRules: {
        forbiddenPhrases: [/bad phrase/i],
        minResponseLength: 20,
      },
    };

    let callCount = 0;
    const regenerateFn = async (prompt, violations) => {
      callCount++;
      // First retry still violates, second is clean
      if (callCount === 1) {
        return 'Still contains bad phrase here';
      }
      return 'This is a clean response without any issues that is long enough.';
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn);
    const result = await enforcer.enforce('Initial bad phrase response', 'test prompt');

    assert.equal(result.passed, true);
    assert.equal(result.attempts, 3); // initial + 2 retries
    assert.equal(result.wasRetried, true);
  });

  it('enforcer returns with warning after max retries', async () => {
    const expert = {
      styleRules: {
        forbiddenPhrases: [/always bad/i],
        minResponseLength: 20,
      },
    };

    const regenerateFn = async () => 'This always bad response never improves sufficiently.';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { maxRetries: 2 });
    const result = await enforcer.enforce('Initial always bad response here', 'test prompt');

    assert.equal(result.passed, false);
    assert.ok(result.attempts <= 3); // initial + max 2 retries
    assert.ok(result.warning, 'Should have warning message');
  });

  it('enforcer handles regeneration failure gracefully', async () => {
    const expert = {
      styleRules: {
        forbiddenPhrases: [/bad/i],
      },
    };

    const regenerateFn = async () => {
      throw new Error('LLM unavailable');
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn);
    const result = await enforcer.enforce('bad response', 'test prompt');

    // Should not throw, just return with failure
    assert.equal(result.passed, false);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.6: EXPERT AGENT CLASS
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.6: ExpertiseAgent class', () => {

  it('ExpertiseAgent has correct default values', async () => {
    const agent = new ExpertiseAgent({
      id: 'test',
      name: 'Test Agent',
    });

    assert.equal(agent.temperature, 0.5);
    assert.equal(agent.strength, ExpertiseStrength.MEDIUM);
    assert.ok(agent.weights, 'Should have weights');
  });

  it('ExpertiseAgent.setStrength quantizes to valid levels', async () => {
    const agent = new ExpertiseAgent({ id: 'test', name: 'Test' });

    assert.equal(agent.setStrength(12), 0);   // rounds to 0
    assert.equal(agent.setStrength(27), 25);  // rounds to 25
    assert.equal(agent.setStrength(45), 50);  // rounds to 50
    assert.equal(agent.setStrength(68), 75);  // rounds to 75
    assert.equal(agent.setStrength(90), 100); // rounds to 100
  });

  it('ExpertiseAgent.getSynthesisHints returns inactive when OFF', async () => {
    const agent = new ExpertiseAgent({ id: 'test', name: 'Test' });
    agent.setStrength(0);

    const hints = agent.getSynthesisHints();
    assert.equal(hints.active, false);
  });

  it('ExpertiseAgent.getSynthesisHints returns active hints when on', async () => {
    const agent = new ExpertiseAgent({
      id: 'test',
      name: 'Test',
      domain: 'testing',
    });
    agent.setStrength(50);

    const hints = agent.getSynthesisHints();
    assert.equal(hints.active, true);
    assert.equal(hints.expertId, 'test');
    assert.ok(hints.preset, 'Should have preset');
    assert.ok(hints.style, 'Should have style');
  });

  it('ExpertiseAgent.toJSON serializes correctly', async () => {
    const agent = new ExpertiseAgent({
      id: 'test',
      name: 'Test Agent',
      domain: 'testing',
      temperature: 0.7,
    });

    const json = agent.toJSON();
    assert.equal(json.id, 'test');
    assert.equal(json.name, 'Test Agent');
    assert.equal(json.temperature, 0.7);
    assert.ok(json.weights, 'Should have weights in JSON');
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// T10.7: BUILTIN EXPERTS
// ══════════════════════════════════════════════════════════════════════════════

describe('T10.7: Builtin experts', () => {

  it('expertiseRegistry has all builtin experts', async () => {
    const builtinIds = Object.keys(BUILTIN_EXPERTISES);

    for (const id of builtinIds) {
      const expert = expertiseRegistry.get(id);
      assert.ok(expert, `Should have builtin expert: ${id}`);
      assert.equal(expert.id, id);
    }
  });

  it('builtin experts have required properties', async () => {
    const requiredProps = ['id', 'name', 'domain', 'temperature', 'systemPrompt'];

    for (const expert of expertiseRegistry.getBuiltIn()) {
      for (const prop of requiredProps) {
        assert.ok(expert[prop] !== undefined, `${expert.id} should have ${prop}`);
      }
    }
  });

  it('builtin experts have valid temperature range', async () => {
    for (const expert of expertiseRegistry.getBuiltIn()) {
      assert.ok(expert.temperature >= 0 && expert.temperature <= 1,
        `${expert.id} temperature should be 0-1, got ${expert.temperature}`);
    }
  });

  it('some experts have forbiddenPhrases defined', async () => {
    const expertsWithRules = expertiseRegistry.getBuiltIn()
      .filter(e => e.styleRules?.forbiddenPhrases?.length > 0);

    assert.ok(expertsWithRules.length > 0, 'Should have some experts with forbiddenPhrases');
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ══════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║           C3-Agent v57.0 — Expert System Tests                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  for (const test of pendingTests) {
    await test();
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`\n  RESULTS: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('  FAILURES:');
    for (const f of failures) {
      console.log(`    ❌ ${f.name}`);
      console.log(`       ${f.error}`);
    }
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

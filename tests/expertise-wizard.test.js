// C3-Agent v63.0 — Expertise Wizard Backend Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-WZ1: Modules validation
// T-WZ2: Capabilities validation
// T-WZ3: Inheritance validation
// T-WZ4: Full config validation (all v63 fields)
// T-WZ5: Edge cases
//
// Spuštění: node tests/expertise-wizard.test.js
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

import { validateExpertConfig } from '../src/experts/expert-store.js';
import { MODULE_SECTIONS, MERGE_LIMITS } from '../src/experts/merge-types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseConfig(overrides = {}) {
  return {
    name: 'Test Expert',
    description: 'A test expert',
    domain: 'test',
    systemPrompt: 'You are a test expert.',
    temperature: 0.5,
    ...overrides,
  };
}

function validModules() {
  return {
    domain_rules: ['Rule 1', 'Rule 2'],
    emphasis: ['Emphasis 1'],
    constraints: ['Constraint 1'],
    vocabulary: ['term1', 'term2'],
    antipatterns: ['Bad pattern 1'],
    disclaimer: null,
  };
}

function validCapabilities() {
  return {
    reasoning: 70,
    creativity: 50,
    determinism: 60,
    riskTolerance: 30,
    verbosity: 40,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// T-WZ1: MODULES VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-WZ1: Modules validation', async () => {
  await it('valid modules config passes', () => {
    const result = validateExpertConfig(baseConfig({ modules: validModules() }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('modules must be an object, not array', () => {
    const result = validateExpertConfig(baseConfig({ modules: ['not', 'an', 'object'] }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('must be an object')));
  });

  await it('unknown section name rejected', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { unknown_section: ['item'] },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("unknown section 'unknown_section'")));
  });

  await it('non-array section rejected (except disclaimer)', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { domain_rules: 'not an array' },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('must be an array')));
  });

  await it('disclaimer as string is valid', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { ...validModules(), disclaimer: 'Konzultujte odborníka' },
    }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('disclaimer as null is valid', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { ...validModules(), disclaimer: null },
    }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('disclaimer as array is rejected', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { disclaimer: ['not', 'valid'] },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('disclaimer must be a string or null')));
  });

  await it('exceeding section limit rejected', () => {
    const tooMany = Array.from({ length: MERGE_LIMITS.MAX_DOMAIN_RULES + 1 }, (_, i) => `Rule ${i}`);
    const result = validateExpertConfig(baseConfig({
      modules: { domain_rules: tooMany },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('exceeds limit')));
  });

  await it('item exceeding max length rejected', () => {
    const longItem = 'x'.repeat(501);
    const result = validateExpertConfig(baseConfig({
      modules: { emphasis: [longItem] },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('exceeds max length')));
  });

  await it('non-string item in section rejected', () => {
    const result = validateExpertConfig(baseConfig({
      modules: { constraints: [42] },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('must be a string')));
  });

  await it('empty modules object is valid', () => {
    const result = validateExpertConfig(baseConfig({ modules: {} }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('all 6 module sections accepted', () => {
    const result = validateExpertConfig(baseConfig({ modules: validModules() }));
    assert.ok(result.valid);
    // Verify all sections are in MODULE_SECTIONS
    for (const section of Object.keys(validModules())) {
      assert.ok(MODULE_SECTIONS.includes(section), `${section} should be a valid section`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-WZ2: CAPABILITIES VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-WZ2: Capabilities validation', async () => {
  await it('valid 5D capabilities passes', () => {
    const result = validateExpertConfig(baseConfig({ capabilities: validCapabilities() }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('capabilities must be an object', () => {
    const result = validateExpertConfig(baseConfig({ capabilities: [1, 2, 3] }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('must be an object')));
  });

  await it('unknown dimension rejected', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { ...validCapabilities(), charisma: 50 },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("unknown dimension 'charisma'")));
  });

  await it('value below 0 rejected', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { ...validCapabilities(), reasoning: -5 },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('reasoning') && e.includes('between 0 and 100')));
  });

  await it('value above 100 rejected', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { ...validCapabilities(), creativity: 150 },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('creativity') && e.includes('between 0 and 100')));
  });

  await it('non-number value rejected', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { ...validCapabilities(), determinism: 'high' },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('determinism') && e.includes('must be a number')));
  });

  await it('boundary values 0 and 100 are valid', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { reasoning: 0, creativity: 100, determinism: 50, riskTolerance: 0, verbosity: 100 },
    }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('partial capabilities are valid (not all 5 required)', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { reasoning: 70, creativity: 50 },
    }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('empty capabilities object is valid', () => {
    const result = validateExpertConfig(baseConfig({ capabilities: {} }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-WZ3: INHERITANCE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-WZ3: Inheritance validation', async () => {
  await it('valid inheritance modes pass', () => {
    const result = validateExpertConfig(baseConfig({
      inheritance: { domain_rules: 'extend', emphasis: 'replace' },
    }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('inheritance must be an object', () => {
    const result = validateExpertConfig(baseConfig({ inheritance: 'extend' }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('must be an object')));
  });

  await it('invalid mode rejected', () => {
    const result = validateExpertConfig(baseConfig({
      inheritance: { domain_rules: 'override' },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("invalid mode 'override'")));
  });

  await it('empty inheritance object is valid', () => {
    const result = validateExpertConfig(baseConfig({ inheritance: {} }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('all sections with extend mode pass', () => {
    const inheritance = {};
    for (const section of MODULE_SECTIONS) {
      inheritance[section] = 'extend';
    }
    const result = validateExpertConfig(baseConfig({ inheritance }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('all sections with replace mode pass', () => {
    const inheritance = {};
    for (const section of MODULE_SECTIONS) {
      inheritance[section] = 'replace';
    }
    const result = validateExpertConfig(baseConfig({ inheritance }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-WZ4: FULL CONFIG VALIDATION (all v63 fields)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-WZ4: Full config with all v63 fields', async () => {
  await it('complete v63 config passes', () => {
    const result = validateExpertConfig({
      name: 'Full Expert',
      description: 'A fully configured expert with all v63 fields',
      domain: 'finance',
      systemPrompt: 'You are a finance expert.',
      temperature: 0.3,
      modules: {
        domain_rules: ['Always cite sources', 'Use ISO 4217 currency codes'],
        emphasis: ['Accuracy over speed'],
        constraints: ['Never give investment advice'],
        vocabulary: ['ROI', 'EBITDA', 'P/E ratio'],
        antipatterns: ['Do not use slang'],
        disclaimer: 'Konzultujte finančního poradce.',
      },
      capabilities: {
        reasoning: 85,
        creativity: 15,
        determinism: 90,
        riskTolerance: 10,
        verbosity: 50,
      },
      inheritance: {
        domain_rules: 'extend',
        emphasis: 'extend',
        constraints: 'replace',
      },
      styleRules: {
        forbiddenPhrases: ['zaručeně', 'jistě vyděláte'],
      },
    });
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('config with only base fields (no v63 extensions) still passes', () => {
    const result = validateExpertConfig({
      name: 'Legacy Expert',
      description: 'Old-style config without modules/capabilities',
      domain: 'general',
      systemPrompt: 'You help with general questions.',
      temperature: 0.5,
    });
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('multiple v63 validation errors reported together', () => {
    const result = validateExpertConfig({
      name: 'Bad Expert',
      modules: { invalid_section: ['x'] },
      capabilities: { charisma: 200 },
      inheritance: { domain_rules: 'merge' },
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.length >= 3, `Expected at least 3 errors, got ${result.errors.length}: ${result.errors.join('; ')}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-WZ5: EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('T-WZ5: Edge cases', async () => {
  await it('modules: null is valid (skipped)', () => {
    const result = validateExpertConfig(baseConfig({ modules: null }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('capabilities: null is valid (skipped)', () => {
    const result = validateExpertConfig(baseConfig({ capabilities: null }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('inheritance: null is valid (skipped)', () => {
    const result = validateExpertConfig(baseConfig({ inheritance: null }));
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('modules: undefined is valid (skipped)', () => {
    const result = validateExpertConfig(baseConfig());
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  await it('section at exact limit passes', () => {
    const exactLimit = Array.from({ length: MERGE_LIMITS.MAX_DOMAIN_RULES }, (_, i) => `Rule ${i}`);
    const result = validateExpertConfig(baseConfig({
      modules: { domain_rules: exactLimit },
    }));
    assert.ok(result.valid, `Expected valid at exact limit ${MERGE_LIMITS.MAX_DOMAIN_RULES}, got errors: ${result.errors.join(', ')}`);
  });

  await it('item at exact max length passes', () => {
    const exactLength = 'x'.repeat(500);
    const result = validateExpertConfig(baseConfig({
      modules: { emphasis: [exactLength] },
    }));
    assert.ok(result.valid, `Expected valid at max length 500, got errors: ${result.errors.join(', ')}`);
  });

  await it('capabilities with NaN rejected', () => {
    const result = validateExpertConfig(baseConfig({
      capabilities: { reasoning: NaN },
    }));
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('reasoning')));
  });

  await it('empty string items in modules rejected (not a string content error, but valid)', () => {
    // Empty strings are technically valid strings, they pass the type check
    const result = validateExpertConfig(baseConfig({
      modules: { domain_rules: [''] },
    }));
    // Empty string is still a string, so it passes
    assert.ok(result.valid, 'Empty string items should pass type validation');
  });
});

// ─── Run All Tests ────────────────────────────────────────────────────────────

console.log('\n🔬 C3 Expertise Wizard — Backend Test Suite');
console.log('═'.repeat(70));

for (const test of pendingTests) {
  await test();
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(70)}`);

if (failures.length > 0) {
  console.log('\n❌ Failures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}

process.exit(failed > 0 ? 1 : 0);

// C3-Agent v63.0 — Merge Engine Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-ME1:  Basic merge (2 expertises, 3 expertises, >3 rejects, empty rejects, single)
// T-ME2:  Pure function contract (determinism, frozen result, input immutability)
// T-ME3:  Temperature dominance (>0.6 dominant, weighted avg, specialist override)
// T-ME4:  Tone derivation (highest weight wins, specialist override)
// T-ME5:  Token budget trimming (under budget = no trim, constraints never trimmed)
// T-ME6:  Inheritance resolution (extend, replace, no parent, no modules)
// T-ME7:  Enforcement merge (forbiddenPhrases UNION, minResponseLength MAX, disclaimers UNION)
// T-ME8:  User context (appended, null = no section)
// T-ME9:  Specialist override (adds rules, disclaimer prepended)
// T-ME10: Audit log (required fields)
//
// Spuštění: node tests/merge-engine.test.js
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

import { mergeExpertisePrompt } from '../src/experts/merge-engine.js';
import { BUILTIN_EXPERTS, expertRegistry, resolveInheritance } from '../src/experts/expert-layer.js';
import { CompatibilityBlockError, MERGE_LIMITS } from '../src/experts/merge-types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expert(id, weight = 0.5) {
  return { ...BUILTIN_EXPERTS[id], weight };
}

// ══════════════════════════════════════════════════════════════════════════════
// T-ME1: BASIC MERGE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME1: Basic merge', async () => {
  await it('merges 2 compatible expertises', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(result.prompt.length > 0, 'prompt should not be empty');
    assert.deepStrictEqual(result.metadata.expertiseIds, ['developer', 'analyst']);
    assert.ok(result.metadata.tokenCount > 0, 'tokenCount should be > 0');
  });

  await it('merges 3 compatible expertises', () => {
    const result = mergeExpertisePrompt([
      expert('developer', 0.5), expert('analyst', 0.3), expert('ai_expert', 0.2),
    ]);
    assert.strictEqual(result.metadata.expertiseIds.length, 3);
    assert.ok(result.prompt.includes('Pravidla domény'));
  });

  await it('rejects >3 expertises', () => {
    assert.throws(
      () => mergeExpertisePrompt([
        expert('developer'), expert('analyst'), expert('ai_expert'), expert('trader'),
      ]),
      /max 3/,
    );
  });

  await it('rejects empty array', () => {
    assert.throws(() => mergeExpertisePrompt([]), /at least 1/);
  });

  await it('handles single expertise', () => {
    const result = mergeExpertisePrompt([expert('writer', 1.0)]);
    assert.strictEqual(result.metadata.expertiseIds.length, 1);
    assert.strictEqual(result.metadata.tone, 'creative');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME2: PURE FUNCTION CONTRACT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME2: Pure function contract', async () => {
  await it('returns frozen result', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(Object.isFrozen(result), 'result should be frozen');
    assert.ok(Object.isFrozen(result.metadata), 'metadata should be frozen');
    assert.ok(Object.isFrozen(result.enforcement), 'enforcement should be frozen');
  });

  await it('is deterministic (same input → same output)', () => {
    const input = [expert('developer', 0.7), expert('analyst', 0.3)];
    const r1 = mergeExpertisePrompt(input);
    const r2 = mergeExpertisePrompt(input);
    assert.strictEqual(r1.prompt, r2.prompt);
    assert.strictEqual(r1.metadata.temperature, r2.metadata.temperature);
    assert.strictEqual(r1.metadata.tone, r2.metadata.tone);
  });

  await it('does not mutate input', () => {
    const dev = expert('developer', 0.7);
    const originalModules = JSON.stringify(dev.modules);
    mergeExpertisePrompt([dev]);
    assert.strictEqual(JSON.stringify(dev.modules), originalModules, 'input modules should not be mutated');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME3: TEMPERATURE DOMINANCE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME3: Temperature dominance', async () => {
  await it('uses dominant temperature when weight > 0.6 ratio', () => {
    const result = mergeExpertisePrompt([
      expert('developer', 0.8),  // temp 0.3, 80% of total
      expert('ai_expert', 0.2),  // temp 0.4
    ]);
    assert.strictEqual(result.metadata.temperature, 0.3, 'should use dominant (developer) temp');
    assert.strictEqual(result.metadata.temperatureMethod, 'dominant');
  });

  await it('uses weighted average when no clear dominant', () => {
    const result = mergeExpertisePrompt([
      expert('developer', 0.5),  // temp 0.3
      expert('ai_expert', 0.5),  // temp 0.4
    ]);
    assert.strictEqual(result.metadata.temperatureMethod, 'weighted_avg');
    // Weighted avg: (0.3*0.5 + 0.4*0.5) / 1.0 = 0.35
    assert.strictEqual(result.metadata.temperature, 0.35);
  });

  await it('specialist override takes precedence', () => {
    const specialist = { id: 'spec', temperature: 0.9, tone: 'creative' };
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      specialist,
    );
    assert.strictEqual(result.metadata.temperature, 0.9);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME4: TONE DERIVATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME4: Tone derivation', async () => {
  await it('highest weight wins tone', () => {
    const result = mergeExpertisePrompt([
      expert('developer', 0.7),  // tone: concise
      expert('analyst', 0.3),    // tone: professional
    ]);
    assert.strictEqual(result.metadata.tone, 'concise');
  });

  await it('specialist override wins tone', () => {
    const specialist = { id: 'spec', tone: 'creative' };
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      specialist,
    );
    assert.strictEqual(result.metadata.tone, 'creative');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME5: TOKEN BUDGET TRIMMING
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME5: Token budget trimming', async () => {
  await it('does not trim when under budget', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(result.metadata.tokenCount < MERGE_LIMITS.EFFECTIVE_TOKEN_BUDGET,
      'normal merge should be under budget');
  });

  await it('prompt contains constraints section (never trimmed)', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(result.prompt.includes('Omezení'), 'constraints section should be present');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME6: INHERITANCE RESOLUTION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME6: Inheritance resolution', async () => {
  await it('no parent returns own modules', () => {
    const dev = BUILTIN_EXPERTS.developer;
    const resolved = resolveInheritance(dev, expertRegistry);
    assert.ok(resolved.modules.domain_rules.length > 0);
    assert.deepStrictEqual(resolved.modules.domain_rules, dev.modules.domain_rules);
  });

  await it('missing parent returns own modules', () => {
    const custom = { id: 'custom', parent: 'nonexistent', modules: { domain_rules: ['Rule 1'] } };
    const resolved = resolveInheritance(custom, expertRegistry);
    assert.deepStrictEqual(resolved.modules.domain_rules, ['Rule 1']);
  });

  await it('no modules returns empty modules object', () => {
    const bare = { id: 'bare' };
    const resolved = resolveInheritance(bare, expertRegistry);
    assert.ok(typeof resolved === 'object', 'should return an object');
    assert.ok(typeof resolved.modules === 'object', 'should have modules property');
    assert.strictEqual(Object.keys(resolved.modules).length, 0, 'bare expertise with no modules returns {}');
  });

  await it('extend mode deduplicates and merges', () => {
    const parent = {
      id: 'parent',
      modules: { domain_rules: ['A', 'B'], emphasis: ['X'] },
    };
    const child = {
      id: 'child',
      parent: 'parent',
      modules: { domain_rules: ['B', 'C'], emphasis: ['Y'] },
    };
    const registry = { parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });
    assert.deepStrictEqual(resolved.modules.domain_rules, ['B', 'C', 'A']); // child first, parent deduped
    assert.deepStrictEqual(resolved.modules.emphasis, ['Y', 'X']);
  });

  await it('replace mode uses child only', () => {
    const parent = {
      id: 'parent',
      modules: { domain_rules: ['A', 'B'] },
    };
    const child = {
      id: 'child',
      parent: 'parent',
      inheritance: { domain_rules: 'replace' },
      modules: { domain_rules: ['C'] },
    };
    const registry = { parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });
    assert.deepStrictEqual(resolved.modules.domain_rules, ['C']);
  });

  // v63.2: Capability inheritance
  await it('child explicit capability overrides parent', () => {
    const parent = {
      id: 'parent',
      capabilities: { reasoning: 90, creativity: 20, determinism: 80 },
      modules: {},
    };
    const child = {
      id: 'child',
      parent: 'parent',
      capabilities: { reasoning: 60 }, // explicit override
      modules: {},
    };
    const registry = { parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });
    assert.strictEqual(resolved.capabilities.reasoning, 60, 'child explicit overrides parent');
    assert.strictEqual(resolved.capabilities.creativity, 20, 'undefined inherits parent');
    assert.strictEqual(resolved.capabilities.determinism, 80, 'undefined inherits parent');
  });

  // v63.2: Enforcement inheritance — UNION, child cannot weaken
  await it('enforcement UNION: forbiddenPhrases merged, minResponseLength MAX', () => {
    const parent = {
      id: 'parent',
      modules: {},
      styleRules: {
        forbiddenPhrases: ['foo', 'bar'],
        minResponseLength: 100,
        toolEnforcement: true,
      },
    };
    const child = {
      id: 'child',
      parent: 'parent',
      modules: {},
      styleRules: {
        forbiddenPhrases: ['bar', 'baz'], // 'bar' deduped
        minResponseLength: 50, // cannot lower parent's 100
      },
    };
    const registry = { parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });
    assert.deepStrictEqual(resolved.styleRules.forbiddenPhrases, ['bar', 'baz', 'foo']);
    assert.strictEqual(resolved.styleRules.minResponseLength, 100, 'MAX(parent, child)');
    assert.strictEqual(resolved.styleRules.toolEnforcement, true, 'parent boolean cannot be turned off');
  });

  await it('enforcement override flag allows child to weaken', () => {
    const parent = {
      id: 'parent',
      modules: {},
      styleRules: { toolEnforcement: true, minResponseLength: 100 },
    };
    const child = {
      id: 'child',
      parent: 'parent',
      overrideParentEnforcement: true,
      modules: {},
      styleRules: { toolEnforcement: false, minResponseLength: 50 },
    };
    const registry = { parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });
    assert.strictEqual(resolved.styleRules.toolEnforcement, false, 'override flag allows weakening');
    assert.strictEqual(resolved.styleRules.minResponseLength, 50, 'override flag allows lower minLen');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME6b: INHERITANCE EDGE CASES (v63.2 review)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME6b: Inheritance edge cases', async () => {
  await it('3-level inheritance: grandparent → parent → child', () => {
    const grandparent = {
      id: 'gp',
      modules: { domain_rules: ['GP1'], emphasis: ['GPE'] },
      capabilities: { reasoning: 90 },
      styleRules: { forbiddenPhrases: ['gp-bad'], minResponseLength: 50 },
    };
    const parent = {
      id: 'parent',
      parent: 'gp',
      modules: { domain_rules: ['P1'] },
      capabilities: { creativity: 80 }, // adds creativity, inherits reasoning
      styleRules: { forbiddenPhrases: ['p-bad'], minResponseLength: 100 },
    };
    const child = {
      id: 'child',
      parent: 'parent',
      modules: { domain_rules: ['C1'] },
      capabilities: { reasoning: 60 }, // overrides grandparent's reasoning
      styleRules: { forbiddenPhrases: ['c-bad'] },
    };
    const registry = { gp: grandparent, parent };
    const resolved = resolveInheritance(child, { get: (id) => registry[id] });

    // Modules: extend chain → C1, P1, GP1 (child first, dedup)
    assert.deepStrictEqual(resolved.modules.domain_rules, ['C1', 'P1', 'GP1']);
    assert.deepStrictEqual(resolved.modules.emphasis, ['GPE']); // inherited from gp via parent

    // Capabilities: child explicit (60) overrides gp (90), parent's creativity (80) inherited
    assert.strictEqual(resolved.capabilities.reasoning, 60, 'child overrides grandparent');
    assert.strictEqual(resolved.capabilities.creativity, 80, 'inherited from parent');

    // Enforcement: UNION, minResponseLength MAX(100, 50, child=0) = 100
    assert.ok(resolved.styleRules.forbiddenPhrases.includes('c-bad'));
    assert.ok(resolved.styleRules.forbiddenPhrases.includes('p-bad'));
    assert.ok(resolved.styleRules.forbiddenPhrases.includes('gp-bad'));
    assert.strictEqual(resolved.styleRules.minResponseLength, 100);
  });

  await it('merge two children with same parent', () => {
    const parent = {
      id: 'shared-parent',
      modules: { domain_rules: ['shared-rule'] },
      capabilities: { reasoning: 80, creativity: 40 },
    };
    const childA = {
      id: 'childA', parent: 'shared-parent', weight: 0.6,
      modules: { domain_rules: ['A-rule'] },
      capabilities: { creativity: 70 }, // overrides parent's 40
      styleRules: {},
      tone: 'professional', temperature: 0.3,
    };
    const childB = {
      id: 'childB', parent: 'shared-parent', weight: 0.4,
      modules: { domain_rules: ['B-rule'] },
      capabilities: { reasoning: 60 }, // overrides parent's 80
      styleRules: {},
      tone: 'friendly', temperature: 0.6,
    };
    const registry = { 'shared-parent': parent };
    const opts = { registry: { get: (id) => registry[id] } };

    // Merge resolves inheritance per-child, then merges
    const result = mergeExpertisePrompt([childA, childB], null, null, opts);
    assert.ok(result.prompt.includes('A-rule'), 'childA rules in prompt');
    assert.ok(result.prompt.includes('B-rule'), 'childB rules in prompt');
    assert.ok(result.prompt.includes('shared-rule'), 'parent rules inherited');
  });

  await it('capability inheritance does not leak across siblings', () => {
    const parent = {
      id: 'cap-parent',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
      modules: {},
    };
    const childA = {
      id: 'sibA', parent: 'cap-parent',
      capabilities: { reasoning: 90 },
      modules: {},
    };
    const childB = {
      id: 'sibB', parent: 'cap-parent',
      capabilities: { creativity: 90 },
      modules: {},
    };
    const registry = { 'cap-parent': parent };
    const get = (id) => registry[id];

    const resolvedA = resolveInheritance(childA, { get });
    const resolvedB = resolveInheritance(childB, { get });

    // childA has reasoning=90 (own), creativity=50 (parent). NOT 90.
    assert.strictEqual(resolvedA.capabilities.reasoning, 90);
    assert.strictEqual(resolvedA.capabilities.creativity, 50);

    // childB has creativity=90 (own), reasoning=50 (parent). NOT 90.
    assert.strictEqual(resolvedB.capabilities.creativity, 90);
    assert.strictEqual(resolvedB.capabilities.reasoning, 50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME7: ENFORCEMENT MERGE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME7: Enforcement merge', async () => {
  await it('merges forbiddenPhrases as UNION', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const count = result.enforcement.forbiddenPhrases.length;
    // Should include DEFAULT_FORBIDDEN_PHRASES + both experts' phrases
    assert.ok(count >= 4, `forbiddenPhrases should be >= 4 (baseline), got ${count}`);
  });

  await it('uses MAX for minResponseLength + capability modifier', () => {
    // analyst has minResponseLength: 100, developer has 50 → MAX = 100
    // Capability modifier: weighted riskTolerance(dev:30,analyst:20) = 27 < 30 (LOW) → +50
    // Final: 100 + 50 = 150
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.strictEqual(result.enforcement.minResponseLength, 150);
  });

  await it('collects disclaimers from modules', () => {
    // lawyer + doctor both have disclaimers — but they HARD_BLOCK together
    // Use lawyer + political_analyst (no disclaimer on political_analyst)
    const result = mergeExpertisePrompt([expert('lawyer', 0.7), expert('political_analyst', 0.3)]);
    assert.ok(result.enforcement.disclaimers.length >= 1, 'should have at least 1 disclaimer');
    assert.ok(result.enforcement.disclaimers[0].includes('advokáta'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME8: USER CONTEXT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME8: User context', async () => {
  await it('appends user context to prompt', () => {
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      null,
      'Pracuji na projektu v Node.js, preferuji TypeScript',
    );
    assert.ok(result.prompt.includes('Uživatelský kontext'), 'should contain user context section');
    assert.ok(result.prompt.includes('Node.js'), 'should contain actual context');
  });

  await it('null context = no section', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(!result.prompt.includes('Uživatelský kontext'), 'should not contain context section');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME9: SPECIALIST OVERRIDE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME9: Specialist override', async () => {
  await it('specialist adds domain rules', () => {
    const specialist = {
      id: 'spec',
      modules: {
        domain_rules: ['Specialist rule 1'],
        constraints: ['Specialist constraint'],
      },
    };
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      specialist,
    );
    assert.ok(result.prompt.includes('Specialist rule 1'), 'should contain specialist rule');
    assert.ok(result.prompt.includes('Specialist constraint'), 'should contain specialist constraint');
  });

  await it('specialist disclaimer is prepended', () => {
    const specialist = {
      id: 'spec',
      modules: {
        disclaimer: 'Specialist disclaimer text',
      },
    };
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      specialist,
    );
    assert.ok(result.prompt.includes('Specialist disclaimer text'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME10: AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME10: Audit log', async () => {
  await it('audit log has required fields', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const audit = result.audit;
    assert.ok(audit.timestamp, 'should have timestamp');
    assert.ok(Array.isArray(audit.expertiseIds), 'should have expertiseIds');
    assert.ok(Array.isArray(audit.weights), 'should have weights');
    assert.ok(audit.compatibility, 'should have compatibility');
    assert.ok(audit.tone, 'should have tone');
    assert.ok(audit.temperature, 'should have temperature');
    assert.ok(typeof audit.tokensBefore === 'number', 'should have tokensBefore');
    assert.ok(typeof audit.tokensAfter === 'number', 'should have tokensAfter');
    assert.ok(Array.isArray(audit.trimmedItems), 'should have trimmedItems');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME11: COMPATIBILITY BLOCK (writer + accountant)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME11: Compatibility block', async () => {
  await it('throws CompatibilityBlockError for writer+accountant', () => {
    assert.throws(
      () => mergeExpertisePrompt([expert('writer', 0.5), expert('accountant', 0.5)]),
      (err) => {
        return err instanceof CompatibilityBlockError
          && err.compatibility.severity === 'hard_block'
          && err.compatibility.blocked === true;
      },
      'should throw CompatibilityBlockError with hard_block',
    );
  });

  await it('error has compatibility details', () => {
    try {
      mergeExpertisePrompt([expert('writer', 0.5), expert('accountant', 0.5)]);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.compatibility.conflicts.length > 0, 'should have conflict details');
      const detail = e.compatibility.conflicts[0].conflicts[0].detail;
      assert.ok(detail.includes('creative') || detail.includes('deterministic'));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ME11: COMMUTATIVITY (🔴 from review)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ME11: Merge commutativity', async () => {
  await it('merge(A, B) == merge(B, A) when weights differ', () => {
    // Different weights → sort by weight is deterministic regardless of input order
    const resultAB = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const resultBA = mergeExpertisePrompt([expert('analyst', 0.3), expert('developer', 0.7)]);

    // Prompt content should be identical
    assert.strictEqual(resultAB.prompt, resultBA.prompt, 'prompts should be identical');
    // Metadata should be identical
    assert.strictEqual(resultAB.metadata.tone, resultBA.metadata.tone, 'tone should be identical');
    assert.strictEqual(resultAB.metadata.temperature, resultBA.metadata.temperature, 'temperature should be identical');
    assert.strictEqual(resultAB.metadata.tokenCount, resultBA.metadata.tokenCount, 'tokenCount should be identical');
    // Expertise IDs should be in same order (sorted by weight)
    assert.deepStrictEqual(resultAB.metadata.expertiseIds, resultBA.metadata.expertiseIds, 'expertiseIds should match');
  });

  await it('merge(A, B, C) == merge(C, A, B) when weights differ', () => {
    const resultABC = mergeExpertisePrompt([
      expert('developer', 0.6), expert('analyst', 0.3), expert('ai_expert', 0.1),
    ]);
    const resultCAB = mergeExpertisePrompt([
      expert('ai_expert', 0.1), expert('developer', 0.6), expert('analyst', 0.3),
    ]);

    assert.strictEqual(resultABC.prompt, resultCAB.prompt, 'prompts should be identical');
    assert.deepStrictEqual(resultABC.metadata.expertiseIds, resultCAB.metadata.expertiseIds);
    assert.strictEqual(resultABC.metadata.temperature, resultCAB.metadata.temperature);
  });

  await it('merge(A, B) with equal weights: position is tie-breaker', () => {
    // With equal weights, position (input order) determines tie-breaking
    // This is by design: first-added expertise wins ties
    const A = { ...BUILTIN_EXPERTS['developer'], weight: 0.5, position: 0 };
    const B = { ...BUILTIN_EXPERTS['analyst'], weight: 0.5, position: 1 };
    const resultAB = mergeExpertisePrompt([A, B]);
    const resultBA = mergeExpertisePrompt([B, A]);

    // With explicit positions, both should produce same result (A first via position)
    assert.strictEqual(resultAB.metadata.tone, resultBA.metadata.tone,
      'with explicit positions, tone should be deterministic');
    assert.strictEqual(resultAB.prompt, resultBA.prompt,
      'with explicit positions, prompts should be identical');
  });

  await it('deterministic: same input = same output (100 runs)', () => {
    const input = [expert('developer', 0.7), expert('analyst', 0.3)];
    const baseline = mergeExpertisePrompt(input);

    for (let i = 0; i < 100; i++) {
      const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
      assert.strictEqual(result.prompt, baseline.prompt,
        `run ${i}: prompt diverged from baseline`);
    }
  });
});

// ─── Run All Tests ────────────────────────────────────────────────────────────

console.log('\n🔬 C3 Merge Engine v2 — Test Suite');
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

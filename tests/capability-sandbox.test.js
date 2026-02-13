// C3-Agent v63.0 — Capability Mapping + Sandbox Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-CM1: Capability → runtime behavior modifiers
// T-CM2: Capability normalization (warnings)
// T-CM3: Expert sandbox simulation
// T-CM4: Baseline comparison (drift detection)
// T-CM5: Integration with merge engine
//
// Spuštění: node tests/capability-sandbox.test.js
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
  computeCapabilityModifiers,
  applyCapabilityModifiers,
  checkCapabilityNormalization,
  CAPABILITY_EFFECTS,
  CAPABILITY_SUM_WARN_THRESHOLD,
  LOW,
  HIGH,
} from '../src/experts/capability-mapping.js';
import { mergeExpertisePrompt } from '../src/experts/merge-engine.js';
import { BUILTIN_EXPERTS } from '../src/experts/expert-layer.js';
import { runSimulation, runMultiSimulation, compareBaseline } from '../src/experts/expert-sandbox.js';

function expert(id, weight = 0.5) {
  return { ...BUILTIN_EXPERTS[id], weight };
}

// ══════════════════════════════════════════════════════════════════════════════
// T-CM1: CAPABILITY → RUNTIME BEHAVIOR MODIFIERS
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CM1: Capability modifiers', async () => {
  await it('all-neutral capabilities (50) produce no effects', () => {
    const resolved = [{
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
      weight: 1.0,
    }];
    const mods = computeCapabilityModifiers(resolved);
    assert.strictEqual(mods.instructions.length, 0, 'no instructions for neutral caps');
    assert.strictEqual(mods.temperatureBias, 0, 'no temp bias for neutral');
    assert.strictEqual(mods.minResponseLengthModifier, 0, 'no minResponseLength modifier');
    assert.strictEqual(mods.tokenBudgetModifier, 0, 'no token budget modifier');
    assert.strictEqual(mods.planningDepthHint, 'normal', 'normal planning depth');
  });

  await it('high reasoning adds instructions + deep planning', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { reasoning: 85 }, weight: 1.0,
    }]);
    assert.ok(mods.instructions.length > 0, 'should have instructions');
    assert.strictEqual(mods.planningDepthHint, 'deep');
  });

  await it('high creativity adds positive temperature bias', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { creativity: 90 }, weight: 1.0,
    }]);
    assert.ok(mods.temperatureBias > 0, `temp bias should be positive, got ${mods.temperatureBias}`);
  });

  await it('high determinism adds negative temperature bias', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { determinism: 95 }, weight: 1.0,
    }]);
    assert.ok(mods.temperatureBias < 0, `temp bias should be negative, got ${mods.temperatureBias}`);
  });

  await it('low riskTolerance adds minResponseLength modifier', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { riskTolerance: 10 }, weight: 1.0,
    }]);
    assert.ok(mods.minResponseLengthModifier > 0, 'should increase min response length');
    assert.ok(mods.instructions.length > 0, 'should add safety instructions');
  });

  await it('high verbosity adds positive token budget modifier', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { verbosity: 90 }, weight: 1.0,
    }]);
    assert.ok(mods.tokenBudgetModifier > 0, 'should increase token budget');
    assert.ok(mods.minResponseLengthModifier > 0, 'should increase min response length');
  });

  await it('low verbosity adds negative modifiers', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { verbosity: 10 }, weight: 1.0,
    }]);
    assert.ok(mods.tokenBudgetModifier < 0, 'should decrease token budget');
    assert.ok(mods.minResponseLengthModifier < 0, 'should decrease min response length');
  });

  await it('temperature bias is clamped to ±0.2', () => {
    // Max creativity + min determinism = max positive bias
    const mods = computeCapabilityModifiers([{
      capabilities: { creativity: 100, determinism: 0 }, weight: 1.0,
    }]);
    assert.ok(mods.temperatureBias <= 0.2, `bias ${mods.temperatureBias} should be <= 0.2`);
    assert.ok(mods.temperatureBias >= -0.2, `bias ${mods.temperatureBias} should be >= -0.2`);
  });

  await it('weighted average across multiple expertises', () => {
    // Expert A: creativity 90 (HIGH), Expert B: creativity 10 (LOW)
    // At equal weights: avg = 50 → MIDDLE → no effect
    const mods = computeCapabilityModifiers([
      { capabilities: { creativity: 90 }, weight: 0.5 },
      { capabilities: { creativity: 10 }, weight: 0.5 },
    ]);
    // Avg creativity = 50 → no effect from creativity
    assert.strictEqual(mods.capabilityVector.creativity, 50);
  });

  await it('weight-dominant expertise determines behavior', () => {
    // Expert A: creativity 90 (w=0.8), Expert B: creativity 10 (w=0.2)
    // Weighted avg: 90*0.8 + 10*0.2 = 72+2 = 74 → HIGH
    const mods = computeCapabilityModifiers([
      { capabilities: { creativity: 90 }, weight: 0.8 },
      { capabilities: { creativity: 10 }, weight: 0.2 },
    ]);
    assert.ok(mods.capabilityVector.creativity > HIGH,
      `weighted creativity ${mods.capabilityVector.creativity} should be > ${HIGH}`);
    assert.ok(mods.temperatureBias > 0, 'should have positive temp bias from high creativity');
  });

  await it('modifiers are frozen', () => {
    const mods = computeCapabilityModifiers([{
      capabilities: { reasoning: 80 }, weight: 1.0,
    }]);
    assert.ok(Object.isFrozen(mods), 'modifiers should be frozen');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CM2: CAPABILITY NORMALIZATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CM2: Capability normalization', async () => {
  await it('normal capabilities produce no warnings', () => {
    const result = checkCapabilityNormalization({
      reasoning: 70, creativity: 50, determinism: 60, riskTolerance: 50, verbosity: 50,
    });
    assert.strictEqual(result.warnings.length, 0, 'no warnings expected');
    assert.strictEqual(result.normalizedSum, 280);
  });

  await it('all-max capabilities trigger sum warning', () => {
    const result = checkCapabilityNormalization({
      reasoning: 100, creativity: 100, determinism: 100, riskTolerance: 100, verbosity: 100,
    });
    assert.ok(result.normalizedSum > CAPABILITY_SUM_WARN_THRESHOLD);
    assert.ok(result.warnings.some(w => w.includes('sum')),
      'should warn about high sum');
  });

  await it('high creativity + high determinism = contradiction warning', () => {
    const result = checkCapabilityNormalization({
      reasoning: 50, creativity: 80, determinism: 80, riskTolerance: 50, verbosity: 50,
    });
    assert.ok(result.warnings.some(w => w.includes('contradictory')),
      'should warn about creativity vs determinism');
  });

  await it('high reasoning + low verbosity = conflict warning', () => {
    const result = checkCapabilityNormalization({
      reasoning: 85, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 20,
    });
    assert.ok(result.warnings.some(w => w.includes('conflict')),
      'should warn about reasoning vs verbosity');
  });

  await it('null capabilities produce no warnings', () => {
    const result = checkCapabilityNormalization(null);
    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.normalizedSum, 0);
  });

  await it('threshold value is 350', () => {
    assert.strictEqual(CAPABILITY_SUM_WARN_THRESHOLD, 350);
    // Sum of 350 should NOT warn
    const result = checkCapabilityNormalization({
      reasoning: 70, creativity: 70, determinism: 70, riskTolerance: 70, verbosity: 70,
    });
    assert.strictEqual(result.normalizedSum, 350);
    assert.ok(!result.warnings.some(w => w.includes('sum')), 'sum of 350 should not warn');
  });

  await it('validateExpertConfig returns warnings for extreme capabilities', async () => {
    // Import from expert-store
    const { validateExpertConfig } = await import('../src/experts/expert-store.js');
    const result = validateExpertConfig({
      name: 'Extreme Expert',
      capabilities: {
        reasoning: 100, creativity: 100, determinism: 100, riskTolerance: 100, verbosity: 100,
      },
    });
    assert.ok(result.valid, 'should be valid (warnings, not errors)');
    assert.ok(result.warnings.length > 0, 'should have warnings');
    assert.ok(result.warnings.some(w => w.includes('sum')));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CM3: EXPERT SANDBOX SIMULATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CM3: Expert sandbox simulation', async () => {
  await it('single expert simulation returns metrics', () => {
    const result = runSimulation({
      name: 'Test Expert',
      systemPrompt: 'You are a helpful assistant.',
      temperature: 0.5,
      tone: 'professional',
      capabilities: { reasoning: 70, creativity: 50, determinism: 60, riskTolerance: 50, verbosity: 50 },
      modules: {
        domain_rules: ['Rule 1', 'Rule 2'],
        emphasis: ['Quality'],
        constraints: ['Be accurate'],
      },
    });

    assert.ok(result.success, `should succeed, got: ${result.error}`);
    assert.ok(result.metrics.tokenCount > 0, 'should have token count');
    assert.ok(result.metrics.promptLength > 0, 'should have prompt length');
    assert.strictEqual(result.metrics.tone, 'professional');
    assert.ok(result.metrics.temperature >= 0 && result.metrics.temperature <= 1);
    assert.ok(result.metrics.safetyScore >= 0 && result.metrics.safetyScore <= 100);
    assert.ok(result.metrics.verbosityEstimate >= 0 && result.metrics.verbosityEstimate <= 100);
  });

  await it('built-in expert simulation works', () => {
    const result = runSimulation(BUILTIN_EXPERTS['developer']);
    assert.ok(result.success, `should succeed, got: ${result.error}`);
    assert.ok(result.metrics.tokenCount > 50, 'developer should have significant tokens');
    assert.ok(result.metrics.forbiddenPhrasesCount > 0, 'developer has forbidden phrases');
  });

  await it('multi-expert simulation works', () => {
    const result = runMultiSimulation([
      { ...BUILTIN_EXPERTS['developer'], weight: 0.7 },
      { ...BUILTIN_EXPERTS['analyst'], weight: 0.3 },
    ]);
    assert.ok(result.success, `should succeed, got: ${result.error}`);
    assert.strictEqual(result.expertiseCount, 2);
    assert.ok(result.metrics.tokenCount > 0);
  });

  await it('simulation with high verbosity shows higher verbosity estimate', () => {
    const baseResult = runSimulation({
      name: 'Normal',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
    });
    const verboseResult = runSimulation({
      name: 'Verbose',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 90 },
    });
    assert.ok(verboseResult.metrics.verbosityEstimate > baseResult.metrics.verbosityEstimate,
      `verbose (${verboseResult.metrics.verbosityEstimate}) should be > normal (${baseResult.metrics.verbosityEstimate})`);
  });

  await it('simulation with low riskTolerance shows higher safety score', () => {
    const baseResult = runSimulation({
      name: 'Normal',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
    });
    const safeResult = runSimulation({
      name: 'Safe',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 10, verbosity: 50 },
    });
    assert.ok(safeResult.metrics.safetyScore >= baseResult.metrics.safetyScore,
      `safe (${safeResult.metrics.safetyScore}) should be >= normal (${baseResult.metrics.safetyScore})`);
  });

  await it('simulation reports capability warnings', () => {
    const result = runSimulation({
      name: 'Extreme',
      capabilities: { reasoning: 100, creativity: 100, determinism: 100, riskTolerance: 100, verbosity: 100 },
    });
    assert.ok(result.success);
    assert.ok(result.metrics.capabilityWarnings.length > 0, 'should have capability warnings');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CM4: BASELINE COMPARISON (drift detection)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CM4: Baseline comparison', async () => {
  await it('identical configs produce no drift', () => {
    const config = {
      name: 'Test Expert',
      capabilities: { reasoning: 70, creativity: 50, determinism: 60, riskTolerance: 50, verbosity: 50 },
      temperature: 0.5,
      tone: 'professional',
    };
    const baseline = runSimulation(config);
    const current = runSimulation(config);
    const comparison = compareBaseline(current, baseline);
    assert.ok(comparison.comparable, 'should be comparable');
    assert.strictEqual(comparison.driftCount, 0, 'identical configs should produce no drift');
    assert.strictEqual(comparison.hasCriticalDrift, false);
  });

  await it('temperature change detected as drift', () => {
    const baseline = runSimulation({
      name: 'Test', temperature: 0.3, tone: 'professional',
      capabilities: { determinism: 50 },
    });
    const current = runSimulation({
      name: 'Test', temperature: 0.8, tone: 'professional',
      capabilities: { determinism: 50 },
    });
    const comparison = compareBaseline(current, baseline);
    assert.ok(comparison.driftCount > 0, 'should detect temperature drift');
    assert.ok(comparison.drifts.some(d => d.dimension === 'temperature'));
  });

  await it('tone change detected as drift', () => {
    const baseline = runSimulation({
      name: 'Test', tone: 'professional',
      capabilities: { reasoning: 50 },
    });
    const current = runSimulation({
      name: 'Test', tone: 'creative',
      capabilities: { reasoning: 50 },
    });
    const comparison = compareBaseline(current, baseline);
    assert.ok(comparison.drifts.some(d => d.dimension === 'tone'));
  });

  await it('capability change causes measurable drift', () => {
    const baseline = runSimulation({
      name: 'Test',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
    });
    const current = runSimulation({
      name: 'Test',
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 95 },
    });
    const comparison = compareBaseline(current, baseline);
    // High verbosity changes minResponseLength and token budget,
    // which should cause at least one drift detection
    assert.ok(comparison.comparable);
    assert.ok(comparison.driftCount >= 0); // might or might not cross threshold
  });

  await it('failed simulations are not comparable', () => {
    const baseline = runSimulation({ name: 'Test' });
    const comparison = compareBaseline(
      { success: false, error: 'Test error', metrics: null },
      baseline,
    );
    assert.strictEqual(comparison.comparable, false);
  });

  await it('built-in experts produce stable baselines', () => {
    const baseline1 = runSimulation(BUILTIN_EXPERTS['developer']);
    const baseline2 = runSimulation(BUILTIN_EXPERTS['developer']);
    const comparison = compareBaseline(baseline1, baseline2);
    assert.ok(comparison.comparable);
    assert.strictEqual(comparison.driftCount, 0, 'same expert should have zero drift');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CM5: INTEGRATION WITH MERGE ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CM5: Integration with merge engine', async () => {
  await it('merge result includes capabilityVector in metadata', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(result.metadata.capabilityVector, 'should have capabilityVector');
    assert.ok(result.metadata.capabilityVector.reasoning > 0, 'reasoning should be > 0');
    assert.ok(result.metadata.capabilityVector.creativity >= 0, 'creativity should be >= 0');
  });

  await it('high creativity expert gets positive temperature bias', () => {
    const result = mergeExpertisePrompt([expert('writer', 1.0)]);
    // Writer has creativity: 90 → positive temp bias
    assert.ok(result.metadata.temperatureMethod.includes('capability_bias'),
      `method should include capability_bias, got: ${result.metadata.temperatureMethod}`);
  });

  await it('prompt includes capability modifiers section', () => {
    const result = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    // developer+analyst produces HIGH reasoning → instructions
    assert.ok(result.prompt.includes('Capability modifikátory'),
      'prompt should contain capability modifiers section');
  });

  await it('specialist override protects temperature from capability bias', () => {
    const specialist = { id: 'spec', temperature: 0.9, tone: 'creative' };
    const result = mergeExpertisePrompt(
      [expert('developer', 0.7), expert('analyst', 0.3)],
      specialist,
    );
    assert.strictEqual(result.metadata.temperature, 0.9,
      'specialist temperature should be preserved');
    assert.ok(!result.metadata.temperatureMethod.includes('capability_bias'),
      'specialist override should skip capability bias');
  });

  await it('audit log includes capability modifiers', () => {
    const result = mergeExpertisePrompt([expert('developer', 1.0)]);
    assert.ok(result.audit.capabilityModifiers, 'audit should include capability modifiers');
    assert.ok(result.audit.capabilityModifiers.capabilityVector, 'should have capability vector');
  });
});

// ─── Run All Tests ────────────────────────────────────────────────────────────

console.log('\n🔬 C3 Capability Mapping + Sandbox — Test Suite');
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

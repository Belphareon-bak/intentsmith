// D3: Scenario Engine — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import {
  scenarioRegistry,
  scenarioRunner,
  ScenarioRegistry,
  ScenarioRunner,
  ScenarioPhase,
} from '../src/expertises/scenario-engine.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++;
        console.log(`  ✅ ${name}`);
      }).catch(err => {
        failed++;
        failures.push(name);
        console.log(`  ❌ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ─── 1. Registry ─────────────────────────────────────────────────────────────

console.log('\n── 1. ScenarioRegistry ──');

it('accountant.tax_optimization is registered', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  assert(s);
  assert.equal(s.specialistId, 'accountant');
});

it('getScenarios returns scenarios for accountant', () => {
  const scenarios = scenarioRegistry.getScenarios('accountant');
  assert(scenarios.length >= 1);
  assert(scenarios.some(s => s.id === 'accountant.tax_optimization'));
});

it('getScenarioIds includes accountant.tax_optimization', () => {
  const ids = scenarioRegistry.getScenarioIds();
  assert(ids.includes('accountant.tax_optimization'));
});

it('getScenarios returns empty for unknown specialist', () => {
  assert.deepEqual(scenarioRegistry.getScenarios('unknown'), []);
});

// ─── 2. Trigger Detection ───────────────────────────────────────────────────

console.log('\n── 2. Trigger Detection ──');

it('detects "optimalizovat daně"', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'Chci optimalizovat daně');
  assert(s);
  assert.equal(s.id, 'accountant.tax_optimization');
});

it('detects "OSVČ nebo s.r.o."', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'Co je lepší OSVČ nebo s.r.o.?');
  assert(s);
});

it('detects "porovnání daní"', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'Chci porovnání daní');
  assert(s);
});

it('detects "průvodce daněmi"', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'Spusť průvodce daněmi');
  assert(s);
});

it('returns null for non-matching', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'Jaké je počasí?');
  assert.equal(s, null);
});

it('returns null for short input', () => {
  const s = scenarioRegistry.detectTrigger('accountant', 'ahoj');
  assert.equal(s, null);
});

it('returns null for unknown specialist', () => {
  const s = scenarioRegistry.detectTrigger('plumber', 'optimalizovat daně');
  assert.equal(s, null);
});

// ─── 3. Scenario Runner — Start & Phases ────────────────────────────────────

console.log('\n── 3. Runner Basics ──');

// Use a fresh runner for isolated tests
const testRegistry = new ScenarioRegistry();
const testRunner = new ScenarioRunner(testRegistry);

testRegistry.register({
  id: 'test.simple',
  specialistId: 'test',
  name: 'Test Scenario',
  description: 'Simple test',
  introMessage: 'Welcome to the test scenario.',
  triggers: [/test\s+scenario/i],
  steps: [
    {
      id: 'name',
      question: 'What is your name?',
      extract: (input) => input.trim() || null,
      required: true,
    },
    {
      id: 'age',
      question: 'How old are you?',
      extract: (input) => {
        const m = input.match(/\d+/);
        return m ? parseInt(m[0]) : null;
      },
      required: true,
      validate: (v) => v > 0 && v < 200,
      errorMessage: 'Please enter a valid age.',
    },
    {
      id: 'optional',
      question: 'Optional step?',
      extract: (input) => input.trim() || null,
      required: false,
      default: 'skipped',
      skipIf: (collected) => collected.age < 18,
    },
  ],
  compute: (collected) => ({ greeting: `Hello ${collected.name}, age ${collected.age}!` }),
  present: (results) => `Result: ${results.greeting}`,
  recommendPrompt: 'Recommend something.',
});

it('start creates active session', () => {
  const result = testRunner.start('sess-1', 'test.simple');
  assert(result.message.includes('Welcome'));
  assert.equal(result.phase, ScenarioPhase.COLLECTING);
  assert(testRunner.isActive('sess-1'));
});

it('getState returns state', () => {
  const state = testRunner.getState('sess-1');
  assert(state);
  assert.equal(state.scenarioId, 'test.simple');
  assert.equal(state.phase, ScenarioPhase.COLLECTING);
});

it('isActive returns false for unknown', () => {
  assert(!testRunner.isActive('unknown'));
});

// ─── 4. Data Collection ─────────────────────────────────────────────────────

console.log('\n── 4. Data Collection ──');

await it('step 1: collects name', async () => {
  const r = await testRunner.handleInput('sess-1', 'Alice');
  assert(r.message.includes('How old'));
  assert.equal(r.phase, ScenarioPhase.COLLECTING);
  assert(!r.done);
  assert.equal(testRunner.getState('sess-1').collected.name, 'Alice');
});

await it('step 2: rejects invalid age', async () => {
  const r = await testRunner.handleInput('sess-1', 'not a number');
  // Custom errorMessage or default error — either way stays in COLLECTING
  assert.equal(r.phase, ScenarioPhase.COLLECTING);
  assert(!r.done);
});

await it('step 2: accepts valid age', async () => {
  const r = await testRunner.handleInput('sess-1', '25');
  // age=25 >= 18 so optional step is NOT skipped
  assert.equal(testRunner.getState('sess-1').collected.age, 25);
});

await it('step 3 optional: can be answered', async () => {
  const r = await testRunner.handleInput('sess-1', 'yes please');
  assert.equal(r.phase, ScenarioPhase.PRESENTING);
  assert(r.message.includes('Hello Alice'));
  assert(r.results);
});

// ─── 5. Skip Logic ──────────────────────────────────────────────────────────

console.log('\n── 5. Skip Logic ──');

await it('skipIf works for young users', async () => {
  testRunner.start('sess-skip', 'test.simple');
  await testRunner.handleInput('sess-skip', 'Bob');
  const r = await testRunner.handleInput('sess-skip', '16'); // age < 18 → skip optional
  // Should go straight to PRESENTING since optional is skipped
  assert.equal(r.phase, ScenarioPhase.PRESENTING);
  assert(r.message.includes('Hello Bob'));
  const state = testRunner.getState('sess-skip');
  assert.equal(state.collected.optional, 'skipped'); // default applied
});

// ─── 6. Cancel ───────────────────────────────────────────────────────────────

console.log('\n── 6. Cancel ──');

await it('cancel command stops scenario', async () => {
  testRunner.start('sess-cancel', 'test.simple');
  const r = await testRunner.handleInput('sess-cancel', 'zrušit');
  assert.equal(r.phase, ScenarioPhase.CANCELLED);
  assert(r.done);
  assert(!testRunner.isActive('sess-cancel'));
});

await it('storno command stops scenario', async () => {
  testRunner.start('sess-cancel2', 'test.simple');
  const r = await testRunner.handleInput('sess-cancel2', 'storno');
  assert.equal(r.phase, ScenarioPhase.CANCELLED);
  assert(r.done);
});

// ─── 7. Presenting Phase ────────────────────────────────────────────────────

console.log('\n── 7. Presenting Phase ──');

await it('recommendation request transitions phase', async () => {
  testRunner.start('sess-rec', 'test.simple');
  await testRunner.handleInput('sess-rec', 'Alice');
  await testRunner.handleInput('sess-rec', '30');
  await testRunner.handleInput('sess-rec', 'yes'); // → PRESENTING
  const r = await testRunner.handleInput('sess-rec', 'co mi doporučíš?');
  assert.equal(r.phase, ScenarioPhase.RECOMMENDING);
  assert(r.recommendPrompt);
});

await it('generic response in PRESENTING completes scenario', async () => {
  testRunner.start('sess-done', 'test.simple');
  await testRunner.handleInput('sess-done', 'Alice');
  await testRunner.handleInput('sess-done', '30');
  await testRunner.handleInput('sess-done', 'yes'); // → PRESENTING
  const r = await testRunner.handleInput('sess-done', 'díky');
  assert.equal(r.phase, ScenarioPhase.COMPLETED);
  assert(r.done);
});

// ─── 8. Adjusting Phase ─────────────────────────────────────────────────────

console.log('\n── 8. Adjusting Phase ──');

await it('adjust request enters ADJUSTING phase', async () => {
  testRunner.start('sess-adj', 'test.simple');
  await testRunner.handleInput('sess-adj', 'Alice');
  await testRunner.handleInput('sess-adj', '30');
  await testRunner.handleInput('sess-adj', 'yes'); // → PRESENTING
  const r = await testRunner.handleInput('sess-adj', 'chci změnit parametry');
  assert.equal(r.phase, ScenarioPhase.ADJUSTING);
});

await it('adjustment re-computes with new data', async () => {
  // In ADJUSTING, extractors run in order — name step matches any non-empty string.
  // So "35" matches the name step first, re-computes with name='35'.
  const r = await testRunner.handleInput('sess-adj', '35');
  assert.equal(r.phase, ScenarioPhase.PRESENTING);
  assert(r.message.includes('Hello 35')); // name was updated to "35"
});

// ─── 9. Custom Registry ─────────────────────────────────────────────────────

console.log('\n── 9. Custom Registry ──');

it('register requires id', () => {
  const reg = new ScenarioRegistry();
  assert.throws(() => reg.register({}), /requires id/);
});

it('register requires specialistId', () => {
  const reg = new ScenarioRegistry();
  assert.throws(() => reg.register({ id: 'x' }), /requires specialistId/);
});

it('register requires steps', () => {
  const reg = new ScenarioRegistry();
  assert.throws(() => reg.register({ id: 'x', specialistId: 'y', triggers: [/a/] }), /requires at least one step/);
});

it('register requires triggers', () => {
  const reg = new ScenarioRegistry();
  assert.throws(() => reg.register({
    id: 'x', specialistId: 'y',
    steps: [{ id: 'a', question: 'q', extract: () => null }],
  }), /requires triggers/);
});

// ─── 10. Built-in Accountant Scenario ────────────────────────────────────────

console.log('\n── 10. Accountant Tax Optimization ──');

it('accountant scenario has 5 steps', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  assert.equal(s.steps.length, 5);
});

it('accountant scenario has compute and present functions', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  assert(typeof s.compute === 'function');
  assert(typeof s.present === 'function');
});

it('accountant income step extracts 850k', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[0].extract('850k');
  assert.equal(val, 850000);
});

it('accountant income step extracts "850 000"', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[0].extract('850 000');
  assert.equal(val, 850000);
});

it('accountant entity step extracts OSVČ', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[1].extract('OSVČ');
  assert.equal(val, 'osvc');
});

it('accountant entity step extracts compare', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[1].extract('3');
  assert.equal(val, 'compare');
});

it('accountant expense step skips for sro', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const skipFn = s.steps[2].skipIf;
  assert(skipFn({ entity_type: 'sro' }));
  assert(!skipFn({ entity_type: 'osvc' }));
});

it('accountant year step extracts 2025', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[3].extract('2025');
  assert.equal(val, 2025);
});

it('accountant children step extracts 2', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[4].extract('2 děti');
  assert.equal(val, 2);
});

it('accountant children step extracts 0 for "žádné"', () => {
  const s = scenarioRegistry.getScenario('accountant.tax_optimization');
  const val = s.steps[4].extract('žádné');
  assert.equal(val, 0);
});

// ─── 11. Full E2E with Accountant Scenario ───────────────────────────────────

console.log('\n── 11. Full E2E Accountant Flow ──');

const e2eRunner = new ScenarioRunner(scenarioRegistry);

await it('full accountant scenario: compare flow', async () => {
  const start = e2eRunner.start('e2e-1', 'accountant.tax_optimization');
  assert(start.message.includes('Pomohu'));
  assert(start.message.includes('příjem'));

  const r1 = await e2eRunner.handleInput('e2e-1', '850k');
  assert(r1.message.includes('Jak podnikáte'));

  const r2 = await e2eRunner.handleInput('e2e-1', '3'); // compare
  assert(r2.message.includes('výdaje'));

  const r3 = await e2eRunner.handleInput('e2e-1', '1'); // flat_60
  assert(r3.message.includes('rok'));

  const r4 = await e2eRunner.handleInput('e2e-1', '2025');
  assert(r4.message.includes('dět'));

  const r5 = await e2eRunner.handleInput('e2e-1', '0');
  // Should be in PRESENTING phase with results
  assert.equal(r5.phase, ScenarioPhase.PRESENTING);
  assert(r5.results);

  const state = e2eRunner.getState('e2e-1');
  assert.equal(state.collected.income, 850000);
  assert.equal(state.collected.entity_type, 'compare');
  assert.equal(state.collected.expense_type, 'flat_60');
  assert.equal(state.collected.year, 2025);
  assert.equal(state.collected.children, 0);
});

await it('full accountant scenario: OSVČ quick flow (skip s.r.o. expense)', async () => {
  const start = e2eRunner.start('e2e-2', 'accountant.tax_optimization');
  await e2eRunner.handleInput('e2e-2', '500000');
  await e2eRunner.handleInput('e2e-2', '1'); // OSVČ
  await e2eRunner.handleInput('e2e-2', '2'); // flat_80
  await e2eRunner.handleInput('e2e-2', '2025');
  const r = await e2eRunner.handleInput('e2e-2', '0'); // no children
  assert.equal(r.phase, ScenarioPhase.PRESENTING);
  assert(r.results);
  assert(r.results.osvc);
});

await it('full accountant scenario: s.r.o. skips expense step', async () => {
  const start = e2eRunner.start('e2e-3', 'accountant.tax_optimization');
  await e2eRunner.handleInput('e2e-3', '1M');
  await e2eRunner.handleInput('e2e-3', '2'); // s.r.o. → skip expense
  // Should go to year (expense skipped)
  const r3 = await e2eRunner.handleInput('e2e-3', '2025');
  // Should go to children
  const r4 = await e2eRunner.handleInput('e2e-3', '1');
  assert.equal(r4.phase, ScenarioPhase.PRESENTING);
  assert(r4.results.sro);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`  Scenario Engine: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log(`══════════════════════════════════════════════════════════`);
if (failed === 0) console.log('✅ ALL SCENARIO ENGINE TESTS PASS');
else console.log(`❌ Failures: ${failures.join(', ')}`);

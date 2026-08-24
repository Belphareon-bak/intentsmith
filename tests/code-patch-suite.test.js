// tests/code-patch-suite.test.js — executable CODE evaluation suite
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { comparePair } from '../src/upgrade/pairwise-trial.js';
import { codePatchSuite, CodePatchEvaluationRunner, MODEL_OPTIONS } from '../src/eval/code-patch-suite.js';
import {
  incrementalBuildSeed, preserveCalibration, reconcileVerifiedTaskSupply,
} from '../src/eval/build-code-suite.js';
import {
  calibrate, rebaseCalibrationPanel, buildPanelSummaries,
} from '../src/eval/calibrate-code-suite.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';

suite('code-patch-suite');

test('CODE role plan nese exact current code_patch suite', () => {
  const plan = createRoleEvaluationPlans({ repeats: 1 }).CODE;
  assertEqual(plan.suiteName, 'code_patch');
  assert(plan.suite === codePatchSuite, 'plan must carry the exact suite object');
  assert(/^[a-f0-9]{64}$/.test(plan.suiteContractSha256), 'missing suite contract SHA');
});

// Souboj se neobchází: sada se do `comparePair` předá explicitně.
await testAsync('comparePair přijme explicitní current suite', async () => {
  const fake = {
    runSuite: async (name, model) => ({
      suite: name, model, tests: [{ name: 'patch_x', score: model === 'a' ? 1 : 0 }],
      score: model === 'a' ? 1 : 0,
    }),
  };
  const cmp = await comparePair(fake, 'code_patch', 'a', 'b', {
    suite: codePatchSuite, repeats: 1,
  });
  assertEqual(cmp.discriminating, 1);
  assertEqual(cmp.candidateWins, 1);
});

await testAsync('runner bez známé sady selže', async () => {
  let threw = false;
  try {
    await comparePair(new CodePatchEvaluationRunner(), 'missing', 'a', 'b', { repeats: 1 });
  } catch { threw = true; }
  assert(threw, 'neznámá sada měla skončit chybou');
});

// Bez vlastních parametrů by platily výchozí num_ctx 4096 a num_predict 512 —
// vadná funkce se do nich nevejde a uříznuté generování by se počítalo jako
// selhání modelu.
await testAsync('runner posílá vlastní parametry volání', async () => {
  const runner = new CodePatchEvaluationRunner('http://127.0.0.1:1');
  let seen = null;
  runner._callModel = async (model, messages, options) => {
    seen = options;
    return { content: 'nic', evalCount: 1, durationMs: 1 };
  };
  await runner._runTest({
    name: 'x',
    options: MODEL_OPTIONS,
    prompt: () => ({ text: 'zadání' }),
    grade: () => ({ passed: false, score: 0 }),
  }, 'model');
  assertEqual(seen.num_ctx, MODEL_OPTIONS.num_ctx);
  assert(seen.num_predict >= 4096, `num_predict je ${seen.num_predict}`);
  assert(seen.timeout >= 300000, `timeout je ${seen.timeout}`);
});

await testAsync('chyba volání dá nulu a nespadne', async () => {
  const runner = new CodePatchEvaluationRunner('http://127.0.0.1:1');
  runner._callModel = async () => ({ content: '', error: 'timeout', durationMs: 5 });
  const r = await runner._runTest({
    name: 'x', options: {}, prompt: () => ({ text: 'z' }), grade: () => ({ passed: true, score: 1 }),
  }, 'model');
  assertEqual(r.score, 0);
  assertEqual(r.passed, false);
});

test('v běžné sadě jsou jen kalibrované aktivní úlohy', () => {
  const fixture = JSON.parse(readFileSync(new URL('../src/eval/code-suite-tasks.json', import.meta.url), 'utf8'));
  const active = fixture.tasks.filter(t => t.status === 'active');
  assertEqual(codePatchSuite.tests.length, active.length);
});

test('fixture nenese úlohy odstraněné paralelní scoring cesty', () => {
  const fixture = JSON.parse(readFileSync(new URL('../src/eval/code-suite-tasks.json', import.meta.url), 'utf8'));
  const deprecated = /model-ranker|validation-suites|benchmark-estimator|empirical-scorer|metrics-collector/;
  assert(!deprecated.test(JSON.stringify(fixture.tasks)), 'deprecated scoring task remained in fixture');
});

test('--help je read-only a fixture nepřegeneruje', () => {
  const fixtureUrl = new URL('../src/eval/code-suite-tasks.json', import.meta.url);
  const before = readFileSync(fixtureUrl, 'utf8');
  const output = execFileSync(process.execPath, ['src/eval/build-code-suite.js', '--help'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  const after = readFileSync(fixtureUrl, 'utf8');
  assert(output.includes('Usage:'), 'help output missing');
  assertEqual(after, before);
});

test('rebuild zachová kalibraci jen při totožném úplném fingerprintu', () => {
  const previous = {
    tasks: [{
      hash: 'abc', taskFingerprint: 'same', status: 'active',
      calibration: { verdict: 'rozlišuje', values: [1, 0] },
    }],
  };
  const [same, changed] = preserveCalibration([
    { hash: 'abc', taskFingerprint: 'same' },
    { hash: 'abc', taskFingerprint: 'different' },
  ], previous);
  assertEqual(same.status, 'active');
  assertEqual(same.calibration.verdict, 'rozlišuje');
  assertEqual(changed.status, 'pending-recalibration');
  assertEqual(changed.calibration, null);
});

test('inkrementální rebuild použije jen fixture se stejným kontraktem', () => {
  const previous = {
    taskContractVersion: 'code-task-v2',
    tasks: [{ hash: 'abc', source: 'src/a.js' }],
    rejected: [{ hash: 'def', reason: 'podlaha' }, { hash: 'def', reason: 'jiný důvod' }],
  };
  const seed = incrementalBuildSeed(previous);
  assertEqual(seed.existingTasks.length, 1);
  assertEqual(seed.rejectedHashes.length, 1);

  let blocked = false;
  try { incrementalBuildSeed({ ...previous, taskContractVersion: 'code-task-v1' }); } catch { blocked = true; }
  assert(blocked, 'append přes změnu kontraktu musí selhat');
});

test('plný rebuild nesmí tiše zahodit gold zásobu', () => {
  const previous = {
    taskContractVersion: 'code-task-v2',
    tasks: [{
      hash: 'gold0000', source: 'src/gold.js', taskFingerprint: 'f'.repeat(64),
      status: 'active', calibration: { verdict: 'rozlišuje' },
    }],
  };
  const same = reconcileVerifiedTaskSupply([], [], previous);
  assertEqual(same.tasks.length, 1);
  assertEqual(same.tasks[0].hash, 'gold0000');
  assertEqual(same.rejected.length, 0);

  const changed = reconcileVerifiedTaskSupply([], [], {
    ...previous, taskContractVersion: 'code-task-v1',
  });
  assertEqual(changed.tasks.length, 0);
  assertEqual(changed.rejected.length, 1);
  assert(changed.rejected[0].reason.includes('code-task-v1 → code-task-v2'));
});

test('inkrementální kalibrace nezahodí dříve změřenou úlohu', () => {
  const fixture = { tasks: [
    { hash: 'aaa00000', taskFingerprint: 'a'.repeat(64), status: 'active', calibration: { verdict: 'rozlišuje' } },
    { hash: 'bbb00000', taskFingerprint: 'b'.repeat(64), status: 'pending-recalibration', calibration: null },
  ] };
  const out = calibrate(fixture, {
    measuredAt: '2026-08-22T00:00:00.000Z', models: ['a', 'b'], repeats: 3,
    tasks: [{ name: `patch_${'b'.repeat(12)}`, verdict: 'podlaha', values: [0, 0], noise: 0 }],
  });
  assertEqual(out.tasks[0].status, 'active');
  assertEqual(out.tasks[0].calibration.verdict, 'rozlišuje');
  assertEqual(out.tasks[1].status, 'reserve-floor');
});

test('změna panelu znovu použije jen exact-task historii a neúplnost nechá pending', () => {
  const fixture = { tasks: [
    {
      hash: 'aaa00000', taskFingerprint: 'a'.repeat(64), status: 'active',
      calibration: {
        verdict: 'rozlišuje', panel: ['old-a', 'old-b'], values: [0.25, 0.5],
        noise: 0, repeats: 3, measuredAt: '2026-08-22T00:00:00.000Z',
      },
    },
    { hash: 'bbb00000', taskFingerprint: 'b'.repeat(64), status: 'pending-recalibration', calibration: null },
  ] };
  const out = rebaseCalibrationPanel(fixture, [{
    measuredAt: '2026-08-23T00:00:00.000Z', models: ['new-c'], repeats: 3,
    tasks: [{ name: `patch_${'a'.repeat(12)}`, values: [1], noise: 0 }],
  }], ['old-a', 'old-b', 'new-c']);
  assertEqual(out.tasks[0].calibration.values.join(','), '0.25,0.5,1');
  assertEqual(out.tasks[0].status, 'active');
  assertEqual(out.tasks[0].calibration.modelEvidence[0].source, 'prior-exact-task');
  assertEqual(out.tasks[0].calibration.modelEvidence[2].source, 'new-report');
  assertEqual(out.tasks[1].status, 'pending-recalibration');
  assert(out.tasks[1].recalibrationReason.includes('neúplný panel'));
});

test('kalibrační panel se převede na reusable historii jen z aktivních úloh', () => {
  const summaries = buildPanelSummaries({ tasks: [
    { hash: 'aaa00000', taskFingerprint: 'a'.repeat(64), status: 'active' },
    { hash: 'bbb00000', taskFingerprint: 'b'.repeat(64), status: 'active' },
    { hash: 'ccc00000', taskFingerprint: 'c'.repeat(64), status: 'reserve-floor' },
  ] }, [{
    models: ['candidate', 'incumbent'], repeats: 3,
    tasks: [
      { name: `patch_${'a'.repeat(12)}`, values: [0.25, 0.75], noise: 0 },
      { name: `patch_${'b'.repeat(12)}`, values: [1, 0.5], noise: 0.1 },
      { name: `patch_${'c'.repeat(12)}`, values: [0, 0], noise: 0 },
    ],
  }]);
  assertEqual(summaries.length, 2);
  assertEqual(summaries[0].tasks.length, 2);
  assertEqual(summaries[0].score, 0.625);
  assertEqual(summaries[1].score, 0.625);
});

test('reusable historie doplní split panel z exact kalibrace fixture', () => {
  const fixture = { tasks: [{
    hash: 'aaa00000', taskFingerprint: 'a'.repeat(64), status: 'active',
    calibration: { panel: ['old', 'new'], values: [0.25, 1], noise: 0, repeats: 3 },
  }] };
  const summaries = buildPanelSummaries(fixture, [{
    models: ['new'], repeats: 3,
    tasks: [{ name: `patch_${'a'.repeat(12)}`, values: [1], noise: 0 }],
  }]);
  assertEqual(summaries.length, 2);
  assertEqual(summaries.find(row => row.model === 'old').score, 0.25);
  assertEqual(summaries.find(row => row.model === 'new').score, 1);
});

test('multi-source úlohy ze stejného commitu mají odlišnou runtime identitu', () => {
  const fixture = { tasks: [
    { hash: 'abc12345', source: 'src/a.js', taskFingerprint: '1'.repeat(64), status: 'pending-recalibration', calibration: null },
    { hash: 'abc12345', source: 'src/b.js', taskFingerprint: '2'.repeat(64), status: 'pending-recalibration', calibration: null },
  ] };
  const out = calibrate(fixture, {
    measuredAt: '2026-08-23T00:00:00.000Z', models: ['a', 'b'], repeats: 3,
    tasks: [
      { name: `patch_${'1'.repeat(12)}`, verdict: 'rozlišuje', values: [1, 0], noise: 0 },
      { name: `patch_${'2'.repeat(12)}`, verdict: 'podlaha', values: [0, 0], noise: 0 },
    ],
  });
  assertEqual(out.tasks[0].status, 'active');
  assertEqual(out.tasks[1].status, 'reserve-floor');
});

test('zneplatněný kolizní report nelze kalibrovat ani importovat', () => {
  const invalid = { invalidated: true, invalidReason: 'task id collision', tasks: [] };
  let calibrationBlocked = false;
  let importBlocked = false;
  try { calibrate({ tasks: [] }, invalid); } catch { calibrationBlocked = true; }
  try { buildPanelSummaries({ tasks: [] }, [invalid]); } catch { importBlocked = true; }
  assert(calibrationBlocked && importBlocked, 'invalid evidence must fail closed');
});

summary();

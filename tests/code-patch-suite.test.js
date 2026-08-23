// tests/code-patch-suite.test.js — zapojení sady bez zásahu do připnutého souboru
// ══════════════════════════════════════════════════════════════════════════════
// `src/upgrade/validation-suites.js` je bajtově připnutý ve fail-closed proof
// policy. Sada `code_patch` se proto registruje zvenčí. Tenhle soubor hlídá,
// že to tak zůstane — porušení se jinak projeví až pádem proof policy.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { SUITES } from '../src/upgrade/validation-suites.js';
import { comparePair } from '../src/upgrade/pairwise-trial.js';
import { codePatchSuite, CodePatchValidationRunner, MODEL_OPTIONS } from '../src/eval/code-patch-suite.js';
import { preserveCalibration } from '../src/eval/build-code-suite.js';
import { calibrate, buildPanelSummaries } from '../src/eval/calibrate-code-suite.js';
import {
  MODEL_FAILOVER_PROOF_POLICY_SOURCE_PINS,
  getModelFailoverProofPolicy,
} from '../src/upgrade/model-failover-proof-policy.js';

suite('code-patch-suite');

// Regrese 2026-08-21: první verze sady zapsala registraci přímo do
// `validation-suites.js` a shodila celou policy na SOURCE_DRIFT.
test('připnutý validation-suites.js zůstává nedotčený', () => {
  const pin = MODEL_FAILOVER_PROOF_POLICY_SOURCE_PINS.validationSuites;
  const bytes = readFileSync(new URL('../src/upgrade/validation-suites.js', import.meta.url));
  assertEqual(bytes.length, pin.byteLength, 'délka připnutého souboru se změnila');
  assertEqual(createHash('sha256').update(bytes).digest('hex'), pin.sha256,
    'obsah připnutého souboru se změnil — proof policy spadne na SOURCE_DRIFT');
});

test('proof policy projde i se zaregistrovanou sadou', () => {
  const policy = getModelFailoverProofPolicy();
  assert(policy, 'policy nevrátila nic');
});

// Registr hlídá policy: `Object.keys(SUITES)` musí přesně odpovídat pěti
// sadám, takže se do něj `code_patch` zapsat nesmí ani zvenčí.
test('sada se do registru SUITES nezapisuje', () => {
  assertEqual(SUITES.code_patch, undefined, 'code_patch je v registru — policy spadne');
  assertEqual(Object.keys(SUITES).length, 5);
});

// Vazba role se nepřebírá — přepnutí CODE je ruční rozhodnutí operátora.
test('sada nepřebírá vazbu žádné role', () => {
  assertEqual(codePatchSuite.roles.length, 0);
});

test('staré sady zůstávají beze změny', () => {
  for (const name of ['reasoning', 'code', 'chat', 'vision', 'review']) {
    assert(SUITES[name], `chybí sada ${name}`);
  }
});

// Souboj se neobchází: sada se do `comparePair` předá explicitně.
await testAsync('comparePair sadu přijme mimo registr', async () => {
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

await testAsync('bez předané sady souboj mimo registr selže', async () => {
  let threw = false;
  try { await comparePair({}, 'code_patch', 'a', 'b', { repeats: 1 }); } catch { threw = true; }
  assert(threw, 'neznámá sada měla skončit chybou');
});

// Bez vlastních parametrů by platily výchozí num_ctx 4096 a num_predict 512 —
// vadná funkce se do nich nevejde a uříznuté generování by se počítalo jako
// selhání modelu.
await testAsync('runner posílá vlastní parametry volání', async () => {
  const runner = new CodePatchValidationRunner('http://127.0.0.1:1');
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
  const runner = new CodePatchValidationRunner('http://127.0.0.1:1');
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

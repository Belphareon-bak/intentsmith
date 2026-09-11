// Current versioned role-evaluation plans, suites, runner and image fixtures.

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { createHash } from 'node:crypto';
import { MODEL_ACTIVITY_OWNER, modelUseAuthority } from '../src/upgrade/model-use-authority.js';
import {
  MODEL_EVALUATION_ARTIFACT_ERROR,
  ModelEvaluationArtifactError,
  ModelEvaluationRunner,
} from '../src/eval/model-evaluation-runner.js';
import {
  ROLE_QUALITY_SUITES,
  chatV3Suite,
  reasoningV2Suite,
  reviewV2Suite,
  visionV2Suite,
  describeChatTests,
} from '../src/eval/role-quality-suites.js';
import {
  MINIMUM_ROLE_DISCRIMINATION,
  MINIMUM_ROLE_TASK_COUNTS,
  MODEL_EVALUATION_APPLICABILITY_VERSION,
  createRoleEvaluationPlans,
} from '../src/eval/role-evaluation-plan.js';
import { generateSyntheticPng, getSyntheticTestImages } from '../src/eval/synthetic-images.js';
import { MODEL_PROFILES } from '../src/upgrade/model-profiles.js';

const plans = createRoleEvaluationPlans({ repeats: 1 });
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

suite('current role evaluation authority');

test('all seven roles have one explicit versioned contract', () => {
  assertEqual(Object.keys(plans).sort().join(','), 'CHAT,CODE,D1,D2,R1,R2,VISION');
  for (const [role, plan] of Object.entries(plans)) {
    assertEqual(plan.role, role);
    assert(plan.suite && plan.suite.name === plan.suiteName, `${role} suite mismatch`);
    assert(plan.suiteVersion.length > 0, `${role} missing suite version`);
    assert(/^[a-f0-9]{64}$/.test(plan.suiteContractSha256), `${role} missing contract SHA`);
    assertEqual(
      plan.applicabilityContract.version,
      MODEL_EVALUATION_APPLICABILITY_VERSION,
    );
    assertEqual(plan.applicabilityContract.role, role);
    assertEqual(plan.applicabilityContract.scope, 'all-technically-compatible-installed-artifacts');
    assertEqual(plan.taskCount, plan.suite.tests.length);
  }
});

test('shared reasoning roles use the same exact contract', () => {
  assert(plans.D1.suite === plans.D2.suite && plans.D2.suite === plans.R1.suite);
  assertEqual(plans.D1.suiteContractSha256, plans.D2.suiteContractSha256);
  assertEqual(plans.D2.suiteContractSha256, plans.R1.suiteContractSha256);
});

test('discovery presentation cannot drift from versioned technical applicability', () => {
  for (const [role, plan] of Object.entries(plans)) {
    const requirements = MODEL_PROFILES[role].requirements;
    const contract = plan.applicabilityContract;
    assertEqual(requirements.minParams, contract.minimumParametersBillions);
    assertEqual(requirements.maxParams, contract.maximumParametersBillions);
    const profileNeedsVision = requirements.capabilities.includes('vision')
      || requirements.capabilities.includes('image-understanding');
    assertEqual(profileNeedsVision, contract.requiredModalities.includes('vision'));
  }
});

test('suite definitions have unique tasks, prompts, graders and public rubrics', () => {
  const suites = [...Object.values(ROLE_QUALITY_SUITES), plans.CODE.suite];
  for (const current of suites) {
    const names = current.tests.map(row => row.name);
    assertEqual(names.length, new Set(names).size, `${current.name} duplicate task`);
    for (const row of current.tests) {
      assert(typeof row.prompt === 'function', `${current.name}/${row.name} prompt`);
      assert(typeof row.grade === 'function', `${current.name}/${row.name} grader`);
      if (current.name !== 'code_patch') {
        assert(Array.isArray(row.rubric) && row.rubric.length > 0,
          `${current.name}/${row.name} missing rubric`);
      }
    }
  }
});

test('every role has a fail-closed task and discrimination floor', () => {
  for (const [role, plan] of Object.entries(plans)) {
    assertEqual(plan.minimumTaskCount, MINIMUM_ROLE_TASK_COUNTS[role]);
    assertEqual(plan.minimumDiscriminatingTasks, MINIMUM_ROLE_DISCRIMINATION[role]);
    assert(plan.minimumTaskCount > 1, `${role} task floor must not accept a smoke test`);
    assert(plan.minimumDiscriminatingTasks > 1,
      `${role} decision floor must reject one lucky task`);
    assert(plan.taskCount >= plan.minimumTaskCount,
      `${role}: ${plan.taskCount}/${plan.minimumTaskCount}`);
    assertEqual(plan.decisionReady, true);
  }
});

test('CHAT requires broad English and Czech discrimination', () => {
  assertEqual(plans.CHAT.minimumDiscriminatingTasks, 7);
  assertEqual(plans.CHAT.minimumDiscriminatingByLanguage.en, 3);
  assertEqual(plans.CHAT.minimumDiscriminatingByLanguage.cs, 4);
  const descriptions = describeChatTests();
  assertEqual(descriptions.length, 40);
  assertEqual(descriptions.filter(row => row.language === 'en').length, 24);
  assertEqual(descriptions.filter(row => row.language === 'cs').length, 16);
  assert(descriptions.every(row => row.rubric.length >= 4));
});

suite('synthetic image fixtures');

test('generated PNG has valid signature and dimensions', () => {
  const png = generateSyntheticPng(8, 8, Array(64).fill([0, 255, 0]));
  const bytes = Buffer.from(png, 'base64');
  assertEqual(bytes.subarray(0, 4).toString('hex'), '89504e47');
  assertEqual(bytes.readUInt32BE(16), 8);
  assertEqual(bytes.readUInt32BE(20), 8);
});

test('VISION fixtures are complete, valid and cached', () => {
  const first = getSyntheticTestImages();
  const second = getSyntheticTestImages();
  assert(first === second, 'fixtures must be cached');
  assertEqual(Object.keys(first).sort().join(','), 'circleImg,dotsImg,red8x8,redPixel');
  for (const image of Object.values(first)) {
    assertEqual(Buffer.from(image, 'base64').subarray(0, 4).toString('hex'), '89504e47');
  }
  const withImages = visionV2Suite.tests.filter(row => row.prompt().images?.length);
  assertEqual(withImages.length, 4);
  for (const row of withImages) {
    const expected = row.prompt().images.map(image => (
      createHash('sha256').update(Buffer.from(image, 'base64')).digest('hex')
    ));
    assertEqual(row.contractMaterial.prompt.imageDigests.join(','), expected.join(','));
  }
});

suite('model evaluation runner');

await testAsync('direct call returns content and metrics', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        message: { content: `response:${body.messages[0].content}` },
        eval_count: 42,
        prompt_eval_count: 9,
      }),
    };
  };
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    const result = await runner._callModel('fixture', [{ role: 'user', content: 'ping' }]);
    assertEqual(result.content, 'response:ping');
    assertEqual(result.evalCount, 42);
    assertEqual(result.promptEvalCount, 9);
  } finally {
    globalThis.fetch = original;
  }
});

await testAsync('evaluation cannot race a pull and holds its lease through response consumption', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let activeDuringBody = false;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => {
      try {
        const conflict = modelUseAuthority.acquireExclusive({ modelName: 'fixture', owner: MODEL_ACTIVITY_OWNER.MODEL_PULL });
        conflict.release();
      } catch { activeDuringBody = true; }
      return { message: { content: 'held' } };
    } };
  };
  let lease = modelUseAuthority.acquireExclusive({ modelName: 'fixture', owner: MODEL_ACTIVITY_OWNER.MODEL_PULL });
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    const blocked = await runner._callModel('fixture', [{ role: 'user', content: 'ping' }]);
    assert(blocked.error);
    assertEqual(calls, 0);
    lease.release();
    lease = null;
    assertEqual((await runner._callModel('fixture', [{ role: 'user', content: 'ping' }])).content, 'held');
    assert(activeDuringBody, 'shared claim must remain active until body completion');
    lease = modelUseAuthority.acquireExclusive({ modelName: 'fixture', owner: MODEL_ACTIVITY_OWNER.MODEL_PULL });
  } finally { lease?.release(); globalThis.fetch = original; }
});

await testAsync('authoritative direct call accepts a response-attested artifact', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      model: 'fixture:latest',
      digest: `sha256:${DIGEST_A}`,
      message: { content: 'verified' },
    }),
  });
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    const result = await runner._callModel(
      'fixture',
      [{ role: 'user', content: 'ping' }],
      {},
      { modelName: 'fixture:latest', digestSha256: DIGEST_A },
    );
    assertEqual(result.content, 'verified');
  } finally {
    globalThis.fetch = original;
  }
});

await testAsync('authoritative direct call rejects a response without artifact proof', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ model: 'fixture', message: { content: 'unproven' } }),
  });
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    let error = null;
    try {
      await runner._callModel(
        'fixture',
        [{ role: 'user', content: 'ping' }],
        {},
        { modelName: 'fixture', digestSha256: DIGEST_A },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof ModelEvaluationArtifactError);
    assertEqual(error.code, MODEL_EVALUATION_ARTIFACT_ERROR.RESPONSE_UNVERIFIED);
  } finally {
    globalThis.fetch = original;
  }
});

await testAsync('authoritative direct call rejects artifact drift', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      model: 'fixture', digest: DIGEST_B, message: { content: 'wrong artifact' },
    }),
  });
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    let error = null;
    try {
      await runner._callModel(
        'fixture',
        [{ role: 'user', content: 'ping' }],
        {},
        { modelName: 'fixture', digestSha256: DIGEST_A },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof ModelEvaluationArtifactError);
    assertEqual(error.code, MODEL_EVALUATION_ARTIFACT_ERROR.RESPONSE_DRIFT);
  } finally {
    globalThis.fetch = original;
  }
});

await testAsync('timeout is a typed zero-result input, not an exception', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  try {
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
    const result = await runner._callModel(
      'fixture', [{ role: 'user', content: 'ping' }], { timeout: 5 },
    );
    assertEqual(result.content, '');
    assertEqual(result.timedOut, true);
    assert(result.error.length > 0);
  } finally {
    globalThis.fetch = original;
  }
});

await testAsync('suite executes sequentially and reports bounded scores', async () => {
  const current = Object.freeze({
    name: 'unit_v1',
    tests: Object.freeze([
      Object.freeze({
        name: 'one', rubric: ['one'], prompt: () => 'first',
        grade: response => ({ passed: response === 'ok', score: 1 }),
      }),
      Object.freeze({
        name: 'two', rubric: ['two'], prompt: () => ({ text: 'second' }),
        grade: () => ({ passed: false, score: -10 }),
      }),
    ]),
  });
  const runner = new ModelEvaluationRunner('http://127.0.0.1:11434', {
    suites: { unit_v1: current },
  });
  runner._callModel = async () => ({ content: 'ok', evalCount: 1, durationMs: 1 });
  const progress = [];
  const result = await runner.runSuite('unit_v1', 'fixture', row => progress.push(row));
  assertEqual(result.total, 2);
  assertEqual(result.passed, 1);
  assertEqual(result.tests[1].score, 0);
  assertEqual(result.score, 0.5);
  assertEqual(progress.at(-1).status, 'complete');
});

await testAsync('unknown suite fails closed', async () => {
  let error = null;
  try { await new ModelEvaluationRunner().runSuite('missing', 'fixture'); } catch (err) { error = err; }
  assert(/Unknown evaluation suite/.test(error?.message || ''));
});

suite('role-specific grading regressions');

test('CHAT uses partial scoring, not a keyword PASS', () => {
  const task = chatV3Suite.tests.find(row => row.name === 'en_grounded_summary');
  const partial = task.grade('Project Northstar launches on October 14.');
  const full = task.grade('Project Northstar launches on October 14 with a $2.4 million budget. Maya Chen owns delivery, and the risk is a delayed battery supplier.');
  assert(partial.score > 0 && partial.score < 1);
  assert(full.score > partial.score);
});

test('Czech CHAT rewards facts, constraints and grammar together', () => {
  const task = chatV3Suite.tests.find(row => row.name === 'cz_grounded_summary');
  const good = task.grade('Brněnská kancelář se otevře 3. května, bude mít 12 lidí a rozpočet 480 000 Kč. Vedoucí bude Eva Šímová.');
  const weak = task.grade('Kancelar bude otevrena.');
  assert(good.score >= 0.8);
  assert(weak.score < good.score);
});

test('Czech grammar cases distinguish correct inflection', () => {
  const task = chatV3Suite.tests.find(row => row.name === 'cz_declension');
  const good = task.grade('Děkuji Evě Šímové za pomoc a dokument pošlu Janu Křížovi zítra.');
  const bad = task.grade('Děkuji Eva Šímová za pomoc a dokument pošlu Jan Kříž zítra.');
  assertEqual(good.score, 1);
  assert(bad.score < good.score);
});

test('reasoning awards exact intermediate results', () => {
  const task = reasoningV2Suite.tests.find(row => row.name === 'reason_transform');
  const partial = task.grade('{"after_multiply":20,"after_subtract":14,"after_divide":8,"result":64}');
  const full = task.grade('{"after_multiply":20,"after_subtract":14,"after_divide":7,"result":49}');
  assert(partial.score > 0 && partial.score < 1);
  assertEqual(full.score, 1);
});

test('review rewards recall and penalizes invented findings', () => {
  const task = reviewV2Suite.tests.find(row => row.name === 'review_sql_null');
  const exact = task.grade('{"findings":[{"line":2,"kind":"sql_injection"},{"line":3,"kind":"null_dereference"}]}');
  const noisy = task.grade('{"findings":[{"line":2,"kind":"sql_injection"},{"line":3,"kind":"secret_exposure"}]}');
  assertEqual(exact.score, 1);
  assert(noisy.score < exact.score);
});

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

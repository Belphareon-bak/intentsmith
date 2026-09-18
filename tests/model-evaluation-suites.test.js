// Current versioned role-evaluation plans, suites, runner and image fixtures.

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { createHash } from 'node:crypto';
import strictAssert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suiteContract } from '../src/upgrade/model-evaluation-history.js';
import { runInNewContext } from 'node:vm';
import { MODEL_ACTIVITY_OWNER, modelUseAuthority } from '../src/upgrade/model-use-authority.js';
import {
  MODEL_EVALUATION_ARTIFACT_ERROR,
  ModelEvaluationArtifactError,
  ModelEvaluationRunner,
} from '../src/eval/model-evaluation-runner.js';
import {
  ROLE_QUALITY_SUITES,
  REPOSITORY_REASONING_CASES,
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
  codeGradingRuntimeContract,
  textGradingRuntimeContract,
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

test('CODE reuse pins the actual grader/helper/lock bytes and Node runtime', () => {
  const fixtureSha256 = createHash('sha256').update(readFileSync(new URL('../src/eval/code-suite-tasks.json', import.meta.url))).digest('hex');
  const hash = runtime => suiteContract(plans.CODE.suite, { version: plans.CODE.suiteVersion, repeats: 1,
    extra: { codeFixtureSha256: fixtureSha256, codeGradingRuntime: runtime } }).sha256;
  const runtime = codeGradingRuntimeContract();
  assertEqual(runtime.nodeVersion, process.version);
  assertEqual(hash(runtime), plans.CODE.suiteContractSha256, 'the production plan uses the complete runtime contract');
  for (const relative of Object.keys(runtime.sources)) {
    assertEqual(runtime.sources[relative], createHash('sha256').update(readFileSync(new URL(relative, new URL('../src/eval/role-evaluation-plan.js', import.meta.url)))).digest('hex'));
    const changed = codeGradingRuntimeContract(url => {
      const bytes = readFileSync(url);
      return url.pathname.endsWith(relative.replace(/^.*\//, '/')) ? Buffer.concat([bytes, Buffer.from('\nchanged')]) : bytes;
    });
    assert(hash(changed) !== plans.CODE.suiteContractSha256, `${relative} must invalidate a cached CODE grade`);
  }
  assert(hash({ ...runtime, nodeVersion: 'changed-node-runtime' }) !== plans.CODE.suiteContractSha256);

});

test('unreadable CODE grading material fails closed instead of reusing an unknown grader', () => {
  for (const name of ['/code-patch-runner.js', '/function-span.js', '/package-lock.json']) {
    strictAssert.throws(() => codeGradingRuntimeContract(url => {
      if (url.pathname.endsWith(name)) throw Object.assign(new Error('missing grader material'), { code: 'ENOENT' });
      return readFileSync(url);
    }), /missing grader material/);
  }
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
  assertEqual(withImages.length, 12);
  assertEqual(new Set(withImages.flatMap(t => t.contractMaterial.prompt.imageDigests)).size, 12);
  assertEqual(new Set(withImages.map(t => t.skill)).size, 12);
  assertEqual(withImages.filter(t => t.difficulty === 'hard').length, 5);
  for (const row of withImages) {
    const expected = row.prompt().images.map(image => (
      createHash('sha256').update(Buffer.from(image, 'base64')).digest('hex')
    ));
    assertEqual(row.contractMaterial.prompt.imageDigests.join(','), expected.join(','));
  }
});

suite('model evaluation runner');

test('all text-role cache identities include the real shared grader and image oracle bytes', () => {
  const runtime = textGradingRuntimeContract();
  for (const [role, plan] of Object.entries(plans)) {
    if (role === 'CODE') continue;
    const hash = textGradingRuntime => suiteContract(plan.suite, { version: plan.suiteVersion,
      repeats: 1, extra: { textGradingRuntime } }).sha256;
    assertEqual(hash(runtime), plan.suiteContractSha256);
    for (const path of Object.keys(runtime.sources)) {
      const changed = textGradingRuntimeContract(url => Buffer.concat([readFileSync(url),
        Buffer.from(url.pathname.endsWith(path.replace(/^\.\//, '')) ? '\nmutation' : '')]));
      assert(hash(changed) !== plan.suiteContractSha256, `${role}/${path} invalidates reuse`);
    }
  }
  strictAssert.throws(() => textGradingRuntimeContract(() => { throw new Error('missing source'); }), /missing source/);
});

test('VISION complete-value oracle accepts normalization but rejects negations, stuffing and invented fields', () => {
  for (const task of visionV2Suite.tests) {
    const expected = task.contractMaterial.gradingInputs.expected;
    assertEqual(task.grade(JSON.stringify(expected)).score, 1, task.name);
    for (const invalid of ['', '{}', task.promptText, 'red green blue black white ring 5 100',
      'Actually the answer is wrong. '+JSON.stringify(expected),
      JSON.stringify({ ...expected, contradictory_extra_claim: 'everything else is false' })]) {
      assertEqual(task.grade(invalid).score, 0, `${task.name}: ${invalid.slice(0, 60)}`);
    }
    // Each advertised field contributes once, with no free points for JSON.
    for (const key of Object.keys(expected)) {
      const wrong = { ...expected, [key]: null };
      assert(task.grade(JSON.stringify(wrong)).score < 1, `${task.name}/${key}`);
    }
  }
  const ring = visionV2Suite.tests.find(t => t.name === 'vision_ring');
  assertEqual(ring.grade('{"shape":"not a ring","foreground":"not black","background":"not white"}').score, 0);
  assertEqual(ring.grade('{"shape":" Circle ","foreground":"BLACK","background":"white"}').score, 1);
  const count = visionV2Suite.tests.find(t => t.name === 'vision_count');
  assertEqual(count.grade('{"total":5,"red":3,"blue":1,"colors":["blue","green","red"]}').score, 1);
  assertEqual(count.grade('{"total":5,"red":3,"blue":1,"colors":["blue","green","red","yellow"]}').score, .75);
  assertEqual(count.grade('{"total":5,"red":3,"blue":1,"colors":["red","red","blue"]}').score, .75);
});

test('VISION hard oracles match independently recomputed pictured quantities and routes', () => {
  const task = name => visionV2Suite.tests.find(t => t.name === `vision_${name}`);
  // Independent expected values verified against the committed images.
  assertEqual(task('orders').grade('{"ids":["F62","A17","D40"],"quantity":10,"total":121}').score, 1);
  assertEqual(task('routes').grade('{"path":["S","B","C","T"],"cost":5,"edges":3}').score, 1);
  assertEqual(task('reconciliation').grade('{"incorrect":["Adapter"],"subtotal":190,"final":205.2,"overcharge":21.6}').score, 1);
  assertEqual(task('lines').grade('{"weeks":["W2","W4"],"largest_gap_week":"W1","gap":40,"blue_w3":40}').score, 1);
  assertEqual(task('dashboard').grade('{"wrong_rows":["billing"],"healthy_prod":3,"non_healthy":"worker","overstatement":1}').score, 1);
});

test('review matching penalizes duplicates, wrong lines, false positives and omissions with F1', () => {
  const task = reviewV2Suite.tests.find(t => t.name === 'review_sql_null');
  const grade = findings => task.grade(JSON.stringify({ findings }));
  const a = { kind: 'sql_injection', line: 2 }, b = { kind: 'null_dereference', line: 3 };
  assertEqual(grade([a, b]).score, 1);
  strictAssert.ok(Math.abs(grade([a]).score - 2/3) < 1e-12);
  assertEqual(grade([a, b, a, b]).score, 2/3);
  assertEqual(grade([{ ...a, line: 200 }, { ...b, line: 300 }]).score, 0);
  const many = grade([a, b, ...Array(100).fill(a)]);
  assertEqual(many.detail.truePositive, 2); assertEqual(many.detail.falsePositive, 100);
  assert(many.score < .04);
  assertEqual(grade([]).score, 0);
  assertEqual(task.grade('{"findings":[],"extra":true}').score, 0);
  const clean = reviewV2Suite.tests.find(t => t.name === 'review_clean');
  assertEqual(clean.grade('{"findings":[]}').score, 1);
  assertEqual(clean.grade(JSON.stringify({ findings: [a] })).score, 0);
});

test('reasoning receives no points for empty JSON or contradictory surrounding prose', () => {
  const task = reasoningV2Suite.tests.find(t => t.name === 'reason_budget');
  assertEqual(task.grade('{}').score, 0);
  assertEqual(task.grade('The answer is 1. {"discounted":660,"tax":132,"total":792}').score, 0);
  assertEqual(task.grade('{"discounted":660,"tax":132,"total":792}').score, 1);
});

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

test('repository fixtures bind exact excerpt bytes and reject malformed or invented outputs', () => {
  for (const fixture of REPOSITORY_REASONING_CASES) {
    assertEqual(createHash('sha256').update(fixture.source.code).digest('hex'), fixture.source.sha256);
    assert(/^[a-f0-9]{40}$/.test(fixture.source.revision));
    assertEqual(fixture.source.code.split('\n').length - 1, fixture.source.endLine - fixture.source.startLine + 1);
    for (const [suiteValue, prefix, expected] of [
      [reasoningV2Suite, 'reason', fixture.expected], [reviewV2Suite, 'review', fixture.reviewExpected],
    ]) {
      const task = suiteValue.tests.find(t => t.name === `${prefix}_repo_${fixture.id}`);
      assertEqual(task.grade(JSON.stringify(expected)).score, 1);
      assertEqual(task.grade(JSON.stringify({ ...expected, invented: true })).score, 0);
      assertEqual(task.grade('not JSON').score, 0);
      assertEqual(task.grade('{}').score, 0);
    }
  }
});

test('captured before and after history code execute the claimed error and persistence boundaries', () => {
  for (const id of ['history_late_guard', 'history_early_guard']) {
    const fixture = REPOSITORY_REASONING_CASES.find(f => f.id === id);
    const emitted = [];
    const context = {
      emitted,
      throwIfAborted() {},
      throwIfTerminalChatFailure(value) { if (value.metadata.error) throw Object.assign(new Error('provider'), { typed: true }); },
      isChatTurnError: error => error.typed === true,
    };
    const source = `class Controller {
      #ensureTagged(response) { return response; }
      #addToHistory(response) { emitted.push(response); }
      #createErrorResponse(message) { return { message }; }
      process(response) { const targetMode = 'chat'; const pendingConfirmation = null; const context = {}; try {
        ${fixture.source.code}
    }
    let rejected = false; let durable = false;
    try {
      const result = new Controller().process({ metadata: { error: true } });
      try { throwIfTerminalChatFailure(result); durable = true; } catch {}
    } catch { rejected = true; }
    ({ inMemoryAssistantAdded: emitted.length > 0, durableAssistantAdded: durable, directProcessRejects: rejected });`;
    const observed = runInNewContext(source, context);
    for (const key of Object.keys(observed)) assertEqual(observed[key], fixture.expected[key], id + '/' + key);
  }
});

await testAsync('captured audit code reproduces false clean for a process error without invoking npm', async () => {
  const fixture = REPOSITORY_REASONING_CASES.find(f => f.id === 'audit_error_envelope');
  const excerpt = fixture.source.code.slice(0, fixture.source.code.lastIndexOf('  },'))
    .replace("const { execSync } = await import('node:child_process');", 'const execSync = fakeExec;');
  const output = await runInNewContext(`(async function() { ${excerpt} })()`, {
    params: { cwd: '/fixture', fix: false },
    fakeExec: () => '{"error":{"code":"ENOTFOUND"}}',
  });
  assertEqual(output.clean, fixture.expected.clean);
  assertEqual(output.summary.total, fixture.expected.total);
  assertEqual(Object.hasOwn(output, 'error'), fixture.expected.reportsError);
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

await testAsync('response-bound provider version rejects missing or changed runtime', async () => {
  const original = globalThis.fetch;
  const runner = new ModelEvaluationRunner('http://127.0.0.1:11434');
  try {
    for (const version of [undefined, '0.35.0-intentsmith.1', '0.34.0-intentsmith.1']) {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({
        model: 'fixture:latest', digest: DIGEST_A, provider_version: version, message: { content: 'ok' },
      }) });
      let error = null;
      try {
        await runner._callModel('fixture', [{ role: 'user', content: 'ping' }], {},
          { modelName: 'fixture:latest', digestSha256: DIGEST_A, providerVersion: '0.34.0-intentsmith.1' });
      } catch (caught) { error = caught; }
      if (version === '0.34.0-intentsmith.1') assertEqual(error, null);
      else assertEqual(error?.code, MODEL_EVALUATION_ARTIFACT_ERROR.PROVIDER_MISMATCH);
    }
  } finally { globalThis.fetch = original; }
});

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);

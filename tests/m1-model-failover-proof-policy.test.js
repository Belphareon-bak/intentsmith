#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
} from './harness.js';
import { MODEL_PROFILES } from '../src/upgrade/model-profiles.js';
import {
  MODEL_FAILOVER_PROOF_CANONICALIZATION_VERSION,
  MODEL_FAILOVER_PROOF_POLICY_SCHEMA_VERSION,
  MODEL_FAILOVER_PROOF_TTL_MS,
  ModelFailoverProofPolicyError,
  assertModelFailoverProofIssuanceEnabled,
  canonicalizeModelFailoverContract,
  getModelFailoverMeasurementContract,
  getModelFailoverProofPolicy,
} from '../src/upgrade/model-failover-proof-policy.js';

const EXPECTED_ROLES = ['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION'];
const EXPECTED_SUITES = {
  D1: ['reasoning', ['json_compliance', 'logic_puzzle', 'math_basic', 'multi_step_plan', 'cause_effect', 'categorization', 'instruction_follow', 'czech_json']],
  D2: ['reasoning', ['json_compliance', 'logic_puzzle', 'math_basic', 'multi_step_plan', 'cause_effect', 'categorization', 'instruction_follow', 'czech_json']],
  CODE: ['code', ['function_gen', 'bug_fix', 'code_completion', 'algorithm', 'regex_gen', 'code_review', 'refactor', 'test_gen']],
  R1: ['reasoning', ['json_compliance', 'logic_puzzle', 'math_basic', 'multi_step_plan', 'cause_effect', 'categorization', 'instruction_follow', 'czech_json']],
  R2: ['review', ['json_review', 'bug_detect', 'security_review', 'complexity_assess', 'style_review', 'refactor_suggest']],
  CHAT: ['chat', ['czech_quality', 'instruction_follow', 'summarization', 'topic_awareness', 'tone_formal', 'creative', 'multilingual', 'factual']],
  VISION: ['vision', ['capability_check', 'color_detect', 'shape_detect', 'count_objects', 'color_names', 'no_image_guard']],
};

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

function assertPolicyError(error, code) {
  assert(error instanceof ModelFailoverProofPolicyError, `Expected policy error, got ${error}`);
  assertEqual(error.code, code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

suite('M1 model failover proof policy — immutable reviewed authority');

test('source pins are raw-byte hashes of the exact reviewed modules', () => {
  const policy = getModelFailoverProofPolicy();
  assertEqual(policy.schemaVersion, MODEL_FAILOVER_PROOF_POLICY_SCHEMA_VERSION);
  assertEqual(policy.schemaVersion, 1);
  assertEqual(policy.canonicalizationVersion, MODEL_FAILOVER_PROOF_CANONICALIZATION_VERSION);
  assertEqual(policy.canonicalizationVersion, 'sorted-key-json-utf8-v1');
  assertEqual(policy.policyVersion, 'd-plus-v1');
  assertEqual(policy.validationVersion, 'v123.1');
  const failoverSource = readFileSync(
    new URL('../src/upgrade/model-failover.js', import.meta.url),
  );
  const failoverSourceText = failoverSource.toString('utf8');
  const policyVersionDeclarations = [...failoverSourceText.matchAll(
    /^export const MODEL_FAILOVER_POLICY_VERSION = '([a-z0-9][a-z0-9.-]{0,63})';$/gm,
  )];
  assertEqual(policyVersionDeclarations.length, 1);
  assertEqual(policy.policyVersion, policyVersionDeclarations[0][1]);
  const proofPolicySource = readFileSync(
    new URL('../src/upgrade/model-failover-proof-policy.js', import.meta.url),
    'utf8',
  );
  assertEqual(proofPolicySource.includes("from './model-failover.js'"), false);
  assertEqual(proofPolicySource.includes("from '../db/model-policy.js'"), false);
  assertEqual(proofPolicySource.includes("from '../db/user-settings.js'"), false);
  assertEqual(proofPolicySource.includes("from '../db/settings-portability.js'"), false);
  for (const [key, relativePath, logicalPath, expectedLength, expectedSha256] of [
    [
      'modelFailover',
      '../src/upgrade/model-failover.js',
      'src/upgrade/model-failover.js',
      203403,
      '4aa33e4cb99d6a78a044aeb5a9d6a5b47d9ceb0741461a3dd7cfb6a858681863',
    ],
    [
      'modelPolicy',
      '../src/db/model-policy.js',
      'src/db/model-policy.js',
      53900,
      '23d3b6320e0386a8715ebc826a4ee2d81cbd848954feadc558f0a85b6c78eebd',
    ],
    [
      'userSettings',
      '../src/db/user-settings.js',
      'src/db/user-settings.js',
      40076,
      '02d45d725dc15f022d0b6c02e8d01dc70698e862ebae9d4bccac2c3c32fe0386',
    ],
    [
      'settingsPortability',
      '../src/db/settings-portability.js',
      'src/db/settings-portability.js',
      14912,
      'b51793ef371530898188903bfd3384e50edf748a7c29258e2ab11c0d63b24c5c',
    ],
    [
      'modelProfiles',
      '../src/upgrade/model-profiles.js',
      'src/upgrade/model-profiles.js',
      9967,
      '16941d6aa9cb99fe6b00b1ee5a95fbd5bef079a35beb23cce63edf78aa04264a',
    ],
    [
      'validationSuites',
      '../src/upgrade/validation-suites.js',
      'src/upgrade/validation-suites.js',
      39108,
      '49520a4176c60f6fd27b713d4fa042dc6c164d3bbda0b983dfd10fe18a24b0ef',
    ],
  ]) {
    const pin = policy.sourcePins[key];
    const bytes = readFileSync(new URL(relativePath, import.meta.url));
    assertEqual(pin.path, logicalPath);
    assertEqual(pin.algorithm, 'sha256-raw-bytes-v1');
    assertEqual(pin.byteLength, expectedLength);
    assertEqual(pin.byteLength, bytes.length);
    assertEqual(pin.sha256, expectedSha256);
    assertEqual(pin.sha256, sha256(bytes));
  }
  const authorityContract = {
    schemaVersion: policy.schemaVersion,
    canonicalizationVersion: policy.canonicalizationVersion,
    policyVersion: policy.policyVersion,
    validationVersion: policy.validationVersion,
    sourcePins: policy.sourcePins,
    runner: policy.runner,
    acceptance: policy.acceptance,
    roles: policy.roles,
  };
  assertEqual(
    policy.authoritySha256,
    sha256(Buffer.from(canonicalizeModelFailoverContract(authorityContract))),
  );
  assertEqual(
    policy.authoritySha256,
    'a7c7c2a27b3c4bec2932bfd68f4b92d5f3974641c67ca7e15dd4f756d5c7b091',
  );
  const weakenedAuthority = structuredClone(authorityContract);
  weakenedAuthority.acceptance.byRole.CHAT.requiredScore = 0.5;
  assert(
    policy.authoritySha256
      !== sha256(Buffer.from(canonicalizeModelFailoverContract(weakenedAuthority))),
    'Acceptance thresholds must be part of the pinned authority digest',
  );
});

test('all seven roles map to the exact ordered 36-test authority', () => {
  const policy = getModelFailoverProofPolicy();
  assertEqual(JSON.stringify(Object.keys(policy.roles)), JSON.stringify(EXPECTED_ROLES));
  let total = 0;
  for (const role of EXPECTED_ROLES) {
    const [suiteName, testIds] = EXPECTED_SUITES[role];
    const contract = policy.roles[role];
    assertEqual(contract.role, role);
    assertEqual(contract.suite, suiteName);
    assertEqual(contract.totalCount, testIds.length);
    assertEqual(JSON.stringify(contract.orderedTestIds), JSON.stringify(testIds));
    total += role === 'D2' || role === 'R1' ? 0 : contract.totalCount;
  }
  assertEqual(total, 36);
});

test('runner contract requires actual capture of randomized prompt and grade context', () => {
  const runner = getModelFailoverProofPolicy().runner;
  assertEqual(runner.requireLoopback, true);
  assertEqual(runner.externalNetworkAllowed, false);
  assertEqual(runner.legacyPersistenceAllowed, false);
  assertEqual(runner.requireCompleteOrderedSuite, true);
  assertEqual(runner.requireSameBeforeAfterDigest, true);
  assertEqual(runner.promptCaptureRequired, true);
  assertEqual(
    runner.randomizedPromptPolicy,
    'CAPTURE_ACTUAL_PROMPT_AND_VERIFY_GRADE_CONTEXT',
  );
  assertEqual(runner.perTestTimeoutMs, 30000);
  assertEqual(runner.numCtx, 4096);
});

test('approved bootstrap policy requires a perfect role suite and exact seven-day TTL', () => {
  const acceptance = getModelFailoverProofPolicy().acceptance;
  assertEqual(acceptance.issuanceEnabled, true);
  assertEqual(acceptance.proofTtlMs, MODEL_FAILOVER_PROOF_TTL_MS);
  assertEqual(acceptance.proofTtlMs, 604800000);
  assertEqual(acceptance.reason, null);

  for (const role of EXPECTED_ROLES) {
    const expectedTotal = EXPECTED_SUITES[role][1].length;
    assertEqual(acceptance.byRole[role].requiredScore, 1);
    assertEqual(acceptance.byRole[role].requiredPassedCount, expectedTotal);
    const measurement = getModelFailoverMeasurementContract(role).contract.acceptance;
    assertEqual(measurement.issuanceEnabled, true);
    assertEqual(measurement.requiredScore, 1);
    assertEqual(measurement.requiredPassedCount, expectedTotal);
    assertEqual(measurement.proofTtlMs, MODEL_FAILOVER_PROOF_TTL_MS);
    assertEqual(measurement.reason, null);
    assertEqual(assertModelFailoverProofIssuanceEnabled(role).role, role);
  }
});

test('measurement contracts are deterministic, role-bound and never proof hashes', () => {
  const first = getModelFailoverMeasurementContract('chat');
  const second = getModelFailoverMeasurementContract('CHAT');
  const reasoning = getModelFailoverMeasurementContract('D1');
  assertEqual(first.canonicalJson, second.canonicalJson);
  assertEqual(first.measurementContractSha256, second.measurementContractSha256);
  assert(first.measurementContractSha256 !== reasoning.measurementContractSha256);
  assert(/^[a-f0-9]{64}$/.test(first.measurementContractSha256));
  assertEqual(first.contract.contractKind, 'MODEL_FAILOVER_ROLE_MEASUREMENT');
  assertEqual(first.contract.canonicalizationVersion, 'sorted-key-json-utf8-v1');
  assertEqual(first.contract.role.role, 'CHAT');
  assertEqual(first.contract.acceptance.issuanceEnabled, true);
  assertEqual(first.contract.acceptance.requiredScore, 1);
  assertEqual(first.contract.acceptance.requiredPassedCount, 8);
  assertEqual(first.contract.acceptance.proofTtlMs, 604800000);
  assertEqual(first.contract.acceptance.reason, null);
  assertEqual(Object.hasOwn(first, 'roleContractSha256'), false);
  assertEqual(Object.hasOwn(first.contract, 'proofId'), false);
});

test('policy snapshots and every nested authority array are immutable', () => {
  const policy = getModelFailoverProofPolicy();
  assertEqual(Object.isFrozen(policy), true);
  assertEqual(Object.isFrozen(policy.sourcePins.modelProfiles), true);
  assertEqual(Object.isFrozen(policy.acceptance.byRole), true);
  assertEqual(Object.isFrozen(policy.acceptance.byRole.CHAT), true);
  assertEqual(Object.isFrozen(policy.roles.CHAT), true);
  assertEqual(Object.isFrozen(policy.roles.CHAT.requirements.capabilities), true);
  assertEqual(Object.isFrozen(policy.roles.CHAT.orderedTestIds), true);
  const error = captureError(() => {
    policy.roles.CHAT.orderedTestIds[0] = 'mutated';
  });
  assert(error instanceof TypeError);
  assertEqual(getModelFailoverProofPolicy().roles.CHAT.orderedTestIds[0], 'czech_quality');
});

test('caller authority overrides and unknown roles fail closed', () => {
  for (const field of [
    'requiredScore',
    'requiredPassedCount',
    'proofTtlMs',
    'suite',
    'policyVersion',
    'validationVersion',
    'roleContractSha256',
    'proofId',
    'startedAtMs',
    'completedAtMs',
    'modelDigestSha256',
    'inventoryBeforeSha256',
    'inventoryAfterSha256',
  ]) {
    const override = { [field]: field.endsWith('Ms') ? 1 : 'caller-value' };
    assertPolicyError(
      captureError(() => getModelFailoverProofPolicy(override)),
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
    );
    assertPolicyError(
      captureError(() => getModelFailoverMeasurementContract('CHAT', override)),
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
    );
  }
  for (const callback of [
    () => assertModelFailoverProofIssuanceEnabled('CHAT', { requiredScore: 0.8 }),
  ]) {
    assertPolicyError(
      captureError(callback),
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
    );
  }
  for (const role of [null, '', 'UNKNOWN']) {
    assertPolicyError(
      captureError(() => getModelFailoverMeasurementContract(role)),
      'MODEL_FAILOVER_PROOF_POLICY_ROLE_INVALID',
    );
  }
});

test('canonical JSON is key-order stable and rejects lossy values', () => {
  assertEqual(
    canonicalizeModelFailoverContract({ z: 1, a: { y: 2, x: 3 }, b: [2, 1] }),
    '{"a":{"x":3,"y":2},"b":[2,1],"z":1}',
  );
  assertEqual(
    canonicalizeModelFailoverContract({ b: 2, a: 1 }),
    canonicalizeModelFailoverContract({ a: 1, b: 2 }),
  );
  assert(
    canonicalizeModelFailoverContract({ ordered: ['a', 'b'] })
      !== canonicalizeModelFailoverContract({ ordered: ['b', 'a'] }),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const arrayWithExtraProperty = ['value'];
  arrayWithExtraProperty.extra = true;
  const recordWithSymbol = { value: true };
  recordWithSymbol[Symbol('hidden')] = true;
  const recordWithHiddenProperty = { value: true };
  Object.defineProperty(recordWithHiddenProperty, 'hidden', { value: true });
  const recordWithAccessor = {};
  Object.defineProperty(recordWithAccessor, 'value', {
    enumerable: true,
    get: () => true,
  });
  for (const invalid of [
    { value: undefined },
    { value: () => true },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: -0 },
    { value: 1n },
    { value: new Date(0) },
    { value: sparse },
    { value: arrayWithExtraProperty },
    recordWithSymbol,
    recordWithHiddenProperty,
    recordWithAccessor,
    cyclic,
  ]) {
    assertPolicyError(
      captureError(() => canonicalizeModelFailoverContract(invalid)),
      'MODEL_FAILOVER_PROOF_CONTRACT_INVALID',
    );
  }
});

test('in-memory role authority drift is detected even when source bytes still match', () => {
  const original = MODEL_PROFILES.CHAT.requirements.minParams;
  try {
    MODEL_PROFILES.CHAT.requirements.minParams = original + 1;
    assertPolicyError(
      captureError(() => getModelFailoverProofPolicy()),
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_DRIFT',
    );
  } finally {
    MODEL_PROFILES.CHAT.requirements.minParams = original;
  }
  assertEqual(getModelFailoverProofPolicy().roles.CHAT.requirements.minParams, original);
});

summary();

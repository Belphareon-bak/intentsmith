// Fail-closed D+ role-suite proof policy.
//
// The operator-approved bootstrap authority lives here. Measurement remains a
// separate, non-persisting operation; only the dedicated operator issuer may
// turn an accepted measurement into a durable PASS proof.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MODEL_FAILOVER_POLICY_VERSION } from './model-failover.js';
import { MODEL_PROFILES } from './model-profiles.js';
import { SUITES, VALIDATION_VERSION } from './validation-suites.js';

export const MODEL_FAILOVER_PROOF_POLICY_SCHEMA_VERSION = 1;
export const MODEL_FAILOVER_PROOF_CANONICALIZATION_VERSION =
  'sorted-key-json-utf8-v1';
export const MODEL_FAILOVER_PROOF_HANDOFF_REASON =
  'SEPARATE_OPERATOR_PROOF_COMMIT_REQUIRED';
export const MODEL_FAILOVER_PROOF_TTL_MS = 604800000;

const EXPECTED_SOURCE_PINS = Object.freeze({
  modelProfiles: Object.freeze({
    path: 'src/upgrade/model-profiles.js',
    algorithm: 'sha256-raw-bytes-v1',
    byteLength: 9967,
    sha256: '16941d6aa9cb99fe6b00b1ee5a95fbd5bef079a35beb23cce63edf78aa04264a',
  }),
  validationSuites: Object.freeze({
    path: 'src/upgrade/validation-suites.js',
    algorithm: 'sha256-raw-bytes-v1',
    byteLength: 39108,
    sha256: '49520a4176c60f6fd27b713d4fa042dc6c164d3bbda0b983dfd10fe18a24b0ef',
  }),
});
const EXPECTED_AUTHORITY_SHA256 =
  '49378598e8644331138174743b816b4b34ca66103dac91128b16ae661679f9bd';
const SOURCE_URLS = Object.freeze({
  modelProfiles: new URL('./model-profiles.js', import.meta.url),
  validationSuites: new URL('./validation-suites.js', import.meta.url),
});
const EXPECTED_ROLES = Object.freeze(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const EXPECTED_SUITES = Object.freeze(['reasoning', 'code', 'review', 'chat', 'vision']);
const EXPECTED_SUITE_COUNTS = Object.freeze({
  reasoning: 8,
  code: 8,
  review: 6,
  chat: 8,
  vision: 6,
});
const TEST_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export class ModelFailoverProofPolicyError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverProofPolicyError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverProofPolicyError(code, message, { details });
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value, ancestors) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract contains a lossy number');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract contains an unsupported value');
  }
  if (ancestors.has(value)) {
    fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract contains a cycle');
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const items = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract contains a sparse array');
      }
      items.push(canonicalValue(descriptor.value, ancestors));
    }
    const expectedKeys = new Set(['length', ...items.map((_, index) => String(index))]);
    if (Reflect.ownKeys(descriptors).some(key => (
      typeof key !== 'string' || !expectedKeys.has(key)
    ))) {
      fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract array has unsupported properties');
    }
    result = `[${items.join(',')}]`;
  } else {
    if (!isPlainRecord(value)) {
      fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract contains a non-plain object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => {
      if (typeof key !== 'string') return true;
      const descriptor = descriptors[key];
      return !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
    })) {
      fail('MODEL_FAILOVER_PROOF_CONTRACT_INVALID', 'Contract record has unsupported properties');
    }
    result = `{${keys.sort().map(key => (
      `${JSON.stringify(key)}:${canonicalValue(descriptors[key].value, ancestors)}`
    )).join(',')}}`;
  }
  ancestors.delete(value);
  return result;
}

export function canonicalizeModelFailoverContract(value) {
  return canonicalValue(value, new Set());
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readSourcePin(key) {
  const expected = EXPECTED_SOURCE_PINS[key];
  let bytes;
  try {
    bytes = readFileSync(SOURCE_URLS[key]);
  } catch (error) {
    throw new ModelFailoverProofPolicyError(
      'MODEL_FAILOVER_PROOF_POLICY_SOURCE_UNAVAILABLE',
      `Cannot read reviewed proof-policy source: ${expected.path}`,
      { cause: error, details: { path: expected.path } },
    );
  }
  const actualSha256 = sha256(bytes);
  if (bytes.length !== expected.byteLength || actualSha256 !== expected.sha256) {
    fail(
      'MODEL_FAILOVER_PROOF_POLICY_SOURCE_DRIFT',
      `Reviewed proof-policy source changed: ${expected.path}`,
      {
        path: expected.path,
        expectedByteLength: expected.byteLength,
        actualByteLength: bytes.length,
        expectedSha256: expected.sha256,
        actualSha256,
      },
    );
  }
  return {
    path: expected.path,
    algorithm: expected.algorithm,
    byteLength: bytes.length,
    sha256: actualSha256,
  };
}

function exactSet(actualValues, expectedValues) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function copyStringArray(value, label) {
  if (!Array.isArray(value)
    || value.length === 0
    || value.some(item => (
      typeof item !== 'string' || item.length === 0 || item !== item.trim()
    ))
    || new Set(value).size !== value.length) {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', `${label} is invalid`);
  }
  return [...value];
}

function roleContract(role) {
  const profile = MODEL_PROFILES[role];
  if (!isPlainRecord(profile) || profile.role !== role) {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Model role profile is invalid', { role });
  }
  const suiteName = profile.validationSuite;
  const suite = SUITES[suiteName];
  if (!isPlainRecord(suite) || suite.name !== suiteName || !Array.isArray(suite.tests)) {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Model validation suite is invalid', {
      role,
      suite: suiteName,
    });
  }
  const orderedTestIds = suite.tests.map(testDefinition => testDefinition?.name);
  if (orderedTestIds.length !== EXPECTED_SUITE_COUNTS[suiteName]
    || orderedTestIds.some(testId => typeof testId !== 'string' || !TEST_ID_PATTERN.test(testId))
    || new Set(orderedTestIds).size !== orderedTestIds.length) {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Suite test identity contract is invalid', {
      role,
      suite: suiteName,
    });
  }
  if (!isPlainRecord(profile.requirements)
    || !Number.isSafeInteger(profile.requirements.minParams)
    || profile.requirements.minParams < 1
    || !Number.isSafeInteger(profile.requirements.maxParams)
    || profile.requirements.maxParams < profile.requirements.minParams
    || typeof profile.requirements.jsonRequired !== 'boolean') {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Model role requirements are invalid', {
      role,
    });
  }
  return {
    role,
    suite: suiteName,
    totalCount: orderedTestIds.length,
    orderedTestIds,
    requirements: {
      minParams: profile.requirements.minParams,
      maxParams: profile.requirements.maxParams,
      capabilities: copyStringArray(profile.requirements.capabilities, `${role}.capabilities`),
      jsonRequired: profile.requirements.jsonRequired,
    },
    preferredFamilies: copyStringArray(profile.preferredFamilies, `${role}.preferredFamilies`),
    preferredCategories: copyStringArray(
      profile.preferredCategories,
      `${role}.preferredCategories`,
    ),
  };
}

function deriveRoleContracts() {
  if (!exactSet(Object.keys(MODEL_PROFILES), EXPECTED_ROLES)
    || !exactSet(Object.keys(SUITES), EXPECTED_SUITES)) {
    fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Role or suite authority set drifted');
  }
  const roles = Object.fromEntries(EXPECTED_ROLES.map(role => [role, roleContract(role)]));
  for (const suiteName of EXPECTED_SUITES) {
    const declaredRoles = copyStringArray(SUITES[suiteName].roles, `${suiteName}.roles`);
    const derivedRoles = EXPECTED_ROLES.filter(role => roles[role].suite === suiteName);
    if (!exactSet(declaredRoles, derivedRoles)) {
      fail('MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_INVALID', 'Suite role mapping drifted', {
        suite: suiteName,
      });
    }
  }
  return roles;
}

function buildPolicy() {
  const sourcePins = {
    modelProfiles: readSourcePin('modelProfiles'),
    validationSuites: readSourcePin('validationSuites'),
  };
  const roles = deriveRoleContracts();
  const authoritySha256 = sha256(canonicalizeModelFailoverContract(roles));
  if (authoritySha256 !== EXPECTED_AUTHORITY_SHA256) {
    fail(
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_DRIFT',
      'Role-suite proof authority changed without a reviewed policy update',
      { expectedSha256: EXPECTED_AUTHORITY_SHA256, actualSha256: authoritySha256 },
    );
  }
  return deepFreeze({
    schemaVersion: MODEL_FAILOVER_PROOF_POLICY_SCHEMA_VERSION,
    canonicalizationVersion: MODEL_FAILOVER_PROOF_CANONICALIZATION_VERSION,
    policyVersion: MODEL_FAILOVER_POLICY_VERSION,
    validationVersion: VALIDATION_VERSION,
    authoritySha256,
    sourcePins,
    runner: {
      perTestTimeoutMs: 30000,
      stream: false,
      think: false,
      temperature: 0.1,
      topP: 0.9,
      numPredict: 512,
      numCtx: 4096,
      requireLoopback: true,
      externalNetworkAllowed: false,
      legacyPersistenceAllowed: false,
      requireCompleteOrderedSuite: true,
      requireSameBeforeAfterDigest: true,
      promptCaptureRequired: true,
      randomizedPromptPolicy: 'CAPTURE_ACTUAL_PROMPT_AND_VERIFY_GRADE_CONTEXT',
    },
    acceptance: {
      issuanceEnabled: true,
      proofTtlMs: MODEL_FAILOVER_PROOF_TTL_MS,
      byRole: Object.fromEntries(EXPECTED_ROLES.map(role => [role, {
        requiredScore: 1,
        requiredPassedCount: roles[role].totalCount,
      }])),
      reason: null,
    },
    roles,
  });
}

export function getModelFailoverProofPolicy(...authorityOverrides) {
  if (authorityOverrides.length > 0) {
    fail(
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
      'Proof policy does not accept caller-owned authority',
    );
  }
  return buildPolicy();
}

function requireRole(roleValue) {
  if (typeof roleValue !== 'string') {
    fail('MODEL_FAILOVER_PROOF_POLICY_ROLE_INVALID', 'Proof policy role must be a string');
  }
  const role = roleValue.trim().toUpperCase();
  if (!EXPECTED_ROLES.includes(role)) {
    fail('MODEL_FAILOVER_PROOF_POLICY_ROLE_INVALID', 'Unknown proof policy role', { role });
  }
  return role;
}

export function getModelFailoverMeasurementContract(roleValue, ...authorityOverrides) {
  if (authorityOverrides.length > 0) {
    fail(
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
      'Measurement contract does not accept caller-owned authority',
    );
  }
  const role = requireRole(roleValue);
  const policy = getModelFailoverProofPolicy();
  const roleAcceptance = policy.acceptance.byRole[role];
  const acceptance = deepFreeze({
    issuanceEnabled: policy.acceptance.issuanceEnabled,
    requiredScore: roleAcceptance.requiredScore,
    requiredPassedCount: roleAcceptance.requiredPassedCount,
    proofTtlMs: policy.acceptance.proofTtlMs,
    reason: policy.acceptance.reason,
  });
  const contract = deepFreeze({
    schemaVersion: policy.schemaVersion,
    canonicalizationVersion: policy.canonicalizationVersion,
    contractKind: 'MODEL_FAILOVER_ROLE_MEASUREMENT',
    policyVersion: policy.policyVersion,
    validationVersion: policy.validationVersion,
    authoritySha256: policy.authoritySha256,
    sourcePins: policy.sourcePins,
    runner: policy.runner,
    acceptance,
    role: policy.roles[role],
  });
  const canonicalJson = canonicalizeModelFailoverContract(contract);
  return deepFreeze({
    contract,
    canonicalJson,
    measurementContractSha256: sha256(canonicalJson),
  });
}

export function assertModelFailoverProofIssuanceEnabled(roleValue, ...authorityOverrides) {
  if (authorityOverrides.length > 0) {
    fail(
      'MODEL_FAILOVER_PROOF_POLICY_AUTHORITY_OVERRIDE_REJECTED',
      'Proof issuance guard does not accept caller-owned authority',
    );
  }
  const role = requireRole(roleValue);
  const policy = getModelFailoverProofPolicy();
  const roleAcceptance = policy.acceptance.byRole[role];
  const acceptance = {
    ...roleAcceptance,
    issuanceEnabled: policy.acceptance.issuanceEnabled,
    proofTtlMs: policy.acceptance.proofTtlMs,
    reason: policy.acceptance.reason,
  };
  const roleContract = policy.roles[role];
  const acceptanceIsComplete = acceptance.issuanceEnabled === true
    && acceptance.reason === null
    && Number.isFinite(acceptance.requiredScore)
    && acceptance.requiredScore > 0
    && acceptance.requiredScore <= 1
    && Number.isSafeInteger(acceptance.requiredPassedCount)
    && acceptance.requiredPassedCount > 0
    && acceptance.requiredPassedCount <= roleContract.totalCount
    && Number.isSafeInteger(acceptance.proofTtlMs)
    && acceptance.proofTtlMs > 0;
  if (!acceptanceIsComplete) {
    fail(
      'MODEL_FAILOVER_PROOF_ISSUANCE_DISABLED',
      'D+ PASS proof issuance is disabled until its acceptance policy is approved',
      { role, reason: acceptance.reason },
    );
  }
  return roleContract;
}

export const MODEL_FAILOVER_PROOF_POLICY_SOURCE_PINS = EXPECTED_SOURCE_PINS;

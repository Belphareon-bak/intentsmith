import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  M6_OPERATOR_DEMO_CONTRACT_VERSION,
  M6_OPERATOR_DEMO_INPUT_CONTRACT,
  M6_OPERATOR_DEMO_OBSERVATION_CONTRACT,
  M6_OPERATOR_DEMO_OBSERVATION_STAGE,
  M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
  M6_OPERATOR_DEMO_PLAN_V1,
} from '../../contracts/m6/operator-demo-v1.js';
import {
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_ROLE,
} from '../../contracts/authority/signed-authority-receipt-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const INPUT_KEYS = Object.freeze([
  'candidateSha', 'completedAt', 'contract', 'environment', 'startedAt', 'steps', 'version',
]);
const ENVIRONMENT_KEYS = Object.freeze([
  'buildProfile', 'freshCloneObserved', 'installProfile', 'unexpectedEgressAttempts',
]);
const INPUT_STEP_KEYS = Object.freeze(['artifactPaths', 'id', 'notes', 'status']);
const OBSERVATION_KEYS = Object.freeze([
  'acceptance', 'candidate', 'completedAt', 'contract', 'durationMs', 'environment',
  'planDigest', 'recordedAt', 'registryFingerprint', 'stage', 'startedAt', 'steps',
  'verdict', 'version',
]);
const CANDIDATE_KEYS = Object.freeze(['sha', 'standaloneCheckout', 'tree', 'treeClean']);
const ACCEPTANCE_KEYS = Object.freeze([
  'authorityId', 'automaticApproval', 'domain', 'receiptPath', 'status',
]);
const OBSERVATION_STEP_KEYS = Object.freeze(['artifacts', 'id', 'notes', 'status']);
const ARTIFACT_KEYS = Object.freeze(['bytes', 'path', 'sha256']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validTime(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0
    || value.includes('\\') || value.includes('\0')) return false;
  return !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

function validNotes(value) {
  return typeof value === 'string'
    && value.length <= 2_000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function expectedRawPrefix(candidateSha) {
  return `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/raw/`;
}

function validateInput(input, { candidateSha } = {}) {
  const errors = [];
  if (!exactKeys(input, INPUT_KEYS)) return ['input:keys'];
  if (input.contract !== M6_OPERATOR_DEMO_INPUT_CONTRACT) errors.push('input:contract');
  if (input.version !== M6_OPERATOR_DEMO_CONTRACT_VERSION) errors.push('input:version');
  if (!SHA_PATTERN.test(input.candidateSha || '') || input.candidateSha !== candidateSha) {
    errors.push('input:candidate');
  }
  if (!validTime(input.startedAt)) errors.push('input:startedAt');
  if (!validTime(input.completedAt)) errors.push('input:completedAt');
  if (validTime(input.startedAt) && validTime(input.completedAt)
    && Date.parse(input.completedAt) < Date.parse(input.startedAt)) errors.push('input:time-order');
  if (!exactKeys(input.environment, ENVIRONMENT_KEYS)) errors.push('input:environment-keys');
  else {
    if (input.environment.freshCloneObserved !== true) errors.push('input:fresh-clone');
    if (input.environment.installProfile !== 'core-minimal-offline') errors.push('input:install-profile');
    if (input.environment.buildProfile !== 'linux-x64-studio-production') errors.push('input:build-profile');
    if (input.environment.unexpectedEgressAttempts !== 0) errors.push('input:egress');
  }
  if (!Array.isArray(input.steps)
    || JSON.stringify(input.steps.map(step => step?.id))
      !== JSON.stringify(M6_OPERATOR_DEMO_PLAN_V1.steps.map(step => step.id))) {
    errors.push('input:step-order');
  }
  for (const [index, step] of (input.steps || []).entries()) {
    const label = `input.steps[${index}]`;
    if (!exactKeys(step, INPUT_STEP_KEYS)) {
      errors.push(`${label}:keys`);
      continue;
    }
    if (!['PASS', 'FAIL', 'NOT_RUN'].includes(step.status)) errors.push(`${label}:status`);
    if (!validNotes(step.notes)) errors.push(`${label}:notes`);
    if (!Array.isArray(step.artifactPaths) || step.artifactPaths.length < 1) {
      errors.push(`${label}:artifacts`);
    } else {
      const seen = new Set();
      for (const artifactPath of step.artifactPaths) {
        if (!safeRelativePath(artifactPath)
          || !artifactPath.startsWith(expectedRawPrefix(candidateSha))) {
          errors.push(`${label}:artifact-path`);
        }
        if (seen.has(artifactPath)) errors.push(`${label}:duplicate-artifact`);
        seen.add(artifactPath);
      }
    }
  }
  return errors;
}

function validateIdentity(identity, errors) {
  if (!SHA_PATTERN.test(identity?.candidateSha || '')) errors.push('identity:candidate');
  if (!SHA_PATTERN.test(identity?.candidateTree || '')) errors.push('identity:tree');
  if (!SHA256_PATTERN.test(identity?.registryFingerprint || '')) errors.push('identity:registry');
  if (identity?.sourceTreeClean !== true) errors.push('identity:dirty-tree');
  if (identity?.standaloneCheckout !== true) errors.push('identity:not-standalone-checkout');
}

async function artifactBinding(path, readArtifact) {
  const bytes = await readArtifact(path);
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new Error('artifact:not-nonempty-buffer');
  return {
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function parseM6OperatorDemoObservationBytes(rawBytes) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length < 1) {
    throw new Error('m6-operator-demo:observation-bytes');
  }
  let observation;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    observation = JSON.parse(text);
  } catch {
    throw new Error('m6-operator-demo:observation-utf8-json');
  }
  const canonical = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, 'utf8');
  if (!rawBytes.equals(canonical)) {
    throw new Error('m6-operator-demo:observation-canonical');
  }
  return observation;
}

export async function buildM6OperatorDemoObservation(input, {
  identity,
  readArtifact,
  recordedAt = new Date().toISOString(),
} = {}) {
  const errors = validateInput(input, { candidateSha: identity?.candidateSha });
  validateIdentity(identity, errors);
  if (typeof readArtifact !== 'function') errors.push('artifact:reader');
  if (!validTime(recordedAt)) errors.push('observation:recordedAt');
  if (errors.length > 0) throw new Error(`m6-operator-demo:${errors.join(';')}`);

  const steps = [];
  for (const step of input.steps) {
    const artifacts = [];
    for (const path of step.artifactPaths) artifacts.push(await artifactBinding(path, readArtifact));
    steps.push({ id: step.id, status: step.status, notes: step.notes, artifacts });
  }
  const allPass = steps.every(step => step.status === 'PASS');
  return deepFreeze({
    contract: M6_OPERATOR_DEMO_OBSERVATION_CONTRACT,
    version: M6_OPERATOR_DEMO_CONTRACT_VERSION,
    stage: M6_OPERATOR_DEMO_OBSERVATION_STAGE,
    planDigest: M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
    candidate: {
      sha: identity.candidateSha,
      tree: identity.candidateTree,
      treeClean: identity.sourceTreeClean,
      standaloneCheckout: identity.standaloneCheckout,
    },
    registryFingerprint: identity.registryFingerprint,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Date.parse(input.completedAt) - Date.parse(input.startedAt),
    recordedAt,
    environment: { ...input.environment },
    steps,
    verdict: allPass ? 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL' : 'DEMO_INCOMPLETE',
    acceptance: {
      authorityId: M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptAuthorityId,
      domain: M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptDomain,
      receiptPath: M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptPath,
      status: 'NOT_ISSUED',
      automaticApproval: 'forbidden',
    },
  });
}

export async function validateM6OperatorDemoObservation(observation, {
  identity,
  readArtifact,
} = {}) {
  const errors = [];
  validateIdentity(identity, errors);
  if (!exactKeys(observation, OBSERVATION_KEYS)) return deepFreeze({ valid: false, errors: ['observation:keys'] });
  if (observation.contract !== M6_OPERATOR_DEMO_OBSERVATION_CONTRACT) errors.push('observation:contract');
  if (observation.version !== M6_OPERATOR_DEMO_CONTRACT_VERSION) errors.push('observation:version');
  if (observation.stage !== M6_OPERATOR_DEMO_OBSERVATION_STAGE) errors.push('observation:stage');
  if (observation.planDigest !== M6_OPERATOR_DEMO_PLAN_DIGEST_V1) {
    errors.push('observation:plan-digest');
  }
  if (!exactKeys(observation.candidate, CANDIDATE_KEYS)) errors.push('observation:candidate-keys');
  else {
    if (observation.candidate.sha !== identity?.candidateSha) errors.push('observation:candidate');
    if (observation.candidate.tree !== identity?.candidateTree) errors.push('observation:tree');
    if (observation.candidate.treeClean !== true) errors.push('observation:dirty-tree');
    if (observation.candidate.standaloneCheckout !== true) errors.push('observation:not-standalone');
  }
  if (observation.registryFingerprint !== identity?.registryFingerprint) errors.push('observation:registry');
  if (!validTime(observation.startedAt) || !validTime(observation.completedAt)
    || !validTime(observation.recordedAt)) errors.push('observation:time');
  if (!Number.isSafeInteger(observation.durationMs) || observation.durationMs < 0
    || observation.durationMs !== Date.parse(observation.completedAt) - Date.parse(observation.startedAt)) {
    errors.push('observation:duration');
  }
  if (!exactKeys(observation.environment, ENVIRONMENT_KEYS)
    || observation.environment.freshCloneObserved !== true
    || observation.environment.installProfile !== 'core-minimal-offline'
    || observation.environment.buildProfile !== 'linux-x64-studio-production'
    || observation.environment.unexpectedEgressAttempts !== 0) errors.push('observation:environment');
  if (!Array.isArray(observation.steps)
    || JSON.stringify(observation.steps.map(step => step?.id))
      !== JSON.stringify(M6_OPERATOR_DEMO_PLAN_V1.steps.map(step => step.id))) {
    errors.push('observation:steps');
  }
  for (const [index, step] of (observation.steps || []).entries()) {
    const label = `observation.steps[${index}]`;
    if (!exactKeys(step, OBSERVATION_STEP_KEYS)) {
      errors.push(`${label}:keys`);
      continue;
    }
    if (!['PASS', 'FAIL', 'NOT_RUN'].includes(step.status)) errors.push(`${label}:status`);
    if (!validNotes(step.notes)) errors.push(`${label}:notes`);
    if (!Array.isArray(step.artifacts) || step.artifacts.length < 1) {
      errors.push(`${label}:artifacts`);
      continue;
    }
    for (const artifact of step.artifacts) {
      if (!exactKeys(artifact, ARTIFACT_KEYS)
        || !safeRelativePath(artifact.path)
        || !artifact.path.startsWith(expectedRawPrefix(identity?.candidateSha))
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1
        || !SHA256_PATTERN.test(artifact.sha256 || '')) {
        errors.push(`${label}:artifact-shape`);
        continue;
      }
      try {
        const actual = await artifactBinding(artifact.path, readArtifact);
        if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
          errors.push(`${label}:artifact-binding`);
        }
      } catch {
        errors.push(`${label}:artifact-unreadable`);
      }
    }
  }
  const allPass = (observation.steps || []).length === M6_OPERATOR_DEMO_PLAN_V1.steps.length
    && observation.steps.every(step => step.status === 'PASS');
  const expectedVerdict = allPass
    ? 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL'
    : 'DEMO_INCOMPLETE';
  if (observation.verdict !== expectedVerdict) errors.push('observation:verdict');
  if (!exactKeys(observation.acceptance, ACCEPTANCE_KEYS)
    || observation.acceptance.authorityId !== SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR
    || observation.acceptance.domain !== SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO
    || observation.acceptance.receiptPath !== M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptPath
    || observation.acceptance.status !== 'NOT_ISSUED'
    || observation.acceptance.automaticApproval !== 'forbidden') {
    errors.push('observation:acceptance-boundary');
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export async function validateM6OperatorDemoReceiptObservation(receipt, {
  candidateSha,
  candidateTree,
  registryFingerprint,
  readGitArtifact,
} = {}) {
  const errors = [];
  if (receipt?.domain !== SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO) {
    return deepFreeze({ valid: true, errors });
  }
  if (receipt.authorityId !== SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR) {
    errors.push('demo-receipt:authority');
  }
  if (typeof readGitArtifact !== 'function') errors.push('demo-receipt:git-reader');
  const prefix = `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/`;
  const observations = (receipt.artifacts || []).filter(artifact => (
    typeof artifact?.path === 'string'
    && artifact.path.startsWith(prefix)
    && /\/observation-[a-f0-9]{64}\.json$/u.test(artifact.path)
  ));
  if (observations.length !== 1) errors.push('demo-receipt:exact-observation-artifact');
  if (errors.length > 0) return deepFreeze({ valid: false, errors });

  const binding = observations[0];
  const filenameDigest = /observation-([a-f0-9]{64})\.json$/u.exec(binding.path)?.[1];
  const bindingDigest = /^sha256:([a-f0-9]{64})$/u.exec(binding.sha256 || '')?.[1];
  if (filenameDigest !== bindingDigest) errors.push('demo-receipt:filename-digest');
  let observation;
  try {
    const artifact = await readGitArtifact(binding.path);
    if (!Buffer.isBuffer(artifact?.bytes)) throw new Error('not-buffer');
    if (artifact.bytes.length !== binding.bytes) errors.push('demo-receipt:observation-bytes');
    if (createHash('sha256').update(artifact.bytes).digest('hex') !== bindingDigest) {
      errors.push('demo-receipt:observation-sha256');
    }
    observation = parseM6OperatorDemoObservationBytes(artifact.bytes);
  } catch (error) {
    errors.push(error.message.endsWith(':observation-canonical')
      ? 'demo-receipt:observation-canonical'
      : 'demo-receipt:observation-unreadable');
  }
  if (!observation) return deepFreeze({ valid: false, errors });

  const validation = await validateM6OperatorDemoObservation(observation, {
    identity: {
      candidateSha,
      candidateTree,
      registryFingerprint,
      sourceTreeClean: true,
      standaloneCheckout: true,
    },
    readArtifact: async artifactPath => {
      const artifact = await readGitArtifact(artifactPath);
      if (!Buffer.isBuffer(artifact?.bytes)) throw new Error('not-buffer');
      return artifact.bytes;
    },
  });
  errors.push(...validation.errors.map(error => `demo-receipt:${error}`));
  if (observation.verdict !== 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL') {
    errors.push('demo-receipt:observation-not-complete');
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

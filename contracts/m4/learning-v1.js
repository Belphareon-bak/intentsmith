import { createHash } from 'node:crypto';

import {
  isIdentifier,
  isJsonValue,
  isNonEmptyString,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const LEARNING_CONTRACT_VERSION = 1;
export const LEARNING_CONTRACT_STAGE = 'PINNED_V1';

export const LEARNING_KIND = Object.freeze({
  OBSERVATION: 'LearningObservation',
  PROPOSAL: 'LearningProposal',
  OUTCOME: 'LearningOutcome',
});

export const LEARNING_OBSERVATION_KIND = Object.freeze({
  PROJECT_PATTERN: 'project_pattern',
});

export const LEARNING_EVIDENCE_KIND = Object.freeze({
  PROJECT_CHANGE_RESULT: 'project_change_result',
  TASK_MEMORY: 'task_memory',
  CODE_INTELLIGENCE: 'code_intelligence',
});

export const LEARNING_ADAPTATION_KIND = Object.freeze({
  PROJECT_CONTEXT_PATTERN: 'project_context_pattern',
});

export const LEARNING_OUTCOME_STATUS = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  MEASURED: 'measured',
  WEAKENED: 'weakened',
  ROLLED_BACK: 'rolled_back',
  DELETED: 'deleted',
  EXPIRED: 'expired',
});

export const LEARNING_ACTOR_KIND = Object.freeze({
  USER: 'user',
  SYSTEM: 'system',
});

export const LEARNING_MEASUREMENT_METRIC = Object.freeze({
  PLAN_CONFORMANCE: 'plan_conformance',
});

export const LEARNING_DECAY_KIND = Object.freeze({
  EXPONENTIAL_HALF_LIFE: 'exponential_half_life',
});

const OBSERVATION_KINDS = new Set(Object.values(LEARNING_OBSERVATION_KIND));
const EVIDENCE_KINDS = new Set(Object.values(LEARNING_EVIDENCE_KIND));
const ADAPTATION_KINDS = new Set(Object.values(LEARNING_ADAPTATION_KIND));
const OUTCOME_STATUSES = new Set(Object.values(LEARNING_OUTCOME_STATUS));
const ACTOR_KINDS = new Set(Object.values(LEARNING_ACTOR_KIND));
const MEASUREMENT_METRICS = new Set(Object.values(LEARNING_MEASUREMENT_METRIC));
const DECAY_KINDS = new Set(Object.values(LEARNING_DECAY_KIND));

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const WORKSPACE_REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const EVIDENCE_ID_PATTERN = /^lev1:[0-9a-f]{64}$/;
const OBSERVATION_ID_PATTERN = /^lob1:[0-9a-f]{64}$/;
const PROPOSAL_ID_PATTERN = /^lpr1:[0-9a-f]{64}$/;
const OUTCOME_ID_PATTERN = /^lou1:[0-9a-f]{64}$/;
const ITEM_ID_PATTERN = /^lit1:[0-9a-f]{64}$/;
const PRODUCER_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9]\d*$/;
const LEARNING_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const MAX_TEXT_LENGTH = 4096;
const MAX_JSON_BYTES = 32 * 1024;
const MAX_RETENTION_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen, depth) {
  if (depth > 64) throw new TypeError('learning-canonical:too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('learning-canonical:non-integer-number');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('learning-canonical:unsupported-value');
  }

  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    serialized = `{${Object.keys(value).sort(compareUtf8).map(key => (
      `${JSON.stringify(key)}:${canonicalize(value[key], seen, depth + 1)}`
    )).join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('learning-canonical:unsupported-object');
  }
  seen.delete(value);
  return serialized;
}

export function canonicalizeLearningValue(value) {
  return canonicalize(value, new Set(), 0);
}

function contentId(prefix, value) {
  return `${prefix}:${createHash('sha256')
    .update(canonicalizeLearningValue(value), 'utf8')
    .digest('hex')}`;
}

function withoutKey(value, key) {
  if (!isPlainRecord(value)) throw new TypeError('learning-id:not-object');
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
}

function isProjectId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isConfidence(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
}

function isBoundedText(value) {
  return isNonEmptyString(value) && value.length <= MAX_TEXT_LENGTH;
}

function isBoundedJson(value) {
  if (!isJsonValue(value)) return false;
  try {
    return Buffer.byteLength(canonicalizeLearningValue(value), 'utf8') <= MAX_JSON_BYTES;
  } catch {
    return false;
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function validateCanonicalIdList(value, pattern, context, minimum = 1) {
  const errors = [];
  if (!Array.isArray(value) || value.length < minimum) return [`${context}:invalid-list`];
  const seen = new Set();
  let previous = null;
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item)) errors.push(`${context}:invalid-item`);
    if (seen.has(item)) errors.push(`${context}:duplicate-item`);
    if (previous !== null && compareUtf8(previous, item) >= 0) {
      errors.push(`${context}:not-canonical-order`);
    }
    seen.add(item);
    previous = item;
  }
  return errors;
}

function validateEvidence(value, index) {
  const context = `learning-observation.evidence[${index}]`;
  const errors = validateExactKeys(
    value,
    [
      'evidenceId',
      'kind',
      'sourceId',
      'sourceVersion',
      'digest',
      'workspaceRevision',
      'occurredAtMs',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!EVIDENCE_ID_PATTERN.test(value.evidenceId ?? '')) errors.push(`${context}:invalid-evidenceId`);
  if (!EVIDENCE_KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (!isIdentifier(value.sourceId)) errors.push(`${context}:invalid-sourceId`);
  if (!Number.isSafeInteger(value.sourceVersion) || value.sourceVersion < 1) {
    errors.push(`${context}:invalid-sourceVersion`);
  }
  if (!SHA256_PATTERN.test(value.digest ?? '')) errors.push(`${context}:invalid-digest`);
  if (!WORKSPACE_REVISION_PATTERN.test(value.workspaceRevision ?? '')) {
    errors.push(`${context}:invalid-workspaceRevision`);
  }
  if (!isTimestamp(value.occurredAtMs)) errors.push(`${context}:invalid-occurredAtMs`);
  try {
    if (computeLearningEvidenceId(value) !== value.evidenceId) {
      errors.push(`${context}:evidenceId-mismatch`);
    }
  } catch {
    errors.push(`${context}:evidenceId-uncomputable`);
  }
  return errors;
}

function validateSubject(value) {
  const context = 'learning-observation.subject';
  const errors = validateExactKeys(value, ['key', 'title', 'statement'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!LEARNING_KEY_PATTERN.test(value.key ?? '')) errors.push(`${context}:invalid-key`);
  if (!isBoundedText(value.title)) errors.push(`${context}:invalid-title`);
  if (!isBoundedText(value.statement)) errors.push(`${context}:invalid-statement`);
  return errors;
}

export function computeLearningEvidenceId(value) {
  return contentId('lev1', withoutKey(value, 'evidenceId'));
}

export function computeLearningObservationId(value) {
  return contentId('lob1', withoutKey(value, 'observationId'));
}

export function computeLearningProposalId(value) {
  return contentId('lpr1', withoutKey(value, 'proposalId'));
}

export function computeLearningOutcomeId(value) {
  return contentId('lou1', withoutKey(value, 'outcomeId'));
}

export function computeLearningItemId(proposalId) {
  if (typeof proposalId !== 'string' || !PROPOSAL_ID_PATTERN.test(proposalId)) {
    throw new TypeError('learning-item-id:invalid-proposalId');
  }
  return contentId('lit1', { proposalId });
}

export function validateLearningObservationV1(value) {
  const context = 'learning-observation';
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'observationId',
      'projectId',
      'kind',
      'producer',
      'confidenceBps',
      'observedAtMs',
      'subject',
      'evidence',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== LEARNING_KIND.OBSERVATION) errors.push(`${context}:invalid-contract`);
  if (value.version !== LEARNING_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!OBSERVATION_ID_PATTERN.test(value.observationId ?? '')) {
    errors.push(`${context}:invalid-observationId`);
  }
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!OBSERVATION_KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (typeof value.producer !== 'string' || !PRODUCER_PATTERN.test(value.producer)) {
    errors.push(`${context}:invalid-producer`);
  }
  if (!isConfidence(value.confidenceBps)) errors.push(`${context}:invalid-confidenceBps`);
  if (!isTimestamp(value.observedAtMs)) errors.push(`${context}:invalid-observedAtMs`);
  errors.push(...validateSubject(value.subject));
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    errors.push(`${context}:invalid-evidence`);
  } else {
    const ids = new Set();
    value.evidence.forEach((entry, index) => {
      errors.push(...validateEvidence(entry, index));
      if (ids.has(entry?.evidenceId)) errors.push(`${context}:duplicate-evidence`);
      ids.add(entry?.evidenceId);
      if (
        index > 0
        && typeof value.evidence[index - 1]?.evidenceId === 'string'
        && typeof entry?.evidenceId === 'string'
        && compareUtf8(value.evidence[index - 1].evidenceId, entry.evidenceId) >= 0
      ) errors.push(`${context}:evidence-not-canonical-order`);
    });
  }
  try {
    if (computeLearningObservationId(value) !== value.observationId) {
      errors.push(`${context}:observationId-mismatch`);
    }
  } catch {
    errors.push(`${context}:observationId-uncomputable`);
  }
  return validationResult(errors, value);
}

function validateAdaptation(value) {
  const context = 'learning-proposal.adaptation';
  const errors = validateExactKeys(
    value,
    [
      'kind',
      'key',
      'value',
      'target',
      'changesPermissions',
      'changesCode',
      'changesConfig',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!ADAPTATION_KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (!LEARNING_KEY_PATTERN.test(value.key ?? '')) errors.push(`${context}:invalid-key`);
  if (!isBoundedJson(value.value)) errors.push(`${context}:invalid-value`);
  if (value.target !== 'project_context') errors.push(`${context}:invalid-target`);
  for (const key of ['changesPermissions', 'changesCode', 'changesConfig']) {
    if (value[key] !== false) errors.push(`${context}:${key}-forbidden`);
  }
  return errors;
}

function validateGate(value) {
  const context = 'learning-proposal.gate';
  const errors = validateExactKeys(value, ['kind', 'status'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.kind !== 'user') errors.push(`${context}:invalid-kind`);
  if (value.status !== 'pending') errors.push(`${context}:invalid-status`);
  return errors;
}

function validateRetention(value) {
  const context = 'learning-proposal.retention';
  const errors = validateExactKeys(value, ['ttlMs', 'decay'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (
    !Number.isSafeInteger(value.ttlMs)
    || value.ttlMs < 1
    || value.ttlMs > MAX_RETENTION_MS
  ) errors.push(`${context}:invalid-ttlMs`);

  const decayContext = `${context}.decay`;
  errors.push(...validateExactKeys(
    value.decay,
    ['kind', 'halfLifeMs', 'floorConfidenceBps'],
    [],
    decayContext,
  ));
  if (!isPlainRecord(value.decay)) return errors;
  if (!DECAY_KINDS.has(value.decay.kind)) errors.push(`${decayContext}:invalid-kind`);
  if (
    !Number.isSafeInteger(value.decay.halfLifeMs)
    || value.decay.halfLifeMs < 1
    || !Number.isSafeInteger(value.ttlMs)
    || value.decay.halfLifeMs > value.ttlMs
  ) errors.push(`${decayContext}:invalid-halfLifeMs`);
  if (!isConfidence(value.decay.floorConfidenceBps)) {
    errors.push(`${decayContext}:invalid-floorConfidenceBps`);
  }
  return errors;
}

export function validateLearningProposalV1(value) {
  const context = 'learning-proposal';
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'proposalId',
      'projectId',
      'observationIds',
      'title',
      'rationale',
      'confidenceBps',
      'createdAtMs',
      'adaptation',
      'gate',
      'retention',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== LEARNING_KIND.PROPOSAL) errors.push(`${context}:invalid-contract`);
  if (value.version !== LEARNING_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!PROPOSAL_ID_PATTERN.test(value.proposalId ?? '')) errors.push(`${context}:invalid-proposalId`);
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  errors.push(...validateCanonicalIdList(
    value.observationIds,
    OBSERVATION_ID_PATTERN,
    `${context}.observationIds`,
    2,
  ));
  if (!isBoundedText(value.title)) errors.push(`${context}:invalid-title`);
  if (!isBoundedText(value.rationale)) errors.push(`${context}:invalid-rationale`);
  if (!isConfidence(value.confidenceBps)) errors.push(`${context}:invalid-confidenceBps`);
  if (!isTimestamp(value.createdAtMs)) errors.push(`${context}:invalid-createdAtMs`);
  errors.push(...validateAdaptation(value.adaptation));
  errors.push(...validateGate(value.gate));
  errors.push(...validateRetention(value.retention));
  try {
    if (computeLearningProposalId(value) !== value.proposalId) {
      errors.push(`${context}:proposalId-mismatch`);
    }
  } catch {
    errors.push(`${context}:proposalId-uncomputable`);
  }
  return validationResult(errors, value);
}

function validateActor(value) {
  const context = 'learning-outcome.actor';
  const errors = validateExactKeys(value, ['kind', 'actorId'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!ACTOR_KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (!isIdentifier(value.actorId)) errors.push(`${context}:invalid-actorId`);
  return errors;
}

function validateLearnedItem(value) {
  const context = 'learning-outcome.learnedItem';
  const errors = validateExactKeys(
    value,
    ['itemId', 'itemVersion', 'active', 'confidenceBps', 'expiresAtMs'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!ITEM_ID_PATTERN.test(value.itemId ?? '')) errors.push(`${context}:invalid-itemId`);
  if (!Number.isSafeInteger(value.itemVersion) || value.itemVersion < 1) {
    errors.push(`${context}:invalid-itemVersion`);
  }
  if (typeof value.active !== 'boolean') errors.push(`${context}:invalid-active`);
  if (!isConfidence(value.confidenceBps)) errors.push(`${context}:invalid-confidenceBps`);
  if (!isTimestamp(value.expiresAtMs)) errors.push(`${context}:invalid-expiresAtMs`);
  return errors;
}

function validateMeasurement(value) {
  const context = 'learning-outcome.measurement';
  const errors = validateExactKeys(
    value,
    ['metric', 'baselineScoreBps', 'observedScoreBps', 'deltaBps', 'sampleSize'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!MEASUREMENT_METRICS.has(value.metric)) errors.push(`${context}:invalid-metric`);
  for (const key of ['baselineScoreBps', 'observedScoreBps']) {
    if (!isConfidence(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (
    !Number.isSafeInteger(value.deltaBps)
    || value.deltaBps < -10_000
    || value.deltaBps > 10_000
  ) errors.push(`${context}:invalid-deltaBps`);
  if (
    Number.isSafeInteger(value.baselineScoreBps)
    && Number.isSafeInteger(value.observedScoreBps)
    && value.deltaBps !== value.observedScoreBps - value.baselineScoreBps
  ) errors.push(`${context}:deltaBps-mismatch`);
  if (!Number.isSafeInteger(value.sampleSize) || value.sampleSize < 1) {
    errors.push(`${context}:invalid-sampleSize`);
  }
  return errors;
}

function validateOutcomeState(value, errors) {
  const context = 'learning-outcome';
  const status = value.status;
  const userStatuses = new Set([
    LEARNING_OUTCOME_STATUS.APPROVED,
    LEARNING_OUTCOME_STATUS.REJECTED,
    LEARNING_OUTCOME_STATUS.WEAKENED,
    LEARNING_OUTCOME_STATUS.ROLLED_BACK,
    LEARNING_OUTCOME_STATUS.DELETED,
  ]);
  if (userStatuses.has(status) && value.actor?.kind !== LEARNING_ACTOR_KIND.USER) {
    errors.push(`${context}:user-gate-required`);
  }
  if (
    [LEARNING_OUTCOME_STATUS.MEASURED, LEARNING_OUTCOME_STATUS.EXPIRED].includes(status)
    && value.actor?.kind !== LEARNING_ACTOR_KIND.SYSTEM
  ) errors.push(`${context}:system-actor-required`);

  const initial = [LEARNING_OUTCOME_STATUS.APPROVED, LEARNING_OUTCOME_STATUS.REJECTED].includes(status);
  if (initial ? value.previousOutcomeId !== null : !OUTCOME_ID_PATTERN.test(value.previousOutcomeId ?? '')) {
    errors.push(`${context}:invalid-previousOutcomeId`);
  }

  if ([LEARNING_OUTCOME_STATUS.REJECTED, LEARNING_OUTCOME_STATUS.DELETED, LEARNING_OUTCOME_STATUS.EXPIRED].includes(status)) {
    if (value.learnedItem !== null) errors.push(`${context}:learnedItem-must-be-null`);
  } else if (!isPlainRecord(value.learnedItem)) {
    errors.push(`${context}:learnedItem-required`);
  }

  if ([LEARNING_OUTCOME_STATUS.ROLLED_BACK].includes(status)) {
    if (value.learnedItem?.active !== false) errors.push(`${context}:rolled-back-item-active`);
  } else if (isPlainRecord(value.learnedItem) && value.learnedItem.active !== true) {
    errors.push(`${context}:active-item-required`);
  }

  if (status === LEARNING_OUTCOME_STATUS.MEASURED) {
    if (!isPlainRecord(value.measurement)) errors.push(`${context}:measurement-required`);
  } else if (value.measurement !== null) {
    errors.push(`${context}:measurement-not-applicable`);
  }
}

export function validateLearningOutcomeV1(value) {
  const context = 'learning-outcome';
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'outcomeId',
      'proposalId',
      'projectId',
      'status',
      'recordedAtMs',
      'actor',
      'reason',
      'previousOutcomeId',
      'learnedItem',
      'measurement',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== LEARNING_KIND.OUTCOME) errors.push(`${context}:invalid-contract`);
  if (value.version !== LEARNING_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!OUTCOME_ID_PATTERN.test(value.outcomeId ?? '')) errors.push(`${context}:invalid-outcomeId`);
  if (!PROPOSAL_ID_PATTERN.test(value.proposalId ?? '')) errors.push(`${context}:invalid-proposalId`);
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!OUTCOME_STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  if (!isTimestamp(value.recordedAtMs)) errors.push(`${context}:invalid-recordedAtMs`);
  errors.push(...validateActor(value.actor));
  if (!isBoundedText(value.reason)) errors.push(`${context}:invalid-reason`);
  if (isPlainRecord(value.learnedItem)) errors.push(...validateLearnedItem(value.learnedItem));
  if (isPlainRecord(value.measurement)) errors.push(...validateMeasurement(value.measurement));
  validateOutcomeState(value, errors);
  try {
    if (computeLearningOutcomeId(value) !== value.outcomeId) {
      errors.push(`${context}:outcomeId-mismatch`);
    }
  } catch {
    errors.push(`${context}:outcomeId-uncomputable`);
  }
  return validationResult(errors, value);
}

export function validateLearningProposalForObservations(proposal, observations) {
  const errors = [...validateLearningProposalV1(proposal).errors];
  if (!Array.isArray(observations)) {
    errors.push('learning-chain:observations-not-array');
    return validationResult(errors, null);
  }
  const actualIds = observations.map((observation) => {
    const result = validateLearningObservationV1(observation);
    errors.push(...result.errors);
    if (observation?.projectId !== proposal?.projectId) errors.push('learning-chain:foreign-project');
    return observation?.observationId;
  }).sort(compareUtf8);
  if (
    !Array.isArray(proposal?.observationIds)
    || actualIds.length !== proposal.observationIds.length
    || actualIds.some((id, index) => id !== proposal.observationIds[index])
  ) errors.push('learning-chain:observation-set-mismatch');
  return validationResult(errors, errors.length === 0 ? proposal : null);
}

export function validateLearningOutcomeForProposal(outcome, proposal) {
  const errors = [
    ...validateLearningProposalV1(proposal).errors,
    ...validateLearningOutcomeV1(outcome).errors,
  ];
  if (outcome?.proposalId !== proposal?.proposalId) errors.push('learning-chain:proposal-mismatch');
  if (outcome?.projectId !== proposal?.projectId) errors.push('learning-chain:foreign-project');
  if (isPlainRecord(outcome?.learnedItem)) {
    try {
      if (outcome.learnedItem.itemId !== computeLearningItemId(proposal?.proposalId)) {
        errors.push('learning-chain:itemId-mismatch');
      }
    } catch {
      errors.push('learning-chain:itemId-uncomputable');
    }
    if (
      Number.isSafeInteger(proposal?.retention?.ttlMs)
      && [LEARNING_OUTCOME_STATUS.APPROVED, LEARNING_OUTCOME_STATUS.REJECTED].includes(outcome?.status)
      && outcome.learnedItem.expiresAtMs !== outcome.recordedAtMs + proposal.retention.ttlMs
    ) errors.push('learning-chain:expiresAtMs-mismatch');
  }
  return validationResult(errors, errors.length === 0 ? outcome : null);
}

const ALLOWED_OUTCOME_TRANSITIONS = Object.freeze({
  [LEARNING_OUTCOME_STATUS.APPROVED]: Object.freeze([
    LEARNING_OUTCOME_STATUS.MEASURED,
    LEARNING_OUTCOME_STATUS.WEAKENED,
    LEARNING_OUTCOME_STATUS.ROLLED_BACK,
    LEARNING_OUTCOME_STATUS.DELETED,
    LEARNING_OUTCOME_STATUS.EXPIRED,
  ]),
  [LEARNING_OUTCOME_STATUS.MEASURED]: Object.freeze([
    LEARNING_OUTCOME_STATUS.MEASURED,
    LEARNING_OUTCOME_STATUS.WEAKENED,
    LEARNING_OUTCOME_STATUS.ROLLED_BACK,
    LEARNING_OUTCOME_STATUS.DELETED,
    LEARNING_OUTCOME_STATUS.EXPIRED,
  ]),
  [LEARNING_OUTCOME_STATUS.WEAKENED]: Object.freeze([
    LEARNING_OUTCOME_STATUS.MEASURED,
    LEARNING_OUTCOME_STATUS.WEAKENED,
    LEARNING_OUTCOME_STATUS.ROLLED_BACK,
    LEARNING_OUTCOME_STATUS.DELETED,
    LEARNING_OUTCOME_STATUS.EXPIRED,
  ]),
  [LEARNING_OUTCOME_STATUS.REJECTED]: Object.freeze([LEARNING_OUTCOME_STATUS.DELETED]),
  [LEARNING_OUTCOME_STATUS.ROLLED_BACK]: Object.freeze([LEARNING_OUTCOME_STATUS.DELETED]),
  [LEARNING_OUTCOME_STATUS.EXPIRED]: Object.freeze([LEARNING_OUTCOME_STATUS.DELETED]),
  [LEARNING_OUTCOME_STATUS.DELETED]: Object.freeze([]),
});

export function validateLearningOutcomeTransitionV1(outcome, proposal, previousOutcome = null) {
  const result = validateLearningOutcomeForProposal(outcome, proposal);
  const errors = [...result.errors];
  const initial = [
    LEARNING_OUTCOME_STATUS.APPROVED,
    LEARNING_OUTCOME_STATUS.REJECTED,
  ].includes(outcome?.status);

  if (initial) {
    if (previousOutcome !== null) errors.push('learning-transition:unexpected-previous');
    return validationResult(errors, errors.length === 0 ? outcome : null);
  }
  if (!isPlainRecord(previousOutcome)) {
    errors.push('learning-transition:previous-required');
    return validationResult(errors, null);
  }

  const previousResult = validateLearningOutcomeForProposal(previousOutcome, proposal);
  errors.push(...previousResult.errors);
  if (outcome?.previousOutcomeId !== previousOutcome.outcomeId) {
    errors.push('learning-transition:previousOutcomeId-mismatch');
  }
  if (
    Number.isSafeInteger(outcome?.recordedAtMs)
    && Number.isSafeInteger(previousOutcome.recordedAtMs)
    && outcome.recordedAtMs <= previousOutcome.recordedAtMs
  ) errors.push('learning-transition:non-monotonic-time');
  if (!(ALLOWED_OUTCOME_TRANSITIONS[previousOutcome.status] ?? []).includes(outcome?.status)) {
    errors.push('learning-transition:status-not-allowed');
  }

  const currentItem = outcome?.learnedItem;
  const previousItem = previousOutcome.learnedItem;
  if (isPlainRecord(currentItem) && isPlainRecord(previousItem)) {
    if (currentItem.itemId !== previousItem.itemId) errors.push('learning-transition:itemId-changed');
    if (currentItem.expiresAtMs !== previousItem.expiresAtMs) {
      errors.push('learning-transition:expiresAtMs-changed');
    }
    const expectedVersion = outcome.status === LEARNING_OUTCOME_STATUS.WEAKENED
      ? previousItem.itemVersion + 1
      : previousItem.itemVersion;
    if (currentItem.itemVersion !== expectedVersion) {
      errors.push('learning-transition:itemVersion-mismatch');
    }
  }
  return validationResult(errors, errors.length === 0 ? outcome : null);
}

function createRecord(contract, idKey, computeId, fields) {
  const draft = {
    ...structuredClone(fields),
    contract,
    version: LEARNING_CONTRACT_VERSION,
  };
  delete draft[idKey];
  draft[idKey] = computeId(draft);
  return draft;
}

export function createLearningEvidenceV1(fields) {
  const draft = structuredClone(fields);
  draft.evidenceId = computeLearningEvidenceId(draft);
  const errors = validateEvidence(draft, 0);
  if (errors.length > 0) throw new TypeError(errors.join(', '));
  return deepFreeze(draft);
}

export function createLearningObservationV1(fields) {
  const canonicalFields = structuredClone(fields);
  if (Array.isArray(canonicalFields.evidence)) {
    canonicalFields.evidence.sort((left, right) => compareUtf8(
      left?.evidenceId ?? '',
      right?.evidenceId ?? '',
    ));
  }
  const draft = createRecord(
    LEARNING_KIND.OBSERVATION,
    'observationId',
    computeLearningObservationId,
    canonicalFields,
  );
  const result = validateLearningObservationV1(draft);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return deepFreeze(draft);
}

export function createLearningProposalV1(fields) {
  const canonicalFields = structuredClone(fields);
  if (Array.isArray(canonicalFields.observationIds)) {
    canonicalFields.observationIds.sort(compareUtf8);
  }
  const draft = createRecord(
    LEARNING_KIND.PROPOSAL,
    'proposalId',
    computeLearningProposalId,
    canonicalFields,
  );
  const result = validateLearningProposalV1(draft);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return deepFreeze(draft);
}

export function createLearningOutcomeV1(fields) {
  const draft = createRecord(LEARNING_KIND.OUTCOME, 'outcomeId', computeLearningOutcomeId, fields);
  const result = validateLearningOutcomeV1(draft);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return deepFreeze(draft);
}

export function validateLearningContractV1(value) {
  if (!isPlainRecord(value)) return validationResult(['learning-contract:not-object'], value);
  if (value.contract === LEARNING_KIND.OBSERVATION) return validateLearningObservationV1(value);
  if (value.contract === LEARNING_KIND.PROPOSAL) return validateLearningProposalV1(value);
  if (value.contract === LEARNING_KIND.OUTCOME) return validateLearningOutcomeV1(value);
  return validationResult(['learning-contract:unknown-contract'], value);
}

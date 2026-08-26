import { createHash } from 'node:crypto';

import {
  isJsonValue,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';
import { canonicalizeLearningValue } from './learning-v1.js';

export const PROJECT_LEARNING_CONTEXT_CONTRACT = 'ProjectLearningContext';
export const PROJECT_LEARNING_CONTEXT_VERSION = 1;
export const PROJECT_LEARNING_CONTEXT_STAGE = 'PINNED_V1';

const REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const ITEM_ID_PATTERN = /^lit1:[0-9a-f]{64}$/;
const PROPOSAL_ID_PATTERN = /^lpr1:[0-9a-f]{64}$/;
const OUTCOME_ID_PATTERN = /^lou1:[0-9a-f]{64}$/;
const OBSERVATION_ID_PATTERN = /^lob1:[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTEXT_DIGEST_PATTERN = /^plc1:[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const MAX_ITEMS = 16;
const MAX_SOURCES = 64;
const MAX_EVIDENCE_DIGESTS = 128;
const MAX_VALUE_BYTES = 32 * 1024;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
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

function isBoundedJson(value) {
  if (!isJsonValue(value)) return false;
  try {
    return Buffer.byteLength(canonicalizeLearningValue(value), 'utf8') <= MAX_VALUE_BYTES;
  } catch {
    return false;
  }
}

function validateSortedUnique(value, pattern, context, maximum) {
  const errors = [];
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    return [`${context}:invalid-list`];
  }
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const previous = value[index - 1];
    if (typeof current !== 'string' || !pattern.test(current)) {
      errors.push(`${context}:invalid-item`);
    }
    if (
      index > 0
      && typeof previous === 'string'
      && typeof current === 'string'
      && compareUtf8(previous, current) >= 0
    ) {
      errors.push(`${context}:not-canonical-order`);
    }
  }
  return errors;
}

function validateContextItem(value, index) {
  const context = `project-learning-context.items[${index}]`;
  const errors = validateExactKeys(value, [
    'itemId',
    'itemVersion',
    'proposalId',
    'outcomeId',
    'key',
    'value',
    'baseConfidenceBps',
    'effectiveConfidenceBps',
    'approvedAtMs',
    'expiresAtMs',
    'sourceObservationIds',
    'sourceEvidenceDigests',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!ITEM_ID_PATTERN.test(value.itemId ?? '')) errors.push(`${context}:invalid-itemId`);
  if (!Number.isSafeInteger(value.itemVersion) || value.itemVersion < 1) {
    errors.push(`${context}:invalid-itemVersion`);
  }
  if (!PROPOSAL_ID_PATTERN.test(value.proposalId ?? '')) errors.push(`${context}:invalid-proposalId`);
  if (!OUTCOME_ID_PATTERN.test(value.outcomeId ?? '')) errors.push(`${context}:invalid-outcomeId`);
  if (!KEY_PATTERN.test(value.key ?? '')) errors.push(`${context}:invalid-key`);
  if (!isBoundedJson(value.value)) errors.push(`${context}:invalid-value`);
  if (!isConfidence(value.baseConfidenceBps)) errors.push(`${context}:invalid-baseConfidenceBps`);
  if (!isConfidence(value.effectiveConfidenceBps)) {
    errors.push(`${context}:invalid-effectiveConfidenceBps`);
  }
  if (
    Number.isSafeInteger(value.baseConfidenceBps)
    && Number.isSafeInteger(value.effectiveConfidenceBps)
    && value.effectiveConfidenceBps > value.baseConfidenceBps
  ) errors.push(`${context}:effective-confidence-increased`);
  if (!isTimestamp(value.approvedAtMs)) errors.push(`${context}:invalid-approvedAtMs`);
  if (!isTimestamp(value.expiresAtMs) || value.expiresAtMs <= value.approvedAtMs) {
    errors.push(`${context}:invalid-expiresAtMs`);
  }
  errors.push(...validateSortedUnique(
    value.sourceObservationIds,
    OBSERVATION_ID_PATTERN,
    `${context}.sourceObservationIds`,
    MAX_SOURCES,
  ));
  errors.push(...validateSortedUnique(
    value.sourceEvidenceDigests,
    DIGEST_PATTERN,
    `${context}.sourceEvidenceDigests`,
    MAX_EVIDENCE_DIGESTS,
  ));
  return errors;
}

export function computeProjectLearningContextDigest(value) {
  if (!isPlainRecord(value)) throw new TypeError('project-learning-context:not-object');
  const source = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'contextDigest'),
  );
  return `plc1:${createHash('sha256')
    .update(canonicalizeLearningValue(source), 'utf8')
    .digest('hex')}`;
}

export function validateProjectLearningContextV1(value) {
  const context = 'project-learning-context';
  const errors = validateExactKeys(value, [
    'contract',
    'version',
    'projectId',
    'workspaceRevision',
    'generatedAtMs',
    'items',
    'contextDigest',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== PROJECT_LEARNING_CONTEXT_CONTRACT) errors.push(`${context}:invalid-contract`);
  if (value.version !== PROJECT_LEARNING_CONTEXT_VERSION) errors.push(`${context}:invalid-version`);
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!REVISION_PATTERN.test(value.workspaceRevision ?? '')) {
    errors.push(`${context}:invalid-workspaceRevision`);
  }
  if (!isTimestamp(value.generatedAtMs)) errors.push(`${context}:invalid-generatedAtMs`);
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) {
    errors.push(`${context}:invalid-items`);
  } else {
    value.items.forEach((item, index) => errors.push(...validateContextItem(item, index)));
    for (let index = 1; index < value.items.length; index += 1) {
      const previous = value.items[index - 1];
      const current = value.items[index];
      if (
        isPlainRecord(previous)
        && isPlainRecord(current)
        && isConfidence(previous.effectiveConfidenceBps)
        && isConfidence(current.effectiveConfidenceBps)
        && typeof previous.itemId === 'string'
        && typeof current.itemId === 'string'
        && (
          previous.effectiveConfidenceBps < current.effectiveConfidenceBps
          || (
            previous.effectiveConfidenceBps === current.effectiveConfidenceBps
            && compareUtf8(previous.itemId, current.itemId) >= 0
          )
        )
      ) errors.push(`${context}:items-not-canonical-order`);
    }
  }
  if (!CONTEXT_DIGEST_PATTERN.test(value.contextDigest ?? '')) {
    errors.push(`${context}:invalid-contextDigest`);
  }
  try {
    if (computeProjectLearningContextDigest(value) !== value.contextDigest) {
      errors.push(`${context}:contextDigest-mismatch`);
    }
  } catch {
    errors.push(`${context}:contextDigest-uncomputable`);
  }
  return validationResult(errors, value);
}

export function createProjectLearningContextV1(fields) {
  const value = {
    ...structuredClone(fields),
    contract: PROJECT_LEARNING_CONTEXT_CONTRACT,
    version: PROJECT_LEARNING_CONTEXT_VERSION,
  };
  delete value.contextDigest;
  value.contextDigest = computeProjectLearningContextDigest(value);
  const result = validateProjectLearningContextV1(value);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  const freeze = current => {
    if (current && typeof current === 'object' && !Object.isFrozen(current)) {
      Object.values(current).forEach(freeze);
      Object.freeze(current);
    }
    return current;
  };
  return freeze(value);
}

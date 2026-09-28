import { createHash } from 'node:crypto';

import {
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';
import { canonicalizeLearningValue } from './learning-v1.js';

export const LEARNING_PLAN_EVALUATION_CONTRACT = 'LearningPlanEvaluationArtifact';
export const LEARNING_PLAN_EVALUATION_VERSION = 1;
export const LEARNING_PLAN_EVALUATION_STAGE = 'PINNED_V1';

export const LEARNING_PLAN_CONFORMANCE_STATUS = Object.freeze({
  ABSENT: 'absent',
  CONFORMED: 'conformed',
  CONFLICT_EXPLICIT: 'conflict_explicit',
});

const ARTIFACT_ID_PATTERN = /^lpa1:[0-9a-f]{64}$/;
const PROPOSAL_ID_PATTERN = /^lpr1:[0-9a-f]{64}$/;
const ITEM_ID_PATTERN = /^lit1:[0-9a-f]{64}$/;
const CONTEXT_DIGEST_PATTERN = /^plc1:[0-9a-f]{64}$/;
const RESPONSE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const STATUSES = new Set(Object.values(LEARNING_PLAN_CONFORMANCE_STATUS));

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isBoundedText(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 4096;
}

function validateConformance(value) {
  const context = 'learning-plan-evaluation.conformance';
  const errors = validateExactKeys(value, ['key', 'status', 'explanation'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!KEY_PATTERN.test(value.key ?? '')) errors.push(`${context}:invalid-key`);
  if (!STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  if (!isBoundedText(value.explanation)) errors.push(`${context}:invalid-explanation`);
  return errors;
}

export function computeLearningPlanResponseDigest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeLearningValue(value), 'utf8')
    .digest('hex')}`;
}

export function computeLearningPlanEvaluationArtifactId(value) {
  if (!isPlainRecord(value)) throw new TypeError('learning-plan-evaluation:not-object');
  const source = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'artifactId'),
  );
  return `lpa1:${createHash('sha256')
    .update(canonicalizeLearningValue(source), 'utf8')
    .digest('hex')}`;
}

export function validateLearningPlanEvaluationArtifactV1(value) {
  const context = 'learning-plan-evaluation';
  const errors = validateExactKeys(value, [
    'contract',
    'version',
    'artifactId',
    'projectId',
    'proposalId',
    'itemId',
    'itemVersion',
    'learningContextDigest',
    'generatedAtMs',
    'responseDigest',
    'conformance',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== LEARNING_PLAN_EVALUATION_CONTRACT) errors.push(`${context}:invalid-contract`);
  if (value.version !== LEARNING_PLAN_EVALUATION_VERSION) errors.push(`${context}:invalid-version`);
  if (!ARTIFACT_ID_PATTERN.test(value.artifactId ?? '')) errors.push(`${context}:invalid-artifactId`);
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) errors.push(`${context}:invalid-projectId`);
  if (!PROPOSAL_ID_PATTERN.test(value.proposalId ?? '')) errors.push(`${context}:invalid-proposalId`);
  if (!ITEM_ID_PATTERN.test(value.itemId ?? '')) errors.push(`${context}:invalid-itemId`);
  if (!Number.isSafeInteger(value.itemVersion) || value.itemVersion < 1) {
    errors.push(`${context}:invalid-itemVersion`);
  }
  if (
    value.learningContextDigest !== null
    && !CONTEXT_DIGEST_PATTERN.test(value.learningContextDigest ?? '')
  ) errors.push(`${context}:invalid-learningContextDigest`);
  if (!isTimestamp(value.generatedAtMs)) errors.push(`${context}:invalid-generatedAtMs`);
  if (!RESPONSE_DIGEST_PATTERN.test(value.responseDigest ?? '')) {
    errors.push(`${context}:invalid-responseDigest`);
  }
  errors.push(...validateConformance(value.conformance));
  try {
    if (computeLearningPlanEvaluationArtifactId(value) !== value.artifactId) {
      errors.push(`${context}:artifactId-mismatch`);
    }
  } catch {
    errors.push(`${context}:artifactId-uncomputable`);
  }
  return validationResult(errors, value);
}

export function createLearningPlanEvaluationArtifactV1(fields) {
  const value = {
    ...structuredClone(fields),
    contract: LEARNING_PLAN_EVALUATION_CONTRACT,
    version: LEARNING_PLAN_EVALUATION_VERSION,
  };
  delete value.artifactId;
  value.artifactId = computeLearningPlanEvaluationArtifactId(value);
  const result = validateLearningPlanEvaluationArtifactV1(value);
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

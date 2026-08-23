import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  M1_TERMINAL_STATUS,
  hasOwn,
  isIdentifier,
  isNonEmptyString,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const PROJECT_CONTEXT_CONTRACT_VERSION = 1;
export const PROJECT_CONTEXT_CONTRACT_STAGE = 'PROVISIONAL_V1';
export const PROJECT_CONTEXT_NORMALIZATION_VERSION = 1;

export const PROJECT_CONTEXT_KIND = Object.freeze({
  QUERY: 'ProjectContextQuery',
  SNAPSHOT: 'ProjectContextSnapshot',
});

export const PROJECT_CONTEXT_OUTCOME = Object.freeze({
  FOUND: 'found',
  EMPTY: 'empty',
});

export const PROJECT_CONTEXT_ERROR_CODE = Object.freeze({
  STALE: 'PROJECT_CONTEXT_STALE',
  INVALID_SCOPE: 'PROJECT_CONTEXT_INVALID_SCOPE',
  NOT_READY: 'PROJECT_CONTEXT_NOT_READY',
  BUDGET_EXHAUSTED: 'PROJECT_CONTEXT_BUDGET_EXHAUSTED',
  SCAN_LIMIT: 'PROJECT_CONTEXT_SCAN_LIMIT',
  INTERNAL: 'PROJECT_CONTEXT_INTERNAL',
  TIMEOUT: 'PROJECT_CONTEXT_TIMEOUT',
  CANCELLED: 'PROJECT_CONTEXT_CANCELLED',
});

export const PROJECT_CONTEXT_TERMINAL_STATUS = M1_TERMINAL_STATUS;

const REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const CONTENT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_DIGEST_PATTERN = /^pcs1:[0-9a-f]{64}$/;
const SUCCESS_OUTCOMES = new Set(Object.values(PROJECT_CONTEXT_OUTCOME));
const ERROR_CODES = new Set(Object.values(PROJECT_CONTEXT_ERROR_CODE));
const NON_SUCCESS_STATUSES = new Set([
  M1_TERMINAL_STATUS.ERROR,
  M1_TERMINAL_STATUS.TIMEOUT,
  M1_TERMINAL_STATUS.CANCELLED,
]);
const TRUNCATION_REASONS = new Set(['maxFiles', 'maxBytes', 'maxTokens']);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen, depth) {
  if (depth > 64) throw new TypeError('project-context-canonical:too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('project-context-canonical:non-integer-number');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('project-context-canonical:unsupported-value');
  }

  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    const fields = Object.keys(value)
      .sort(compareUtf8)
      .map(key => `${JSON.stringify(key)}:${canonicalize(value[key], seen, depth + 1)}`);
    serialized = `{${fields.join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('project-context-canonical:unsupported-object');
  }
  seen.delete(value);
  return serialized;
}

export function canonicalizeProjectContextValue(value) {
  return canonicalize(value, new Set(), 0);
}

export function isProjectContextProjectId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function normalizeProjectContextQuery(queryText) {
  if (typeof queryText !== 'string') {
    throw new TypeError('project-context-query:invalid-queryText');
  }

  const normalizedQuery = queryText
    .normalize('NFC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
    .toLowerCase();
  const seen = new Set();
  const terms = [];
  for (const term of normalizedQuery.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return Object.freeze({
    normalizationVersion: PROJECT_CONTEXT_NORMALIZATION_VERSION,
    normalizedQuery,
    terms: Object.freeze(terms),
  });
}

function isCanonicalRoot(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value;
}

function isProjectRelativePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
  ) return false;
  const segments = value.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function isRevision(value) {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

function isContentDigest(value) {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

function validatePositiveBudget(value, key, context, errors) {
  if (!Number.isSafeInteger(value[key]) || value[key] < 1) {
    errors.push(`${context}:invalid-${key}`);
  }
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function validateProjectContextQuery(value) {
  const context = 'project-context-query';
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'requestId',
      'projectId',
      'canonicalRoot',
      'workspaceRevision',
      'queryText',
      'maxFiles',
      'maxBytes',
      'maxTokens',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);

  if (value.contract !== PROJECT_CONTEXT_KIND.QUERY) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== PROJECT_CONTEXT_CONTRACT_VERSION) {
    errors.push(`${context}:invalid-version`);
  }
  if (!isIdentifier(value.requestId)) errors.push(`${context}:invalid-requestId`);
  if (!isProjectContextProjectId(value.projectId)) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isCanonicalRoot(value.canonicalRoot)) {
    errors.push(`${context}:invalid-canonicalRoot`);
  }
  if (!isRevision(value.workspaceRevision)) {
    errors.push(`${context}:invalid-workspaceRevision`);
  }
  if (!isNonEmptyString(value.queryText)) {
    errors.push(`${context}:invalid-queryText`);
  } else {
    const normalized = normalizeProjectContextQuery(value.queryText);
    if (normalized.terms.length === 0) errors.push(`${context}:empty-terms`);
  }
  for (const key of ['maxFiles', 'maxBytes', 'maxTokens']) {
    validatePositiveBudget(value, key, context, errors);
  }
  return validationResult(errors, value);
}

function validateBudget(value) {
  const context = 'project-context-snapshot.budget';
  const errors = validateExactKeys(
    value,
    ['maxFiles', 'maxBytes', 'maxTokens', 'usedFiles', 'usedBytes', 'usedTokens'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  for (const key of ['maxFiles', 'maxBytes', 'maxTokens']) {
    validatePositiveBudget(value, key, context, errors);
  }
  for (const key of ['usedFiles', 'usedBytes', 'usedTokens']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      errors.push(`${context}:invalid-${key}`);
    }
  }
  for (const [used, maximum] of [
    ['usedFiles', 'maxFiles'],
    ['usedBytes', 'maxBytes'],
    ['usedTokens', 'maxTokens'],
  ]) {
    if (
      Number.isSafeInteger(value[used])
      && Number.isSafeInteger(value[maximum])
      && value[used] > value[maximum]
    ) errors.push(`${context}:${used}-exceeds-${maximum}`);
  }
  return errors;
}

function validateTruncation(value, outcome) {
  const context = 'project-context-snapshot.truncation';
  const required = isPlainRecord(value) && value.truncated === true
    ? ['truncated', 'reason']
    : ['truncated'];
  const errors = validateExactKeys(value, required, [], context);
  if (!isPlainRecord(value)) return errors;
  if (typeof value.truncated !== 'boolean') errors.push(`${context}:invalid-truncated`);
  if (value.truncated === true) {
    if (!TRUNCATION_REASONS.has(value.reason)) errors.push(`${context}:invalid-reason`);
    if (outcome !== PROJECT_CONTEXT_OUTCOME.FOUND) {
      errors.push(`${context}:truncated-without-found`);
    }
  }
  return errors;
}

function validateProvenance(value, item, snapshot, index) {
  const context = `project-context-snapshot.items[${index}].provenance`;
  const errors = validateExactKeys(
    value,
    ['sourceSet', 'projectId', 'workspaceRevision', 'path', 'contentDigest'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (value.sourceSet !== 'ContextSourceSet@1') errors.push(`${context}:invalid-sourceSet`);
  if (value.projectId !== snapshot.projectId) errors.push(`${context}:foreign-projectId`);
  if (value.workspaceRevision !== snapshot.workspaceRevision) {
    errors.push(`${context}:foreign-workspaceRevision`);
  }
  if (value.path !== item.path) errors.push(`${context}:path-mismatch`);
  if (value.contentDigest !== item.contentDigest) {
    errors.push(`${context}:contentDigest-mismatch`);
  }
  return errors;
}

function validateItem(value, snapshot, index) {
  const context = `project-context-snapshot.items[${index}]`;
  const errors = validateExactKeys(
    value,
    [
      'path',
      'startLine',
      'endLine',
      'content',
      'contentDigest',
      'score',
      'provenance',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!isProjectRelativePath(value.path)) errors.push(`${context}:invalid-path`);
  if (!Number.isSafeInteger(value.startLine) || value.startLine < 1) {
    errors.push(`${context}:invalid-startLine`);
  }
  if (
    !Number.isSafeInteger(value.endLine)
    || value.endLine < value.startLine
  ) errors.push(`${context}:invalid-endLine`);
  if (!isNonEmptyString(value.content)) errors.push(`${context}:invalid-content`);
  if (!isContentDigest(value.contentDigest)) errors.push(`${context}:invalid-contentDigest`);
  if (!Number.isSafeInteger(value.score) || value.score < 0) {
    errors.push(`${context}:invalid-score`);
  }
  errors.push(...validateProvenance(value.provenance, value, snapshot, index));
  return errors;
}

function validateSuccessfulSnapshot(value) {
  const context = 'project-context-snapshot';
  const errors = [];
  if (!SUCCESS_OUTCOMES.has(value.outcome)) errors.push(`${context}:invalid-outcome`);
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (value.normalizationVersion !== PROJECT_CONTEXT_NORMALIZATION_VERSION) {
    errors.push(`${context}:invalid-normalizationVersion`);
  }

  if (!isNonEmptyString(value.normalizedQuery)) {
    errors.push(`${context}:invalid-normalizedQuery`);
  } else {
    const derived = normalizeProjectContextQuery(value.normalizedQuery);
    if (derived.normalizedQuery !== value.normalizedQuery) {
      errors.push(`${context}:noncanonical-normalizedQuery`);
    }
    if (!arraysEqual(value.terms, derived.terms)) errors.push(`${context}:invalid-terms`);
  }

  if (!Array.isArray(value.items)) {
    errors.push(`${context}:invalid-items`);
  } else {
    const identities = new Set();
    value.items.forEach((item, index) => {
      errors.push(...validateItem(item, value, index));
      if (!isPlainRecord(item)) return;
      const identity = `${item.path}\0${item.startLine}\0${item.endLine}`;
      if (identities.has(identity)) errors.push(`${context}:duplicate-item`);
      identities.add(identity);
    });
    if (value.outcome === PROJECT_CONTEXT_OUTCOME.FOUND && value.items.length === 0) {
      errors.push(`${context}:found-without-items`);
    }
    if (value.outcome === PROJECT_CONTEXT_OUTCOME.EMPTY && value.items.length !== 0) {
      errors.push(`${context}:empty-with-items`);
    }
  }

  errors.push(...validateBudget(value.budget));
  errors.push(...validateTruncation(value.truncation, value.outcome));
  if (
    Array.isArray(value.items)
    && isPlainRecord(value.budget)
    && value.budget.usedFiles !== value.items.length
  ) errors.push(`${context}:usedFiles-mismatch`);
  if (
    value.outcome === PROJECT_CONTEXT_OUTCOME.EMPTY
    && isPlainRecord(value.truncation)
    && value.truncation.truncated !== false
  ) errors.push(`${context}:empty-truncated`);

  if (!SNAPSHOT_DIGEST_PATTERN.test(value.snapshotDigest ?? '')) {
    errors.push(`${context}:invalid-snapshotDigest`);
  } else {
    try {
      if (computeProjectContextSnapshotDigest(value) !== value.snapshotDigest) {
        errors.push(`${context}:snapshotDigest-mismatch`);
      }
    } catch {
      errors.push(`${context}:snapshotDigest-uncomputable`);
    }
  }
  return errors;
}

function validateSnapshotError(value, status) {
  const context = 'project-context-snapshot.error';
  const stale = isPlainRecord(value) && value.code === PROJECT_CONTEXT_ERROR_CODE.STALE;
  const errors = validateExactKeys(
    value,
    stale ? ['code', 'message', 'expectedRevision', 'observedRevision'] : ['code', 'message'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!ERROR_CODES.has(value.code)) errors.push(`${context}:invalid-code`);
  if (!isNonEmptyString(value.message)) errors.push(`${context}:invalid-message`);

  if (status === M1_TERMINAL_STATUS.TIMEOUT) {
    if (value.code !== PROJECT_CONTEXT_ERROR_CODE.TIMEOUT) {
      errors.push(`${context}:timeout-code-mismatch`);
    }
  } else if (status === M1_TERMINAL_STATUS.CANCELLED) {
    if (value.code !== PROJECT_CONTEXT_ERROR_CODE.CANCELLED) {
      errors.push(`${context}:cancelled-code-mismatch`);
    }
  } else if (
    value.code === PROJECT_CONTEXT_ERROR_CODE.TIMEOUT
    || value.code === PROJECT_CONTEXT_ERROR_CODE.CANCELLED
  ) {
    errors.push(`${context}:transport-code-on-error`);
  }

  if (stale) {
    if (!isRevision(value.expectedRevision)) errors.push(`${context}:invalid-expectedRevision`);
    if (!isRevision(value.observedRevision)) errors.push(`${context}:invalid-observedRevision`);
    if (value.expectedRevision === value.observedRevision) {
      errors.push(`${context}:stale-revisions-equal`);
    }
  }
  return errors;
}

export function computeProjectContextSnapshotDigest(snapshot) {
  if (!isPlainRecord(snapshot) || snapshot.status !== M1_TERMINAL_STATUS.OK) {
    throw new TypeError('project-context-snapshot-digest:success-required');
  }
  const digestInput = {
    contract: snapshot.contract,
    version: snapshot.version,
    normalizationVersion: snapshot.normalizationVersion,
    projectId: snapshot.projectId,
    status: snapshot.status,
    outcome: snapshot.outcome,
    workspaceRevision: snapshot.workspaceRevision,
    normalizedQuery: snapshot.normalizedQuery,
    terms: snapshot.terms,
    budget: snapshot.budget,
    truncation: snapshot.truncation,
    items: snapshot.items,
  };
  const canonical = canonicalizeProjectContextValue(digestInput);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `pcs1:${digest}`;
}

export function validateProjectContextSnapshot(value) {
  const context = 'project-context-snapshot';
  const success = isPlainRecord(value) && value.status === M1_TERMINAL_STATUS.OK;
  const required = success
    ? [
      'contract',
      'version',
      'requestId',
      'projectId',
      'status',
      'outcome',
      'workspaceRevision',
      'normalizationVersion',
      'normalizedQuery',
      'terms',
      'items',
      'budget',
      'truncation',
      'snapshotDigest',
    ]
    : ['contract', 'version', 'requestId', 'projectId', 'status', 'error'];
  const errors = validateExactKeys(value, required, [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);

  if (value.contract !== PROJECT_CONTEXT_KIND.SNAPSHOT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== PROJECT_CONTEXT_CONTRACT_VERSION) {
    errors.push(`${context}:invalid-version`);
  }
  if (!isIdentifier(value.requestId)) errors.push(`${context}:invalid-requestId`);
  if (!isProjectContextProjectId(value.projectId)) {
    errors.push(`${context}:invalid-projectId`);
  }

  if (success) {
    errors.push(...validateSuccessfulSnapshot(value));
  } else if (NON_SUCCESS_STATUSES.has(value.status)) {
    errors.push(...validateSnapshotError(value.error, value.status));
  } else {
    errors.push(`${context}:invalid-status`);
  }
  return validationResult(errors, value);
}

export function validateProjectContextContract(value) {
  if (!isPlainRecord(value)) {
    return validationResult(['project-context-contract:not-object'], value);
  }
  if (value.contract === PROJECT_CONTEXT_KIND.QUERY) {
    return validateProjectContextQuery(value);
  }
  if (value.contract === PROJECT_CONTEXT_KIND.SNAPSHOT) {
    return validateProjectContextSnapshot(value);
  }
  return validationResult(['project-context-contract:unknown-contract'], value);
}

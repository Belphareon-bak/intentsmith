import path from 'node:path';

import { M2_EXECUTION_LIMITS } from '../../contracts/m2/execution-v1.js';
import { isPlainRecord, validateExactKeys, validationResult } from '../../contracts/m1/shared.js';

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ARGUMENT_COUNT = 128;
const MAX_ARGUMENT_BYTES = 4_096;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_INTENT_BYTES = 16_384;
const MAX_COMMIT_MESSAGE_BYTES = 4_096;
const GIT_IDENTITY_KEYS = Object.freeze([
  'authorName',
  'authorEmail',
  'authorDate',
  'committerName',
  'committerEmail',
  'committerDate',
]);

export const M2ProposalCompilerErrorCode = Object.freeze({
  INPUT_NOT_OBJECT: 'M2_PROPOSAL_INPUT_NOT_OBJECT',
  PROPOSAL_KEYS_INVALID: 'M2_PROPOSAL_KEYS_INVALID',
  INTENT_INVALID: 'M2_PROPOSAL_INTENT_INVALID',
  CHANGES_INVALID: 'M2_PROPOSAL_CHANGES_INVALID',
  CHANGE_KEYS_INVALID: 'M2_PROPOSAL_CHANGE_KEYS_INVALID',
  CHANGE_PATH_INVALID: 'M2_PROPOSAL_CHANGE_PATH_INVALID',
  CHANGE_PATH_DUPLICATE: 'M2_PROPOSAL_CHANGE_PATH_DUPLICATE',
  CHANGE_CONTENT_INVALID: 'M2_PROPOSAL_CHANGE_CONTENT_INVALID',
  CHANGE_LIMIT_EXCEEDED: 'M2_PROPOSAL_CHANGE_LIMIT_EXCEEDED',
  FOCUSED_TEST_MISSING: 'M2_PROPOSAL_FOCUSED_TEST_MISSING',
  FOCUSED_TEST_KEYS_INVALID: 'M2_PROPOSAL_FOCUSED_TEST_KEYS_INVALID',
  FOCUSED_TEST_INVALID: 'M2_PROPOSAL_FOCUSED_TEST_INVALID',
  GIT_COMMIT_KEYS_INVALID: 'M2_PROPOSAL_GIT_COMMIT_KEYS_INVALID',
  GIT_COMMIT_INVALID: 'M2_PROPOSAL_GIT_COMMIT_INVALID',
});

export class M2ProposalCompilerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'M2ProposalCompilerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new M2ProposalCompilerError(code, message, details);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isNfcString(value) {
  return typeof value === 'string' && value === value.normalize('NFC');
}

function isBoundedNfcString(value, maximum, { empty = false } = {}) {
  return isNfcString(value)
    && !value.includes('\0')
    && Buffer.from(value, 'utf8').toString('utf8') === value
    && (empty || value.trim().length > 0)
    && Buffer.byteLength(value, 'utf8') <= maximum;
}

function isCanonicalAbsolute(value) {
  return isBoundedNfcString(value, 4_096)
    && !value.includes('\\')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && (value === '/' || !value.endsWith('/'));
}

function isProjectRelativePath(value) {
  if (
    !isBoundedNfcString(value, 4_096)
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || value.endsWith('/')
  ) return false;
  const segments = value.split('/');
  return path.posix.normalize(value) === value
    && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function validateEnvironment(value, context) {
  if (!isPlainRecord(value)) return [`${context}:not-object`];
  const errors = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) errors.push(`${context}:invalid-key-${key}`);
    if (!isBoundedNfcString(entry, MAX_ENVIRONMENT_VALUE_BYTES, { empty: true })) {
      errors.push(`${context}:invalid-value-${key}`);
    }
  }
  return errors;
}

function validateGitIdentity(value, context) {
  const errors = validateExactKeys(value, GIT_IDENTITY_KEYS, [], context);
  if (!isPlainRecord(value)) return errors;
  for (const key of GIT_IDENTITY_KEYS) {
    if (!isBoundedNfcString(value[key], 4_096)) errors.push(`${context}:invalid-${key}`);
  }
  return errors;
}

function validateProposal(value) {
  if (!isPlainRecord(value)) {
    return {
      errorCode: M2ProposalCompilerErrorCode.INPUT_NOT_OBJECT,
      errors: ['m2-proposal:not-object'],
    };
  }
  const topErrors = validateExactKeys(
    value,
    ['intent', 'changes', 'focusedTest'],
    ['gitCommit'],
    'm2-proposal',
  );
  if (topErrors.length > 0) {
    const missingFocusedTest = topErrors.includes('m2-proposal:missing-focusedTest');
    return {
      errorCode: missingFocusedTest
        ? M2ProposalCompilerErrorCode.FOCUSED_TEST_MISSING
        : M2ProposalCompilerErrorCode.PROPOSAL_KEYS_INVALID,
      errors: topErrors,
    };
  }
  if (!isBoundedNfcString(value.intent, MAX_INTENT_BYTES)) {
    return {
      errorCode: M2ProposalCompilerErrorCode.INTENT_INVALID,
      errors: ['m2-proposal:invalid-intent'],
    };
  }
  if (
    !Array.isArray(value.changes)
    || value.changes.length < 1
    || value.changes.length > M2_EXECUTION_LIMITS.MAX_CHANGES
  ) {
    return {
      errorCode: M2ProposalCompilerErrorCode.CHANGES_INVALID,
      errors: ['m2-proposal:invalid-changes'],
    };
  }

  const paths = new Set();
  let totalBytes = 0;
  for (let index = 0; index < value.changes.length; index += 1) {
    const change = value.changes[index];
    const context = `m2-proposal.changes[${index}]`;
    const keyErrors = validateExactKeys(change, ['path', 'afterContent'], [], context);
    if (keyErrors.length > 0) {
      return {
        errorCode: M2ProposalCompilerErrorCode.CHANGE_KEYS_INVALID,
        errors: keyErrors,
      };
    }
    if (!isProjectRelativePath(change.path)) {
      return {
        errorCode: M2ProposalCompilerErrorCode.CHANGE_PATH_INVALID,
        errors: [`${context}:invalid-path`],
      };
    }
    if (paths.has(change.path)) {
      return {
        errorCode: M2ProposalCompilerErrorCode.CHANGE_PATH_DUPLICATE,
        errors: [`${context}:duplicate-path`],
      };
    }
    paths.add(change.path);
    if (!isBoundedNfcString(change.afterContent, M2_EXECUTION_LIMITS.MAX_FILE_BYTES, { empty: true })) {
      return {
        errorCode: M2ProposalCompilerErrorCode.CHANGE_CONTENT_INVALID,
        errors: [`${context}:invalid-afterContent`],
      };
    }
    totalBytes += Buffer.byteLength(change.afterContent, 'utf8');
    if (totalBytes > M2_EXECUTION_LIMITS.MAX_TOTAL_AFTER_BYTES) {
      return {
        errorCode: M2ProposalCompilerErrorCode.CHANGE_LIMIT_EXCEEDED,
        errors: ['m2-proposal:after-bytes-exceed-total-limit'],
      };
    }
  }

  if (!isPlainRecord(value.focusedTest)) {
    return {
      errorCode: M2ProposalCompilerErrorCode.FOCUSED_TEST_MISSING,
      errors: ['m2-proposal.focusedTest:not-object'],
    };
  }
  const focusedKeyErrors = validateExactKeys(
    value.focusedTest,
    ['binary', 'argv', 'environment', 'timeoutMs'],
    [],
    'm2-proposal.focusedTest',
  );
  if (focusedKeyErrors.length > 0) {
    return {
      errorCode: M2ProposalCompilerErrorCode.FOCUSED_TEST_KEYS_INVALID,
      errors: focusedKeyErrors,
    };
  }
  const focusedErrors = [];
  if (!isCanonicalAbsolute(value.focusedTest.binary)) {
    focusedErrors.push('m2-proposal.focusedTest:invalid-binary');
  }
  if (
    !Array.isArray(value.focusedTest.argv)
    || value.focusedTest.argv.length > MAX_ARGUMENT_COUNT
    || value.focusedTest.argv.some(argument => (
      !isBoundedNfcString(argument, MAX_ARGUMENT_BYTES, { empty: true })
    ))
  ) focusedErrors.push('m2-proposal.focusedTest:invalid-argv');
  focusedErrors.push(...validateEnvironment(
    value.focusedTest.environment,
    'm2-proposal.focusedTest.environment',
  ));
  if (
    !Number.isSafeInteger(value.focusedTest.timeoutMs)
    || value.focusedTest.timeoutMs < 1
    || value.focusedTest.timeoutMs > 3_600_000
  ) focusedErrors.push('m2-proposal.focusedTest:invalid-timeoutMs');
  if (focusedErrors.length > 0) {
    return {
      errorCode: M2ProposalCompilerErrorCode.FOCUSED_TEST_INVALID,
      errors: focusedErrors,
    };
  }

  if (value.gitCommit !== undefined && value.gitCommit !== null) {
    const gitKeyErrors = validateExactKeys(
      value.gitCommit,
      ['message', 'identity'],
      [],
      'm2-proposal.gitCommit',
    );
    if (gitKeyErrors.length > 0) {
      return {
        errorCode: M2ProposalCompilerErrorCode.GIT_COMMIT_KEYS_INVALID,
        errors: gitKeyErrors,
      };
    }
    const gitErrors = [];
    if (!isBoundedNfcString(value.gitCommit.message, MAX_COMMIT_MESSAGE_BYTES)) {
      gitErrors.push('m2-proposal.gitCommit:invalid-message');
    }
    gitErrors.push(...validateGitIdentity(value.gitCommit.identity, 'm2-proposal.gitCommit.identity'));
    if (
      isPlainRecord(value.gitCommit.identity)
      && Buffer.byteLength(JSON.stringify(value.gitCommit.identity), 'utf8') > 4_096
    ) gitErrors.push('m2-proposal.gitCommit:identity-exceeds-durable-limit');
    if (gitErrors.length > 0) {
      return {
        errorCode: M2ProposalCompilerErrorCode.GIT_COMMIT_INVALID,
        errors: gitErrors,
      };
    }
  }

  return { errorCode: null, errors: [] };
}

export function validateM2ProjectChangeProposal(value) {
  const checked = validateProposal(value);
  return validationResult(checked.errors, value);
}

export function compileM2ProjectChangeProposal(value) {
  const checked = validateProposal(value);
  if (checked.errors.length > 0) {
    fail(checked.errorCode, 'M2 project-change proposal is invalid', {
      errors: Object.freeze([...checked.errors]),
    });
  }

  const changes = [...value.changes]
    .sort((left, right) => compareUtf8(left.path, right.path))
    .map(change => Object.freeze({ path: change.path, afterContent: change.afterContent }));
  const environment = Object.fromEntries(
    Object.entries(value.focusedTest.environment)
      .sort(([left], [right]) => compareUtf8(left, right)),
  );
  const focusedTest = Object.freeze({
    binary: value.focusedTest.binary,
    argv: Object.freeze([...value.focusedTest.argv]),
    environment: Object.freeze(environment),
    timeoutMs: value.focusedTest.timeoutMs,
  });
  const gitCommit = value.gitCommit == null ? null : Object.freeze({
    message: value.gitCommit.message,
    identity: Object.freeze(Object.fromEntries(
      GIT_IDENTITY_KEYS.map(key => [key, value.gitCommit.identity[key]]),
    )),
  });

  return Object.freeze({
    intent: value.intent,
    changes: Object.freeze(changes),
    focusedTest,
    gitCommit,
  });
}

export default compileM2ProjectChangeProposal;

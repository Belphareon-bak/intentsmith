import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M2_EXECUTION_CONTRACT_VERSION = 1;
export const M2_EXECUTION_CONTRACT_STAGE = 'CANDIDATE_V1';

export const M2_EXECUTION_CONTRACT_KIND = Object.freeze({
  REQUEST: 'ProjectChangeRequest',
  RESULT: 'ProjectChangeResult',
});

export const M2_EXECUTION_LIMITS = Object.freeze({
  MAX_CHANGES: 32,
  MAX_FILE_BYTES: 1_048_576,
  MAX_TOTAL_AFTER_BYTES: 8_388_608,
  MAX_WIRE_BYTES: 8_388_608,
});

export const M2_EXECUTION_TERMINAL_STATUS = Object.freeze({
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  ORPHANED: 'orphaned',
});

const TERMINAL_STATUSES = new Set(Object.values(M2_EXECUTION_TERMINAL_STATUS));
const CHILD_TERMINAL_STATUSES = new Set([
  'not_started',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'killed',
  'orphaned',
]);
const GIT_STATUSES = new Set([
  'not_requested',
  'committed',
  'failed',
  'reverted',
  'in_doubt',
]);
const ROLLBACK_STATUSES = new Set(['not_required', 'pending', 'succeeded', 'failed']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const WORKSPACE_REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_BRANCH_PATTERN = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,247}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,63}$/;
const SIGNAL_PATTERN = /^SIG[A-Z0-9]{1,31}$/;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen, depth) {
  if (depth > 32) throw new TypeError('m2-execution-canonical:too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('m2-execution-canonical:invalid-number');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('m2-execution-canonical:unsupported-value');
  }

  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    const fields = Object.keys(value)
      .map(original => ({ original, normalized: original.normalize('NFC') }))
      .sort((left, right) => compareUtf8(left.normalized, right.normalized));
    for (let index = 1; index < fields.length; index += 1) {
      if (fields[index - 1].normalized === fields[index].normalized) {
        seen.delete(value);
        throw new TypeError('m2-execution-canonical:normalized-key-collision');
      }
    }
    encoded = `{${fields.map(({ original, normalized }) => (
      `${JSON.stringify(normalized)}:${canonicalize(value[original], seen, depth + 1)}`
    )).join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('m2-execution-canonical:unsupported-object');
  }
  seen.delete(value);
  return encoded;
}

export function canonicalizeM2ExecutionValue(value) {
  return canonicalize(value, new Set(), 0);
}

export function normalizeM2ExecutionValue(value) {
  return JSON.parse(canonicalizeM2ExecutionValue(value));
}

export function computeM2ExecutionValueDigest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function isNfcString(value) {
  return typeof value === 'string' && value === value.normalize('NFC');
}

function isNonEmptyNfcString(value, maximum = 4096) {
  return isNfcString(value) && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= maximum;
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isWorkspaceRevision(value) {
  return typeof value === 'string' && WORKSPACE_REVISION_PATTERN.test(value);
}

function isGitObject(value) {
  return typeof value === 'string' && GIT_OBJECT_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function isCanonicalAbsolute(value) {
  return isNonEmptyNfcString(value)
    && !value.includes('\\')
    && !value.includes('\0')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && (value === '/' || !value.endsWith('/'));
}

export function isM2ExecutionProjectRelativePath(value) {
  if (
    !isNonEmptyNfcString(value)
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.isAbsolute(value)
    || value.endsWith('/')
  ) return false;
  const segments = value.split('/');
  return path.posix.normalize(value) === value
    && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function validateSortedUniqueStrings(value, context, validator = isNonEmptyNfcString) {
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const errors = [];
  value.forEach((item, index) => {
    if (!validator(item)) errors.push(`${context}[${index}]:invalid`);
  });
  for (let index = 1; index < value.length; index += 1) {
    if (
      typeof value[index - 1] === 'string'
      && typeof value[index] === 'string'
      && compareUtf8(value[index - 1], value[index]) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateActor(value) {
  const context = 'project-change-request.actor';
  const errors = validateExactKeys(value, ['type', 'id'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'user') errors.push(`${context}:user-required`);
  if (!isIdentifier(value.id)) errors.push(`${context}:invalid-id`);
  return errors;
}

function validateOrigin(value) {
  const context = 'project-change-request.origin';
  const errors = validateExactKeys(
    value,
    ['surface', 'sessionId', 'conversationId', 'projectId'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!['http', 'ws', 'studio', 'skill', 'lifecycle'].includes(value.surface)) {
    errors.push(`${context}:invalid-surface`);
  }
  for (const key of ['sessionId', 'conversationId']) {
    if (!(value[key] === null || isIdentifier(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  return errors;
}

function validateProject(value, origin) {
  const context = 'project-change-request.project';
  const errors = validateExactKeys(value, [
    'projectId',
    'canonicalRoot',
    'workspaceRevision',
    'gitHead',
    'gitBranchRef',
    'foreignDirtDigest',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (value.projectId !== origin?.projectId) errors.push(`${context}:projectId-origin-mismatch`);
  if (!isCanonicalAbsolute(value.canonicalRoot)) errors.push(`${context}:invalid-canonicalRoot`);
  if (!isWorkspaceRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (!isGitObject(value.gitHead)) errors.push(`${context}:invalid-gitHead`);
  if (typeof value.gitBranchRef !== 'string' || !GIT_BRANCH_PATTERN.test(value.gitBranchRef)) {
    errors.push(`${context}:invalid-gitBranchRef`);
  }
  if (!isDigest(value.foreignDirtDigest)) errors.push(`${context}:invalid-foreignDirtDigest`);
  return errors;
}

function validateFileImage(value, context, before) {
  const required = before
    ? ['exists', 'digest', 'bytes', 'mode']
    : ['digest', 'bytes', 'mode'];
  const errors = validateExactKeys(value, required, [], context);
  if (!isPlainRecord(value)) return errors;
  if (before && typeof value.exists !== 'boolean') errors.push(`${context}:invalid-exists`);
  const exists = before ? value.exists : true;
  if (exists) {
    if (!isDigest(value.digest)) errors.push(`${context}:invalid-digest`);
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > M2_EXECUTION_LIMITS.MAX_FILE_BYTES) {
      errors.push(`${context}:invalid-bytes`);
    }
    if (!Number.isSafeInteger(value.mode) || value.mode < 0 || value.mode > 0o777) {
      errors.push(`${context}:invalid-mode`);
    }
  } else {
    if (value.digest !== null) errors.push(`${context}:digest-on-absent`);
    if (value.bytes !== 0) errors.push(`${context}:bytes-on-absent`);
    if (value.mode !== null) errors.push(`${context}:mode-on-absent`);
  }
  return errors;
}

function validateAuthorityBinding(value, context) {
  const errors = validateExactKeys(value, ['effectId', 'requestDigest'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isIdentifier(value.effectId)) errors.push(`${context}:invalid-effectId`);
  if (!isDigest(value.requestDigest)) errors.push(`${context}:invalid-requestDigest`);
  return errors;
}

function validateChange(value, index) {
  const context = `project-change-request.changes[${index}]`;
  const errors = validateExactKeys(value, [
    'path', 'before', 'after', 'forwardAuthority', 'rollbackAuthority',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isM2ExecutionProjectRelativePath(value.path)) errors.push(`${context}:invalid-path`);
  errors.push(...validateFileImage(value.before, `${context}.before`, true));
  errors.push(...validateFileImage(value.after, `${context}.after`, false));
  errors.push(...validateAuthorityBinding(value.forwardAuthority, `${context}.forwardAuthority`));
  errors.push(...validateAuthorityBinding(value.rollbackAuthority, `${context}.rollbackAuthority`));
  if (value.forwardAuthority?.effectId === value.rollbackAuthority?.effectId) {
    errors.push(`${context}:authority-reused`);
  }
  if (value.before?.exists === true && value.before.mode !== value.after?.mode) {
    errors.push(`${context}:mode-not-preserved`);
  }
  if (
    value.before?.exists === true
    && value.before.digest === value.after?.digest
    && value.before.bytes === value.after?.bytes
  ) errors.push(`${context}:no-op-change`);
  return errors;
}

function validateFocusedTest(value, canonicalRoot) {
  const context = 'project-change-request.focusedTest';
  const errors = validateExactKeys(value, [
    'authority', 'binary', 'argv', 'argvDigest', 'canonicalCwd',
    'environmentDigest', 'timeoutMs', 'expectedExitCode', 'sandboxProfile',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateAuthorityBinding(value.authority, `${context}.authority`));
  if (!isCanonicalAbsolute(value.binary)) errors.push(`${context}:invalid-binary`);
  if (
    !Array.isArray(value.argv)
    || value.argv.length > 128
    || value.argv.some(argument => !isNfcString(argument) || Buffer.byteLength(argument, 'utf8') > 4096)
    || Buffer.byteLength(canonicalizeM2ExecutionValue(value.argv), 'utf8') > 65_536
  ) errors.push(`${context}:invalid-argv`);
  if (!isDigest(value.argvDigest)) {
    errors.push(`${context}:invalid-argvDigest`);
  } else if (Array.isArray(value.argv) && computeM2ExecutionValueDigest(value.argv) !== value.argvDigest) {
    errors.push(`${context}:argvDigest-mismatch`);
  }
  if (!isCanonicalAbsolute(value.canonicalCwd)) errors.push(`${context}:invalid-canonicalCwd`);
  if (value.canonicalCwd !== canonicalRoot) errors.push(`${context}:cwd-root-mismatch`);
  if (!isDigest(value.environmentDigest)) errors.push(`${context}:invalid-environmentDigest`);
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000) {
    errors.push(`${context}:invalid-timeoutMs`);
  }
  if (value.expectedExitCode !== 0) errors.push(`${context}:zero-exit-required`);
  if (value.sandboxProfile !== 'linux-bwrap-ro-v2') errors.push(`${context}:invalid-sandboxProfile`);
  return errors;
}

function validateGitCommit(value, project) {
  if (value === null) return [];
  const context = 'project-change-request.gitCommit';
  const errors = validateExactKeys(value, [
    'authority', 'expectedHead', 'branchRef', 'paths', 'messageDigest', 'identityDigest',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateAuthorityBinding(value.authority, `${context}.authority`));
  if (!isGitObject(value.expectedHead)) errors.push(`${context}:invalid-expectedHead`);
  if (value.expectedHead !== project?.gitHead) errors.push(`${context}:head-mismatch`);
  if (typeof value.branchRef !== 'string' || !GIT_BRANCH_PATTERN.test(value.branchRef)) {
    errors.push(`${context}:invalid-branchRef`);
  }
  if (value.branchRef !== project?.gitBranchRef) errors.push(`${context}:branch-mismatch`);
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ExecutionProjectRelativePath));
  if (value.paths?.length === 0) errors.push(`${context}.paths:empty`);
  if (!isDigest(value.messageDigest)) errors.push(`${context}:invalid-messageDigest`);
  if (!isDigest(value.identityDigest)) errors.push(`${context}:invalid-identityDigest`);
  return errors;
}

function patchSetProjection(changes) {
  return changes.map(change => ({
    path: change.path,
    before: change.before,
    after: change.after,
  }));
}

export function computeM2ProjectChangePatchSetDigest(changes) {
  if (!Array.isArray(changes)) throw new TypeError('m2-execution-patch-set:invalid-changes');
  return computeM2ExecutionValueDigest(patchSetProjection(changes));
}

export function deriveM2ProjectChangeAuthoritySet(request) {
  if (!isPlainRecord(request) || !Array.isArray(request.changes)) {
    throw new TypeError('m2-execution-authority-set:invalid-request');
  }
  const set = [];
  request.changes.forEach(change => {
    set.push({
      role: 'change.forward',
      path: change.path,
      kind: 'fs.write',
      effectId: change.forwardAuthority?.effectId,
      requestDigest: change.forwardAuthority?.requestDigest,
    });
    set.push({
      role: 'change.rollback',
      path: change.path,
      kind: change.before?.exists === true ? 'fs.write' : 'fs.delete',
      effectId: change.rollbackAuthority?.effectId,
      requestDigest: change.rollbackAuthority?.requestDigest,
    });
  });
  set.push({
    role: 'focused-test',
    path: null,
    kind: 'process.exec',
    effectId: request.focusedTest?.authority?.effectId,
    requestDigest: request.focusedTest?.authority?.requestDigest,
  });
  if (request.gitCommit !== null) {
    set.push({
      role: 'git-commit',
      path: null,
      kind: 'git.commit',
      effectId: request.gitCommit?.authority?.effectId,
      requestDigest: request.gitCommit?.authority?.requestDigest,
    });
  }
  return Object.freeze(set.map(item => Object.freeze(item)));
}

export function computeM2ProjectChangeAuthoritySetDigest(request) {
  return computeM2ExecutionValueDigest(deriveM2ProjectChangeAuthoritySet(request));
}

export function validateM2ProjectChangeRequest(value) {
  const context = 'project-change-request';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'executionId', 'runId', 'actor', 'origin', 'project',
    'patchSetDigest', 'changes', 'focusedTest', 'gitCommit', 'authoritySetDigest', 'createdAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_EXECUTION_CONTRACT_KIND.REQUEST) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_EXECUTION_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['executionId', 'runId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  errors.push(...validateActor(value.actor));
  errors.push(...validateOrigin(value.origin));
  errors.push(...validateProject(value.project, value.origin));
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > M2_EXECUTION_LIMITS.MAX_CHANGES) {
    errors.push(`${context}:invalid-change-count`);
  } else {
    value.changes.forEach((change, index) => errors.push(...validateChange(change, index)));
    const paths = value.changes.map(change => change?.path);
    errors.push(...validateSortedUniqueStrings(paths, `${context}.changes.paths`, isM2ExecutionProjectRelativePath));
    const totalBytes = value.changes.reduce(
      (sum, change) => sum + (Number.isSafeInteger(change?.after?.bytes) ? change.after.bytes : 0),
      0,
    );
    if (totalBytes > M2_EXECUTION_LIMITS.MAX_TOTAL_AFTER_BYTES) errors.push(`${context}:after-bytes-exceed-total-limit`);
    if (!isDigest(value.patchSetDigest)) {
      errors.push(`${context}:invalid-patchSetDigest`);
    } else {
      try {
        if (computeM2ProjectChangePatchSetDigest(value.changes) !== value.patchSetDigest) {
          errors.push(`${context}:patchSetDigest-mismatch`);
        }
      } catch {
        errors.push(`${context}:invalid-patch-set-canonical-form`);
      }
    }
    if (value.gitCommit !== null) {
      const gitPaths = value.gitCommit?.paths;
      if (
        Array.isArray(gitPaths)
        && (gitPaths.length !== paths.length || gitPaths.some((entry, index) => entry !== paths[index]))
      ) errors.push(`${context}:git-paths-incomplete`);
    }
  }
  errors.push(...validateFocusedTest(value.focusedTest, value.project?.canonicalRoot));
  errors.push(...validateGitCommit(value.gitCommit, value.project));
  if (!isDigest(value.authoritySetDigest)) {
    errors.push(`${context}:invalid-authoritySetDigest`);
  } else {
    try {
      const authoritySet = deriveM2ProjectChangeAuthoritySet(value);
      const effectIds = authoritySet.map(item => item.effectId);
      if (new Set(effectIds).size !== effectIds.length) errors.push(`${context}:authority-effect-reused`);
      if (authoritySet.some(item => !isIdentifier(item.effectId) || !isDigest(item.requestDigest))) {
        errors.push(`${context}:authority-set-incomplete`);
      }
      if (computeM2ProjectChangeAuthoritySetDigest(value) !== value.authoritySetDigest) {
        errors.push(`${context}:authoritySetDigest-mismatch`);
      }
    } catch {
      errors.push(`${context}:invalid-authority-set-canonical-form`);
    }
  }
  if (!isCanonicalTimestamp(value.createdAt)) errors.push(`${context}:invalid-createdAt`);
  return validationResult(errors, value);
}

function validateChangesResult(value) {
  const context = 'project-change-result.changes';
  const errors = validateExactKeys(
    value,
    ['paths', 'beforeRevision', 'afterRevision', 'diffDigest'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ExecutionProjectRelativePath));
  if (!isWorkspaceRevision(value.beforeRevision)) errors.push(`${context}:invalid-beforeRevision`);
  if (!(value.afterRevision === null || isWorkspaceRevision(value.afterRevision))) {
    errors.push(`${context}:invalid-afterRevision`);
  }
  if (!(value.diffDigest === null || isDigest(value.diffDigest))) errors.push(`${context}:invalid-diffDigest`);
  return errors;
}

function validateFocusedTestResult(value) {
  const context = 'project-change-result.focusedTest';
  const errors = validateExactKeys(value, [
    'effectId', 'terminalStatus', 'exitCode', 'signal',
    'stdoutDigest', 'stderrDigest', 'outputTruncated',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isIdentifier(value.effectId)) errors.push(`${context}:invalid-effectId`);
  if (!CHILD_TERMINAL_STATUSES.has(value.terminalStatus)) errors.push(`${context}:invalid-terminalStatus`);
  if (!(value.exitCode === null || (Number.isSafeInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255))) {
    errors.push(`${context}:invalid-exitCode`);
  }
  if (!(value.signal === null || (typeof value.signal === 'string' && SIGNAL_PATTERN.test(value.signal)))) {
    errors.push(`${context}:invalid-signal`);
  }
  for (const key of ['stdoutDigest', 'stderrDigest']) {
    if (!(value[key] === null || isDigest(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (typeof value.outputTruncated !== 'boolean') errors.push(`${context}:invalid-outputTruncated`);
  if (value.terminalStatus === 'not_started' && (
    value.exitCode !== null
    || value.signal !== null
    || value.stdoutDigest !== null
    || value.stderrDigest !== null
    || value.outputTruncated !== false
  )) errors.push(`${context}:evidence-on-not-started`);
  if (value.terminalStatus === 'succeeded' && (
    value.exitCode !== 0
    || value.signal !== null
    || !isDigest(value.stdoutDigest)
    || !isDigest(value.stderrDigest)
  )) errors.push(`${context}:invalid-success-evidence`);
  return errors;
}

function validateGitResult(value) {
  const context = 'project-change-result.git';
  const errors = validateExactKeys(
    value,
    ['status', 'beforeHead', 'afterHead', 'commitId', 'foreignDirtPreserved'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!GIT_STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  for (const key of ['beforeHead', 'afterHead', 'commitId']) {
    if (!(value[key] === null || isGitObject(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (typeof value.foreignDirtPreserved !== 'boolean') errors.push(`${context}:invalid-foreignDirtPreserved`);
  if (value.status === 'not_requested' && (
    !isGitObject(value.beforeHead)
    || value.afterHead !== value.beforeHead
    || value.commitId !== null
  )) errors.push(`${context}:invalid-not-requested-evidence`);
  if (value.status === 'committed' && (
    !isGitObject(value.beforeHead)
    || !isGitObject(value.afterHead)
    || value.commitId !== value.afterHead
    || value.beforeHead === value.afterHead
  )) errors.push(`${context}:invalid-commit-evidence`);
  return errors;
}

function validateRollbackResult(value) {
  const context = 'project-change-result.rollback';
  const errors = validateExactKeys(value, ['required', 'status', 'paths', 'evidenceRef'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (typeof value.required !== 'boolean') errors.push(`${context}:invalid-required`);
  if (!ROLLBACK_STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ExecutionProjectRelativePath));
  if (!(value.evidenceRef === null || isNonEmptyNfcString(value.evidenceRef))) {
    errors.push(`${context}:invalid-evidenceRef`);
  }
  if (value.required === false && (
    value.status !== 'not_required'
    || value.paths?.length !== 0
    || value.evidenceRef !== null
  )) errors.push(`${context}:unexpected-rollback`);
  if (value.required === true && (
    !['succeeded', 'failed'].includes(value.status)
    || value.paths?.length === 0
    || !isNonEmptyNfcString(value.evidenceRef)
  )) errors.push(`${context}:incomplete-rollback`);
  if (value.status === 'pending') errors.push(`${context}:pending-on-terminal-result`);
  return errors;
}

export function validateM2ProjectChangeResult(value) {
  const context = 'project-change-result';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'executionId', 'requestDigest', 'runId', 'projectId',
    'terminalStatus', 'fencingGeneration', 'startedAt', 'completedAt',
    'changes', 'focusedTest', 'git', 'rollback', 'errorCode', 'evidenceRefs',
    'lateCompletionRejected',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_EXECUTION_CONTRACT_KIND.RESULT) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_EXECUTION_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['executionId', 'runId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isDigest(value.requestDigest)) errors.push(`${context}:invalid-requestDigest`);
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) errors.push(`${context}:invalid-projectId`);
  if (!TERMINAL_STATUSES.has(value.terminalStatus)) errors.push(`${context}:invalid-terminalStatus`);
  if (!Number.isSafeInteger(value.fencingGeneration) || value.fencingGeneration < 1) {
    errors.push(`${context}:invalid-fencingGeneration`);
  }
  if (!isCanonicalTimestamp(value.startedAt)) errors.push(`${context}:invalid-startedAt`);
  if (!isCanonicalTimestamp(value.completedAt)) errors.push(`${context}:invalid-completedAt`);
  if (
    isCanonicalTimestamp(value.startedAt)
    && isCanonicalTimestamp(value.completedAt)
    && Date.parse(value.completedAt) < Date.parse(value.startedAt)
  ) errors.push(`${context}:time-order`);
  errors.push(...validateChangesResult(value.changes));
  errors.push(...validateFocusedTestResult(value.focusedTest));
  errors.push(...validateGitResult(value.git));
  errors.push(...validateRollbackResult(value.rollback));
  if (!(value.errorCode === null || (typeof value.errorCode === 'string' && ERROR_CODE_PATTERN.test(value.errorCode)))) {
    errors.push(`${context}:invalid-errorCode`);
  }
  errors.push(...validateSortedUniqueStrings(value.evidenceRefs, `${context}.evidenceRefs`));
  if (value.evidenceRefs?.length > 64) errors.push(`${context}:too-many-evidenceRefs`);
  if (typeof value.lateCompletionRejected !== 'boolean') errors.push(`${context}:invalid-lateCompletionRejected`);

  if (value.terminalStatus === M2_EXECUTION_TERMINAL_STATUS.SUCCEEDED) {
    if (value.errorCode !== null) errors.push(`${context}:error-on-success`);
    if (value.changes?.paths?.length < 1 || !isWorkspaceRevision(value.changes?.afterRevision) || !isDigest(value.changes?.diffDigest)) {
      errors.push(`${context}:incomplete-success-change-evidence`);
    }
    if (value.focusedTest?.terminalStatus !== 'succeeded' || value.focusedTest?.exitCode !== 0) {
      errors.push(`${context}:focused-test-not-successful`);
    }
    if (!['not_requested', 'committed'].includes(value.git?.status) || value.git?.foreignDirtPreserved !== true) {
      errors.push(`${context}:git-not-successful`);
    }
    if (value.rollback?.required !== false || value.rollback?.status !== 'not_required') {
      errors.push(`${context}:rollback-on-success`);
    }
    if (value.lateCompletionRejected !== false) errors.push(`${context}:late-completion-on-success`);
  } else if (value.errorCode === null) {
    errors.push(`${context}:missing-errorCode`);
  }
  return validationResult(errors, value);
}

export function computeM2ProjectChangeRequestDigest(value) {
  const result = validateM2ProjectChangeRequest(value);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return computeM2ExecutionValueDigest(value);
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

export function validateM2ProjectChangeResultForRequest(request, result) {
  const errors = [];
  const requestValidation = validateM2ProjectChangeRequest(request);
  const resultValidation = validateM2ProjectChangeResult(result);
  errors.push(...requestValidation.errors, ...resultValidation.errors);
  if (!requestValidation.valid || !resultValidation.valid) return validationResult(errors, result);

  if (
    result.executionId !== request.executionId
    || result.runId !== request.runId
    || result.projectId !== request.project.projectId
    || result.requestDigest !== computeM2ProjectChangeRequestDigest(request)
  ) errors.push('project-change-result:request-identity-mismatch');
  if (result.changes.beforeRevision !== request.project.workspaceRevision) {
    errors.push('project-change-result:before-revision-mismatch');
  }
  const requestedPaths = request.changes.map(change => change.path);
  if (result.changes.paths.some(candidate => !requestedPaths.includes(candidate))) {
    errors.push('project-change-result:foreign-change-path');
  }
  if (result.rollback.paths.some(candidate => !requestedPaths.includes(candidate))) {
    errors.push('project-change-result:foreign-rollback-path');
  }
  if (result.focusedTest.effectId !== request.focusedTest.authority.effectId) {
    errors.push('project-change-result:focused-test-effect-mismatch');
  }
  if (result.focusedTest.terminalStatus === 'succeeded'
    && result.focusedTest.exitCode !== request.focusedTest.expectedExitCode) {
    errors.push('project-change-result:focused-test-exit-mismatch');
  }
  if (result.git.beforeHead !== request.project.gitHead) {
    errors.push('project-change-result:git-before-head-mismatch');
  }

  if (request.gitCommit === null) {
    if (result.git.status !== 'not_requested' || result.git.commitId !== null) {
      errors.push('project-change-result:unexpected-git-commit');
    }
  } else if (result.terminalStatus === M2_EXECUTION_TERMINAL_STATUS.SUCCEEDED
    && result.git.status !== 'committed') {
    errors.push('project-change-result:required-git-commit-missing');
  }

  if (result.terminalStatus === M2_EXECUTION_TERMINAL_STATUS.SUCCEEDED) {
    if (!arraysEqual(result.changes.paths, requestedPaths)) {
      errors.push('project-change-result:success-paths-incomplete');
    }
    if (request.gitCommit === null && result.git.afterHead !== request.project.gitHead) {
      errors.push('project-change-result:head-changed-without-commit');
    }
    if (request.gitCommit !== null && (
      result.git.commitId !== result.git.afterHead
      || result.git.afterHead === request.gitCommit.expectedHead
    )) errors.push('project-change-result:invalid-required-commit-evidence');
  }
  return validationResult(errors, result);
}

export function validateM2ExecutionContract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m2-execution:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) {
    return validationResult(['m2-execution:unexpected-contract'], value);
  }
  if (value.contract === M2_EXECUTION_CONTRACT_KIND.REQUEST) {
    return validateM2ProjectChangeRequest(value);
  }
  if (value.contract === M2_EXECUTION_CONTRACT_KIND.RESULT) {
    return validateM2ProjectChangeResult(value);
  }
  return validationResult(['m2-execution:unknown-contract'], value);
}

export function encodeM2ExecutionContract(value, expectedContract = null) {
  const result = validateM2ExecutionContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Buffer.from(canonicalizeM2ExecutionValue(value), 'utf8');
}

export function decodeM2ExecutionContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) {
    throw new TypeError('m2-execution-decode:invalid-bytes');
  }
  const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
  if (bytes.length === 0 || bytes.length > M2_EXECUTION_LIMITS.MAX_WIRE_BYTES) {
    throw new TypeError('m2-execution-decode:invalid-size');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-execution-decode:invalid-utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('m2-execution-decode:invalid-json');
  }
  const result = validateM2ExecutionContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  if (!Buffer.from(canonicalizeM2ExecutionValue(value), 'utf8').equals(bytes)) {
    throw new TypeError('m2-execution-decode:non-canonical-encoding');
  }
  return Object.freeze(value);
}

export const _testInternals = Object.freeze({
  compareUtf8,
  isCanonicalAbsolute,
  isCanonicalTimestamp,
  isDigest,
  isGitObject,
  patchSetProjection,
});

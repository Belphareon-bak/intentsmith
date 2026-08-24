import { createHash } from 'node:crypto';
import path from 'node:path';
import { isIP } from 'node:net';

export const M2_EFFECT_CONTRACT_VERSION = 1;
export const M2_EFFECT_CONTRACT_STAGE = 'CANDIDATE_V1';

export const M2_EFFECT_CONTRACT_KIND = Object.freeze({
  EFFECT_REQUEST: 'EffectRequest',
  EFFECT_RESULT: 'EffectResult',
  APPROVAL_GRANT: 'ApprovalGrant',
});

export const EFFECT_KINDS = Object.freeze([
  'fs.read',
  'fs.write',
  'fs.delete',
  'process.exec',
  'network.request',
  'git.commit',
  'git.push',
]);

export const EFFECT_TERMINAL_STATUSES = Object.freeze([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'killed',
  'orphaned',
]);

const ACTOR_TYPES = Object.freeze(['user', 'system', 'model', 'specialist']);
const ORIGIN_SURFACES = Object.freeze(['http', 'ws', 'studio', 'skill', 'lifecycle']);
const ROLLBACK_STATUSES = Object.freeze([
  'not_required',
  'pending',
  'succeeded',
  'failed',
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,63}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RISK_BY_KIND = Object.freeze({
  'fs.read': 'read',
  'fs.write': 'write',
  'fs.delete': 'destructive',
  'process.exec': 'exec',
  'network.request': 'network',
  'git.commit': 'write',
  'git.push': 'network',
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateExactKeys(value, required, optional, context) {
  if (!isPlainRecord(value)) return [`${context}:not-object`];
  const allowed = new Set([...required, ...optional]);
  const errors = [];
  for (const key of required) {
    if (!hasOwn(value, key)) errors.push(`${context}:missing-${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${context}:unknown-${key}`);
  }
  return errors;
}

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isProjectId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value, maximum = 1024) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

export function timestampToMs(value) {
  if (!isCanonicalTimestamp(value)) throw new TypeError('m2-effect:invalid-timestamp');
  return Date.parse(value);
}

function isCanonicalAbsolute(candidate) {
  return typeof candidate === 'string'
    && path.isAbsolute(candidate)
    && path.normalize(candidate) === candidate;
}

export function isM2ProjectRelativePath(candidate) {
  if (
    !isNonEmptyString(candidate, 4096)
    || path.isAbsolute(candidate)
    || candidate.includes('\\')
    || candidate.includes('\0')
    || candidate.endsWith('/')
  ) {
    return false;
  }
  const normalized = path.posix.normalize(candidate);
  return normalized === candidate
    && normalized !== '.'
    && normalized !== '..'
    && !normalized.startsWith('../');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function validateSortedUniqueStrings(value, context, validator = isNonEmptyString) {
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const errors = [];
  value.forEach((item, index) => {
    if (!validator(item)) errors.push(`${context}[${index}]:invalid`);
  });
  for (let index = 1; index < value.length; index += 1) {
    if (
      typeof value[index - 1] === 'string'
      && typeof value[index] === 'string'
      && Buffer.compare(Buffer.from(value[index - 1]), Buffer.from(value[index])) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateActor(value, context = 'effect-request.actor') {
  const errors = validateExactKeys(value, ['type', 'id'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!ACTOR_TYPES.includes(value.type)) errors.push(`${context}:invalid-type`);
  if (!isIdentifier(value.id)) errors.push(`${context}:invalid-id`);
  return errors;
}

function validateOrigin(value) {
  const context = 'effect-request.origin';
  const errors = validateExactKeys(
    value,
    ['surface', 'sessionId', 'conversationId', 'projectId'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!ORIGIN_SURFACES.includes(value.surface)) errors.push(`${context}:invalid-surface`);
  for (const key of ['sessionId', 'conversationId']) {
    if (!(value[key] === null || isIdentifier(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  return errors;
}

function validateFilesystemTarget(value) {
  const context = 'effect-request.target';
  const errors = validateExactKeys(
    value,
    ['type', 'canonicalRoot', 'relativePath', 'resolvedRealpath'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'filesystem') errors.push(`${context}:invalid-type`);
  if (!isCanonicalAbsolute(value.canonicalRoot)) errors.push(`${context}:invalid-canonicalRoot`);
  if (!isM2ProjectRelativePath(value.relativePath)) errors.push(`${context}:invalid-relativePath`);
  if (!isCanonicalAbsolute(value.resolvedRealpath)) errors.push(`${context}:invalid-resolvedRealpath`);
  if (
    isCanonicalAbsolute(value.canonicalRoot)
    && isCanonicalAbsolute(value.resolvedRealpath)
    && !isInside(value.canonicalRoot, value.resolvedRealpath)
  ) errors.push(`${context}:outside-project`);
  if (
    isCanonicalAbsolute(value.canonicalRoot)
    && isM2ProjectRelativePath(value.relativePath)
    && isCanonicalAbsolute(value.resolvedRealpath)
    && path.resolve(value.canonicalRoot, value.relativePath) !== value.resolvedRealpath
  ) errors.push(`${context}:canonical-target-mismatch`);
  return errors;
}

function validateProcessTarget(value) {
  const context = 'effect-request.target';
  const errors = validateExactKeys(
    value,
    ['type', 'binary', 'argv', 'argvDigest', 'canonicalCwd'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'process') errors.push(`${context}:invalid-type`);
  if (!isCanonicalAbsolute(value.binary)) errors.push(`${context}:invalid-binary`);
  if (!Array.isArray(value.argv) || value.argv.some(arg => typeof arg !== 'string')) {
    errors.push(`${context}:invalid-argv`);
  } else if (value.argvDigest !== computeEffectArgvDigest(value.argv)) {
    errors.push(`${context}:argvDigest-mismatch`);
  }
  if (!isDigest(value.argvDigest)) errors.push(`${context}:invalid-argvDigest`);
  if (!isCanonicalAbsolute(value.canonicalCwd)) errors.push(`${context}:invalid-canonicalCwd`);
  return errors;
}

function validateNormalizedHttpUrl(value, context, field = 'url') {
  const errors = [];
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return [`${context}:invalid-${field}`];
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`${context}:invalid-protocol`);
  if (parsed.username || parsed.password) errors.push(`${context}:credentialed-${field}`);
  if (parsed.href !== value) errors.push(`${context}:${field}-not-normalized`);
  return errors;
}

function validateNetworkTarget(value) {
  const context = 'effect-request.target';
  const errors = validateExactKeys(
    value,
    ['type', 'url', 'origin', 'method', 'redirectPolicy', 'dnsPolicy'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'network') errors.push(`${context}:invalid-type`);
  errors.push(...validateNormalizedHttpUrl(value.url, context));
  try {
    if (new URL(value.url).origin !== value.origin) {
      errors.push(`${context}:origin-mismatch`);
    }
  } catch {
    // The URL validator above owns the invalid URL diagnostic.
  }
  if (!isNonEmptyString(value.origin, 4096)) errors.push(`${context}:invalid-origin`);
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method)) {
    errors.push(`${context}:invalid-method`);
  }
  if (!['deny', 'same-origin', 'revalidate'].includes(value.redirectPolicy)) {
    errors.push(`${context}:invalid-redirectPolicy`);
  }
  if (!['public-only', 'loopback-only'].includes(value.dnsPolicy)) {
    errors.push(`${context}:invalid-dnsPolicy`);
  }
  return errors;
}

function validateGitTarget(value, kind, workspaceRevision) {
  const context = 'effect-request.target';
  const errors = validateExactKeys(
    value,
    ['type', 'canonicalRepo', 'paths', 'expectedWorkspaceRevision', 'remote'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'git') errors.push(`${context}:invalid-type`);
  if (!isCanonicalAbsolute(value.canonicalRepo)) errors.push(`${context}:invalid-canonicalRepo`);
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ProjectRelativePath));
  if (value.paths?.length === 0) errors.push(`${context}.paths:empty`);
  if (value.expectedWorkspaceRevision !== workspaceRevision) {
    errors.push(`${context}:workspace-revision-mismatch`);
  }
  if (kind === 'git.commit' && value.remote !== null) errors.push(`${context}:remote-on-commit`);
  if (kind === 'git.push' && !isNonEmptyString(value.remote, 256)) {
    errors.push(`${context}:missing-remote`);
  }
  return errors;
}

function validateTarget(value, kind, workspaceRevision) {
  if (kind?.startsWith('fs.')) return validateFilesystemTarget(value);
  if (kind === 'process.exec') return validateProcessTarget(value);
  if (kind === 'network.request') return validateNetworkTarget(value);
  if (kind?.startsWith('git.')) return validateGitTarget(value, kind, workspaceRevision);
  return ['effect-request.target:unknown-kind'];
}

function validationResult(errors, value) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    value: errors.length === 0 ? value : null,
  });
}

export function validateEffectRequest(value) {
  const context = 'effect-request';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'effectId', 'runId', 'parentEffectId', 'actor', 'origin',
    'kind', 'target', 'payloadDigest', 'workspaceRevision', 'requiredCapability',
    'payloadBytes', 'riskClass', 'timeoutMs', 'idempotencyKey',
    'approvalGrantId', 'createdAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_EFFECT_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['effectId', 'runId', 'idempotencyKey']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!(value.parentEffectId === null || isIdentifier(value.parentEffectId))) {
    errors.push(`${context}:invalid-parentEffectId`);
  }
  if (value.parentEffectId === value.effectId) errors.push(`${context}:self-parent`);
  errors.push(...validateActor(value.actor));
  errors.push(...validateOrigin(value.origin));
  if (!EFFECT_KINDS.includes(value.kind)) errors.push(`${context}:invalid-kind`);
  errors.push(...validateTarget(value.target, value.kind, value.workspaceRevision));
  if (!isDigest(value.payloadDigest)) errors.push(`${context}:invalid-payloadDigest`);
  if (!Number.isSafeInteger(value.payloadBytes) || value.payloadBytes < 0) {
    errors.push(`${context}:invalid-payloadBytes`);
  }
  if (!isNonEmptyString(value.workspaceRevision, 256)) errors.push(`${context}:invalid-workspaceRevision`);
  if (typeof value.requiredCapability !== 'string' || !CAPABILITY_PATTERN.test(value.requiredCapability)) {
    errors.push(`${context}:invalid-requiredCapability`);
  }
  if (RISK_BY_KIND[value.kind] !== value.riskClass) errors.push(`${context}:risk-kind-mismatch`);
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 86_400_000) {
    errors.push(`${context}:invalid-timeoutMs`);
  }
  if (!(value.approvalGrantId === null || isIdentifier(value.approvalGrantId))) {
    errors.push(`${context}:invalid-approvalGrantId`);
  }
  if (!isCanonicalTimestamp(value.createdAt)) errors.push(`${context}:invalid-createdAt`);
  return validationResult(errors, value);
}

function validateProcessResult(value) {
  const context = 'effect-result.process';
  const errors = validateExactKeys(
    value,
    ['pid', 'processGroupId', 'startIdentity', 'exitCode', 'signal'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  for (const key of ['pid', 'processGroupId', 'exitCode']) {
    if (!(value[key] === null || Number.isSafeInteger(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  for (const key of ['startIdentity', 'signal']) {
    if (!(value[key] === null || isNonEmptyString(value[key], 256))) errors.push(`${context}:invalid-${key}`);
  }
  return errors;
}

function validateChangesResult(value) {
  const context = 'effect-result.changes';
  const errors = validateExactKeys(
    value,
    ['paths', 'beforeDigest', 'afterDigest', 'diffArtifact'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ProjectRelativePath));
  for (const key of ['beforeDigest', 'afterDigest']) {
    if (!(value[key] === null || isDigest(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (!(value.diffArtifact === null || isNonEmptyString(value.diffArtifact, 4096))) {
    errors.push(`${context}:invalid-diffArtifact`);
  }
  return errors;
}

function validateNetworkResult(value) {
  const context = 'effect-result.network';
  const errors = validateExactKeys(
    value,
    ['resolvedAddresses', 'finalUrl', 'status', 'bytes'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateSortedUniqueStrings(
    value.resolvedAddresses,
    `${context}.resolvedAddresses`,
    candidate => typeof candidate === 'string' && isIP(candidate) !== 0,
  ));
  if (value.finalUrl !== null) {
    errors.push(...validateNormalizedHttpUrl(value.finalUrl, context, 'finalUrl'));
  }
  if (!(value.status === null || (Number.isSafeInteger(value.status) && value.status >= 100 && value.status <= 599))) {
    errors.push(`${context}:invalid-status`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) errors.push(`${context}:invalid-bytes`);
  return errors;
}

function validateRollbackResult(value) {
  const context = 'effect-result.rollback';
  const errors = validateExactKeys(value, ['required', 'status', 'evidenceRef'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (typeof value.required !== 'boolean') errors.push(`${context}:invalid-required`);
  if (!ROLLBACK_STATUSES.includes(value.status)) errors.push(`${context}:invalid-status`);
  if (value.required === false && value.status !== 'not_required') errors.push(`${context}:unexpected-status`);
  if (value.required === true && value.status === 'not_required') errors.push(`${context}:missing-status`);
  if (!(value.evidenceRef === null || isNonEmptyString(value.evidenceRef, 4096))) {
    errors.push(`${context}:invalid-evidenceRef`);
  }
  return errors;
}

export function validateEffectResult(value) {
  const context = 'effect-result';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'effectId', 'runId', 'projectId', 'requestDigest',
    'approvalGrantId', 'terminalStatus', 'startedAt', 'completedAt',
    'process', 'changes', 'network', 'rollback', 'outputDigest', 'errorCode',
    'evidenceRefs', 'lateCompletionRejected',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_EFFECT_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!isIdentifier(value.effectId)) errors.push(`${context}:invalid-effectId`);
  if (!isIdentifier(value.runId)) errors.push(`${context}:invalid-runId`);
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!isDigest(value.requestDigest)) errors.push(`${context}:invalid-requestDigest`);
  if (!isIdentifier(value.approvalGrantId)) {
    errors.push(`${context}:invalid-approvalGrantId`);
  }
  if (!EFFECT_TERMINAL_STATUSES.includes(value.terminalStatus)) errors.push(`${context}:invalid-terminalStatus`);
  if (!isCanonicalTimestamp(value.startedAt)) errors.push(`${context}:invalid-startedAt`);
  if (!isCanonicalTimestamp(value.completedAt)) errors.push(`${context}:invalid-completedAt`);
  if (isCanonicalTimestamp(value.startedAt) && isCanonicalTimestamp(value.completedAt)
    && timestampToMs(value.completedAt) < timestampToMs(value.startedAt)) {
    errors.push(`${context}:time-order`);
  }
  errors.push(...validateProcessResult(value.process));
  errors.push(...validateChangesResult(value.changes));
  errors.push(...validateNetworkResult(value.network));
  errors.push(...validateRollbackResult(value.rollback));
  if (!(value.outputDigest === null || isDigest(value.outputDigest))) errors.push(`${context}:invalid-outputDigest`);
  if (!(value.errorCode === null || (typeof value.errorCode === 'string' && ERROR_CODE_PATTERN.test(value.errorCode)))) {
    errors.push(`${context}:invalid-errorCode`);
  }
  if (value.terminalStatus === 'succeeded' && value.errorCode !== null) errors.push(`${context}:error-on-success`);
  if (value.terminalStatus !== 'succeeded' && value.errorCode === null) errors.push(`${context}:missing-errorCode`);
  errors.push(...validateSortedUniqueStrings(value.evidenceRefs, `${context}.evidenceRefs`));
  if (typeof value.lateCompletionRejected !== 'boolean') errors.push(`${context}:invalid-lateCompletionRejected`);
  return validationResult(errors, value);
}

/**
 * Validate the terminal evidence against the exact EffectRequest it claims to
 * complete. Generic shape alone is insufficient: a provider returning `{}`
 * must never turn an fs.write into a succeeded authority record.
 */
export function validateEffectResultForRequest(request, result) {
  const errors = [];
  const requestValidation = validateEffectRequest(request);
  const resultValidation = validateEffectResult(result);
  errors.push(...requestValidation.errors, ...resultValidation.errors);
  if (!requestValidation.valid || !resultValidation.valid) {
    return validationResult(errors, result);
  }
  if (
    result.effectId !== request.effectId
    || result.runId !== request.runId
    || result.projectId !== request.origin.projectId
    || result.requestDigest !== computeEffectRequestDigest(request)
  ) errors.push('effect-result:request-identity-mismatch');

  if (result.terminalStatus === 'succeeded' && request.kind === 'fs.write') {
    if (
      result.changes.paths.length !== 1
      || result.changes.paths[0] !== request.target.relativePath
    ) errors.push('effect-result:fs-write-path-evidence-mismatch');
    if (result.changes.afterDigest !== request.payloadDigest) {
      errors.push('effect-result:fs-write-after-digest-mismatch');
    }
    if (result.outputDigest !== request.payloadDigest) {
      errors.push('effect-result:fs-write-output-digest-mismatch');
    }
    if (result.rollback.required !== false || result.rollback.status !== 'not_required') {
      errors.push('effect-result:fs-write-success-rollback-mismatch');
    }
    if (result.changes.diffArtifact !== null) {
      errors.push('effect-result:fs-write-success-diff-artifact-mismatch');
    }
    if (
      result.process.pid !== null
      || result.process.processGroupId !== null
      || result.process.startIdentity !== null
      || result.process.exitCode !== null
      || result.process.signal !== null
    ) errors.push('effect-result:fs-write-success-process-mismatch');
    if (
      result.network.resolvedAddresses.length !== 0
      || result.network.finalUrl !== null
      || result.network.status !== null
      || result.network.bytes !== 0
    ) errors.push('effect-result:fs-write-success-network-mismatch');
    if (result.lateCompletionRejected !== false) {
      errors.push('effect-result:fs-write-success-late-completion-mismatch');
    }
  }
  return validationResult(errors, result);
}

function validateGrantSubject(value) {
  const context = 'approval-grant.subject';
  const errors = validateExactKeys(value, ['actorType', 'actorId'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.actorType !== 'user') errors.push(`${context}:invalid-actorType`);
  if (!isIdentifier(value.actorId)) errors.push(`${context}:invalid-actorId`);
  return errors;
}

function validateGrantScope(value) {
  const context = 'approval-grant.scope';
  const errors = validateExactKeys(
    value,
    [
      'runId', 'projectId', 'effectId', 'kind', 'payloadDigest',
      'payloadBytes', 'workspaceRevision',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  for (const key of ['runId', 'effectId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!EFFECT_KINDS.includes(value.kind)) errors.push(`${context}:invalid-kind`);
  if (!isDigest(value.payloadDigest)) errors.push(`${context}:invalid-payloadDigest`);
  if (!Number.isSafeInteger(value.payloadBytes) || value.payloadBytes < 0) {
    errors.push(`${context}:invalid-payloadBytes`);
  }
  if (!isNonEmptyString(value.workspaceRevision, 256)) errors.push(`${context}:invalid-workspaceRevision`);
  return errors;
}

function validateGrantConstraints(value, scope) {
  const context = 'approval-grant.constraints';
  const errors = validateExactKeys(
    value,
    ['allowedRealpaths', 'allowedBinary', 'allowedArgvDigest', 'allowedOrigin', 'maxBytes'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  errors.push(...validateSortedUniqueStrings(value.allowedRealpaths, `${context}.allowedRealpaths`, isCanonicalAbsolute));
  if (!(value.allowedBinary === null || isCanonicalAbsolute(value.allowedBinary))) {
    errors.push(`${context}:invalid-allowedBinary`);
  }
  if (!(value.allowedArgvDigest === null || isDigest(value.allowedArgvDigest))) {
    errors.push(`${context}:invalid-allowedArgvDigest`);
  }
  if (!(value.allowedOrigin === null || isNonEmptyString(value.allowedOrigin, 4096))) {
    errors.push(`${context}:invalid-allowedOrigin`);
  }
  if (!(value.maxBytes === null || (Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 0))) {
    errors.push(`${context}:invalid-maxBytes`);
  }
  if (Number.isSafeInteger(scope?.payloadBytes) && value.maxBytes !== scope.payloadBytes) {
    errors.push(`${context}:maxBytes-scope-mismatch`);
  }
  return errors;
}

export function validateApprovalGrant(value) {
  const context = 'approval-grant';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'grantId', 'subject', 'scope', 'constraints', 'issuedAt',
    'expiresAt', 'singleUse', 'nonce', 'consumedAt', 'consumedByEffectId',
    'revokedAt', 'revocationReason',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_EFFECT_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!isIdentifier(value.grantId)) errors.push(`${context}:invalid-grantId`);
  errors.push(...validateGrantSubject(value.subject));
  errors.push(...validateGrantScope(value.scope));
  errors.push(...validateGrantConstraints(value.constraints, value.scope));
  if (!isCanonicalTimestamp(value.issuedAt)) errors.push(`${context}:invalid-issuedAt`);
  if (!isCanonicalTimestamp(value.expiresAt)) errors.push(`${context}:invalid-expiresAt`);
  if (isCanonicalTimestamp(value.issuedAt) && isCanonicalTimestamp(value.expiresAt)
    && timestampToMs(value.expiresAt) <= timestampToMs(value.issuedAt)) {
    errors.push(`${context}:invalid-expiry-order`);
  }
  if (value.singleUse !== true) errors.push(`${context}:singleUse-required`);
  if (!isNonEmptyString(value.nonce, 256) || value.nonce.length < 16) errors.push(`${context}:invalid-nonce`);
  const consumed = value.consumedAt !== null || value.consumedByEffectId !== null;
  if (consumed) {
    if (!isCanonicalTimestamp(value.consumedAt)) errors.push(`${context}:invalid-consumedAt`);
    if (!isIdentifier(value.consumedByEffectId)) errors.push(`${context}:invalid-consumedByEffectId`);
    if (value.consumedByEffectId !== value.scope?.effectId) errors.push(`${context}:consumed-effect-mismatch`);
  }
  if ((value.consumedAt === null) !== (value.consumedByEffectId === null)) {
    errors.push(`${context}:partial-consumption`);
  }
  if (
    isCanonicalTimestamp(value.issuedAt)
    && isCanonicalTimestamp(value.expiresAt)
    && isCanonicalTimestamp(value.consumedAt)
    && (
      timestampToMs(value.consumedAt) < timestampToMs(value.issuedAt)
      || timestampToMs(value.consumedAt) >= timestampToMs(value.expiresAt)
    )
  ) errors.push(`${context}:invalid-consumption-time`);
  const revoked = value.revokedAt !== null || value.revocationReason !== null;
  if (revoked) {
    if (!isCanonicalTimestamp(value.revokedAt)) errors.push(`${context}:invalid-revokedAt`);
    if (!isNonEmptyString(value.revocationReason, 1024)) errors.push(`${context}:invalid-revocationReason`);
  }
  if ((value.revokedAt === null) !== (value.revocationReason === null)) {
    errors.push(`${context}:partial-revocation`);
  }
  // A run cancellation is an authority cutoff, not a use of the grant.  It is
  // therefore valid for a defensive revocation to predate a not-yet-valid
  // grant restored from an older database or written by a compromised caller.
  if (consumed && revoked) errors.push(`${context}:consumed-and-revoked`);
  return validationResult(errors, value);
}

const VALIDATORS = Object.freeze({
  [M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST]: validateEffectRequest,
  [M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT]: validateEffectResult,
  [M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT]: validateApprovalGrant,
});

export function validateM2EffectContract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m2-effect:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) {
    return validationResult(['m2-effect:unexpected-contract'], value);
  }
  const validator = VALIDATORS[value.contract];
  if (!validator) return validationResult(['m2-effect:unknown-contract'], value);
  return validator(value);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('m2-effect:non-json-number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) throw new TypeError('m2-effect:non-json-value');
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function computeEffectArgvDigest(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) {
    throw new TypeError('m2-effect:invalid-argv');
  }
  return `sha256:${createHash('sha256').update(canonicalStringify(argv), 'utf8').digest('hex')}`;
}

export function computeEffectRequestDigest(request) {
  const normalized = { ...request, approvalGrantId: null };
  const validation = validateEffectRequest(normalized);
  if (!validation.valid) {
    throw new TypeError(`m2-effect:invalid-request-for-digest:${validation.errors.join(',')}`);
  }
  return `sha256:${createHash('sha256')
    .update(canonicalStringify(normalized), 'utf8')
    .digest('hex')}`;
}

export function encodeM2EffectContract(value, expectedContract = null) {
  const result = validateM2EffectContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return canonicalStringify(value);
}

export function decodeM2EffectContract(encoded, expectedContract = null) {
  if (typeof encoded !== 'string') throw new TypeError('m2-effect:encoded-not-string');
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new TypeError('m2-effect:invalid-json');
  }
  const result = validateM2EffectContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return value;
}

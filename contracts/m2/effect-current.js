import { createHash } from 'node:crypto';
import * as legacy from './effect-v1.js';
import { createM2FileListPolicyPayload, validateM2FileListTarget } from './file-list-snapshot-v1.js';
export * from './effect-v1.js';

// Version 1 remains immutable. Version 2 represents one project-root metadata
// observation only; it does not authorize root file reads, writes or recursion.
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const result = (errors, value) => Object.freeze({ valid: errors.length === 0,
  errors: Object.freeze(errors), value: errors.length === 0 ? value : null });
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const timestamp = value => { try { legacy.timestampToMs(value); return true; } catch { return false; } };

export function validateEffectRequest(value) {
  if (value?.version !== 2) return legacy.validateEffectRequest(value);
  const errors = [];
  if (!exact(value, ['contract','version','effectId','runId','parentEffectId','actor','origin',
    'kind','target','payloadDigest','workspaceRevision','requiredCapability','payloadBytes',
    'riskClass','timeoutMs','idempotencyKey','approvalGrantId','createdAt'])) {
    return result(['effect-request-v2:exact-envelope-required'], value);
  }
  if (value.contract !== 'EffectRequest') errors.push('effect-request-v2:contract');
  for (const key of ['effectId','runId','idempotencyKey']) if (!identifier(value[key])) errors.push(`effect-request-v2:${key}`);
  if (!(value.parentEffectId === null || identifier(value.parentEffectId)) || value.parentEffectId === value.effectId) errors.push('effect-request-v2:parent');
  if (!exact(value.actor, ['type','id']) || value.actor.type !== 'user' || !identifier(value.actor.id)) errors.push('effect-request-v2:actor');
  if (!exact(value.origin, ['surface','sessionId','conversationId','projectId'])
    || !['http','ws','studio','skill','lifecycle'].includes(value.origin.surface)
    || !(value.origin.sessionId === null || identifier(value.origin.sessionId))
    || !identifier(value.origin.conversationId)
    || !Number.isSafeInteger(value.origin.projectId) || value.origin.projectId <= 0) errors.push('effect-request-v2:origin');
  if (value.kind !== 'fs.read' || value.requiredCapability !== 'project.fs.list' || value.riskClass !== 'read'
    || !validateM2FileListTarget(value.target)) errors.push('effect-request-v2:root-list-scope');
  const policy = createM2FileListPolicyPayload();
  if (value.payloadBytes !== policy.length || value.payloadDigest !== digest(policy)) errors.push('effect-request-v2:policy');
  if (!text(value.workspaceRevision, 256)) errors.push('effect-request-v2:revision');
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 86400000) errors.push('effect-request-v2:timeout');
  if (!(value.approvalGrantId === null || identifier(value.approvalGrantId))) errors.push('effect-request-v2:grant');
  if (!timestamp(value.createdAt)) errors.push('effect-request-v2:timestamp');
  return result(errors, value);
}

export function computeEffectRequestDigest(request) {
  if (request?.version !== 2) return legacy.computeEffectRequestDigest(request);
  const normalized = { ...request, approvalGrantId: null };
  const check = validateEffectRequest(normalized);
  if (!check.valid) throw new TypeError(`m2-effect:invalid-request-for-digest:${check.errors.join(',')}`);
  return digest(legacy.canonicalStringify(normalized));
}

export function deriveApprovalGrantConstraints(request) {
  if (request?.version !== 2) return legacy.deriveApprovalGrantConstraints(request);
  if (!validateEffectRequest(request).valid) throw new TypeError('m2-effect:invalid-root-list-request-for-grant');
  return Object.freeze({ allowedRealpaths: Object.freeze([request.target.canonicalRoot]),
    allowedBinary: null, allowedArgvDigest: null, allowedOrigin: null, maxBytes: request.payloadBytes });
}

export function validateApprovalGrantForRequest(request, grant) {
  if (request?.version !== 2) return legacy.validateApprovalGrantForRequest(request, grant);
  const errors = [...validateEffectRequest(request).errors, ...legacy.validateApprovalGrant(grant).errors];
  if (errors.length) return result(errors, grant);
  if (grant.subject.actorType !== 'user' || grant.subject.actorId !== request.actor.id
    || (request.approvalGrantId !== null && request.approvalGrantId !== grant.grantId)
    || grant.scope.runId !== request.runId || grant.scope.projectId !== request.origin.projectId
    || grant.scope.effectId !== request.effectId || grant.scope.kind !== request.kind
    || grant.scope.payloadDigest !== request.payloadDigest || grant.scope.payloadBytes !== request.payloadBytes
    || grant.scope.workspaceRevision !== request.workspaceRevision) errors.push('approval-grant:request-scope-mismatch');
  if (legacy.canonicalStringify(grant.constraints) !== legacy.canonicalStringify(deriveApprovalGrantConstraints(request))) errors.push('approval-grant:request-constraints-mismatch');
  return result(errors, grant);
}

export function validateEffectResultForRequest(request, value) {
  if (request?.version !== 2) return legacy.validateEffectResultForRequest(request, value);
  const errors = [...validateEffectRequest(request).errors, ...legacy.validateEffectResult(value).errors];
  if (errors.length) return result(errors, value);
  if (value.effectId !== request.effectId || value.runId !== request.runId
    || value.projectId !== request.origin.projectId || value.requestDigest !== computeEffectRequestDigest(request)
    || (request.approvalGrantId !== null && value.approvalGrantId !== request.approvalGrantId)) errors.push('effect-result:request-identity-mismatch');
  if (value.evidenceRefs.length === 0) errors.push('effect-result:evidence-refs-empty');
  if (legacy.canonicalStringify(value.process) !== legacy.canonicalStringify({pid:null,processGroupId:null,startIdentity:null,exitCode:null,signal:null})
    || legacy.canonicalStringify(value.changes) !== legacy.canonicalStringify({paths:[],beforeDigest:null,afterDigest:null,diffArtifact:null})
    || legacy.canonicalStringify(value.network) !== legacy.canonicalStringify({resolvedAddresses:[],finalUrl:null,status:null,bytes:0})
    || legacy.canonicalStringify(value.rollback) !== legacy.canonicalStringify({required:false,status:'not_required',evidenceRef:null})
    || value.lateCompletionRejected !== false) errors.push('effect-result:root-list-read-only-evidence');
  if ((value.terminalStatus === 'succeeded') !== (value.outputDigest !== null)) errors.push('effect-result:root-list-output-evidence');
  if (['APPROVAL_GRANT_EXPIRED','APPROVAL_GRANT_REVOKED'].includes(value.errorCode)
    && (value.terminalStatus !== 'cancelled' || value.startedAt !== value.completedAt)) errors.push('effect-result:approval-pre-execution-terminal-mismatch');
  return result(errors, value);
}

export function validateM2EffectContract(value, expectedContract = null) {
  if (value?.contract !== 'EffectRequest' || value?.version !== 2) return legacy.validateM2EffectContract(value, expectedContract);
  if (expectedContract !== null && expectedContract !== 'EffectRequest') return result(['m2-effect:unexpected-contract'], value);
  return validateEffectRequest(value);
}
export function encodeM2EffectContract(value, expectedContract = null) {
  const check = validateM2EffectContract(value, expectedContract);
  if (!check.valid) throw new TypeError(check.errors.join(', '));
  return legacy.canonicalStringify(value);
}
export function decodeM2EffectContract(encoded, expectedContract = null) {
  if (typeof encoded !== 'string') throw new TypeError('m2-effect:encoded-not-string');
  const value = JSON.parse(encoded); encodeM2EffectContract(value, expectedContract); return value;
}

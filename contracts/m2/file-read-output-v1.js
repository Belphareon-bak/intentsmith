import { createHash } from 'node:crypto';
import {
  canonicalStringify, computeEffectRequestDigest,
  validateEffectRequest, validateEffectResultForRequest,
} from './effect-v1.js';

// Request policy and output storage have different digest domains. Only the
// policy is an execution payload; file bytes never enter generic authority JSON.
export const M2_FILE_READ_MAX_BYTES = 1_048_576;
export const M2_FILE_READ_OUTPUT_SCHEMA = 'intentsmith.effect.file-read-output@1';

function reject(reason) {
  throw Object.assign(new TypeError(`Invalid immutable file read: ${reason}`), {
    code: 'EFFECT_FILE_READ_OUTPUT_INVALID',
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function m2FileReadConversationOrigin(conversationId) {
  if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 512) reject('conversation identity');
  return `conversation:${createHash('sha256').update(conversationId, 'utf8').digest('hex')}`;
}

export function m2FileReadBytesDigest(bytes) {
  if (!Buffer.isBuffer(bytes)) reject('bytes must be a Buffer');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function m2FileReadOutputEvidenceRef(effectId) {
  if (typeof effectId !== 'string' || !/^effect:[a-f0-9]{64}$/.test(effectId)) reject('effect identity');
  return `effect:${effectId}:file-read-output-v1`;
}

export function createM2FileReadPolicyPayload(maxOutputBytes = M2_FILE_READ_MAX_BYTES) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1
    || maxOutputBytes > M2_FILE_READ_MAX_BYTES) reject('output byte ceiling');
  return Buffer.from(canonicalStringify({ format: 'bytes@1', maxOutputBytes }), 'utf8');
}

export function parseM2FileReadPolicyPayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length > 128) reject('policy bytes');
  let value;
  try { value = JSON.parse(payload.toString('utf8')); } catch { reject('policy JSON'); }
  if (!exactKeys(value, ['format', 'maxOutputBytes']) || value.format !== 'bytes@1'
    || !createM2FileReadPolicyPayload(value.maxOutputBytes).equals(payload)) reject('canonical policy');
  return Object.freeze(value);
}

export function isM2FileReadOutputRequest(request) {
  if (!validateEffectRequest(request).valid || request.kind !== 'fs.read') return false;
  // New read requests always carry the canonical policy (v1 historical empty
  // payloads remain v1 and cannot acquire an output merely by upgrading code).
  const payload = createM2FileReadPolicyPayload();
  return request.payloadBytes === payload.length
    && request.payloadDigest === m2FileReadBytesDigest(payload);
}

export function createM2FileReadOutputEvidence(request, result, bytes) {
  if (!isM2FileReadOutputRequest(request)
    || !validateEffectResultForRequest(request, result).valid
    || result.terminalStatus !== 'succeeded' || !Buffer.isBuffer(bytes)
    || bytes.length > M2_FILE_READ_MAX_BYTES
    || result.requestDigest !== computeEffectRequestDigest(request)
    || result.outputDigest !== m2FileReadBytesDigest(bytes)
    || !result.evidenceRefs.includes(m2FileReadOutputEvidenceRef(request.effectId))) {
    reject('exact successful request/result/bytes binding');
  }
  return Object.freeze({
    schema: M2_FILE_READ_OUTPUT_SCHEMA,
    effectId: request.effectId,
    projectId: request.origin.projectId,
    requestDigest: result.requestDigest,
    path: request.target.relativePath,
    contentRef: m2FileReadOutputEvidenceRef(request.effectId),
    contentDigest: result.outputDigest,
    byteLength: bytes.length,
    format: 'bytes',
  });
}

export function validateM2FileReadOutputEvidence(request, result, evidence) {
  if (!exactKeys(evidence, ['schema', 'effectId', 'projectId', 'requestDigest',
    'path', 'contentRef', 'contentDigest', 'byteLength', 'format'])) return false;
  return isM2FileReadOutputRequest(request)
    && validateEffectResultForRequest(request, result).valid
    && result.terminalStatus === 'succeeded'
    && evidence.schema === M2_FILE_READ_OUTPUT_SCHEMA
    && evidence.effectId === request.effectId && evidence.projectId === request.origin.projectId
    && evidence.requestDigest === computeEffectRequestDigest(request)
    && evidence.requestDigest === result.requestDigest
    && evidence.path === request.target.relativePath
    && evidence.contentRef === m2FileReadOutputEvidenceRef(request.effectId)
    && result.evidenceRefs.includes(evidence.contentRef)
    && evidence.contentDigest === result.outputDigest
    && evidence.format === 'bytes'
    && Number.isSafeInteger(evidence.byteLength) && evidence.byteLength >= 0
    && evidence.byteLength <= M2_FILE_READ_MAX_BYTES;
}

export function m2FileReadOutputBytesMatch(request, evidence, bytes) {
  if (!Buffer.isBuffer(bytes) || !isM2FileReadOutputRequest(request)) return false;
  // Check the entire canonical metadata without pretending that bytes alone
  // prove terminal authority. The separate result match is required as well.
  return canonicalStringify(evidence) === canonicalStringify({
    schema: M2_FILE_READ_OUTPUT_SCHEMA,
    effectId: request.effectId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    path: request.target.relativePath,
    contentRef: m2FileReadOutputEvidenceRef(request.effectId),
    contentDigest: m2FileReadBytesDigest(bytes),
    byteLength: bytes.length,
    format: 'bytes',
  }) && bytes.length <= M2_FILE_READ_MAX_BYTES;
}

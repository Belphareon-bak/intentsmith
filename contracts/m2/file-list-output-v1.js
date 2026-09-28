import { createHash } from 'node:crypto';
import { parseM2FileListSnapshot } from './file-list-snapshot-v1.js';
import {
  canonicalStringify, computeEffectRequestDigest,
  validateEffectRequest, validateEffectResultForRequest,
} from './effect-current.js';

// Request policy and output storage have different digest domains. Only the
// policy is an execution payload; file bytes never enter generic authority JSON.
export const M2_FILE_LIST_MAX_BYTES = 1_048_576;
export const M2_FILE_LIST_OUTPUT_SCHEMA = 'intentsmith.effect.file-list-output@1';

function reject(reason) {
  throw Object.assign(new TypeError(`Invalid immutable file list: ${reason}`), {
    code: 'EFFECT_FILE_LIST_OUTPUT_INVALID',
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function m2FileListConversationOrigin(conversationId) {
  if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 512) reject('conversation identity');
  return `conversation:${createHash('sha256').update(conversationId, 'utf8').digest('hex')}`;
}

export function m2FileListBytesDigest(bytes) {
  if (!Buffer.isBuffer(bytes)) reject('bytes must be a Buffer');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function m2FileListOutputEvidenceRef(effectId) {
  if (typeof effectId !== 'string' || !/^effect:[a-f0-9]{64}$/.test(effectId)) reject('effect identity');
  return `effect:${effectId}:file-list-output-v1`;
}

export function isM2FileListOutputRequest(request) {
  return request?.version === 2 && validateEffectRequest(request).valid;
}

export function createM2FileListOutputEvidence(request, result, bytes) {
  if (!isM2FileListOutputRequest(request)
    || !validateEffectResultForRequest(request, result).valid
    || result.terminalStatus !== 'succeeded' || !Buffer.isBuffer(bytes)
    || bytes.length > M2_FILE_LIST_MAX_BYTES
    || result.requestDigest !== computeEffectRequestDigest(request)
    || result.outputDigest !== m2FileListBytesDigest(bytes)
    || !result.evidenceRefs.includes(m2FileListOutputEvidenceRef(request.effectId))) {
    reject('exact successful request/result/bytes binding');
  }
  parseM2FileListSnapshot(bytes);
  return Object.freeze({
    schema: M2_FILE_LIST_OUTPUT_SCHEMA,
    effectId: request.effectId,
    projectId: request.origin.projectId,
    requestDigest: result.requestDigest,
    path: request.target.relativePath,
    contentRef: m2FileListOutputEvidenceRef(request.effectId),
    contentDigest: result.outputDigest,
    byteLength: bytes.length,
    format: 'root-entries@1',
  });
}

export function validateM2FileListOutputEvidence(request, result, evidence) {
  if (!exactKeys(evidence, ['schema', 'effectId', 'projectId', 'requestDigest',
    'path', 'contentRef', 'contentDigest', 'byteLength', 'format'])) return false;
  return isM2FileListOutputRequest(request)
    && validateEffectResultForRequest(request, result).valid
    && result.terminalStatus === 'succeeded'
    && evidence.schema === M2_FILE_LIST_OUTPUT_SCHEMA
    && evidence.effectId === request.effectId && evidence.projectId === request.origin.projectId
    && evidence.requestDigest === computeEffectRequestDigest(request)
    && evidence.requestDigest === result.requestDigest
    && evidence.path === request.target.relativePath
    && evidence.contentRef === m2FileListOutputEvidenceRef(request.effectId)
    && result.evidenceRefs.includes(evidence.contentRef)
    && evidence.contentDigest === result.outputDigest
    && evidence.format === 'root-entries@1'
    && Number.isSafeInteger(evidence.byteLength) && evidence.byteLength >= 0
    && evidence.byteLength <= M2_FILE_LIST_MAX_BYTES;
}

export function m2FileListOutputBytesMatch(request, evidence, bytes) {
  if (!Buffer.isBuffer(bytes) || !isM2FileListOutputRequest(request)) return false;
  try { parseM2FileListSnapshot(bytes); } catch { return false; }
  // Check the entire canonical metadata without pretending that bytes alone
  // prove terminal authority. The separate result match is required as well.
  return canonicalStringify(evidence) === canonicalStringify({
    schema: M2_FILE_LIST_OUTPUT_SCHEMA,
    effectId: request.effectId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    path: request.target.relativePath,
    contentRef: m2FileListOutputEvidenceRef(request.effectId),
    contentDigest: m2FileListBytesDigest(bytes),
    byteLength: bytes.length,
    format: 'root-entries@1',
  }) && bytes.length <= M2_FILE_LIST_MAX_BYTES;
}

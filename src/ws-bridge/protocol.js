// C3 WS Bridge — Protocol Constants
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — IDE ↔ Backend WebSocket protocol
//
// Channels:
//   chat     — user messages + assistant responses
//   agent    — CRE decisions, tool calls, LLM events, gate verdicts
//   control  — cancel, ping/pong
//   status   — agent idle/executing state
//   terminal — IDE terminal command execution (validated + sandboxed)
//
// Handshake:
//   IDE sends:     { type: 'hello', protocolVersion: 1, ideVersion: '...' }
//   BE replies:    { type: 'hello_ack', protocolVersion: 1, backendVersion: '...' }
//   On mismatch:   { type: 'hello_reject', reason: '...', requiredProtocol: 1 }
//
// ══════════════════════════════════════════════════════════════════════════════

export const PROTOCOL_VERSION = 1;
import { getCurrentVersion } from '../packaging/auto-updater.js';
export const BACKEND_VERSION = getCurrentVersion();
export const M1_WIRE_FEATURE = 'm1-wire-v1';
export const M1_WIRE_METADATA_VERSION = 1;

export const M1_INLINE_IMAGE_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/tiff',
  'image/avif',
]);

const M1_ATTACHMENT_POLICY_KEYS = Object.freeze([
  'version',
  'mode',
  'maxCount',
  'maxTextBytes',
  'maxImageBytes',
  'maxAggregateBytes',
  'maxFrameBytes',
  'imageMimeTypes',
]);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Build the exact versioned inline-only attachment policy transported in the
 * M1 negotiation metadata. There is intentionally no production default here:
 * the operator-owned count/aggregate/frame values must be supplied explicitly.
 */
export function createM1AttachmentPolicy({
  maxCount,
  maxTextBytes,
  maxImageBytes,
  maxAggregateBytes,
  maxFrameBytes,
} = {}) {
  const numericValues = [
    maxCount,
    maxTextBytes,
    maxImageBytes,
    maxAggregateBytes,
    maxFrameBytes,
  ];
  if (!numericValues.every(isPositiveSafeInteger)) {
    throw new TypeError('M1 attachment policy requires positive safe integer limits');
  }
  if (maxAggregateBytes < Math.max(maxTextBytes, maxImageBytes)) {
    throw new TypeError('M1 aggregate attachment limit cannot undercut an item limit');
  }
  if (maxFrameBytes <= maxAggregateBytes) {
    throw new TypeError('M1 frame limit must exceed the decoded aggregate limit');
  }
  return Object.freeze({
    version: M1_WIRE_METADATA_VERSION,
    mode: 'inline-only',
    maxCount,
    maxTextBytes,
    maxImageBytes,
    maxAggregateBytes,
    maxFrameBytes,
    imageMimeTypes: M1_INLINE_IMAGE_MIME_TYPES,
  });
}

export function isM1AttachmentPolicy(value) {
  return hasExactKeys(value, M1_ATTACHMENT_POLICY_KEYS)
    && value.version === M1_WIRE_METADATA_VERSION
    && value.mode === 'inline-only'
    && [
      value.maxCount,
      value.maxTextBytes,
      value.maxImageBytes,
      value.maxAggregateBytes,
      value.maxFrameBytes,
    ].every(isPositiveSafeInteger)
    && value.maxAggregateBytes >= Math.max(value.maxTextBytes, value.maxImageBytes)
    && value.maxFrameBytes > value.maxAggregateBytes
    && Array.isArray(value.imageMimeTypes)
    && value.imageMimeTypes.length === M1_INLINE_IMAGE_MIME_TYPES.length
    && value.imageMimeTypes.every(
      (mimeType, index) => mimeType === M1_INLINE_IMAGE_MIME_TYPES[index],
    );
}

const LEGACY_SERVER_FEATURES = Object.freeze([
  'workspace',
  'terminal',
  'merge-preview',
  'edit-ask',
  'audit',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Channels
// ─────────────────────────────────────────────────────────────────────────────

export const Channel = Object.freeze({
  CHAT: 'chat',
  AGENT: 'agent',
  CONTROL: 'control',
  STATUS: 'status',
  TERMINAL: 'terminal',
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Event Types
// ─────────────────────────────────────────────────────────────────────────────

export const AgentEventType = Object.freeze({
  TURN_START: 'turn_start',
  TURN_END: 'turn_end',
  CRE_DECISION: 'cre_decision',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  LLM_START: 'llm_start',
  LLM_TOKEN: 'llm_token',
  LLM_DONE: 'llm_done',
  GATE_VERDICT: 'gate_verdict',
  ERROR: 'error',
  STATUS_CHANGE: 'status_change',
  SYSTEM_STEP: 'system_step',
});

// ─────────────────────────────────────────────────────────────────────────────
// Message Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a channel message envelope.
 * @param {string} channel — Channel name
 * @param {Object} data — Payload
 * @returns {string} JSON string ready to send
 */
export function buildChannelMessage(channel, data) {
  return JSON.stringify({ channel, data });
}

/**
 * Build an agent event message.
 * @param {number} seq — Monotonic sequence number
 * @param {string} type — AgentEventType
 * @param {string} turnId — Turn ID
 * @param {Object} payload — Event-specific data
 * @returns {Object} Agent event object (NOT stringified)
 */
export function buildAgentEvent(seq, type, turnId, payload) {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    seq,
    turnId,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Derive the exact server feature subset for one client offer.
 * @param {string[]} [clientFeatures] — Features requested by client
 * @param {{m1WireSupported?: boolean}} [capabilities]
 * @returns {string[]} negotiated features
 */
export function negotiateFeatures(clientFeatures = [], capabilities = {}) {
  const offered = Array.isArray(clientFeatures) ? clientFeatures : [];
  const serverFeatures = capabilities?.m1WireSupported === true
    && isM1AttachmentPolicy(capabilities?.m1AttachmentPolicy)
    ? [...LEGACY_SERVER_FEATURES, M1_WIRE_FEATURE]
    : LEGACY_SERVER_FEATURES;

  // Legacy clients historically omitted the feature array and received the
  // five legacy capabilities. Additive security-sensitive capabilities must
  // never inherit that fallback: M1 is returned only after an explicit offer.
  if (offered.length === 0) return [...LEGACY_SERVER_FEATURES];
  return serverFeatures.filter(feature => offered.includes(feature));
}

/** Encode a handshake acknowledgement from the already-derived server subset. */
export function buildHelloAckFromNegotiatedFeatures(
  negotiatedFeatures = [],
  capabilities = {},
) {
  const features = Array.isArray(negotiatedFeatures)
    ? [...new Set(negotiatedFeatures.filter(feature => typeof feature === 'string'))]
    : [];
  const payload = {
    type: 'hello_ack',
    protocolVersion: PROTOCOL_VERSION,
    backendVersion: BACKEND_VERSION,
    serverVersion: BACKEND_VERSION,
    features,
  };
  if (features.includes(M1_WIRE_FEATURE)) {
    if (!isM1AttachmentPolicy(capabilities?.m1AttachmentPolicy)) {
      throw new TypeError('M1 negotiation requires exact attachment policy metadata');
    }
    payload.featureMetadata = {
      [M1_WIRE_FEATURE]: {
        version: M1_WIRE_METADATA_VERSION,
        attachmentPolicy: capabilities.m1AttachmentPolicy,
      },
    };
  }
  return JSON.stringify(payload);
}

/** Build a handshake acknowledgement from one client offer. */
export function buildHelloAck(clientFeatures = [], capabilities = {}) {
  return buildHelloAckFromNegotiatedFeatures(
    negotiateFeatures(clientFeatures, capabilities),
    capabilities,
  );
}

/**
 * Build handshake reject message.
 * @param {string} reason — Rejection reason
 * @returns {string} JSON string
 */
export function buildHelloReject(reason) {
  return JSON.stringify({
    type: 'hello_reject',
    reason,
    requiredProtocol: PROTOCOL_VERSION,
  });
}

/**
 * Build a unique message ID.
 * @param {string} prefix — 'msg', 'sys', 'err'
 * @returns {string}
 */
export function messageId(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// M1 connector v1 is additive while consumers migrate from the legacy wire
// shape. The current handshake version therefore remains unchanged.
export {
  M1_CONTRACT_KIND,
  M1_CONTRACT_STAGE,
  M1_CONTRACT_VERSION,
  M1_MODEL_PURPOSE,
  M1_TERMINAL_STATUS,
  classifyTerminal,
  decodeM1Contract,
  encodeM1Contract,
  validateConversationCommand,
  validateConversationResult,
  validateCoreEvent,
  validateCoreEventStream,
  validateM1Contract,
  validateModelRequest,
  validateModelResult,
} from '../../contracts/m1/index.js';

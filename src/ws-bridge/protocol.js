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
 * Build handshake ack message.
 * @returns {string} JSON string
 */
/**
 * Build handshake ack message with feature negotiation.
 * @param {string[]} [clientFeatures] — Features requested by client
 * @returns {string} JSON string
 */
export function buildHelloAck(clientFeatures = []) {
  const serverFeatures = ['workspace', 'terminal', 'merge-preview', 'edit-ask', 'audit'];
  const negotiated = clientFeatures.length > 0
    ? serverFeatures.filter(f => clientFeatures.includes(f))
    : serverFeatures;

  return JSON.stringify({
    type: 'hello_ack',
    protocolVersion: PROTOCOL_VERSION,
    backendVersion: BACKEND_VERSION,
    serverVersion: BACKEND_VERSION,
    features: negotiated,
  });
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

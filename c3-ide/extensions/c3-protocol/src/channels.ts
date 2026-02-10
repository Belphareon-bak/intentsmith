/**
 * @c3/protocol — WebSocket channel types
 *
 * Every WS message is wrapped in C3WSMessage with a channel discriminator.
 * This allows multiplexing chat, agent, terminal, and status on one connection.
 */

import { C3Message, C3AgentEvent, C3StatusUpdate } from './messages';

// ─── Channel Types ───────────────────────────────────────────

export type C3Channel = 'chat' | 'agent' | 'terminal' | 'status' | 'control';

// ─── Outgoing (IDE → Backend) ────────────────────────────────

export interface C3WSOutgoing {
  channel: C3Channel;
  data: ChatSendData | ControlData;
}

export interface ChatSendData {
  content: string;
}

export interface ControlData {
  action: 'cancel' | 'reconnect' | 'ping';
}

// ─── Incoming (Backend → IDE) ────────────────────────────────

export type C3WSIncoming =
  | { channel: 'chat'; data: C3Message }
  | { channel: 'agent'; data: C3AgentEvent }
  | { channel: 'status'; data: C3StatusUpdate }
  | { channel: 'control'; data: ControlResponse };

export interface ControlResponse {
  action: string;
  success: boolean;
  message?: string;
}

// ─── Handshake (Protocol Versioning) ─────────────────────────

export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  ideVersion: string;
}

export interface HelloAck {
  type: 'hello_ack';
  protocolVersion: number;
  backendVersion: string;
}

export interface HelloReject {
  type: 'hello_reject';
  reason: string;
  requiredProtocol: number;
}

export type HandshakeMessage = HelloMessage | HelloAck | HelloReject;

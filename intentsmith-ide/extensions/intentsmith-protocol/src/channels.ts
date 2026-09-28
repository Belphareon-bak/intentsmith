/**
 * @intentsmith/protocol — WebSocket channel types
 *
 * Every WS message is wrapped in IntentSmithWSMessage with a channel discriminator.
 * This allows multiplexing chat, agent, terminal, and status on one connection.
 */

import { IntentSmithMessage, IntentSmithAgentEvent, IntentSmithStatusUpdate } from './messages';

// ─── Channel Types ───────────────────────────────────────────

export type IntentSmithChannel = 'chat' | 'agent' | 'terminal' | 'status' | 'control';

// ─── Outgoing (IDE → Backend) ────────────────────────────────

export interface IntentSmithWSOutgoing {
  channel: IntentSmithChannel;
  data: ChatSendData | ControlData;
}

export interface ChatSendData {
  content: string;
}

export interface ControlData {
  action: 'cancel' | 'reconnect' | 'ping';
}

// ─── Incoming (Backend → IDE) ────────────────────────────────

export type IntentSmithWSIncoming =
  | { channel: 'chat'; data: IntentSmithMessage }
  | { channel: 'agent'; data: IntentSmithAgentEvent }
  | { channel: 'status'; data: IntentSmithStatusUpdate }
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

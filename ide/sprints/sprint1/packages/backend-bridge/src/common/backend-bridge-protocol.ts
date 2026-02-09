/**
 * @c3/backend-bridge — Service interface (common)
 *
 * Shared between Theia frontend and backend.
 * Frontend calls these methods via JSON-RPC proxy.
 * Backend implements them with actual WebSocket logic.
 */

import { C3Message, C3AgentEvent, C3StatusUpdate, AgentStatus } from '@c3/protocol';

export const C3BackendBridgePath = '/services/c3-backend-bridge';

export const C3BackendBridge = Symbol('C3BackendBridge');

export interface C3BackendBridge {

  /** Connect to C3 backend WebSocket */
  connect(url: string): Promise<ConnectionResult>;

  /** Disconnect from C3 backend */
  disconnect(): Promise<void>;

  /** Send a chat message (natural language → CRE routing) */
  sendChatMessage(content: string): Promise<void>;

  /** Cancel the current agent execution */
  cancelExecution(): Promise<void>;

  /** Get chat history for current session */
  getChatHistory(): Promise<C3Message[]>;

  /** Get connection status */
  getStatus(): Promise<ConnectionStatus>;
}

/** Emitted events (backend → frontend via JSON-RPC notifications) */
export const C3BackendBridgeClient = Symbol('C3BackendBridgeClient');

export interface C3BackendBridgeClient {
  onChatMessage(message: C3Message): void;
  onAgentEvent(event: C3AgentEvent): void;
  onStatusUpdate(status: C3StatusUpdate): void;
  onConnectionChange(status: ConnectionStatus): void;
}

export interface ConnectionResult {
  success: boolean;
  backendVersion?: string;
  protocolVersion?: number;
  error?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'handshake' | 'connected' | 'reconnecting';

export interface ConnectionStatus {
  state: ConnectionState;
  url?: string;
  backendVersion?: string;
  agentStatus?: AgentStatus;
  reconnectAttempt?: number;
}

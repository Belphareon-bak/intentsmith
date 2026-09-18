/**
 * @intentsmith/backend-bridge — Service interface (common)
 *
 * Shared between Theia frontend and backend.
 * Frontend calls these methods via JSON-RPC proxy.
 * Backend implements them with actual WebSocket logic.
 */

import { IntentSmithMessage, IntentSmithAgentEvent, IntentSmithStatusUpdate, AgentStatus } from '@intentsmith/protocol';

export const IntentSmithBackendBridgePath = '/services/intentsmith-backend-bridge';

export const IntentSmithBackendBridge = Symbol('IntentSmithBackendBridge');

export interface IntentSmithBackendBridge {

  /** Connect to IntentSmith backend WebSocket */
  connect(url: string): Promise<ConnectionResult>;

  /** Disconnect from IntentSmith backend */
  disconnect(): Promise<void>;

  /** Send a chat message (natural language → CRE routing) */
  sendChatMessage(content: string): Promise<void>;

  /** Cancel the current agent execution */
  cancelExecution(): Promise<void>;

  /** Get chat history for current session */
  getChatHistory(): Promise<IntentSmithMessage[]>;

  /** Get connection status */
  getStatus(): Promise<ConnectionStatus>;
}

/** Emitted events (backend → frontend via JSON-RPC notifications) */
export const IntentSmithBackendBridgeClient = Symbol('IntentSmithBackendBridgeClient');

export interface IntentSmithBackendBridgeClient {
  onChatMessage(message: IntentSmithMessage): void;
  onAgentEvent(event: IntentSmithAgentEvent): void;
  onStatusUpdate(status: IntentSmithStatusUpdate): void;
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

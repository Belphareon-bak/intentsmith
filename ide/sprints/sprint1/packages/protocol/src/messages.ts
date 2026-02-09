/**
 * @c3/protocol — Message types
 *
 * Turn Lifecycle:
 *   turn_start → cre_decision → llm_start → llm_token* → llm_done → gate_verdict → turn_end
 *
 * Ordering: Agent panel sorts by `seq`, NOT timestamp.
 * `seq` is a monotonic counter on the backend — guarantees order.
 */

// ─── Chat Messages ───────────────────────────────────────────

export interface C3Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: C3MessageMetadata;
}

export interface C3MessageMetadata {
  intent?: string;
  confidence?: number;
  tools?: string[];
  turnId?: string;
  designProject?: DesignProjectState;
}

export interface DesignProjectState {
  projectId: string;
  phase: 'design' | 'build' | 'pending_review' | 'review';
  step: number;
}

// ─── Agent Events ────────────────────────────────────────────

export type AgentEventType =
  | 'turn_start'
  | 'turn_end'
  | 'cre_decision'
  | 'tool_call'
  | 'tool_result'
  | 'gate_verdict'
  | 'llm_start'
  | 'llm_token'
  | 'llm_done'
  | 'error'
  | 'status_change';

export interface C3AgentEvent {
  id: string;
  /** Monotonic counter — agent panel sorts by this, NOT timestamp */
  seq: number;
  /** Groups events belonging to one user turn (e.g., "t-001") */
  turnId: string;
  type: AgentEventType;
  timestamp: string;
  payload: AgentEventPayload;
}

// ─── Event Payloads (discriminated by type) ──────────────────

export type AgentEventPayload =
  | TurnStartPayload
  | TurnEndPayload
  | CREDecisionPayload
  | ToolCallPayload
  | ToolResultPayload
  | GateVerdictPayload
  | LLMStartPayload
  | LLMTokenPayload
  | LLMDonePayload
  | ErrorPayload
  | StatusChangePayload;

export interface TurnStartPayload {
  input: string;
}

export type TurnEndStatus = 'ok' | 'cancelled_by_user' | 'timeout' | 'error' | 'interrupted';

export interface TurnEndPayload {
  status: TurnEndStatus;
  durationMs: number;
  error?: string;
}

export interface CREDecisionPayload {
  intent: string;
  confidence: number;
  input: string;
  actionType?: string;
  tools?: string[];
}

export interface ToolCallPayload {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  tool: string;
  success: boolean;
  durationMs: number;
  resultSummary?: string;
}

export interface GateVerdictPayload {
  d61?: 'ok' | 'fail';
  d62?: 'ok' | 'fail';
  d63?: 'ok' | 'fail';
  d64?: 'ok' | 'fail' | 'suspicious';
  retryCount?: number;
}

export interface LLMStartPayload {
  model: string;
  tokensIn: number;
}

export interface LLMTokenPayload {
  token: string;
  /** Accumulated text so far (for progressive rendering) */
  accumulated?: string;
}

export interface LLMDonePayload {
  tokensOut: number;
  durationMs: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface StatusChangePayload {
  from: string;
  to: string;
  reason?: string;
}

// ─── Status Updates ──────────────────────────────────────────

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'streaming' | 'error' | 'disconnected';

export interface C3StatusUpdate {
  agentStatus: AgentStatus;
  project?: {
    id: string;
    name: string;
    phase: string;
    step?: number;
  };
  backendVersion: string;
}

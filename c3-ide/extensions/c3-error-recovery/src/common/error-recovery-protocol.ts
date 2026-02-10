/**
 * @c3/error-recovery — Protocol (common)
 *
 * Error recovery covers three scenarios:
 *
 * 1. BACKEND DISCONNECT
 *    Backend spadne → Statusbar: 🔴 DISCONNECTED
 *    → Auto-reconnect (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
 *    → Po reconnect: rehydratace projektu
 *    → Agent log: "⚠️ Reconnected after 12s downtime"
 *    → Chat: "(systém se znovu připojil)"
 *
 * 2. LLM TIMEOUT
 *    LLM neodpovídá > 60s
 *    → Agent log: "⏱️ LLM timeout (60s)"
 *    → Chat: "Odpověď trvá déle než obvykle... [Cancel] [Počkat]"
 *    → Cancel → abort request, agent se vrátí do IDLE
 *
 * 3. CRASH RECOVERY
 *    IDE crash / kill -9
 *    → Restart IDE
 *    → Načte project.json → rehydratace
 *    → Chat history ze souboru (conversation.jsonl)
 *    → Agent log: "🔄 Session restored from disk"
 */

export const C3ErrorRecoveryPath = '/services/c3-error-recovery';
export const C3ErrorRecovery = Symbol('C3ErrorRecovery');

// ─── Connection State ────────────────────────────────────

export type ConnectionState =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed';         // Max retries exceeded

export interface ReconnectConfig {
  /** Initial delay in ms (default: 1000) */
  initialDelay: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay: number;
  /** Multiplier for exponential backoff (default: 2) */
  multiplier: number;
  /** Max number of retries before giving up (default: 20) */
  maxRetries: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitter: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
  maxRetries: 20,
  jitter: 0.1,
};

export interface ReconnectStatus {
  state: ConnectionState;
  attempt: number;
  nextRetryMs: number;
  totalDowntimeMs: number;
  lastError?: string;
}

// ─── LLM Timeout ─────────────────────────────────────────

export interface LlmTimeoutConfig {
  /** Timeout for LLM response in ms (default: 60000) */
  timeoutMs: number;
  /** Show warning after this many ms (default: 30000) */
  warningMs: number;
}

export const DEFAULT_LLM_TIMEOUT: LlmTimeoutConfig = {
  timeoutMs: 60000,
  warningMs: 30000,
};

export type LlmTimeoutAction = 'cancel' | 'wait';

// ─── Crash Recovery ──────────────────────────────────────

export interface CrashRecoveryResult {
  /** Whether recovery was needed */
  recovered: boolean;
  /** Project name if restored */
  projectName?: string;
  /** Phase at crash time */
  phase?: string;
  /** Chat messages restored count */
  chatMessagesRestored: number;
  /** Agent events restored count */
  agentEventsRestored: number;
  /** Whether there was a pending review */
  hasPendingReview: boolean;
  /** Total downtime (if detectable) */
  downtimeMs?: number;
}

// ─── Chat History Persistence ────────────────────────────

export interface ChatHistoryEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  /** For assistant messages: the intent detected by CRE */
  intent?: string;
  /** Turn ID for correlation with agent log */
  turnId?: string;
}

// ─── Service Interface ───────────────────────────────────

export interface C3ErrorRecovery {
  /** Persist chat message to conversation.jsonl */
  appendChatMessage(projectPath: string, entry: ChatHistoryEntry): Promise<void>;

  /** Load chat history from conversation.jsonl */
  loadChatHistory(projectPath: string): Promise<ChatHistoryEntry[]>;

  /** Perform crash recovery check on startup */
  checkCrashRecovery(projectPath: string): Promise<CrashRecoveryResult>;

  /** Write crash marker (removed on clean shutdown) */
  writeCrashMarker(projectPath: string): Promise<void>;

  /** Remove crash marker (clean shutdown) */
  removeCrashMarker(projectPath: string): Promise<void>;
}

// ─── Events (backend → frontend) ─────────────────────────

export const C3ErrorRecoveryClient = Symbol('C3ErrorRecoveryClient');

export interface C3ErrorRecoveryClient {
  onConnectionStateChanged(status: ReconnectStatus): void;
  onCrashRecovered(result: CrashRecoveryResult): void;
}

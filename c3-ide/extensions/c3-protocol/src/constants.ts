/**
 * @c3/protocol — Constants
 */

/** Current protocol version. Increment on ANY change to WS message format. */
export const PROTOCOL_VERSION = 1;

/** Default backend WS URL */
export const DEFAULT_WS_URL = 'ws://localhost:3001/c3/ws';

/** Agent event type icons (for UI rendering) */
export const AGENT_EVENT_ICONS: Record<string, string> = {
  turn_start: '▶️',
  turn_end: '⏹️',
  cre_decision: '🧠',
  tool_call: '🔧',
  tool_result: '📋',
  gate_verdict: '🚦',
  llm_start: '⏳',
  llm_token: '💬',
  llm_done: '✅',
  error: '❌',
  status_change: '🔄',
};

/** Agent status colors (CSS class suffixes) */
export const STATUS_COLORS: Record<string, string> = {
  idle: '#4ade80',        // green
  thinking: '#60a5fa',    // blue
  executing: '#facc15',   // yellow
  streaming: '#60a5fa',   // blue
  error: '#f87171',       // red
  disconnected: '#9ca3af', // gray
};

/** Reconnect settings */
export const RECONNECT = {
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  BACKOFF_MULTIPLIER: 2,
  MAX_ATTEMPTS: Infinity,
} as const;

/** Chat settings */
export const CHAT = {
  MAX_INPUT_LENGTH: 10000,
  MAX_HISTORY_RECALL: 50,
  TYPING_INDICATOR_DELAY_MS: 300,
} as const;

/** Agent log settings */
export const AGENT_LOG = {
  MAX_VISIBLE_EVENTS: 1000,
  AUTO_SCROLL_THRESHOLD_PX: 50,
} as const;

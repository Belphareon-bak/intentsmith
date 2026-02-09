/**
 * @c3/token-dashboard — Protocol (common)
 *
 * Token usage tracking and cost estimation.
 *
 * Dashboard layout:
 *   ┌──────────────────────────────┐
 *   │ 📊 Token Usage               │
 *   ├──────────────────────────────┤
 *   │ Today:    12,450 tokens      │
 *   │ This week: 87,230 tokens     │
 *   │ Project:  145,800 tokens     │
 *   ├──────────────────────────────┤
 *   │ By intent:                   │
 *   │ DESIGN      45%  ████████░░  │
 *   │ CODE        30%  ██████░░░░  │
 *   │ CONVERSATIONAL 25% █████░░░░ │
 *   └──────────────────────────────┘
 */

export const C3TokenDashboardPath = '/services/c3-token-dashboard';
export const C3TokenDashboard = Symbol('C3TokenDashboard');

// ─── Usage Record ────────────────────────────────────────

export interface TokenUsageRecord {
  /** Turn ID */
  turnId: string;
  /** Project slug */
  projectSlug: string;
  /** Intent (DESIGN, CODE, CONVERSATIONAL, etc.) */
  intent: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Model used */
  model: string;
  /** ISO timestamp */
  timestamp: string;
  /** Estimated cost in USD (optional) */
  estimatedCostUsd?: number;
}

// ─── Aggregated Stats ────────────────────────────────────

export interface TokenStats {
  /** Total tokens today */
  today: number;
  /** Total tokens this week */
  thisWeek: number;
  /** Total tokens for current project */
  project: number;
  /** Total tokens all-time */
  allTime: number;
  /** Breakdown by intent */
  byIntent: IntentBreakdown[];
  /** Breakdown by model */
  byModel: ModelBreakdown[];
  /** Daily usage for chart (last 30 days) */
  dailyUsage: DailyUsage[];
  /** Estimated total cost */
  estimatedCostUsd: number;
}

export interface IntentBreakdown {
  intent: string;
  tokens: number;
  percentage: number;
  count: number;
}

export interface ModelBreakdown {
  model: string;
  tokens: number;
  percentage: number;
}

export interface DailyUsage {
  /** YYYY-MM-DD */
  date: string;
  tokens: number;
  turns: number;
}

// ─── Cost Estimation ─────────────────────────────────────

export interface ModelPricing {
  model: string;
  inputPer1k: number;
  outputPer1k: number;
}

export const DEFAULT_PRICING: ModelPricing[] = [
  { model: 'gpt-4', inputPer1k: 0.03, outputPer1k: 0.06 },
  { model: 'gpt-4-turbo', inputPer1k: 0.01, outputPer1k: 0.03 },
  { model: 'gpt-3.5-turbo', inputPer1k: 0.0005, outputPer1k: 0.0015 },
  { model: 'claude-3-opus', inputPer1k: 0.015, outputPer1k: 0.075 },
  { model: 'claude-3-sonnet', inputPer1k: 0.003, outputPer1k: 0.015 },
  { model: 'claude-3-haiku', inputPer1k: 0.00025, outputPer1k: 0.00125 },
  { model: 'local', inputPer1k: 0, outputPer1k: 0 },
];

// ─── Service Interface ───────────────────────────────────

export interface C3TokenDashboard {
  /** Record token usage for a turn */
  recordUsage(record: TokenUsageRecord): Promise<void>;

  /** Get aggregated stats */
  getStats(projectSlug?: string): Promise<TokenStats>;

  /** Get raw usage records for a date range */
  getRecords(
    projectSlug?: string,
    after?: string,
    before?: string,
  ): Promise<TokenUsageRecord[]>;

  /** Clear all records for a project */
  clearProject(projectSlug: string): Promise<void>;
}

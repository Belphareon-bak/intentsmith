// C3-Agent Handler Utilities Type Definitions
// Generated for v55.1

// ═══════════════════════════════════════════════════════════════════════════
// INTENT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intent types
 */
export type IntentType =
  | 'SEARCH'
  | 'REPORT'
  | 'CODE'
  | 'CONVERSATIONAL'
  | 'LOCAL'
  | 'CREATIVE'
  | 'FACTUAL'
  | 'ITEM_LOOKUP';

/**
 * Clarification keywords mapping
 */
export declare const CLARIFICATION_KEYWORDS: Readonly<Record<string, IntentType>>;

/**
 * Check if input is a clarification response
 */
export declare function isClarification(input: string | null | undefined): boolean;

/**
 * Resolve clarification keyword to intent type
 */
export declare function resolveClarificationIntent(input: string | null | undefined): IntentType | null;

/**
 * Detect affirmative/negative response
 */
export declare function detectAffirmative(input: string | null | undefined): 'yes' | 'no' | null;

/**
 * Check if input is too vague
 */
export declare function isVagueInput(input: string | null | undefined): boolean;

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creative quality check result
 */
export interface CreativeQualityResult {
  valid: boolean;
  reason?: string;
}

/**
 * Check creative response quality
 */
export declare function assertCreativeQuality(
  response: string | null | undefined,
  input: string,
  minLength?: number
): CreativeQualityResult;

/**
 * Fluff detection result
 */
export interface FluffDetectionResult {
  isFluff: boolean;
  reason?: string;
  confidence: number;
  pattern?: string;
  count?: number;
  threshold?: number;
  ratio?: number;
  titleMatches?: number;
  totalTitles?: number;
}

/**
 * Detect fluff (low-quality synthesis)
 */
export declare function detectFluff(
  content: string | null | undefined,
  sourceData?: unknown[]
): FluffDetectionResult;

/**
 * Atomic answer gate result
 */
export interface AtomicGateResult {
  pass: boolean;
  reason?: string;
  violation?: string;
  count?: number;
  length?: number;
}

/**
 * Validate atomic (minimal) response
 */
export declare function atomicAnswerGate(
  content: string | null | undefined,
  options?: {
    responseIntent?: string;
    prefersMinimal?: boolean;
  }
): AtomicGateResult;

/**
 * Count sentences in text
 */
export declare function countSentences(text: string | null | undefined): number;

/**
 * Build retry prompt for atomic gate failure
 */
export declare function buildAtomicRetryPrompt(
  originalPrompt: string,
  gateResult: AtomicGateResult
): string;

/**
 * Build retry prompt for fluff detection
 */
export declare function buildFluffRetryPrompt(
  originalPrompt: string,
  fluffInfo: FluffDetectionResult
): string;

/**
 * Synthesis thresholds
 */
export declare const SYNTHESIS_THRESHOLDS: Readonly<{
  minUniqueWords: number;
  minContentRatio: number;
  maxUrlRatio: number;
  minSentences: number;
}>;

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHESIS UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool result from execution
 */
export interface ToolResult {
  type: string;
  success?: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

/**
 * Expert hints for synthesis
 */
export interface ExpertHints {
  active: boolean;
  expertName?: string;
  influence?: number;
  style?: 'creative' | 'technical' | 'formal' | 'casual';
  depth?: 'deep' | 'shallow';
  caution?: 'high' | 'normal';
  systemAddition?: string;
}

/**
 * User preferences for response formatting
 */
export interface UserPreferences {
  verbosity?: 'minimal' | 'brief' | 'normal' | 'detailed';
  structure?: 'bullets' | 'paragraphs' | 'mixed';
  followUpStyle?: 'concise' | 'comprehensive';
  technicalDepth?: 'basic' | 'intermediate' | 'advanced';
}

/**
 * Response intent types
 */
export type ResponseIntent =
  | 'DIRECT'
  | 'SUMMARY'
  | 'BULLETS'
  | 'COMPARISON'
  | 'STEP_BY_STEP'
  | 'EXPLORATORY'
  | 'OPINIONATED'
  | 'MINIMAL';

/**
 * Synthesis result
 */
export interface SynthesisResult {
  content: string;
  confidence: number;
  model: string;
  duration?: number;
  retried?: boolean;
}

/**
 * Synthesis options
 */
export interface SynthesisOptions {
  query: string;
  intent: IntentType;
  toolResults: ToolResult[];
  context?: {
    sessionId?: string;
    [key: string]: unknown;
  };
  userPreferences?: UserPreferences;
  expertHints?: ExpertHints | null;
  responseIntent?: ResponseIntent | null;
  creDecisionEngine?: unknown;
}

/**
 * Synthesize response from tool data using LLM
 */
export declare function synthesizeWithLLM(options: SynthesisOptions): Promise<SynthesisResult>;

/**
 * Build synthesis prompt
 */
export declare function buildSynthesisPrompt(options: {
  query: string;
  intent: IntentType;
  data: unknown[];
  failures: unknown[];
  userPreferences?: UserPreferences;
  expertHints?: ExpertHints | null;
}): string;

/**
 * Build synthesis system prompt
 */
export declare function buildSynthesisSystemPrompt(
  intent: IntentType,
  userPreferences?: UserPreferences,
  expertHints?: ExpertHints | null,
  responseIntent?: ResponseIntent | null
): string;

/**
 * Build failure response
 */
export declare function buildSynthesisFailureResponse(
  query: string,
  failures: unknown[]
): string;

/**
 * Build basic synthesis without LLM
 */
export declare function buildBasicSynthesis(
  query: string,
  intent: IntentType,
  data: unknown[]
): string;

/**
 * Check if query is asking for list
 */
export declare function isListQuery(query: string): boolean;

/**
 * Check if query is asking for specific answer
 */
export declare function isSpecificQuery(query: string): boolean;

/**
 * Calculate relevance score
 */
export declare function calculateRelevanceScore(
  result: { title?: string; url?: string; snippet?: string },
  query: string
): number;

/**
 * Apply adaptive result count
 */
export declare function applyAdaptiveResultCount(
  data: unknown[],
  query: string,
  intent: IntentType
): unknown[];

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-UP UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Follow-up types
 */
export declare const FollowUpType: Readonly<{
  FORMAT_CHANGE: 'FORMAT_CHANGE';
  REFINEMENT: 'REFINEMENT';
  NEW_QUERY: 'NEW_QUERY';
  CONTINUATION: 'CONTINUATION';
}>;

export type FollowUpTypeValue = typeof FollowUpType[keyof typeof FollowUpType];

/**
 * Follow-up detection result
 */
export interface FollowUpDetectionResult {
  type: FollowUpTypeValue;
  confidence: number;
  reusePreviousData: boolean;
}

/**
 * Detect follow-up type
 */
export declare function detectFollowUpType(
  input: string,
  sessionState: unknown,
  options?: { IntentType?: Record<string, string> }
): FollowUpDetectionResult;

/**
 * Get previous tool data from session
 */
export declare function getPreviousToolData(sessionState: unknown): unknown[] | null;

/**
 * Resolved decision from clarification
 */
export interface ResolvedDecision {
  type: string;
  intent: IntentType;
  tools?: string[];
  params?: Record<string, unknown>;
  confidence: number;
  reason: string;
  metadata?: Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

/**
 * Try to resolve pending clarification
 */
export declare function tryResolveClarification(
  input: string,
  sessionState: unknown,
  context: unknown,
  options?: {
    creDecisionEngine?: unknown;
    DecisionType?: Record<string, string>;
    IntentType?: Record<string, string>;
  }
): ResolvedDecision | null;

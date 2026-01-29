// CRE v45.0 — Chat Handlers
// ══════════════════════════════════════════════════════════════════════════════
//
// Mode-specific handlers for ChatController
// All handlers use CRE Decision Engine for tool-first logic
//
// INVARIANTS:
// 1. No text response without CRE Decision
// 2. SEARCH/FACT/REPORT = TOOL_CALL first (never ANSWER without tool)
// 3. CHAT mode ≠ text mode (CHAT is a goal type, not "allow LLM")
// 4. First turn NEVER returns ASK_USER (v44.8)
// 5. First turn vague inputs NEVER trigger SEARCH (v44.9)
// 6. ANSWER decisions MUST record to sessionState (v44.9)
// 7. CREATIVE responses validated for quality (v44.10)
// 8. REPORT = SEARCH→SCRAPE pipeline, NEVER scrape without URLs (v44.11)
// 9. Tools return DATA only — LLM synthesizes response (v45.0)
//
// v45.0 ARCHITECTURE:
// - Tools return ToolResult (structured data) — no text!
// - synthesizeWithLLM() generates human response from tool data
// - Tool nesmí "mluvit" — tools provide DATA, LLM generates RESPONSE
//
// CHANGELOG:
// v45.0 - LLM synthesis layer (synthesizeWithLLM) — tools return data only
// v44.11 - REPORT pipeline orchestration (SEARCH→SCRAPE, fallback on failure)
// v44.10 - Creative quality gate (assertCreativeQuality)
// v44.9 - FIX A: CREATIVE follow-up lock (sessionState.recordDecision in handleAnswerDecision)
//         FIX B: First-turn SEARCH block for vague inputs ("něco", "hmm", etc.)
// v44.8 - First-turn ASK_USER blocking, CREATIVE intent support
// v44.7 - LOCAL terminal handling, max 1× clarification
// v44.6 - Strong intent detection, clarification content respecting
//
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from './chat-controller.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  FORBIDDEN_PHRASES,
  assertDecision,
  assertNoDirectAnswer,
  ResponseIntent,
  detectResponseIntent,
} from './cre-decision.js';
import { toolExecutor, ExecutionStatus } from './tool-executor.js';
import { logger } from '../core/logger.js';
import { preferenceEngine, Structure, FollowUpStyle } from '../memory/preferences.js';
import { expertRegistry, ExpertStrength, ExpertWeights } from '../experts/expert-layer.js';

// v44.5 - Helper to detect clarification-like responses
function isClarification(input) {
  if (!input || typeof input !== 'string') return false;

  const trimmed = input.trim();
  const words = trimmed.split(/\s+/).length;

  // Short responses (1-5 words) are likely clarifications
  if (words <= 5) return true;

  // Affirmative/negative patterns
  if (/^(ano|ne|jo|jasně|fajn|ok|yes|no|pokračuj|zrušit|cancel|stop)$/i.test(trimmed)) return true;

  // Single keywords from CLARIFICATION_KEYWORDS
  if (CLARIFICATION_KEYWORDS[trimmed.toLowerCase()]) return true;

  // Starts with clarification phrases
  if (/^(chci|chtěl bych|zkus|použij|raději|místo|instead)/i.test(trimmed)) return true;

  // URL only
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;

  // Number/selection only (e.g., "1", "první", "2.")
  if (/^[1-4]\.?$|^(první|druhý|třetí|čtvrtý|first|second|third)$/i.test(trimmed)) return true;

  return false;
}

// v44.2 - Intent resolution keywords for clarification responses
const CLARIFICATION_KEYWORDS = {
  // Single-word responses that resolve intent
  'vyhledávání': IntentType.SEARCH,
  'vyhledavani': IntentType.SEARCH,
  'hledat': IntentType.SEARCH,
  'search': IntentType.SEARCH,
  'najít': IntentType.SEARCH,
  'najit': IntentType.SEARCH,

  'report': IntentType.REPORT,
  'souhrn': IntentType.REPORT,
  'analýza': IntentType.REPORT,
  'analyza': IntentType.REPORT,
  'přehled': IntentType.REPORT,
  'prehled': IntentType.REPORT,
  'summary': IntentType.REPORT,

  'kód': IntentType.CODE,
  'kod': IntentType.CODE,
  'code': IntentType.CODE,
  'napsat': IntentType.CODE,
  'programovat': IntentType.CODE,

  'chat': IntentType.CONVERSATIONAL,
  'konverzace': IntentType.CONVERSATIONAL,
  'povídání': IntentType.CONVERSATIONAL,
  'povidat': IntentType.CONVERSATIONAL,
};

// ─────────────────────────────────────────────────────────────────────────────
// v44.10 - Creative Quality Gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns indicating empty/low-quality creative responses
 */
const CREATIVE_QUALITY_VIOLATIONS = [
  // Response just repeats/acknowledges without content
  /^(samozřejmě|jistě|rozumím|chápu|dobře|ok)[,.]?\s*$/i,

  // Empty promises without delivery
  /^(rád|ráda) (bych|pomohu)[^.]*\.?$/i,

  // Generic filler without substance
  /^to (je|záleží|závisí) (na|složité|komplexní)[^.]*\.?$/i,

  // Deflection patterns
  /^(bohužel )?(nemám|nemůžu|nemohu|nevím)[^.]*\.?$/i,
];

/**
 * assertCreativeQuality - Lightweight check for creative response quality
 *
 * v44.10 - Detects responses that are structurally empty:
 * - Just acknowledge without content
 * - Repeat the question
 * - Have structure (markdown) but no actual ideas
 *
 * @param {string} response - The creative response
 * @param {string} input - Original user input
 * @param {number} minLength - Minimum expected length for creative content
 * @returns {{ valid: boolean, reason?: string }}
 */
function assertCreativeQuality(response, input, minLength = 100) {
  if (!response || typeof response !== 'string') {
    return { valid: false, reason: 'EMPTY_RESPONSE' };
  }

  const trimmed = response.trim();

  // Check 1: Minimum length for creative content
  if (trimmed.length < minLength) {
    // Very short creative responses are suspicious
    // (unless user asked for something very specific like "one sentence")
    const askedForShort = /jedno|krátk|brief|one|single/i.test(input);
    if (!askedForShort && trimmed.length < 50) {
      return { valid: false, reason: 'TOO_SHORT' };
    }
  }

  // Check 2: Response starts by repeating the question
  const inputLower = input.toLowerCase().trim();
  const responseLower = trimmed.toLowerCase();
  if (inputLower.length > 15 && responseLower.startsWith(inputLower.substring(0, 20))) {
    return { valid: false, reason: 'REPEATS_INPUT' };
  }

  // Check 3: Known empty patterns
  for (const pattern of CREATIVE_QUALITY_VIOLATIONS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: 'EMPTY_ACKNOWLEDGMENT' };
    }
  }

  // Check 4: Has markdown structure but no actual content
  // (e.g., "# Title\n\n" with nothing else)
  const contentOnly = trimmed
    .replace(/^#+\s*.*/gm, '')       // Remove headings
    .replace(/^\s*[-*]\s*/gm, '')    // Remove list markers
    .replace(/\*\*[^*]+\*\*/g, '')   // Remove bold text
    .replace(/\n+/g, ' ')            // Normalize newlines
    .trim();

  if (contentOnly.length < 30 && trimmed.length > 50) {
    return { valid: false, reason: 'EMPTY_STRUCTURE' };
  }

  // Check 5: For creative requests, should have some specifics
  // (at least one concrete noun, name, or number)
  const hasConcretes = /\d|[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]{2,}/g.test(trimmed);
  if (!hasConcretes && trimmed.length < 200) {
    // Not a hard fail, but suspicious
    logger.debug('CreativeQuality', 'Response lacks concrete details', {
      length: trimmed.length,
      preview: trimmed.substring(0, 100),
    });
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 FIX 3.3 - LLM Confidence Gate (Anti-Fluff)
// ─────────────────────────────────────────────────────────────────────────────
// Detects low-quality "fluff" responses before returning to user:
// - Just repeats/lists sources without synthesis
// - Generic filler without actual content
// - Empty promises ("Zde je přehled...")
// If fluff detected → retry with stronger prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns indicating fluff (low-quality synthesis)
 */
const FLUFF_PATTERNS = [
  // Just lists sources without synthesis
  /^(zde jsou|here are|tady jsou).*:?\s*\n/i,

  // Empty framing without content
  /^(na základě|based on|podle).*(zdrojů|sources|dat|data)[,:]/i,

  // Generic opener followed by just links/titles
  /^(našel jsem|found|zjistil jsem).*(výsledk|result)/i,

  // Markdown headers with no content after
  /^##?\s+\w+\s*\n\s*\n##/m,

  // Just numbered list of titles
  /^1\.\s+\*\*[^*]+\*\*\s*\n2\.\s+\*\*[^*]+\*\*\s*\n3\./m,

  // Empty structure markers
  /^(shrnutí|summary|přehled|overview):\s*$/im,

  // Promises without delivery
  /^(rád|ráda)?\s*(bych)?\s*(vám)?\s*(poskytl|připravil|shrnul)/i,
];

/**
 * Minimum thresholds for non-fluff response
 */
const SYNTHESIS_THRESHOLDS = {
  minUniqueWords: 30,          // At least 30 unique words (not just source titles)
  minContentRatio: 0.3,        // At least 30% of response is original synthesis
  maxUrlRatio: 0.4,            // Max 40% of response is URLs/links
  minSentences: 2,             // At least 2 complete sentences
};

/**
 * v45.0 FIX 3.3 - Check if response is fluff
 *
 * @param {string} content - The synthesized response
 * @param {Array} sourceData - Original tool data (to detect repetition)
 * @returns {{ isFluff: boolean, reason?: string, confidence: number }}
 */
function detectFluff(content, sourceData = []) {
  if (!content || typeof content !== 'string') {
    return { isFluff: true, reason: 'EMPTY_RESPONSE', confidence: 1.0 };
  }

  const trimmed = content.trim();

  // Check explicit fluff patterns
  for (const pattern of FLUFF_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isFluff: true,
        reason: 'FLUFF_PATTERN_MATCH',
        pattern: pattern.toString(),
        confidence: 0.8,
      };
    }
  }

  // Count unique words (excluding URLs and common words)
  const words = trimmed.toLowerCase()
    .replace(/https?:\/\/\S+/g, '') // Remove URLs
    .replace(/[^\p{L}\s]/gu, ' ')   // Keep only letters
    .split(/\s+/)
    .filter(w => w.length > 3);    // Only words > 3 chars

  const uniqueWords = new Set(words);

  if (uniqueWords.size < SYNTHESIS_THRESHOLDS.minUniqueWords) {
    return {
      isFluff: true,
      reason: 'TOO_FEW_UNIQUE_WORDS',
      count: uniqueWords.size,
      threshold: SYNTHESIS_THRESHOLDS.minUniqueWords,
      confidence: 0.7,
    };
  }

  // Check URL ratio
  const urlMatches = trimmed.match(/https?:\/\/\S+/g) || [];
  const urlLength = urlMatches.join('').length;
  const urlRatio = urlLength / trimmed.length;

  if (urlRatio > SYNTHESIS_THRESHOLDS.maxUrlRatio) {
    return {
      isFluff: true,
      reason: 'TOO_MANY_URLS',
      ratio: urlRatio,
      threshold: SYNTHESIS_THRESHOLDS.maxUrlRatio,
      confidence: 0.75,
    };
  }

  // Check for source title repetition
  if (sourceData.length > 0) {
    const sourceTitles = sourceData
      .flatMap(d => d.data?.results || [])
      .map(r => r.title?.toLowerCase())
      .filter(Boolean);

    let titleMatches = 0;
    for (const title of sourceTitles) {
      if (title && trimmed.toLowerCase().includes(title)) {
        titleMatches++;
      }
    }

    // If response mostly just lists source titles
    if (sourceTitles.length > 0 && titleMatches >= sourceTitles.length * 0.8) {
      // Check if there's synthesis beyond just titles
      let contentWithoutTitles = trimmed.toLowerCase();
      for (const title of sourceTitles) {
        contentWithoutTitles = contentWithoutTitles.replace(title, '');
      }

      const remainingWords = contentWithoutTitles
        .replace(/[^\p{L}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);

      if (remainingWords.length < 20) {
        return {
          isFluff: true,
          reason: 'JUST_SOURCE_TITLES',
          titleMatches,
          totalTitles: sourceTitles.length,
          confidence: 0.85,
        };
      }
    }
  }

  // Count sentences (rough heuristic)
  const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length < SYNTHESIS_THRESHOLDS.minSentences) {
    return {
      isFluff: true,
      reason: 'TOO_FEW_SENTENCES',
      count: sentences.length,
      threshold: SYNTHESIS_THRESHOLDS.minSentences,
      confidence: 0.6,
    };
  }

  return { isFluff: false, confidence: 0.0 };
}

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 KOLO 4.2 — Atomic Answer Gate
// ════════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// If ResponseIntent === MINIMAL or ConversationStyle.prefersMinimal === true:
// - Response MUST be 1 sentence
// - NO intro phrases ("Ano, zde je...")
// - NO explanations
// - NO offers
// - NO links
//
// ════════════════════════════════════════════════════════════════════════════════

// Patterns FORBIDDEN in atomic answers
const ATOMIC_FORBIDDEN_PATTERNS = [
  /^ano[,\s]/i,
  /^samozřejmě/i,
  /^jistě/i,
  /zde je/i,
  /tady je/i,
  /here is/i,
  /here's/i,
  /mohu (případně|také)/i,
  /can also/i,
  /pokud chcete/i,
  /if you want/i,
  /chcete.*\?/i,
  /want.*\?/i,
  /https?:\/\//i,  // No links
];

/**
 * Count sentences in text (for atomic validation)
 * @param {string} text - Text to analyze
 * @returns {number} Sentence count
 */
function countSentences(text) {
  if (!text) return 0;
  // Split on sentence terminators, filter out empty/short fragments
  return text
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 3)
    .length;
}

/**
 * v45.0 KOLO 4.2: Atomic Answer Gate
 * Validates that MINIMAL responses are truly atomic.
 *
 * @param {string} content - Response content
 * @param {Object} options - Validation options
 * @param {string} options.responseIntent - Current ResponseIntent
 * @param {boolean} options.prefersMinimal - ConversationStyle.prefersMinimal
 * @returns {{ pass: boolean, reason?: string, violation?: string }}
 */
function atomicAnswerGate(content, options = {}) {
  const { responseIntent, prefersMinimal } = options;

  // Gate only applies to MINIMAL responses
  if (responseIntent !== 'MINIMAL' && !prefersMinimal) {
    return { pass: true };
  }

  if (!content || typeof content !== 'string') {
    return { pass: false, reason: 'EMPTY_RESPONSE' };
  }

  const trimmed = content.trim();

  // Check forbidden patterns
  for (const pattern of ATOMIC_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        pass: false,
        reason: 'FORBIDDEN_PATTERN',
        violation: pattern.toString(),
      };
    }
  }

  // Check sentence count (must be 1)
  const sentences = countSentences(trimmed);
  if (sentences > 1) {
    return {
      pass: false,
      reason: 'TOO_MANY_SENTENCES',
      count: sentences,
    };
  }

  // Check length (atomic should be < 150 chars typically)
  if (trimmed.length > 200) {
    return {
      pass: false,
      reason: 'TOO_LONG',
      length: trimmed.length,
    };
  }

  return { pass: true };
}

/**
 * Build atomic retry prompt when atomic gate fails
 * @param {string} originalPrompt - Original prompt
 * @param {Object} gateResult - Result from atomicAnswerGate
 * @returns {string} Modified prompt for retry
 */
function buildAtomicRetryPrompt(originalPrompt, gateResult) {
  return `${originalPrompt}

⚠️ ATOMIC RESPONSE REQUIRED — ONE SENTENCE ONLY!

Your previous response failed the atomic gate: ${gateResult.reason}
${gateResult.violation ? `Pattern violated: ${gateResult.violation}` : ''}
${gateResult.count ? `You wrote ${gateResult.count} sentences, but only 1 is allowed.` : ''}

RULES:
- EXACTLY 1 sentence
- NO "Ano,", "Samozřejmě,", "Zde je..."
- NO explanations
- NO links
- NO offers

Example good responses:
- "45 230 USD"
- "Bitcoin je kryptoměna."
- "Ano."
`;
}

/**
 * v45.0 FIX 3.3 - Build retry prompt for fluff response
 *
 * @param {string} originalPrompt - The original synthesis prompt
 * @param {Object} fluffInfo - Info about why it was fluff
 * @returns {string} Improved prompt for retry
 */
function buildRetryPrompt(originalPrompt, fluffInfo) {
  let addition = '\n\n⚠️ CRITICAL: Your previous response was insufficient.\n';

  switch (fluffInfo.reason) {
    case 'JUST_SOURCE_TITLES':
      addition += `DO NOT just list source titles.
SYNTHESIZE the information into a coherent answer.
Add your own analysis, connections, and conclusions.`;
      break;

    case 'TOO_MANY_URLS':
      addition += `Your response had too many URLs and not enough synthesis.
Focus on EXPLAINING the information, not just linking to it.
Include URLs only at the end as sources.`;
      break;

    case 'TOO_FEW_UNIQUE_WORDS':
      addition += `Your response was too brief or repetitive.
Provide a more thorough, detailed synthesis.
Use varied vocabulary and explain concepts fully.`;
      break;

    case 'FLUFF_PATTERN_MATCH':
      addition += `Your response was generic filler.
Provide SPECIFIC information from the data.
Answer the user's question directly with concrete details.`;
      break;

    default:
      addition += `Provide a more substantial, synthesized response.
Don't just list data - analyze and explain it.`;
  }

  return originalPrompt + addition;
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 - LLM Synthesis Layer
// ─────────────────────────────────────────────────────────────────────────────
// Tools return DATA only — this function synthesizes human-readable responses
// using the LLM. The LLM generates all user-facing text, not tools.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * synthesizeWithLLM - Generate human response from tool data
 *
 * v45.0 - Core architecture change: Tools return DATA, LLM generates RESPONSE
 * v45.0 FIX 3.3 - Confidence gate: detect fluff, retry with improved prompt
 *
 * @param {Object} options
 * @param {string} options.query - Original user query
 * @param {string} options.intent - Detected intent (SEARCH, REPORT, etc.)
 * @param {Array} options.toolResults - Array of ToolResult objects from execution
 * @param {Object} options.context - Handler context (sessionId, history, etc.)
 * @param {Object} options.userPreferences - Optional user preferences (verbosity, structure)
 * @param {Object} options.expertHints - Optional expert synthesis hints (v45.0 Phase 3)
 * @param {string} options.responseIntent - Optional ResponseIntent (v45.0 KOLO 3)
 * @returns {Promise<{ content: string, confidence: number, model: string }>}
 */
async function synthesizeWithLLM({
  query,
  intent,
  toolResults,
  context = {},
  userPreferences = {},
  expertHints = null,
  responseIntent = null,
}) {
  // Extract successful results' data
  const successfulData = toolResults
    .filter(r => r.success !== false)
    .map(r => ({
      type: r.type,
      data: r.data,
      meta: r.meta,
    }));

  // Extract failure info for context
  const failures = toolResults
    .filter(r => r.success === false)
    .map(r => ({
      type: r.type,
      error: r.error,
      errorCode: r.errorCode,
    }));

  // If no successful data, return degraded response
  if (successfulData.length === 0) {
    return {
      content: buildSynthesisFailureResponse(query, failures),
      confidence: 0.3,
      model: 'fallback',
    };
  }

  // Build synthesis prompt
  let synthesisPrompt = buildSynthesisPrompt({
    query,
    intent,
    data: successfulData,
    failures,
    userPreferences,
    expertHints,  // v45.0 Phase 3
  });

  // Build system prompt for synthesis (includes expert hints + responseIntent)
  const systemPrompt = buildSynthesisSystemPrompt(intent, userPreferences, expertHints, responseIntent);

  // v45.0 FIX 3.3: Maximum retry attempts for fluff
  const MAX_RETRIES = 1;
  let retryCount = 0;

  try {
    // Lazy import CRE bridge
    const creBridge = await import('../llm/cre-bridge.js');

    while (retryCount <= MAX_RETRIES) {
      // Call LLM to synthesize response
      const result = await creBridge.generateChatResponse(synthesisPrompt, systemPrompt, {
        sessionId: `synth-${context.sessionId || 'default'}`,
        temperature: retryCount === 0 ? 0.4 : 0.5, // Slightly higher temp on retry
      });

      // Validate response (forbidden phrases)
      const validation = creDecisionEngine.validateResponse(result.content);
      if (!validation.valid) {
        logger.warn('SynthesizeWithLLM', 'LLM generated forbidden phrase in synthesis', {
          violations: validation.violations,
          intent,
        });
      }

      // v45.0 FIX 3.3: Check for fluff
      const fluffCheck = detectFluff(result.content, successfulData);

      if (fluffCheck.isFluff && retryCount < MAX_RETRIES) {
        logger.warn('SynthesizeWithLLM', 'Fluff detected, retrying with improved prompt', {
          reason: fluffCheck.reason,
          confidence: fluffCheck.confidence,
          retryCount,
        });

        // Build improved prompt for retry
        synthesisPrompt = buildRetryPrompt(synthesisPrompt, fluffCheck);
        retryCount++;
        continue;
      }

      // Log if fluff but max retries reached
      if (fluffCheck.isFluff) {
        logger.warn('SynthesizeWithLLM', 'Fluff detected but max retries reached', {
          reason: fluffCheck.reason,
        });
      }

      return {
        content: result.content,
        confidence: fluffCheck.isFluff ? 0.6 : 0.85,  // Lower confidence if still fluff
        model: result.model,
        duration: result.duration,
        retried: retryCount > 0,
      };
    }

    // Should not reach here, but fallback just in case
    return {
      content: buildBasicSynthesis(query, intent, successfulData),
      confidence: 0.5,
      model: 'fallback',
    };

  } catch (err) {
    logger.error('SynthesizeWithLLM', `LLM synthesis failed: ${err.message}`);

    // Fallback: build basic response from data without LLM
    return {
      content: buildBasicSynthesis(query, intent, successfulData),
      confidence: 0.5,
      model: 'fallback',
    };
  }
}

/**
 * Build the prompt for LLM synthesis
 * v45.0 Phase 3: Added expertHints support
 */
function buildSynthesisPrompt({ query, intent, data, failures, userPreferences, expertHints = null }) {
  let prompt = `User query: "${query}"\n\n`;
  prompt += `Intent: ${intent}\n\n`;

  // v45.0 FIX 1.3: Apply adaptive result count before sending to LLM
  const adaptedData = applyAdaptiveResultCount(data, query, intent);

  // Add tool data
  prompt += `Tool execution data:\n`;
  prompt += '```json\n';
  prompt += JSON.stringify(adaptedData, null, 2);
  prompt += '\n```\n\n';

  // Add failure info if any
  if (failures.length > 0) {
    prompt += `Note: Some tools failed:\n`;
    failures.forEach(f => {
      prompt += `- ${f.type}: ${f.error}\n`;
    });
    prompt += '\n';
  }

  // Add user preferences if any (v45.0)
  const prefLines = [];
  if (userPreferences.verbosity) {
    prefLines.push(`verbosity: ${userPreferences.verbosity}`);
  }
  if (userPreferences.structure) {
    prefLines.push(`structure: ${userPreferences.structure}`);
  }
  if (userPreferences.followUpStyle) {
    prefLines.push(`follow-up style: ${userPreferences.followUpStyle}`);
  }
  if (userPreferences.technicalDepth) {
    prefLines.push(`technical depth: ${userPreferences.technicalDepth}`);
  }

  if (prefLines.length > 0) {
    prompt += `User preferences: ${prefLines.join(', ')}\n`;
  }

  // v45.0 Phase 3: Add expert hints if active
  if (expertHints?.active) {
    prompt += `\nExpert mode: ${expertHints.expertName} (${Math.round(expertHints.influence * 100)}% intensity)\n`;
    if (expertHints.systemAddition) {
      prompt += `Expert guidance: ${expertHints.systemAddition}\n`;
    }
  }

  prompt += `\nSynthesize a helpful response based on this data.`;

  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 FIX 1.3 - Adaptive Result Count
// ─────────────────────────────────────────────────────────────────────────────
// Dynamically determine how many results to include based on:
// - Query type (list query = more results, specific query = fewer)
// - Result relevance (high-match results get priority)
// - Intent type (REPORT needs more, FACTUAL needs fewer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine if query is asking for a list/multiple results
 */
function isListQuery(query) {
  const listPatterns = [
    /nejlepší|top|seznam|list|přehled|porovn|srovn/i,  // "nejlepší", "top", "seznam", "list", "přehled", "porovnej"
    /všechny|všech|multiple|several|many/i,            // "všechny", "všech"
    /\d+\s*(nejlepší|top|možností|options)/i,          // "5 nejlepších", "10 top"
    /kolik|how many/i,                                  // "kolik", "how many"
  ];
  return listPatterns.some(p => p.test(query));
}

/**
 * Determine if query is asking for a specific answer
 */
function isSpecificQuery(query) {
  const specificPatterns = [
    /co je|what is|who is|kdo je/i,                    // "co je", "what is", "kdo je"
    /kdy|when|kolik stojí|how much/i,                  // "kdy", "when", "kolik stojí"
    /^najdi\s+\w+$/i,                                  // "najdi X" (single item)
    /konkrétní|specific|exact/i,                       // "konkrétní", "specific"
  ];
  return specificPatterns.some(p => p.test(query));
}

/**
 * Calculate relevance score for a search result
 * @param {Object} result - Search result { title, url, snippet }
 * @param {string} query - User query
 * @returns {number} Score 0-1
 */
function calculateRelevanceScore(result, query) {
  if (!result || !query) return 0;

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let score = 0;
  let maxScore = queryWords.length * 3; // title=3pts, snippet=2pts, url=1pt

  const title = (result.title || '').toLowerCase();
  const snippet = (result.snippet || '').toLowerCase();
  const url = (result.url || '').toLowerCase();

  for (const word of queryWords) {
    if (title.includes(word)) score += 3;
    if (snippet.includes(word)) score += 2;
    if (url.includes(word)) score += 1;
  }

  return maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
}

/**
 * Apply adaptive result count to tool data
 * @param {Array} data - Tool result data array
 * @param {string} query - User query
 * @param {string} intent - Detected intent
 * @returns {Array} Filtered data with appropriate result count
 */
function applyAdaptiveResultCount(data, query, intent) {
  return data.map(item => {
    // Only apply to search results
    if (item.type !== 'search' || !item.data?.results) {
      return item;
    }

    const results = item.data.results;

    // Determine target count based on query type and intent
    let targetCount;
    const isList = isListQuery(query);
    const isSpecific = isSpecificQuery(query);

    if (intent === 'REPORT') {
      // REPORT always needs comprehensive data
      targetCount = isList ? 10 : 5;
    } else if (intent === 'FACTUAL') {
      // FACTUAL needs fewer, focused results
      targetCount = isSpecific ? 1 : 3;
    } else if (intent === 'SEARCH') {
      // SEARCH adapts to query type
      targetCount = isList ? 8 : (isSpecific ? 2 : 5);
    } else {
      // Default
      targetCount = 5;
    }

    // Calculate relevance scores and sort
    const scoredResults = results.map(r => ({
      ...r,
      relevanceScore: calculateRelevanceScore(r, query),
    }));

    // Sort by relevance
    scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Apply minimum relevance threshold for non-list queries
    let filteredResults = scoredResults;
    if (!isList && scoredResults.length > 1) {
      const minRelevance = 0.2; // Minimum 20% relevance
      filteredResults = scoredResults.filter(r => r.relevanceScore >= minRelevance);

      // Always keep at least 1 result
      if (filteredResults.length === 0) {
        filteredResults = [scoredResults[0]];
      }
    }

    // Apply target count
    const finalResults = filteredResults.slice(0, targetCount);

    logger.debug('AdaptiveResultCount', 'Applied adaptive filtering', {
      originalCount: results.length,
      filteredCount: finalResults.length,
      targetCount,
      isList,
      isSpecific,
      intent,
    });

    // Return modified item with filtered results
    return {
      ...item,
      data: {
        ...item.data,
        results: finalResults,
        originalCount: results.length,
        adaptiveFiltered: true,
      },
    };
  });
}

/**
 * Build system prompt for synthesis based on intent
 * v45.0 Phase 3: Added expertHints support
 */
function buildSynthesisSystemPrompt(intent, userPreferences, expertHints = null, responseIntent = null) {
  let basePrompt = `You are a response synthesizer. Your job is to take tool execution data and create a helpful, well-structured response for the user.

CRITICAL RULES:
1. ONLY use information from the provided tool data - do not make up facts
2. Be concise and relevant to the user's query
3. Use markdown formatting for readability
4. If data is limited, acknowledge it but still provide what you can
5. NEVER say "I cannot access" or "I don't have access" - you have the data!

FORBIDDEN PHRASES (never use these):
${FORBIDDEN_PHRASES.slice(0, 5).map(p => `- "${p}"`).join('\n')}`;

  // v45.0 Phase 3: Add expert style hints
  if (expertHints?.active && expertHints.influence >= 0.25) {
    basePrompt += `\n\nEXPERT MODE (${expertHints.expertName}):`;

    // Add style based on weight
    switch (expertHints.style) {
      case 'creative':
        basePrompt += '\n- Use creative, expressive language';
        break;
      case 'technical':
        basePrompt += '\n- Use precise technical terminology';
        break;
      case 'formal':
        basePrompt += '\n- Maintain formal, professional tone';
        break;
      case 'casual':
        basePrompt += '\n- Use friendly, approachable language';
        break;
    }

    // Add depth based on weight
    switch (expertHints.depth) {
      case 'deep':
        basePrompt += '\n- Provide thorough, detailed explanations';
        break;
      case 'shallow':
        basePrompt += '\n- Keep explanations brief and focused';
        break;
    }

    // Add caution based on weight
    if (expertHints.caution === 'high') {
      basePrompt += '\n- Include disclaimers and caveats where appropriate';
      basePrompt += '\n- Emphasize limitations and risks';
    }

    // Add custom system addition if influence is high enough
    if (expertHints.influence >= 0.5 && expertHints.systemAddition) {
      basePrompt += `\n- ${expertHints.systemAddition}`;
    }
  }

  // Intent-specific additions
  const intentPrompts = {
    SEARCH: `
FORMAT:
- Lead with the most relevant information
- Include source URLs when available
- Keep it factual and concise`,

    REPORT: `
FORMAT:
- Use clear section headers
- Summarize key points first
- Include sources at the end
- Be comprehensive but structured`,

    FACTUAL: `
FORMAT:
- Direct answer first
- Brief explanation if needed
- Source citation if available`,
  };

  let prompt = basePrompt;
  if (intentPrompts[intent]) {
    prompt += intentPrompts[intent];
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // v45.0 KOLO 3: RESPONSE INTENT FORMATTING
  // ResponseIntent controls HOW to present the answer (user-driven formatting)
  // This OVERRIDES default Intent formatting when user explicitly requests it
  // ════════════════════════════════════════════════════════════════════════════════

  if (responseIntent) {
    const responseIntentInstructions = {
      DIRECT: `
RESPONSE STYLE: DIRECT
- Answer in one clear sentence or short paragraph
- No headers, no bullet lists, no preamble
- Get straight to the point`,

      SUMMARY: `
RESPONSE STYLE: SUMMARY
- Condense the information to its essence
- Maximum 2-3 sentences
- Focus on the single most important takeaway
- No elaboration, no examples`,

      BULLETS: `
RESPONSE STYLE: BULLETS
- MANDATORY: Use bullet points only
- No paragraphs, no headers
- Each bullet: one key point (5-15 words)
- Order from most to least important`,

      COMPARISON: `
RESPONSE STYLE: COMPARISON
- Use a side-by-side format (table or parallel lists)
- Highlight key differences clearly
- Include both similarities AND differences
- End with a brief verdict if appropriate`,

      STEP_BY_STEP: `
RESPONSE STYLE: STEP-BY-STEP
- Use numbered steps (1, 2, 3...)
- Each step: clear, actionable instruction
- Include prerequisites if any
- One action per step`,

      EXPLORATORY: `
RESPONSE STYLE: EXPLORATORY
- Present multiple options/directions
- Don't commit to one answer
- Offer trade-offs for each option
- Invite user to narrow down preference`,

      OPINIONATED: `
RESPONSE STYLE: OPINIONATED
- Give a clear recommendation
- State your reasoning (2-3 points)
- Acknowledge alternatives briefly
- Be confident but not dismissive`,

      MINIMAL: `
RESPONSE STYLE: MINIMAL
- Absolute minimum words needed
- Just the answer: number, date, yes/no, name
- No explanation, no context, no sources
- Example: "42", "January 28, 2026", "Yes"`,
    };

    if (responseIntentInstructions[responseIntent]) {
      prompt += `

════════════════════════════════════════════════════════════════════════════════
🎯 USER REQUESTED FORMAT — FOLLOW EXACTLY
════════════════════════════════════════════════════════════════════════════════
${responseIntentInstructions[responseIntent]}
════════════════════════════════════════════════════════════════════════════════`;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // v45.0 KOLO 2: STRICT PREFERENCE ENFORCEMENT
  // These are REQUIREMENTS, not suggestions. Violating them is an error.
  // ════════════════════════════════════════════════════════════════════════════════

  const strictPreferences = [];

  // Verbosity - STRICT
  if (userPreferences.verbosity === 'minimal' || userPreferences.verbosity === 'brief') {
    strictPreferences.push('VERBOSITY: MINIMAL — Maximum 3 sentences. No fluff, no filler, no preambles.');
  } else if (userPreferences.verbosity === 'detailed') {
    strictPreferences.push('VERBOSITY: DETAILED — Provide thorough explanations with examples and context.');
  } else {
    strictPreferences.push('VERBOSITY: NORMAL — Balanced responses, neither too brief nor too verbose.');
  }

  // Structure - STRICT
  if (userPreferences.structure === Structure.BULLETS || userPreferences.structure === 'bullets') {
    strictPreferences.push('STRUCTURE: BULLETS — You MUST use bullet points. Paragraphs are forbidden.');
  } else if (userPreferences.structure === Structure.PARAGRAPHS || userPreferences.structure === 'paragraphs') {
    strictPreferences.push('STRUCTURE: PARAGRAPHS — You MUST use flowing prose. Bullet lists are forbidden.');
  } else {
    strictPreferences.push('STRUCTURE: MIXED — Use appropriate formatting based on content.');
  }

  // Follow-up style - STRICT
  if (userPreferences.followUpStyle === FollowUpStyle.CONCISE || userPreferences.followUpStyle === 'concise') {
    strictPreferences.push('FOLLOW-UP STYLE: CONCISE — Keep responses brief and direct. No repetition of previous context.');
  } else if (userPreferences.followUpStyle === FollowUpStyle.COMPREHENSIVE || userPreferences.followUpStyle === 'comprehensive') {
    strictPreferences.push('FOLLOW-UP STYLE: COMPREHENSIVE — Include full context even if repeating previous information.');
  }

  if (strictPreferences.length > 0) {
    prompt += `

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT USER PREFERENCES — THESE ARE REQUIREMENTS, NOT SUGGESTIONS!
═══════════════════════════════════════════════════════════════════════════════

${strictPreferences.map(p => `• ${p}`).join('\n')}

VIOLATION OF THESE PREFERENCES IS AN ERROR. Follow them exactly.
═══════════════════════════════════════════════════════════════════════════════`;
  }

  return prompt;
}

/**
 * Build fallback response when synthesis fails
 */
function buildSynthesisFailureResponse(query, failures) {
  let content = `⚠️ **Nepodařilo se získat data pro váš dotaz**\n\n`;
  content += `**Dotaz:** ${query}\n\n`;

  if (failures.length > 0) {
    content += `**Problémy:**\n`;
    failures.forEach(f => {
      content += `- ${f.type}: ${f.error || 'neznámá chyba'}\n`;
    });
  }

  content += `\nZkuste to prosím znovu nebo přeformulujte dotaz.`;

  return content;
}

/**
 * Build basic synthesis without LLM (emergency fallback)
 */
function buildBasicSynthesis(query, intent, data) {
  let content = '';

  // Handle search results
  const searchData = data.find(d => d.type === 'search');
  if (searchData?.data?.results) {
    content += `📊 **Výsledky vyhledávání**\n\n`;
    searchData.data.results.slice(0, 5).forEach((r, i) => {
      content += `${i + 1}. **${r.title || 'Bez názvu'}**\n`;
      if (r.url) content += `   🔗 ${r.url}\n`;
      if (r.snippet) content += `   ${r.snippet}\n`;
      content += '\n';
    });
  }

  // Handle scrape results
  const scrapeData = data.find(d => d.type === 'scrape');
  if (scrapeData?.data?.content) {
    content += `📄 **Obsah stránky**\n\n`;
    content += scrapeData.data.content.substring(0, 1000);
    if (scrapeData.data.content.length > 1000) content += '...';
    content += '\n';
  }

  // Handle local computation
  const localData = data.find(d => d.type === 'local');
  if (localData?.data) {
    content += `📊 **Výsledek:** ${JSON.stringify(localData.data)}\n`;
  }

  return content || `Dotaz: ${query}\n\nData zpracována, ale bez možnosti syntézy.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 FIX 1.4 - Follow-up Detection
// ─────────────────────────────────────────────────────────────────────────────
// Distinguish between:
// - FORMAT_CHANGE: User wants same data in different format ("kratší", "v tabulce")
// - NEW_QUERY: User is asking something completely new
// - REFINEMENT: User is refining the previous query ("jen benzínová")
// ─────────────────────────────────────────────────────────────────────────────

export const FollowUpType = {
  FORMAT_CHANGE: 'FORMAT_CHANGE',  // Same data, different presentation
  REFINEMENT: 'REFINEMENT',        // Same topic, narrower focus
  NEW_QUERY: 'NEW_QUERY',          // Completely different topic
  CONTINUATION: 'CONTINUATION',    // Continue discussing same topic
};

/**
 * Detect the type of follow-up based on current input and session context
 *
 * @param {string} input - Current user input
 * @param {Object} sessionState - Session state with history
 * @returns {{ type: string, confidence: number, reusePreviousData: boolean }}
 */
function detectFollowUpType(input, sessionState) {
  const lastDecision = sessionState?.lastDecision;
  const lastInput = sessionState?.lastUserInput;

  // No history = definitely new query
  if (!lastDecision || !lastInput) {
    return { type: FollowUpType.NEW_QUERY, confidence: 1.0, reusePreviousData: false };
  }

  const inputLower = input.toLowerCase().trim();

  // ════════════════════════════════════════════════════════════════════════════
  // Pattern 1: FORMAT_CHANGE - user wants different presentation
  // v45.0 FIX: Patterns without ^ to match anywhere in input
  // ════════════════════════════════════════════════════════════════════════════
  const formatChangePatterns = [
    // Shorter/longer/summary (CZ + EN)
    /(kratší|zkrať|stručněji|brief|shorter|delší|podrobněji|more detail)/i,
    /(shrnout|shrň|sumarizuj|summarize|shrnutí|summary)/i,
    // Structure changes
    /(v tabulce|as table|jako seznam|as list|v bodech|bullet|odrážk)/i,
    /(ve formě|in form of|formát|format)/i,
    // Style changes
    /(jednodušeji|simpler|formálněji|more formal|neformálně|informal)/i,
    // Explicit reformat requests
    /(přepiš|rewrite|změň formát|change format|přeformátuj|reformat)/i,
    // "teď to..." or "můžeš to..." followed by style word
    /(teď to|můžeš to|dej mi to|give me|can you).*(jinak|kratší|delší|stručněji|podrobněji|v bodech)/i,
  ];

  if (formatChangePatterns.some(p => p.test(inputLower))) {
    return {
      type: FollowUpType.FORMAT_CHANGE,
      confidence: 0.9,
      reusePreviousData: true,  // Re-use previous tool data!
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Pattern 2: REFINEMENT - narrowing down previous query
  // ════════════════════════════════════════════════════════════════════════════
  const refinementPatterns = [
    // Filter additions
    /^(jen|pouze|only|just|bez|without|s |with )/i,
    // Constraints
    /^(do \d|pod \d|nad \d|max |min |levnější|cheaper|dražší)/i,
    // Selections
    /^(první|první tři|top \d|ten první|the first)/i,
    // Specific aspect
    /^(konkrétně|specifically|hlavně|mainly|especially)/i,
  ];

  if (refinementPatterns.some(p => p.test(inputLower))) {
    return {
      type: FollowUpType.REFINEMENT,
      confidence: 0.85,
      reusePreviousData: false,  // Need new search with refinement
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Pattern 3: CONTINUATION - discussing same topic
  // ════════════════════════════════════════════════════════════════════════════
  // Short inputs that reference previous context
  const isContinuation =
    inputLower.length < 30 &&
    (inputLower.includes('to') ||      // "řekni mi o tom víc"
     inputLower.includes('tenhle') ||  // "tenhle"
     inputLower.includes('tohle') ||   // "tohle"
     inputLower.includes('ten') ||     // "ten první"
     inputLower.includes('it') ||      // "tell me more about it"
     inputLower.includes('this'));     // "this one"

  if (isContinuation && lastDecision.intent !== IntentType.CONVERSATIONAL) {
    return {
      type: FollowUpType.CONTINUATION,
      confidence: 0.7,
      reusePreviousData: true,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Pattern 4: NEW_QUERY - detect topic change
  // ════════════════════════════════════════════════════════════════════════════
  // Check if input shares keywords with last query
  const lastWords = new Set(
    lastInput.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  const currentWords = inputLower.split(/\s+/).filter(w => w.length > 3);
  const sharedWords = currentWords.filter(w => lastWords.has(w));

  // If no shared keywords and input is substantial, it's likely new
  if (sharedWords.length === 0 && currentWords.length >= 2) {
    return {
      type: FollowUpType.NEW_QUERY,
      confidence: 0.8,
      reusePreviousData: false,
    };
  }

  // Default: treat as continuation if there's some keyword overlap
  if (sharedWords.length > 0) {
    return {
      type: FollowUpType.CONTINUATION,
      confidence: 0.6,
      reusePreviousData: false,
    };
  }

  // Fallback: new query
  return {
    type: FollowUpType.NEW_QUERY,
    confidence: 0.5,
    reusePreviousData: false,
  };
}

/**
 * Get previous tool data from session state if available
 * Used for FORMAT_CHANGE follow-ups to avoid re-fetching
 */
function getPreviousToolData(sessionState) {
  if (!sessionState?.lastToolResults) {
    return null;
  }

  // Check if data is still fresh (within 5 minutes)
  const dataAge = Date.now() - (sessionState.lastToolResultsTimestamp || 0);
  const maxAge = 5 * 60 * 1000; // 5 minutes

  if (dataAge > maxAge) {
    logger.debug('FollowUpDetection', 'Previous tool data expired', { dataAge, maxAge });
    return null;
  }

  return sessionState.lastToolResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.2 - Clarification Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to resolve pending clarification from user input
 *
 * @param {string} input - User's clarification response
 * @param {SessionState} sessionState - Current session state with pending decision
 * @param {Object} context - Request context
 * @returns {Object|null} - Resolved decision or null if not resolved
 */
function tryResolveClarification(input, sessionState, context) {
  const pendingDecision = sessionState.pendingDecision;
  const awaitingSlots = sessionState.awaitingSlots;
  const lastUserInput = sessionState.lastUserInput;

  if (!pendingDecision) {
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 1: NEW STRONG INTENT = HARD RESET
  // ════════════════════════════════════════════════════════════════════════════
  // If user's input is a NEW clear intent (not a clarification), clear pending
  // and let normal flow handle it. This prevents:
  // - "kdy bude úplněk?" → ASK_USER → "napiš báseň" → still ASK_USER (BUG!)
  // ════════════════════════════════════════════════════════════════════════════
  const newIntent = creDecisionEngine.classifyIntent(input);

  // Strong intents that should NEVER be treated as clarification
  const STRONG_INTENTS = [
    IntentType.LOCAL,           // "kdy bude úplněk?" - clear intent
    IntentType.CONVERSATIONAL,  // "napiš báseň" - clear intent
    IntentType.CODE,            // "napiš funkci" - clear intent
    IntentType.REPORT,          // "dej mi souhrn" - clear intent
    IntentType.CREATIVE,        // v44.8: "vymyslet kampaň", "dej mi nápady" - clear intent
  ];

  if (STRONG_INTENTS.includes(newIntent)) {
    logger.info('TryResolveClarification', 'New strong intent detected, clearing pendingDecision', {
      newIntent,
      input: input.substring(0, 50),
      previousPending: pendingDecision?.intent,
    });
    sessionState.clearPendingDecision();
    return null; // Let normal flow handle this new intent
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 2: ASK_USER MAX 1× LIMIT
  // ════════════════════════════════════════════════════════════════════════════
  // If we've already asked for clarification once, don't ask again.
  // Clear pending and process as new input.
  // ════════════════════════════════════════════════════════════════════════════
  if (pendingDecision.attempts >= 1) {
    logger.warn('TryResolveClarification', 'Max clarification attempts reached, clearing pendingDecision', {
      attempts: pendingDecision.attempts,
      input: input.substring(0, 50),
    });
    sessionState.clearPendingDecision();

    // v44.7 FIX: Return ANSWER instead of null to prevent CRE from returning ASK_USER again
    // After max attempts, we must process the input as-is without further clarification
    return {
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.5,
      reason: 'Max clarification attempts reached - processing as conversational',
      metadata: {
        maxAttemptsReached: true,
        originalInput: input,
      },
      toJSON() { return this; },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 5: CLARIFICATION CONTENT RESPECTING
  // v44.7 FIX: Returns DecisionType.LOCAL (not TOOL_CALL!)
  // ════════════════════════════════════════════════════════════════════════════
  // If user says "chci datum", "jen datum", "bez odkazů" → LOCAL intent
  // ════════════════════════════════════════════════════════════════════════════
  if (/datum|číslo|jen datum|bez odkazů|no links|just.*date/i.test(input)) {
    logger.info('TryResolveClarification', 'User requested local/direct response', {
      input: input.substring(0, 50),
    });
    sessionState.clearPendingDecision();
    return {
      type: DecisionType.LOCAL,  // v44.7: LOCAL, not TOOL_CALL!
      intent: IntentType.LOCAL,
      tools: [],                  // No tools for LOCAL
      confidence: 0.9,
      reason: 'User explicitly requested local/direct response (datum/bez odkazů)',
      metadata: {
        handler: 'local.date',
        localComputation: true,
      },
      toJSON() { return this; },
    };
  }

  const normalizedInput = input.toLowerCase().trim();

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Intent clarification (user replied with intent keyword)
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('intent_clarification')) {
    // Check for single-word keyword match
    const resolvedIntent = CLARIFICATION_KEYWORDS[normalizedInput];

    if (resolvedIntent) {
      // User said "report", "search", "code", etc.
      return buildResolvedDecision(resolvedIntent, lastUserInput, context);
    }

    // Check for keyword within response (e.g., "chci report")
    for (const [keyword, intent] of Object.entries(CLARIFICATION_KEYWORDS)) {
      if (normalizedInput.includes(keyword)) {
        return buildResolvedDecision(intent, lastUserInput, context);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: Source/URL clarification (user provided URL or topic)
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('source')) {
    // Check if user provided a URL
    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        params: { url: urlMatch[0] },
        confidence: 0.9,
        reason: 'User provided URL for source clarification',
        toJSON() { return this; },
      };
    }

    // Otherwise treat as search topic
    if (normalizedInput.length > 2) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        params: { query: input },
        confidence: 0.85,
        reason: 'User provided search topic for source clarification',
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 3: Project context clarification
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('project_context') || awaitingSlots.includes('file_path')) {
    // Check if user said it's a general question (not project-specific)
    const generalPhrases = ['obecná', 'obecne', 'obecný', 'general', 'žádný projekt', 'zadny projekt'];
    if (generalPhrases.some(p => normalizedInput.includes(p))) {
      // Treat as general code question → ANSWER
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.FACTUAL,
        confidence: 0.85,
        reason: 'User indicated general question, not project-specific',
        toJSON() { return this; },
      };
    }

    // If user provides file path, use it
    const filePathMatch = input.match(/[./\\][\w./\\-]+\.\w+/);
    if (filePathMatch) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: IntentType.CODE,
        tools: ['file.read'],
        params: { path: filePathMatch[0] },
        confidence: 0.85,
        reason: 'User provided file path',
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 4: Tool failure - alternative action (v44.2)
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('alternative_action')) {
    const failedDecision = pendingDecision;

    // User wants to retry
    if (/znovu|retry|opakovat|zkus/i.test(normalizedInput)) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: failedDecision.failedTools || ['web.search'],
        params: { query: failedDecision.originalInput || lastUserInput },
        confidence: 0.8,
        reason: 'User requested retry after failure',
        toJSON() { return this; },
      };
    }

    // User provides alternative source/URL
    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        params: { url: urlMatch[0] },
        confidence: 0.9,
        reason: 'User provided alternative URL after failure',
        toJSON() { return this; },
      };
    }

    // User provides new search terms
    if (normalizedInput.length > 3 && !/^(ne|no|cancel|zrušit)$/i.test(normalizedInput)) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        params: { query: input },
        confidence: 0.85,
        reason: 'User provided reformulated query after failure',
        toJSON() { return this; },
      };
    }

    // User cancelled
    if (/^(ne|no|cancel|zrušit|stop)$/i.test(normalizedInput)) {
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        confidence: 0.9,
        reason: 'User cancelled after failure',
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 5: Goal drift confirmation (v44.4)
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('goal_drift_confirmation')) {
    const driftDecision = pendingDecision;

    // User confirmed - proceed with off-goal operation
    // v44.5 - Reset drift count since user explicitly confirmed
    if (/^(ano|yes|ok|pokračuj|jasně|fajn|jo)/i.test(normalizedInput)) {
      // Reset drift count - user made explicit choice
      if (sessionState?.resetDriftCount) {
        sessionState.resetDriftCount();
      }
      return {
        type: DecisionType.TOOL_CALL,
        intent: driftDecision.intent,
        tools: driftDecision.tools,
        params: { query: driftDecision.originalInput || lastUserInput },
        confidence: 0.9,
        reason: 'User confirmed goal drift - proceeding',
        metadata: { goalDriftConfirmed: true },
        toJSON() { return this; },
      };
    }

    // User declined - stay on goal
    // v44.5 - Reset drift count since user chose to stay on goal
    if (/^(ne|no|cancel|zrušit|stop|zpět)/i.test(normalizedInput)) {
      // Reset drift count - user returned to goal
      if (sessionState?.resetDriftCount) {
        sessionState.resetDriftCount();
      }
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        confidence: 0.9,
        reason: 'User declined goal drift - returning to project goal',
        metadata: { returnToGoal: true },
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 6: pendingDecision exists + input looks like clarification (v44.5)
  // ════════════════════════════════════════════════════════════════════════════
  // RULE: If pendingDecision exists, do NOT classify new intent.
  // Instead, use the pending intent to build a resolved decision.
  // ════════════════════════════════════════════════════════════════════════════

  if (pendingDecision && isClarification(input)) {
    const pendingIntent = pendingDecision.intent || IntentType.SEARCH;

    logger.info('TryResolveClarification', 'Using pendingDecision (fallback)', {
      pendingIntent,
      input: input.substring(0, 50),
      pendingType: pendingDecision.type,
    });

    // If pending was a TOOL_CALL that failed or was waiting, retry with original context
    if (pendingDecision.type === DecisionType.TOOL_CALL ||
        pendingDecision.type === 'TOOL_CALL_FAILED') {
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingIntent,
        tools: pendingDecision.tools || ['web.search'],
        params: {
          query: pendingDecision.originalInput || lastUserInput,
          clarification: input,
        },
        confidence: 0.8,
        reason: 'Resolved from pendingDecision with clarification input',
        toJSON() { return this; },
      };
    }

    // For other pending types, build standard resolved decision
    return buildResolvedDecision(pendingIntent, lastUserInput || input, context);
  }

  // Not resolved
  return null;
}

/**
 * Build a resolved decision based on clarified intent
 *
 * v44.2 - CRITICAL: Must return TOOL_CALL for SEARCH/REPORT/FACTUAL
 * "report" = TOOL_CALL, NEVER ASK_USER
 */
function buildResolvedDecision(intent, originalInput, context) {
  // Use valid ToolType values only
  const toolMapping = {
    [IntentType.SEARCH]: ['web.search'],
    [IntentType.REPORT]: ['web.search', 'web.scrape'],  // Fixed: data.analyze doesn't exist
    [IntentType.FACTUAL]: ['web.search'],
    [IntentType.CODE]: context.hasActiveProject ? ['file.read', 'file.write'] : [],
    [IntentType.CONVERSATIONAL]: [],
  };

  const tools = toolMapping[intent] || ['web.search'];

  // CONVERSATIONAL → ANSWER is OK
  if (intent === IntentType.CONVERSATIONAL) {
    return {
      type: DecisionType.ANSWER,
      intent,
      confidence: 0.9,
      reason: 'Resolved to CONVERSATIONAL - direct answer allowed',
      toJSON() { return this; },
    };
  }

  // CODE without project → ASK_USER for project context
  if (intent === IntentType.CODE && tools.length === 0) {
    return {
      type: DecisionType.ASK_USER,
      intent,
      slots: ['project_context'],
      confidence: 0.7,
      reason: 'CODE intent requires project context',
      toJSON() { return this; },
    };
  }

  // SEARCH/REPORT/FACTUAL → ALWAYS TOOL_CALL
  return {
    type: DecisionType.TOOL_CALL,
    intent,
    tools,
    params: { query: originalInput },
    confidence: 0.9,
    reason: `Clarification resolved: ${intent} → TOOL_CALL`,
    toJSON() { return this; },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.3 - Project Goal Alignment Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assess if an operation is aligned with the project goal
 * Simple heuristic check - not blocking, just logging
 *
 * @param {string} input - User input
 * @param {string} goal - Project goal
 * @param {string} intent - Detected intent
 * @returns {{ aligned: boolean, reason: string }}
 */
function assessGoalAlignment(input, goal, intent) {
  if (!goal || !input) {
    return { aligned: true, reason: 'No goal to check against' };
  }

  const inputLower = input.toLowerCase();
  const goalLower = goal.toLowerCase();

  // Extract keywords from goal (simple tokenization)
  const goalKeywords = goalLower
    .split(/[\s,.\-:;]+/)
    .filter(w => w.length > 3)
    .slice(0, 10);

  // Check if input contains any goal keywords
  const matchingKeywords = goalKeywords.filter(kw => inputLower.includes(kw));

  if (matchingKeywords.length > 0) {
    return { aligned: true, reason: `Matches goal keywords: ${matchingKeywords.join(', ')}` };
  }

  // Intent-based alignment
  // CODE intent in project mode is always considered aligned (working on the project)
  if (intent === IntentType.CODE) {
    return { aligned: true, reason: 'CODE intent in project context' };
  }

  // SEARCH/REPORT might be tangential - flag for review
  if (intent === IntentType.SEARCH || intent === IntentType.REPORT) {
    return {
      aligned: false,
      reason: `Search/Report may not be directly related to goal: "${goal.substring(0, 50)}"`,
    };
  }

  // Default: assume aligned
  return { aligned: true, reason: 'Default alignment' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Handler (with CRE Decision Logic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle conversation mode - uses CRE Decision Engine
 * Only allows direct LLM response for pure CONVERSATIONAL intent
 *
 * v44.2 - Now handles clarification resolution:
 * - If awaiting clarification, tries to resolve pending decision
 * - Single-word responses like "report" resolve AMBIGUOUS → REPORT
 */
export async function conversationHandler(input, context) {
  const { sessionId, sessionState } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - CHECK FOR PENDING CLARIFICATION
  // ════════════════════════════════════════════════════════════════════════════

  // v44.8: Track if we started as a clarification follow-up (for first-turn check)
  const wasClarificationFollowUp = sessionState?.awaitingClarification;

  if (sessionState?.awaitingClarification) {
    const resolvedDecision = tryResolveClarification(input, sessionState, context);

    if (resolvedDecision) {
      logger.info('ConversationHandler', 'Clarification resolved', {
        originalIntent: sessionState.getPendingIntent(),
        resolvedIntent: resolvedDecision.intent,
        resolvedType: resolvedDecision.type,
      });

      // Clear pending state and process resolved decision
      sessionState.clearPendingDecision();

      // Handle the resolved decision
      // v44.7: LOCAL must be handled FIRST (terminal decision)
      if (resolvedDecision.type === DecisionType.LOCAL) {
        return await handleLocalDecision(input, resolvedDecision, context);
      } else if (resolvedDecision.type === DecisionType.TOOL_CALL) {
        // v44.4 - Pass goalDriftConfirmed if set in metadata
        const enrichedContext = resolvedDecision.metadata?.goalDriftConfirmed
          ? { ...context, goalDriftConfirmed: true }
          : context;
        return await handleToolCallDecision(input, resolvedDecision, enrichedContext);
      } else if (resolvedDecision.type === DecisionType.ANSWER) {
        return await handleAnswerDecision(input, resolvedDecision, context);
      }
      // For other types, fall through to normal processing
    }

    // If clarification not resolved, continue with normal flow
    // but include context that we were waiting
    logger.info('ConversationHandler', 'Clarification not resolved, processing as new input', {
      pendingIntent: sessionState.getPendingIntent(),
    });
  }

  // STEP 1: Get CRE Decision
  // v44.8: Pass lastIntent from sessionState for sticky intent logic
  const decisionContext = {
    ...context,
    lastIntent: sessionState?.lastIntent,
    lastDecision: sessionState?.lastDecision,
  };
  let decision = creDecisionEngine.decide(input, decisionContext);

  // STEP 1.5: Fail-fast assertion - catch bugs early
  assertDecision(decision);

  // ════════════════════════════════════════════════════════════════════════════
  // v44.8 FIX: NO ASK_USER ON FIRST TURN
  // v44.9 FIX B: NO SEARCH/TOOL_CALL FOR VAGUE INPUTS ON FIRST TURN
  // ════════════════════════════════════════════════════════════════════════════
  // First message in conversation should NEVER be ASK_USER.
  // First message with vague input should NEVER be SEARCH.
  // Instead: give optimistic conversational answer.
  // ════════════════════════════════════════════════════════════════════════════
  // First turn = no previous decision AND no pending decision AND not a clarification follow-up
  // v44.8: Also check wasClarificationFollowUp to handle cases where pendingDecision was just cleared
  const isFirstTurn = !sessionState?.lastDecision &&
                      !sessionState?.lastUserInput &&
                      !sessionState?.pendingDecision &&
                      !wasClarificationFollowUp;

  // v44.9 FIX B: Vague inputs that should NOT trigger SEARCH on first turn
  const VAGUE_INPUT_PATTERNS = [
    /^něco$/i,                    // "něco"
    /^hm+$/i,                     // "hm", "hmm", "hmmm"
    /^idk$/i,                     // "idk"
    /^nevím$/i,                   // "nevím"
    /^test$/i,                    // "test"
    /^[.!?]+$/,                   // just punctuation
    /^.{1,3}$/,                   // 1-3 characters (too short)
  ];
  const isVagueInput = VAGUE_INPUT_PATTERNS.some(p => p.test(input.trim()));

  // v44.9 FIX B: Block SEARCH/TOOL_CALL on first turn for vague inputs
  if (isFirstTurn && isVagueInput && decision.type === DecisionType.TOOL_CALL) {
    logger.info('ConversationHandler', 'First turn SEARCH blocked for vague input - forcing CONVERSATIONAL', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    decision = {
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.6,
      reason: 'First turn vague input - optimistic conversational response instead of SEARCH',
      slots: [],
      metadata: {
        firstTurnOverride: true,
        vagueInputBlocked: true,
        originalIntent: decision.intent,
        inputPreview: input.substring(0, 100),
      },
      toJSON() { return this; },
    };
  }

  if (isFirstTurn && decision.type === DecisionType.ASK_USER) {
    logger.info('ConversationHandler', 'First turn ASK_USER blocked - forcing CREATIVE/CONVERSATIONAL answer', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    // Force CREATIVE if it looks like an ideation request, otherwise CONVERSATIONAL
    const isIdeation = /vymyslet|navrh|nápad|inspirac|kampaň|kampan|příběh|pribeh/i.test(input);

    decision = {
      type: DecisionType.ANSWER,
      intent: isIdeation ? IntentType.CREATIVE : IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.7,
      reason: 'First turn - optimistic answer instead of ASK_USER',
      slots: [],
      metadata: {
        firstTurnOverride: true,
        originalIntent: decision.intent,
        inputPreview: input.substring(0, 100),
      },
      toJSON() { return this; },
    };
  }

  logger.info('ConversationHandler', `CRE Decision: ${decision.type}`, {
    intent: decision.intent,
    tools: decision.tools,
    reason: decision.reason,
  });

  // STEP 2: Handle based on decision type
  switch (decision.type) {
    // ════════════════════════════════════════════════════════════════════════
    // v44.7 FIX 1: LOCAL is TERMINAL - direct computation, no tools
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.LOCAL:
      return await handleLocalDecision(input, decision, context);

    case DecisionType.TOOL_CALL:
      return await handleToolCallDecision(input, decision, context);

    case DecisionType.ASK_USER:
      return handleAskUserDecision(input, decision, context);

    case DecisionType.ANSWER:
      // v44.8: ANSWER is valid for CONVERSATIONAL and CREATIVE intents
      const ANSWER_VALID_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE];
      if (!ANSWER_VALID_INTENTS.includes(decision.intent)) {
        logger.warn('ConversationHandler', 'BLOCKED: ANSWER decision for non-valid intent', {
          intent: decision.intent,
          validIntents: ANSWER_VALID_INTENTS,
        });
        return await handleToolCallDecision(input, {
          ...decision,
          type: DecisionType.TOOL_CALL,
          tools: ['web.search'],
          reason: 'Forced TOOL_CALL for non-valid ANSWER intent',
        }, context);
      }
      return await handleAnswerDecision(input, decision, context);

    case DecisionType.REFUSE:
      return handleRefuseDecision(input, decision, context);

    default:
      // Unknown decision type - refuse to proceed
      return handleRefuseDecision(input, {
        ...decision,
        reason: 'Unknown decision type',
      }, context);
  }
}

/**
 * Handle TOOL_CALL decision - EXECUTE tools, don't describe them
 *
 * CRITICAL: This function RUNS tools and returns RESULTS.
 * It does NOT return "Spouštím vyhledávání..." text.
 *
 * v44.2 - On failure, offers ASK_USER fallback instead of just ending
 * v44.3 - Enforces project goal when project mode is active
 */
async function handleToolCallDecision(input, decision, context) {
  const { sessionState } = context;

  logger.info('HandleToolCall', `Executing TOOL_CALL decision`, {
    tools: decision.tools,
    intent: decision.intent,
    projectDominant: decision.metadata?.projectDominant,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 FIX 1.4 — FOLLOW-UP DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  // Detect if this is a FORMAT_CHANGE (reuse previous data) or NEW_QUERY
  // ════════════════════════════════════════════════════════════════════════════
  const followUp = detectFollowUpType(input, sessionState);

  if (followUp.type === FollowUpType.FORMAT_CHANGE && followUp.reusePreviousData) {
    const previousData = getPreviousToolData(sessionState);

    if (previousData) {
      logger.info('HandleToolCall', 'FORMAT_CHANGE detected - reusing previous data', {
        followUpType: followUp.type,
        confidence: followUp.confidence,
      });

      // v45.0: Get optimized preferences from engine
      const optimizedPrefs = preferenceEngine.getPreferencesForSynthesis(decision.intent);

      // v45.0 KOLO 3: Detect ResponseIntent from format change request
      const responseIntent = detectResponseIntent(input, {
        lastResponseIntent: sessionState?.lastResponseIntent,
      });

      // Re-synthesize with new format request but same data
      const synthesizedResponse = await synthesizeWithLLM({
        query: input,
        intent: decision.intent,
        toolResults: previousData,
        context,
        userPreferences: {
          ...optimizedPrefs,
          ...context.userPreferences,
          formatChange: input,  // Pass the format change request
        },
        responseIntent,  // v45.0 KOLO 3: Pass detected responseIntent
      });

      // v45.0 KOLO 3: Store responseIntent for next turn
      if (sessionState) {
        sessionState.lastResponseIntent = responseIntent;
      }

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: synthesizedResponse.confidence,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          followUpType: followUp.type,
          reusedPreviousData: true,
          synthesized: true,
        },
      });

      return new TaggedResponse({
        content: synthesizedResponse.content,
        tag,
      });
    }
  }

  logger.debug('HandleToolCall', 'Follow-up detection result', {
    type: followUp.type,
    confidence: followUp.confidence,
    reusePreviousData: followUp.reusePreviousData,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v44.4 — PROJECT GOAL ENFORCEMENT (with confirmation)
  // v44.5 — Now blocks on 2nd+ drift instead of just warning
  // ════════════════════════════════════════════════════════════════════════════
  // When project mode is active with a goal, validate that the operation
  // is aligned with the project goal:
  // - 1st drift → ask for confirmation
  // - 2nd+ drift → block operation
  // ════════════════════════════════════════════════════════════════════════════
  const projectGoal = context.projectWorkingMemory?.goal || context.projectGoal;
  if (decision.metadata?.projectDominant && projectGoal && !context.goalDriftConfirmed) {
    const goalAlignment = assessGoalAlignment(input, projectGoal, decision.intent);
    if (!goalAlignment.aligned) {
      // v44.5 - Check if this is 2nd+ drift (should block, not warn)
      const shouldBlock = sessionState?.shouldBlockDrift?.() || false;

      logger.warn('HandleToolCall', 'Operation may drift from project goal', {
        input: input.substring(0, 50),
        goal: projectGoal,
        reason: goalAlignment.reason,
        driftCount: sessionState?.driftCount || 0,
        shouldBlock,
      });

      // v44.5 - On 2nd+ drift, block the operation entirely
      if (shouldBlock) {
        const tag = new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.PROJECT,
          confidence: 1.0,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            goalDriftBlocked: true,
            projectGoal,
            driftCount: sessionState?.driftCount || 0,
          },
        });

        return new TaggedResponse({
          content: `🛑 **Operace zablokována**\n\n` +
                   `Opakovaně se pokoušíte o operace mimo cíl projektu.\n\n` +
                   `**Cíl projektu:** ${projectGoal}\n\n` +
                   `Pro pokračování buď:\n` +
                   `• Formulujte požadavek související s cílem projektu\n` +
                   `• Změňte cíl projektu v nastavení\n` +
                   `• Ukončete projektový režim`,
          tag,
        });
      }

      // 1st drift - Ask for confirmation
      // Increment drift count for next time
      if (sessionState?.incrementDriftCount) {
        sessionState.incrementDriftCount();
      }

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.PROJECT,
        confidence: 0.7,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          goalDrift: true,
          projectGoal,
          awaitingConfirmation: true,
          driftCount: sessionState?.driftCount || 1,
        },
      });

      // Save state for resume after confirmation
      if (sessionState) {
        sessionState.setPendingDecision({
          ...decision,
          type: 'GOAL_DRIFT_CONFIRMATION',
          originalInput: input,
          goalAlignment,
        }, ['goal_drift_confirmation']);
      }

      return new TaggedResponse({
        content: `⚠️ **Operace mimo aktuální cíl projektu**\n\n` +
                 `**Cíl projektu:** ${projectGoal}\n\n` +
                 `**Váš požadavek:** "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}"\n\n` +
                 `Tento požadavek se zdá být mimo aktuální cíl. Chcete pokračovat?\n\n` +
                 `• **Ano** - pokračovat i tak\n` +
                 `• **Ne** - zrušit a vrátit se k cíli`,
        tag,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.11 — REPORT PIPELINE ORCHESTRATION
  // ════════════════════════════════════════════════════════════════════════════
  // REPORT is NOT a parallel tool call! It's a pipeline:
  // 1. SEARCH → get URLs from search results
  // 2. SCRAPE → fetch content from URLs (only if search succeeded)
  // 3. SYNTHESIZE → build report from scraped content
  //
  // If SEARCH fails → return degraded fallback (no ASK_USER)
  // If SEARCH returns 0 results → return degraded fallback
  // NEVER call SCRAPE without URLs!
  // ════════════════════════════════════════════════════════════════════════════
  if (decision.intent === IntentType.REPORT) {
    logger.info('HandleToolCall', 'REPORT pipeline started', { input: input.substring(0, 50) });

    // Step 1: Execute web.search
    const searchResult = await toolExecutor.execute({
      ...decision,
      tools: ['web.search'],
    }, {
      input,
      query: input,
      sessionId: context.sessionId,
      projectGoal,
      ...context,
    });

    // Check if search succeeded and returned results
    // v45.0 FIX: ToolResult uses 'type', not 'tool'
    const searchData = searchResult.toolResults?.find(r => r.type === 'search');
    const hasResults = searchData?.success && searchData?.data?.results?.length > 0;

    if (!hasResults) {
      // Search failed or returned no results → return REPORT fallback
      logger.warn('HandleToolCall', 'REPORT pipeline: search failed or no results', {
        status: searchResult.status,
        hasData: !!searchData,
        resultCount: searchData?.data?.results?.length || 0,
      });

      return buildReportFallback(input, decision, searchResult, context);
    }

    // Step 2: Extract URLs from search results (max 5)
    const urls = searchData.data.results
      .filter(r => r.url && r.url.startsWith('http'))
      .slice(0, 5)
      .map(r => r.url);

    logger.info('HandleToolCall', 'REPORT pipeline: scraping URLs', {
      urlCount: urls.length,
      urls: urls.slice(0, 3),
    });

    // Step 3: Execute web.scrape with URLs (if we have any)
    let scrapeResults = [];
    if (urls.length > 0) {
      const scrapeResult = await toolExecutor.execute({
        ...decision,
        tools: ['web.scrape'],
      }, {
        input,
        urls,  // Pass URLs, not query!
        sessionId: context.sessionId,
        projectGoal,
        ...context,
      });

      scrapeResults = scrapeResult.toolResults || [];
    }

    // Step 4: Synthesize report from search + scrape results
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: decision.confidence,
      canExecute: false,
      metadata: {
        decision: decision.toJSON(),
        pipeline: 'REPORT',
        searchResults: searchData?.data?.results?.length || 0,
        scrapedUrls: urls.length,
      },
    });

    // Build report content
    const reportContent = synthesizeReport({
      query: input,
      searchResults: searchData?.data?.results || [],
      scrapeResults: scrapeResults.filter(r => r.success).map(r => r.data),
    });

    // Record successful decision
    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    return new TaggedResponse({
      content: reportContent,
      tag,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EXECUTE TOOLS - regular execution for non-REPORT intents
  // ════════════════════════════════════════════════════════════════════════════

  const executionResult = await toolExecutor.execute(decision, {
    input,
    query: input,
    sessionId: context.sessionId,
    projectGoal, // v44.3 - Pass goal for context
    ...context,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // BUILD RESPONSE FROM EXECUTION RESULTS
  // ════════════════════════════════════════════════════════════════════════════

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false, // Already executed
    metadata: {
      decision: decision.toJSON(),
      executionStatus: executionResult.status,
      executionDuration: executionResult.duration,
      toolResults: executionResult.toolResults.map(r => ({
        tool: r.tool,
        success: r.success,
        error: r.error,
      })),
    },
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - Handle execution failure with FALLBACK instead of just ending
  // ════════════════════════════════════════════════════════════════════════════

  if (executionResult.status === ExecutionStatus.FAILED) {
    logger.error('HandleToolCall', 'All tools failed', {
      error: executionResult.error,
      tools: decision.tools,
    });

    // Check if we can offer alternatives
    const fallbackResponse = buildFailureFallback(input, decision, executionResult, context);

    // Save fallback state if we're offering alternatives
    if (sessionState && fallbackResponse.offeringAlternatives) {
      sessionState.setPendingDecision({
        ...decision,
        type: 'TOOL_CALL_FAILED',
        failedTools: decision.tools,
        originalInput: input,
      }, ['alternative_action']);

      logger.info('HandleToolCall', 'Saved fallback state for user choice', {
        originalTools: decision.tools,
      });
    }

    return new TaggedResponse({
      content: fallbackResponse.content,
      tag: new ResponseTag({
        ...tag.toJSON(),
        metadata: {
          ...tag.metadata,
          offeringFallback: fallbackResponse.offeringAlternatives,
          fallbackOptions: fallbackResponse.options,
          // v44.5 - Include structured ASK_USER data for UI
          structured: fallbackResponse.structured,
          awaitingUserChoice: true,
          slots: ['alternative_action'],
        },
      }),
    });
  }

  // Handle partial success
  if (executionResult.status === ExecutionStatus.PARTIAL) {
    logger.warn('HandleToolCall', 'Partial execution success', {
      succeeded: executionResult.toolResults.filter(r => r.success).length,
      failed: executionResult.toolResults.filter(r => !r.success).length,
    });
  }

  // Record successful decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 — LLM SYNTHESIS: Tools returned DATA, now LLM generates RESPONSE
  // ════════════════════════════════════════════════════════════════════════════
  // The key architectural change: tools don't "speak" — they provide data.
  // LLM synthesizes the user-facing response from tool data.
  // ════════════════════════════════════════════════════════════════════════════

  // v45.0: Get optimized preferences from engine
  const optimizedPrefs = preferenceEngine.getPreferencesForSynthesis(decision.intent);

  // v45.0 KOLO 3: Detect ResponseIntent from user input
  const responseIntent = detectResponseIntent(input, {
    lastResponseIntent: sessionState?.lastResponseIntent,
  });

  const synthesizedResponse = await synthesizeWithLLM({
    query: input,
    intent: decision.intent,
    toolResults: executionResult.toolResults,
    context,
    userPreferences: {
      ...optimizedPrefs,
      ...context.userPreferences,
    },
    responseIntent,  // v45.0 KOLO 3: Pass detected responseIntent
  });

  // v45.0 FIX 1.4: Save tool results for FORMAT_CHANGE follow-ups
  if (sessionState) {
    sessionState.lastToolResults = executionResult.toolResults;
    sessionState.lastToolResultsTimestamp = Date.now();
    sessionState.lastResponseIntent = responseIntent;  // v45.0 KOLO 3: Store for next turn
  }

  // Update tag with synthesis metadata
  const finalTag = new ResponseTag({
    ...tag.toJSON(),
    metadata: {
      ...tag.metadata,
      synthesized: true,
      synthesisModel: synthesizedResponse.model,
      synthesisConfidence: synthesizedResponse.confidence,
      followUpType: followUp?.type,
    },
  });

  return new TaggedResponse({
    content: synthesizedResponse.content,
    tag: finalTag,
  });
}

/**
 * v44.5 - Build structured ASK_USER fallback when tool execution fails
 * Returns a proper ASK_USER decision structure that UI can handle
 */
function buildFailureFallback(input, decision, executionResult, context) {
  const hasRetryable = executionResult.toolResults.some(r => !r.success && r.retryable);
  const firstSuggestion = executionResult.toolResults
    .filter(r => !r.success && r.suggestion)
    .map(r => r.suggestion)[0];

  // Get error details
  const failedTools = executionResult.toolResults
    .filter(r => !r.success)
    .map(r => ({
      tool: r.tool,
      error: r.error,
      code: r.errorCode,
      retryable: r.retryable,
    }));

  // Check for SOURCE_BLOCKED - offer alternative sources
  const hasSourceBlocked = failedTools.some(t => t.code === 'SOURCE_BLOCKED');

  // Build structured options for UI
  const structuredOptions = [];
  const options = [];

  if (hasSourceBlocked) {
    structuredOptions.push(
      { id: 'alternative_source', label: 'Zkusit jiný zdroj', action: 'prompt', prompt: 'Zadejte jinou URL nebo téma' },
      { id: 'alternative_search', label: 'Použít DuckDuckGo', action: 'auto', tool: 'web.search', provider: 'duckduckgo' },
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('alternative_source', 'alternative_search', 'reformulate');
  } else if (hasRetryable) {
    structuredOptions.push(
      { id: 'retry', label: 'Zkusit znovu', action: 'retry' },
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('retry', 'reformulate');
  } else {
    structuredOptions.push(
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('reformulate');
  }

  // Build human-readable content
  const toolNames = {
    'web.search': 'Vyhledávání',
    'web.scrape': 'Načtení stránky',
    'file.read': 'Čtení souboru',
  };

  let content = `⚠️ **Nepodařilo se zpracovat požadavek**\n\n`;
  content += `**Váš dotaz:** ${input}\n\n`;
  content += `**Problém:**\n`;
  for (const tool of failedTools) {
    content += `- ${toolNames[tool.tool] || tool.tool}: ${tool.error}\n`;
  }
  content += '\n';

  if (hasSourceBlocked) {
    content += `💡 **Zdroj blokuje automatické požadavky.**\n\n`;
  }

  if (firstSuggestion) {
    content += `💡 **Tip:** ${firstSuggestion}\n\n`;
  }

  content += `**Možnosti:**\n`;
  structuredOptions.forEach((opt, i) => {
    if (opt.id !== 'cancel') {
      content += `${i + 1}. ${opt.label}\n`;
    }
  });

  return {
    content,
    offeringAlternatives: structuredOptions.length > 1,
    options,
    // v44.5 - Structured response for UI
    structured: {
      type: 'ASK_USER',
      subtype: 'TOOL_FAILURE_RECOVERY',
      failedTools,
      options: structuredOptions,
      originalInput: input,
      originalIntent: decision.intent,
      suggestion: firstSuggestion,
    },
  };
}


/**
 * Handle ASK_USER decision - need clarification
 *
 * v44.2 - Now saves pending decision to session state for resumption
 * v44.6 FIX 2 - Tracks attempts to enforce max 1× clarification
 */
function handleAskUserDecision(input, decision, context) {
  const { sessionState } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - SAVE PENDING DECISION FOR RESUMPTION
  // v44.6 FIX 2 - Track attempts (max 1× clarification)
  // ════════════════════════════════════════════════════════════════════════════

  if (sessionState) {
    // v44.6 - Calculate new attempts count
    const currentAttempts = sessionState.pendingDecision?.attempts ?? 0;
    const decisionWithAttempts = {
      ...decision,
      attempts: currentAttempts + 1,
    };

    sessionState.recordDecision(decisionWithAttempts, input);
    logger.info('HandleAskUser', 'Saved pending decision for resumption', {
      intent: decision.intent,
      slots: decision.slots,
      attempts: decisionWithAttempts.attempts,
    });
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      awaitingClarification: true,
      slots: decision.slots,
    },
  });

  const content = formatClarificationRequest(input, decision);

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Format clarification request
 * v44.2 - Intent-specific templates instead of generic options
 */
function formatClarificationRequest(input, decision) {
  const shortInput = input.length > 60 ? input.substring(0, 60) + '...' : input;

  if (decision.slots.includes('intent_clarification')) {
    // v44.2 - Analyze input to show relevant options only
    const lower = input.toLowerCase();

    // Check if input looks like news/report request
    const looksLikeReport = /souhrn|přehled|prehled|zpráv|zprav|novinky|za|report|analýz/i.test(lower);
    const looksLikeSearch = /najdi|hledej|vyhledej|kde|kolik|cen|odkaz/i.test(lower);
    const looksLikeCode = /kód|kod|funkc|napš|oprav|bug|class|function/i.test(lower);

    // Show only relevant options based on input analysis
    if (looksLikeReport && !looksLikeSearch && !looksLikeCode) {
      return `📋 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Přehled** - vytvořit souhrn informací\n` +
             `• **Vyhledávání** - najít odkazy na webu`;
    }

    if (looksLikeSearch && !looksLikeReport && !looksLikeCode) {
      return `🔍 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Najít informace** - vyhledat na webu\n` +
             `• **Vytvořit přehled** - zpracovat do souhrnu`;
    }

    if (looksLikeCode) {
      return `💻 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Napsat kód** - vytvořit/upravit program\n` +
             `• **Vysvětlit** - obecná otázka o programování`;
    }

    // Fallback: generic but shorter
    return `🤔 **"${shortInput}"**\n\n` +
           `Upřesněte záměr:\n` +
           `• **Vyhledávání** - najít informace\n` +
           `• **Přehled** - vytvořit souhrn\n` +
           `• **Kód** - napsat program`;
  }

  if (decision.slots.includes('source')) {
    return `📎 **Pro tento požadavek potřebuji zdroj:**\n\n` +
           `Zadejte URL nebo téma pro vyhledávání.`;
  }

  // CODE intent without project context
  if (decision.slots.includes('project_context') || decision.slots.includes('file_path')) {
    return `💻 **"${shortInput}"**\n\n` +
           `V jakém projektu chcete pracovat?\n` +
           `(Vyberte projekt z nabídky nebo napište "obecná otázka")`;
  }

  return `❓ Potřebuji upřesnit: ${decision.slots[0] || 'kontext'}\n\n` +
         `**"${shortInput}"**`;
}

/**
 * Handle ANSWER decision - only for pure CONVERSATIONAL intent
 */
async function handleAnswerDecision(input, decision, context) {
  const { sessionId } = context;

  try {
    // Lazy import CRE bridge to avoid circular dependencies
    const creBridge = await import('../llm/cre-bridge.js');

    // Build prompt with conversation history
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content || ''}`)
        .join('\n');
      prompt = `Context:\n${historyContext}\n\nUser: ${input}`;
    }

    // System prompt for CONVERSATIONAL - strict rules
    const systemPrompt = `You are a helpful AI assistant in CONVERSATIONAL mode.

CRITICAL RULES:
- You are ONLY handling casual conversation (greetings, opinions, small talk)
- You CANNOT search the web - if asked about facts, say you need to search first
- You CANNOT access URLs - if given a URL, say you need to fetch it first
- NEVER say "nemám přístup", "nemohu vyhledávat", etc. - instead say what ACTION is needed
- If the user asks about anything requiring real data, redirect them to ask properly

ALLOWED:
- Greetings and farewells
- Opinions and preferences
- General knowledge from your training
- Explaining how to use the system

FORBIDDEN PHRASES (never use these):
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`;

    // Call LLM via CRE bridge (authorized)
    const result = await creBridge.generateChatResponse(prompt, systemPrompt, {
      sessionId: `conv-${sessionId}`,
      temperature: 0.7,
    });

    // CRITICAL: Validate response against forbidden phrases
    const validation = creDecisionEngine.validateResponse(result.content);
    if (!validation.valid) {
      logger.error('ConversationHandler', 'LLM generated FORBIDDEN response', {
        violations: validation.violations,
        content: result.content.substring(0, 200),
      });

      // Return error instead of forbidden content
      return createForbiddenResponseError(input, validation.violations);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // v44.10 - Creative Quality Gate
    // ════════════════════════════════════════════════════════════════════════════
    // For CREATIVE intent, check that response has actual substance
    // (not just acknowledgment or empty structure)
    // ════════════════════════════════════════════════════════════════════════════
    if (decision.intent === IntentType.CREATIVE) {
      const qualityCheck = assertCreativeQuality(result.content, input);
      if (!qualityCheck.valid) {
        logger.warn('ConversationHandler', 'CREATIVE response failed quality gate', {
          reason: qualityCheck.reason,
          contentLength: result.content.length,
          preview: result.content.substring(0, 100),
        });
        // For now, log but don't block - we want to observe first
        // In future versions, this could trigger a retry or warning
      }
    }

    // v44.9 FIX: Record decision to sessionState (required for CREATIVE follow-up lock!)
    const { sessionState } = context;
    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        model: result.model,
        duration: result.duration,
        decision: decision.toJSON(),
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });
  } catch (err) {
    logger.error('ConversationHandler', `LLM call failed: ${err.message}`);

    // CRITICAL: Never return free text on error - use REFUSE decision
    // This prevents fallback to "chatty" error messages
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'LLM_CALL_FAILED',
        decision: { type: 'REFUSE', reason: err.message },
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba zpracování**\n\nSystém nemohl zpracovat váš požadavek.\n\n` +
               `**Důvod:** ${err.message}\n\n` +
               `Zkuste to prosím znovu nebo přeformulujte dotaz.`,
      tag,
    });
  }
}

/**
 * Create error response when LLM generates forbidden content
 */
function createForbiddenResponseError(input, violations) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 1.0,
    canExecute: true,
    metadata: {
      error: 'FORBIDDEN_PHRASE_DETECTED',
      violations,
      requiresToolExecution: true,
    },
  });

  return new TaggedResponse({
    content: `🔄 Váš dotaz vyžaduje získání aktuálních dat.\n\n` +
             `**Dotaz:** ${input}\n\n` +
             `Pro zodpovězení spustím vyhledávání...`,
    tag,
    actions: [{
      type: 'TOOL_CALL',
      tool: 'web.search',
      query: input,
      reason: 'forbidden_phrase_recovery',
    }],
  });
}

/**
 * Handle REFUSE decision
 */
function handleRefuseDecision(input, decision, context) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      refused: true,
    },
  });

  return new TaggedResponse({
    content: `⚠️ Tento požadavek nemohu zpracovat.\n\n` +
             `**Důvod:** ${decision.reason}\n\n` +
             `Zkuste prosím přeformulovat váš dotaz.`,
    tag,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.7 - LOCAL Handler (TERMINAL - direct computation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle LOCAL decision - TERMINAL direct computation
 *
 * LOCAL is special: it's deterministic computation that doesn't need external APIs.
 * Examples: "kdy bude úplněk?", "kolik je hodin?", "5+3"
 *
 * v44.7 INVARIANT: LOCAL NEVER calls tools, NEVER goes to web.search
 */
async function handleLocalDecision(input, decision, context) {
  const { sessionState } = context;
  const handler = decision.metadata?.handler || 'local.date';

  logger.info('HandleLocal', `Executing LOCAL decision (TERMINAL)`, {
    handler,
    input: input.substring(0, 50),
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DIRECT COMPUTATION - no external API, no tool executor
  // ════════════════════════════════════════════════════════════════════════════

  let result;
  try {
    switch (handler) {
      case 'local.calendar':
        result = computeCalendar(input);
        break;
      case 'local.math':
        result = computeMath(input);
        break;
      case 'local.date':
      default:
        result = computeDate(input);
        break;
    }
  } catch (err) {
    logger.error('HandleLocal', `Computation failed: ${err.message}`);
    result = { error: err.message, answer: null };
  }

  // Record successful decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      localComputation: true,
      handler,
      computationResult: result,
    },
  });

  // Format response based on computation
  const content = formatLocalResponse(input, result, handler);

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Compute calendar-related queries (moon phases, days until events)
 */
function computeCalendar(input) {
  const now = new Date();

  // Moon phase calculation (simplified - real implementation would be more precise)
  if (/úplněk|uplnek|full.*moon/i.test(input)) {
    // Simplified lunar cycle: ~29.5 days
    const lunarCycle = 29.53;
    // Reference full moon: January 13, 2025 (approximate)
    const refFullMoon = new Date('2025-01-13');
    const daysSinceRef = (now - refFullMoon) / (1000 * 60 * 60 * 24);
    const daysInCurrentCycle = daysSinceRef % lunarCycle;
    const daysToFullMoon = Math.round(lunarCycle - daysInCurrentCycle);

    const nextFullMoon = new Date(now);
    nextFullMoon.setDate(nextFullMoon.getDate() + daysToFullMoon);

    return {
      answer: daysToFullMoon,
      unit: 'dní',
      date: nextFullMoon.toLocaleDateString('cs-CZ'),
      explanation: `Příští úplněk bude za ${daysToFullMoon} dní (${nextFullMoon.toLocaleDateString('cs-CZ')})`,
    };
  }

  // Days until Christmas
  if (/váno|christmas/i.test(input)) {
    const christmas = new Date(now.getFullYear(), 11, 24);
    if (christmas < now) {
      christmas.setFullYear(christmas.getFullYear() + 1);
    }
    const days = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
    return {
      answer: days,
      unit: 'dní',
      date: christmas.toLocaleDateString('cs-CZ'),
      explanation: `Do Vánoc zbývá ${days} dní`,
    };
  }

  // Default: current date info
  return computeDate(input);
}

/**
 * Compute math expressions
 */
function computeMath(input) {
  // Extract math expression
  const mathMatch = input.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
  if (mathMatch) {
    const [, a, op, b] = mathMatch;
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    let result;

    switch (op) {
      case '+': result = numA + numB; break;
      case '-': result = numA - numB; break;
      case '*': result = numA * numB; break;
      case '/': result = numB !== 0 ? numA / numB : NaN; break;
      default: result = NaN;
    }

    return {
      answer: result,
      expression: `${a} ${op} ${b}`,
      explanation: `${a} ${op} ${b} = ${result}`,
    };
  }

  return { answer: null, error: 'Could not parse math expression' };
}

/**
 * Compute date/time queries
 */
function computeDate(input) {
  const now = new Date();

  // Current time
  if (/hodin|time/i.test(input)) {
    return {
      answer: now.toLocaleTimeString('cs-CZ'),
      explanation: `Aktuální čas: ${now.toLocaleTimeString('cs-CZ')}`,
    };
  }

  // Current date
  if (/datum|date|den|day/i.test(input)) {
    const dayNames = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    return {
      answer: now.toLocaleDateString('cs-CZ'),
      dayOfWeek: dayNames[now.getDay()],
      explanation: `Dnes je ${dayNames[now.getDay()]}, ${now.toLocaleDateString('cs-CZ')}`,
    };
  }

  // Default: full datetime
  return {
    answer: now.toLocaleString('cs-CZ'),
    explanation: `Aktuální datum a čas: ${now.toLocaleString('cs-CZ')}`,
  };
}

/**
 * Format LOCAL computation result for user
 */
function formatLocalResponse(input, result, handler) {
  if (result.error) {
    return `⚠️ Nepodařilo se vypočítat: ${result.error}`;
  }

  // Use explanation if available, otherwise construct response
  if (result.explanation) {
    return `📊 **${result.explanation}**`;
  }

  if (result.answer !== null && result.answer !== undefined) {
    return `📊 **Výsledek:** ${result.answer}${result.unit ? ' ' + result.unit : ''}`;
  }

  return `📊 Výpočet dokončen.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle project mode - code-focused work
 *
 * INVARIANT: If context.project exists, we NEVER ask "select project"
 * Instead, we route to CRE with CODE intent and hasActiveProject=true
 */
export async function projectHandler(input, context) {
  const { sessionId, project } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Project IS selected - route through CRE with CODE context
  // ════════════════════════════════════════════════════════════════════════════

  if (project && project.id) {
    logger.info('ProjectHandler', `Project active: ${project.name}`, {
      projectId: project.id,
      scope: project.scope || 'project',
    });

    // Get CRE decision with project context
    const decision = creDecisionEngine.decide(input, {
      ...context,
      hasActiveProject: true,
      projectId: project.id,
      projectName: project.name,
      projectScope: project.scope || 'project',
    });

    assertDecision(decision);

    logger.info('ProjectHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
    });

    // Handle based on decision
    switch (decision.type) {
      case DecisionType.TOOL_CALL:
        // v44.2 - Ensure project context is fully propagated for sandbox
        return await handleToolCallDecision(input, decision, {
          ...context,
          hasActiveProject: true,
          project: project, // Explicit project for ToolExecutor sandbox
          projectPath: project.path, // Explicit path for backward compatibility
        });

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // In project mode, even CONVERSATIONAL gets project context
        return await handleAnswerDecision(input, decision, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No project selected - ASK_USER (no text description!)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ProjectHandler', 'No project selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'PROJECT_REQUIRED' },
      slots: ['project'],
      awaitingSelection: true,
    },
  });

  // This is ASK_USER behavior, not "chatty" text
  return new TaggedResponse({
    content: `💻 **Vyber projekt**\n\nPro práci s kódem potřebuji znát kontext projektu.\n\n` +
             `**Váš požadavek:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"\n\n` +
             `Vyberte projekt z nabídky nebo vytvořte nový.`,
    tag,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Expert Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle expert mode - domain expertise
 *
 * v44.2+ - Now uses CRE decision engine for proper tool execution
 * INVARIANT: If context.expert exists, we use that expert for ALL responses
 * Expert is LOCKED until user explicitly changes it.
 * No automatic arbitration when expert is selected.
 */
export async function expertHandler(input, context) {
  const { sessionId, expert, sessionState } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Expert IS selected - use CRE then apply expert persona
  // ════════════════════════════════════════════════════════════════════════════

  if (expert && expert.id) {
    logger.info('ExpertHandler', `Expert active: ${expert.name}`, {
      expertId: expert.id,
      domain: expert.domain || 'general',
    });

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 6: Expert MUST NOT change decision type
    // ════════════════════════════════════════════════════════════════════════
    // Expert only INTERPRETS results, never changes what decision to make.
    // If user asks for creative writing with expert active, expert answers directly.
    // ════════════════════════════════════════════════════════════════════════

    // v44.2+ - Use CRE decision engine WITH expert context
    const decision = creDecisionEngine.decide(input, {
      ...context,
      hasActiveExpert: true,
      expert: expert,
    });

    assertDecision(decision);

    logger.info('ExpertHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
      expert: expert.name,
    });

    // v44.6 FIX 6: Expert MUST respect CRE decision type
    // If CRE says ANSWER (for CONVERSATIONAL), expert answers directly
    // Expert NEVER forces TOOL_CALL when CRE says ANSWER
    // Handle based on decision
    switch (decision.type) {
      case DecisionType.TOOL_CALL:
        // v44.2+ - Execute tools, then format response with expert persona
        const toolResult = await handleToolCallDecision(input, decision, context);

        // If tool succeeded, wrap response with expert persona
        if (toolResult.tag?.metadata?.executionStatus === 'SUCCESS') {
          return await wrapWithExpertPersona(input, toolResult, expert, context);
        }
        return toolResult;

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // v44.6 - For CONVERSATIONAL, expert answers directly (no tools!)
        // This is the correct flow - expert uses their knowledge
        return await generateExpertResponse(input, expert, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No expert selected - ASK_USER to select one
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ExpertHandler', 'No expert selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.EXPERT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'EXPERT_REQUIRED' },
      slots: ['expert'],
      awaitingSelection: true,
    },
  });

  return new TaggedResponse({
    content: `👨‍💻 **Vyber experta**\n\n` +
             `Pro odbornou konzultaci vyber experta z nabídky.\n\n` +
             `**Váš dotaz:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"`,
    tag,
  });
}

/**
 * v44.2+ - Generate direct expert response (for CONVERSATIONAL intent)
 */
async function generateExpertResponse(input, expert, context) {
  const { sessionId } = context;

  try {
    // Lazy import CRE bridge for LLM calls
    const creBridge = await import('../llm/cre-bridge.js');

    // Build expert system prompt
    const expertSystemPrompt = buildExpertSystemPrompt(expert);

    // Build prompt with context
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content?.substring(0, 200) || ''}`)
        .join('\n');
      prompt = `Previous context:\n${historyContext}\n\nUser question: ${input}`;
    }

    // Call LLM with expert persona
    const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
      sessionId: `expert-${sessionId}`,
      temperature: 0.5,
    });

    // Validate response
    const validation = creDecisionEngine.validateResponse(result.content);
    if (!validation.valid) {
      logger.warn('ExpertHandler', 'Expert generated forbidden phrase', {
        expert: expert.id,
        violations: validation.violations,
      });
    }

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        expert: {
          id: expert.id,
          name: expert.name,
          domain: expert.domain,
        },
        model: result.model,
        duration: result.duration,
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });

  } catch (err) {
    logger.error('ExpertHandler', `LLM call failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.EXPERT,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'EXPERT_LLM_FAILED',
        expert: expert.id,
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba experta**\n\n` +
               `Expert "${expert.name}" nemohl zpracovat dotaz.\n\n` +
               `**Důvod:** ${err.message}`,
      tag,
    });
  }
}

/**
 * v44.2+ - Wrap tool execution result with expert persona
 * Takes raw tool results and has expert interpret them
 */
async function wrapWithExpertPersona(input, toolResult, expert, context) {
  try {
    const creBridge = await import('../llm/cre-bridge.js');
    const expertSystemPrompt = buildExpertSystemPrompt(expert);

    // Build prompt that includes tool results
    const toolContent = toolResult.content || '';
    const prompt = `User asked: "${input}"

Tool execution results:
${toolContent}

Based on these results, provide your expert analysis and response.`;

    const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
      sessionId: `expert-${context.sessionId}`,
      temperature: 0.5,
    });

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        expert: { id: expert.id, name: expert.name, domain: expert.domain },
        toolResults: toolResult.tag?.metadata?.toolResults,
        model: result.model,
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });

  } catch (err) {
    // If expert wrapping fails, return original tool result
    logger.warn('ExpertHandler', `Expert wrapping failed, returning raw result: ${err.message}`);
    return toolResult;
  }
}

/**
 * Build expert system prompt based on expert profile
 */
function buildExpertSystemPrompt(expert) {
  const basePrompt = `You are ${expert.name}, an expert in ${expert.domain || 'technology'}.

Your expertise includes: ${expert.description || expert.domain || 'general software development'}

IMPORTANT RULES:
- Respond as ${expert.name}, using your domain expertise
- Be specific and technical when appropriate
- If a question is outside your expertise, say so
- Never claim you cannot access information - if you need data, explain what would be helpful`;

  if (expert.systemPrompt) {
    return `${basePrompt}\n\n${expert.systemPrompt}`;
  }

  return basePrompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle agent mode - autonomous execution
 *
 * INVARIANT: Agent mode ALWAYS requires explicit confirmation before starting
 * Uses AgentOutputContract for structured responses
 */
export async function agentHandler(input, context) {
  const { sessionId, agent, confirmed } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Pending confirmation - ask user to confirm
  // ════════════════════════════════════════════════════════════════════════════

  if (!confirmed && context.pendingConfirmation) {
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION, // Stay in conversation until confirmed
      confidence: 1.0,
      canExecute: false,
      metadata: {
        pendingModeSwitch: context.pendingConfirmation,
        awaitingConfirmation: true,
      },
    });

    return new TaggedResponse({
      content: `🤖 **Potvrzení autonomního režimu**\n\n` +
               `Chystám se spustit autonomní úlohu:\n\n` +
               `**Úloha:** "${input}"\n\n` +
               `⚠️ Agent bude pracovat samostatně a může:\n` +
               `- Provádět vyhledávání\n` +
               `- Číst a zapisovat soubory\n` +
               `- Spouštět příkazy\n\n` +
               `Odpovězte **"ano"** pro spuštění nebo **"ne"** pro zrušení.`,
      tag,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: Agent execution (confirmed or explicit)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('AgentHandler', `Starting agent execution`, {
    sessionId,
    agentId: agent?.id,
    task: input.substring(0, 100),
  });

  // Build AgentOutputContract-compatible response
  const agentOutput = {
    status: 'STARTED',
    progress: 0,
    task: input,
    steps: [],
    next_action: 'PLANNING',
    artifacts: [],
  };

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.AGENT,
    mode: ChatMode.AGENT,
    confidence: 0.9,
    canExecute: true,
    metadata: {
      agentOutput,
      agent: agent ? { id: agent.id, name: agent.name } : null,
    },
  });

  // Return initial response with execution started
  return new TaggedResponse({
    content: `🤖 **Agent spuštěn**\n\n` +
             `**Úloha:** ${input}\n\n` +
             `**Status:** Plánování...\n` +
             `**Progress:** 0%\n\n` +
             `Agent pracuje autonomně. Další aktualizace přijdou automaticky.`,
    tag,
    actions: [{
      type: 'AGENT_START',
      task: input,
      agentId: agent?.id || `agent_${Date.now()}`,
    }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.11 - REPORT Pipeline Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build degraded REPORT fallback when search fails or returns no results.
 * NEVER asks user for clarification - provides orientational overview instead.
 *
 * @param {string} input - Original user query
 * @param {Object} decision - CRE decision
 * @param {Object} searchResult - Failed search result
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
function buildReportFallback(input, decision, searchResult, context) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 0.4,  // Low confidence for degraded response
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      degraded: true,
      reason: 'SEARCH_FAILED_OR_NO_RESULTS',
      searchStatus: searchResult.status,
    },
  });

  // Get error details for logging
  const errorInfo = searchResult.toolResults
    ?.filter(r => !r.success)
    ?.map(r => r.error || 'unknown')
    ?.join(', ') || 'unknown';

  logger.warn('HandleToolCall', 'REPORT fallback triggered', {
    query: input.substring(0, 50),
    errorInfo,
  });

  // Build orientational fallback content
  const content = `⚠️ **Nelze získat aktuální zdroje**

Vyhledávání selhalo nebo nevrátilo žádné výsledky.

**Důvod:** ${errorInfo.includes('timeout') ? 'Vypršel časový limit' :
             errorInfo.includes('blocked') ? 'Zdroje dočasně nedostupné' :
             'Vyhledávání nebylo úspěšné'}

---

📋 **Orientační přehled** (bez aktuálních zdrojů):

K tématu "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}" mohu nabídnout:
• Obecné informace z mých znalostí
• Doporučení relevantních zdrojů k ruční kontrole
• Strukturu reportu, kterou můžete doplnit

Chcete pokračovat s orientačním přehledem, nebo zkusit vyhledávání znovu?`;

  // Record the fallback decision
  if (context.sessionState) {
    context.sessionState.recordDecision(decision, input);
  }

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Synthesize a report from search and scrape results.
 *
 * @param {Object} options
 * @param {string} options.query - Original user query
 * @param {Array} options.searchResults - Search result items
 * @param {Array} options.scrapeResults - Scraped content items
 * @returns {string} Synthesized report content
 */
function synthesizeReport({ query, searchResults, scrapeResults }) {
  const parts = [];

  // Header
  parts.push(`📊 **Report: ${query.substring(0, 80)}${query.length > 80 ? '...' : ''}**\n`);
  parts.push(`*Zpracováno ${searchResults.length} zdrojů*\n`);
  parts.push('---\n');

  // If we have scraped content, use it
  if (scrapeResults && scrapeResults.length > 0) {
    parts.push('## 📄 Shrnutí zdrojů\n');

    scrapeResults.forEach((scraped, i) => {
      if (scraped?.content || scraped?.text) {
        const content = scraped.content || scraped.text;
        const title = scraped.title || searchResults[i]?.title || `Zdroj ${i + 1}`;
        const url = scraped.url || searchResults[i]?.url;

        parts.push(`### ${title}\n`);
        if (url) parts.push(`🔗 ${url}\n`);
        parts.push(`\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}\n\n`);
      }
    });
  } else {
    // Fallback to search result snippets
    parts.push('## 🔍 Nalezené zdroje\n');

    searchResults.slice(0, 5).forEach((result, i) => {
      parts.push(`### ${i + 1}. ${result.title || 'Bez názvu'}\n`);
      if (result.url) parts.push(`🔗 ${result.url}\n`);
      if (result.snippet) parts.push(`\n${result.snippet}\n`);
      parts.push('\n');
    });
  }

  // Footer with sources
  parts.push('---\n');
  parts.push('## 📚 Zdroje\n');
  searchResults.slice(0, 5).forEach((result, i) => {
    if (result.url) {
      parts.push(`${i + 1}. [${result.title || result.url}](${result.url})\n`);
    }
  });

  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Handlers Map
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 — FEEDBACK API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Record user feedback signal for preference learning
 * @param {string} type - 'positive' or 'negative'
 * @param {Object} context - Context about the response
 */
export function recordFeedback(type, context = {}) {
  if (type === 'positive') {
    preferenceEngine.recordPositiveFeedback(context);
  } else if (type === 'negative') {
    preferenceEngine.recordNegativeFeedback(context);
  }
}

/**
 * Get current user preferences for external use
 */
export function getUserPreferences() {
  return preferenceEngine.getStats();
}

/**
 * Get default handlers for all modes
 */
export function getDefaultHandlers() {
  return {
    [ChatMode.CONVERSATION]: conversationHandler,
    [ChatMode.PROJECT]: projectHandler,
    [ChatMode.EXPERT]: expertHandler,
    [ChatMode.AGENT]: agentHandler,
  };
}

export default {
  conversationHandler,
  projectHandler,
  expertHandler,
  agentHandler,
  getDefaultHandlers,
  // v45.0 - Feedback API
  recordFeedback,
  getUserPreferences,
  FollowUpType,
};

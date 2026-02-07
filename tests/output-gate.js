// CRE v55.2 — D6 Output Quality Gate
// ══════════════════════════════════════════════════════════════════════════════
//
// POST-SYNTHESIS ENFORCEMENT — validates LLM output AFTER generation.
//
// Three independent dimensions:
//   D6.1: Zombie / Meta detection (hard fail)
//   D6.2: Minimum content density (per-intent thresholds)
//   D6.3: Response intent enforcement (structural contracts)
//
// Architecture:
//   This module sits AFTER detectFluff (structural) in synthesis.js.
//   detectFluff catches: empty structure, URL ratio, source title repetition.
//   Output Gate catches: semantic emptiness, missing content, wrong format.
//
//   ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
//   │ LLM returns  │ →  │ detectFluff  │ →  │ OUTPUT GATE  │ → response
//   │ raw text     │    │ (structural) │    │ (semantic)   │
//   └─────────────┘    └──────────────┘    └──────────────┘
//
// Fail modes:
//   RETRY  — regenerate with stricter prompt (max 1 retry)
//   DEGRADE — return degraded but honest response
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// D6.1 — ZOMBIE / META RESPONSE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
// Hard fail patterns: responses that say nothing, talk about themselves,
// or describe the process instead of answering.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that indicate a zombie/meta response.
 * These are responses that talk ABOUT answering instead of actually answering.
 *
 * Each pattern has a category for diagnostics.
 */
const ZOMBIE_PATTERNS = [
  // ── Process narration (talks about what it's doing) ─────────────────
  { pattern: /zde je m\w+\s+odpověď/i, category: 'PROCESS_NARRATION' },
  { pattern: /here is my (answer|response)/i, category: 'PROCESS_NARRATION' },
  { pattern: /připravil jsem (pro vás|pro tebe)/i, category: 'PROCESS_NARRATION' },
  { pattern: /I('ve| have) prepared (for you|the following)/i, category: 'PROCESS_NARRATION' },
  { pattern: /let me (share|provide|present)/i, category: 'PROCESS_NARRATION' },
  { pattern: /dovolte mi (představit|shrnout|prezentovat)/i, category: 'PROCESS_NARRATION' },

  // ── Self-referential (talks about being AI) ─────────────────────────
  { pattern: /jako (jazykový model|AI|umělá inteligence)/i, category: 'SELF_REFERENTIAL' },
  { pattern: /as (a|an) (language model|AI|artificial intelligence)/i, category: 'SELF_REFERENTIAL' },
  { pattern: /jsem (jen )?(model|AI|bot|asistent)/i, category: 'SELF_REFERENTIAL' },

  // ── Hollow filler (promises without delivery) ───────────────────────
  { pattern: /^rád(a)? (ti|vám) (pomůžu|pomohu|pomohu s|odpovím)\s*[.!]?\s*$/im, category: 'HOLLOW_FILLER' },
  { pattern: /^(samozřejmě|jistě|určitě)[,.]?\s*(rád|ráda)?\s*(pomůžu|pomohu)?\s*[.!]?\s*$/im, category: 'HOLLOW_FILLER' },
  { pattern: /^(sure|of course)[,.]?\s*(I('d| would) be happy to help)?\s*[.!]?\s*$/im, category: 'HOLLOW_FILLER' },

  // ── Capability denial (forbidden — system HAS the data) ─────────────
  { pattern: /nemám přístup k (internetu|webu|dat)/i, category: 'CAPABILITY_DENIAL' },
  { pattern: /nemohu (vyhledávat|prohledat|najít na)/i, category: 'CAPABILITY_DENIAL' },
  { pattern: /I (don't|do not|cannot) have access to/i, category: 'CAPABILITY_DENIAL' },
  { pattern: /I('m| am) (unable|not able) to (search|browse|access)/i, category: 'CAPABILITY_DENIAL' },
  { pattern: /nemám (možnost|schopnost) (prohled|vyhled)/i, category: 'CAPABILITY_DENIAL' },

  // ── Echo (just repeats the question back) ───────────────────────────
  { pattern: /^(ptáte se|ptáš se|you('re| are) asking)/i, category: 'ECHO' },
  { pattern: /^(your question|váš dotaz|tvůj dotaz) (is|je|se týká)/i, category: 'ECHO' },
];

/**
 * D6.1 — Detect zombie/meta responses
 *
 * @param {string} content - LLM output
 * @returns {{ pass: boolean, violation?: { pattern: string, category: string } }}
 */
export function checkZombie(content) {
  if (!content || typeof content !== 'string') {
    return { pass: false, violation: { pattern: 'EMPTY', category: 'EMPTY_RESPONSE' } };
  }

  const trimmed = content.trim();

  // Check each zombie pattern
  for (const { pattern, category } of ZOMBIE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        pass: false,
        violation: {
          pattern: pattern.toString(),
          category,
        },
      };
    }
  }

  // ── Opener ratio check ──────────────────────────────────────────────
  // If the first sentence is meta/process and the rest is very short,
  // the response is effectively a zombie with a tiny tail.
  const firstSentenceEnd = trimmed.search(/[.!?]\s/);
  if (firstSentenceEnd > 0 && firstSentenceEnd < 200) {
    const firstSentence = trimmed.substring(0, firstSentenceEnd + 1);
    const rest = trimmed.substring(firstSentenceEnd + 1).trim();

    // First sentence is meta AND rest is too short
    const isMetaOpener = ZOMBIE_PATTERNS.some(z => z.pattern.test(firstSentence));
    if (isMetaOpener && rest.length < 100) {
      return {
        pass: false,
        violation: {
          pattern: 'META_OPENER_SHORT_TAIL',
          category: 'ZOMBIE_WITH_TAIL',
        },
      };
    }
  }

  return { pass: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// D6.2 — MINIMUM CONTENT DENSITY
// ─────────────────────────────────────────────────────────────────────────────
// Measures whether the response contains enough substantive content.
// NOT word count — we count "content tokens" (meaningful words minus filler).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common filler/stop words that don't count as content (CZ + EN)
 */
const FILLER_WORDS = new Set([
  // Czech
  'a', 'i', 'k', 'o', 'na', 'je', 'se', 'že', 'to', 'v', 'z', 'do',
  'pro', 'ale', 'tak', 'jak', 'co', 'by', 'si', 'ten', 'ta', 'ty',
  'být', 'jsou', 'jsem', 'jsi', 'jsme', 'jste', 'byl', 'byla', 'bylo',
  'které', 'který', 'která', 'tohle', 'toto', 'tato', 'tyto', 'této',
  'také', 'tedy', 'proto', 'pokud', 'nebo', 'ani', 'než', 'při',
  'jako', 'jeho', 'její', 'jejich', 'moje', 'tvoje', 'naše', 'vaše',
  'může', 'mohou', 'musí', 'bude', 'budou', 'byl', 'byli', 'byly',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'and', 'but', 'or', 'if', 'while', 'that', 'this', 'these', 'those',
  'it', 'its', 'he', 'she', 'they', 'them', 'his', 'her', 'their',
  'we', 'you', 'your', 'our', 'my', 'me', 'him', 'us', 'who', 'which',
  'what', 'about',
]);

/**
 * Count content tokens — meaningful words minus filler, URLs, and formatting.
 *
 * @param {string} text
 * @returns {number}
 */
export function countContentTokens(text) {
  if (!text) return 0;

  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')      // Remove URLs
    .replace(/[#*_`~\[\](){}|>]/g, '')   // Remove markdown formatting
    .replace(/\d+\.\s+/g, '')             // Remove numbered list markers
    .replace(/-\s+/g, '')                  // Remove bullet markers
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');   // Keep letters, numbers, spaces

  const words = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)             // Skip very short words
    .filter(w => !FILLER_WORDS.has(w));    // Skip filler words

  return words.length;
}

/**
 * Minimum content token thresholds per intent.
 * These are deliberately low — we want to catch zombie responses,
 * not penalize concise but informative answers.
 */
export const CONTENT_THRESHOLDS = Object.freeze({
  FACTUAL:     15,   // "DPH v ČR je 21%, snížená 15% a 10%." = ~10 tokens
  SEARCH:      15,   // Basic answer with source reference
  REPORT:      30,   // Must synthesize multiple sources
  ITEM_LOOKUP: 15,   // N items with details
  COMPARISON:  20,   // Must mention both sides
  SUMMARY:     12,   // Concise but must say something
  DETAILED:    40,   // Thorough explanation expected
  MINIMAL:      2,   // Just the answer — a date or number is enough
  STEP_BY_STEP: 20,  // Multiple steps
  DEFAULT:     12,   // Fallback
});

/**
 * D6.2 — Check minimum content density
 *
 * @param {string} content - LLM output
 * @param {string} intent - CRE intent (FACTUAL, REPORT, SEARCH, ...)
 * @param {string} [responseIntent] - Response format intent (SUMMARY, DETAILED, ...)
 * @returns {{ pass: boolean, tokens: number, threshold: number, reason?: string }}
 */
export function checkContentDensity(content, intent, responseIntent = null) {
  const tokens = countContentTokens(content);

  // Use responseIntent threshold if available, otherwise fall back to intent
  const key = responseIntent || intent || 'DEFAULT';
  const threshold = CONTENT_THRESHOLDS[key] ?? CONTENT_THRESHOLDS.DEFAULT;

  if (tokens < threshold) {
    return {
      pass: false,
      tokens,
      threshold,
      reason: `INSUFFICIENT_CONTENT: ${tokens} content tokens < ${threshold} required for ${key}`,
    };
  }

  return { pass: true, tokens, threshold };
}

// ─────────────────────────────────────────────────────────────────────────────
// D6.3 — RESPONSE INTENT ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
// Validates that the response structurally matches the requested format.
// Today, responseIntent is a HINT. D6.3 turns it into a CONTRACT.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural validators per response intent.
 * Each returns { pass, reason? }
 */
const INTENT_VALIDATORS = {
  COMPARISON: (content) => {
    // Must contain comparison structure: both sides mentioned
    // Look for: "vs", "oproti", "na rozdíl", comparison markers,
    // or table structure, or parallel sections
    const comparisonMarkers = [
      /\bvs\.?\b/i,
      /\boproti\b/i,
      /\bna rozdíl\b/i,
      /\bsrovnán/i,
      /\bporovnán/i,
      /\bvýhod.*nevýhod/i,
      /\bpros?\b.*\bcons?\b/i,
      /\bcompared?\b/i,
      /\bversus\b/i,
      /\bwhile\b/i,
      /\bwhereas\b/i,
      /\|.*\|.*\|/,              // table structure
      /\bon the other hand\b/i,
      /\bna druhou stranu\b/i,
      /\bzatímco\b/i,
    ];

    const hasComparison = comparisonMarkers.some(p => p.test(content));
    if (!hasComparison) {
      return {
        pass: false,
        reason: 'NO_COMPARISON_STRUCTURE: Response lacks comparison markers (vs, oproti, table, etc.)',
      };
    }
    return { pass: true };
  },

  STEP_BY_STEP: (content) => {
    // Must contain numbered steps
    const stepPattern = /(?:^|\n)\s*(?:\d+[.)]\s|krok\s+\d+)/im;
    const steps = content.match(/(?:^|\n)\s*\d+[.)]\s/gm);

    if (!steps || steps.length < 2) {
      return {
        pass: false,
        reason: `NO_STEPS: Expected numbered steps, found ${steps?.length || 0}`,
      };
    }
    return { pass: true };
  },

  BULLETS: (content) => {
    // Must contain bullet points
    const bullets = content.match(/(?:^|\n)\s*[-•*]\s/gm);
    if (!bullets || bullets.length < 2) {
      return {
        pass: false,
        reason: `NO_BULLETS: Expected bullet points, found ${bullets?.length || 0}`,
      };
    }
    return { pass: true };
  },

  SUMMARY: (content) => {
    // Must be concise — not more than ~5 paragraphs
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (paragraphs.length > 5) {
      return {
        pass: false,
        reason: `TOO_LONG_FOR_SUMMARY: ${paragraphs.length} paragraphs (expected ≤5)`,
      };
    }
    return { pass: true };
  },

  MINIMAL: (content) => {
    // Must be very short — ideally 1-2 sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 5);
    if (sentences.length > 4) {
      return {
        pass: false,
        reason: `TOO_LONG_FOR_MINIMAL: ${sentences.length} sentences (expected ≤4)`,
      };
    }
    return { pass: true };
  },

  // DIRECT, EXPLORATORY, OPINIONATED — no strict structural enforcement
  // (content density from D6.2 is sufficient)
};

/**
 * D6.3 — Enforce response intent structure
 *
 * @param {string} content - LLM output
 * @param {string} responseIntent - Requested response format
 * @returns {{ pass: boolean, reason?: string }}
 */
export function checkResponseIntent(content, responseIntent) {
  if (!responseIntent) {
    return { pass: true }; // No intent specified → no enforcement
  }

  const validator = INTENT_VALIDATORS[responseIntent];
  if (!validator) {
    return { pass: true }; // Unknown intent → pass (don't block new intents)
  }

  return validator(content);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE GATE — Single entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GateVerdict
 * @property {boolean} ok - All checks passed
 * @property {'ZOMBIE'|'LOW_CONTENT'|'WRONG_FORMAT'|null} failDimension
 * @property {string|null} reason - Human-readable failure reason
 * @property {Object} details - Per-dimension results
 */

/**
 * enforceOutputContract — Run all D6 checks on LLM output.
 *
 * Call this AFTER detectFluff in synthesis.js.
 * If verdict.ok === false, either retry or degrade.
 *
 * @param {string} content - Raw LLM output
 * @param {Object} context
 * @param {string} context.intent - CRE intent (FACTUAL, REPORT, etc.)
 * @param {string} [context.responseIntent] - Response format (SUMMARY, COMPARISON, etc.)
 * @returns {GateVerdict}
 */
export function enforceOutputContract(content, { intent, responseIntent = null } = {}) {
  // D6.1 — Zombie check (highest priority)
  const zombie = checkZombie(content);
  if (!zombie.pass) {
    logger.warn('OutputGate', 'D6.1 ZOMBIE detected', {
      category: zombie.violation.category,
      preview: content?.substring(0, 80),
    });
    return {
      ok: false,
      failDimension: 'ZOMBIE',
      reason: `ZOMBIE_RESPONSE: ${zombie.violation.category}`,
      details: { zombie, density: null, format: null },
    };
  }

  // D6.2 — Content density check
  const density = checkContentDensity(content, intent, responseIntent);
  if (!density.pass) {
    logger.warn('OutputGate', 'D6.2 LOW CONTENT', {
      tokens: density.tokens,
      threshold: density.threshold,
      intent,
      responseIntent,
      preview: content?.substring(0, 80),
    });
    return {
      ok: false,
      failDimension: 'LOW_CONTENT',
      reason: density.reason,
      details: { zombie, density, format: null },
    };
  }

  // D6.3 — Response intent enforcement
  const format = checkResponseIntent(content, responseIntent);
  if (!format.pass) {
    logger.warn('OutputGate', 'D6.3 WRONG FORMAT', {
      responseIntent,
      reason: format.reason,
      preview: content?.substring(0, 80),
    });
    return {
      ok: false,
      failDimension: 'WRONG_FORMAT',
      reason: format.reason,
      details: { zombie, density, format },
    };
  }

  return {
    ok: true,
    failDimension: null,
    reason: null,
    details: { zombie, density, format },
  };
}

/**
 * Build a retry prompt that addresses the specific failure.
 * Used when enforceOutputContract fails and we want to retry.
 *
 * @param {string} originalPrompt - The synthesis prompt
 * @param {GateVerdict} verdict - The failed verdict
 * @returns {string}
 */
export function buildOutputGateRetryPrompt(originalPrompt, verdict) {
  let constraint = '';

  switch (verdict.failDimension) {
    case 'ZOMBIE':
      constraint = `
⚠️ YOUR PREVIOUS RESPONSE WAS REJECTED: ${verdict.reason}
CRITICAL: You must provide ACTUAL CONTENT, not meta-commentary about responding.
- Do NOT say "here is my answer" / "rád pomohu" / "as an AI"
- JUST ANSWER THE QUESTION directly with concrete information.
- Start with the actual fact, explanation, or data.`;
      break;

    case 'LOW_CONTENT':
      constraint = `
⚠️ YOUR PREVIOUS RESPONSE WAS REJECTED: ${verdict.reason}
CRITICAL: Your response lacked sufficient content.
- Include CONCRETE facts, numbers, dates, examples, or explanations
- Do NOT give vague generalities
- Minimum: provide specific, actionable information the user can use`;
      break;

    case 'WRONG_FORMAT':
      constraint = `
⚠️ YOUR PREVIOUS RESPONSE WAS REJECTED: ${verdict.reason}
CRITICAL: Your response did not match the requested format.
- Follow the EXACT format specified in the response style instructions
- If COMPARISON: use side-by-side structure, mention both sides
- If STEP_BY_STEP: use numbered steps (1. 2. 3.)
- If BULLETS: use bullet points for every item
- If SUMMARY: keep it to 2-3 sentences maximum`;
      break;
  }

  return `${originalPrompt}\n\n${constraint}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export default {
  enforceOutputContract,
  buildOutputGateRetryPrompt,
  checkZombie,
  checkContentDensity,
  checkResponseIntent,
  countContentTokens,
  CONTENT_THRESHOLDS,
  ZOMBIE_PATTERNS,
};

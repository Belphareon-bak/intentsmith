// ═══════════════════════════════════════════════════════════════════════════════
// Creative Quality Gate — v56.0 Sprint 4
// ═══════════════════════════════════════════════════════════════════════════════
//
//   Validates CREATIVE intent responses for substantive content.
//   Rejects: empty templates, skeleton responses, echo-backs, generic filler.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimum content length for creative responses (chars).
 */
const CREATIVE_MIN_LENGTH = 100;

/**
 * Patterns indicating a skeleton/template response instead of actual creative content.
 */
const SKELETON_MARKERS = [
  /\[sem vložte/i,
  /\[insert here/i,
  /\[TODO\]/i,
  /\.\.\.(váš|your) text\.\.\./i,
  /\[doplňte\]/i,
  /\[fill in\]/i,
  /\[name\]/i,
  /\[placeholder\]/i,
];

/**
 * Patterns indicating the response just restates the task without doing it.
 */
const ECHO_BACK_PATTERNS = [
  /^(Tady je|Here is|Zde je)\s+(návrh|draft|koncept|outline)\s*(:|\.)/i,
  /^(Připravil jsem|I've prepared|Vytvořil jsem)\s+(pro vás\s+)?(strukturu|outline|osnovu)/i,
];

/**
 * Generic filler phrases that indicate low-quality creative output.
 */
const FILLER_PHRASES = [
  'lorem ipsum',
  'example text here',
  'příklad textu',
  'toto je ukázka',
  'this is a sample',
];

/**
 * Assert that a CREATIVE response has substantive quality.
 *
 * @param {string} content — LLM response content
 * @param {string} input — Original user input (for context)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function assertCreativeQuality(content, input) {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'Empty creative response' };
  }

  const trimmed = content.trim();

  // ─── Length check ───────────────────────────────────────────────────────
  if (trimmed.length < CREATIVE_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Creative response too short: ${trimmed.length}/${CREATIVE_MIN_LENGTH} chars`,
    };
  }

  // ─── Skeleton/template check ────────────────────────────────────────────
  for (const pattern of SKELETON_MARKERS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: `Creative response contains skeleton placeholder: ${pattern.source.substring(0, 40)}`,
      };
    }
  }

  // ─── Echo-back check ────────────────────────────────────────────────────
  const head = trimmed.substring(0, 200);
  for (const pattern of ECHO_BACK_PATTERNS) {
    if (pattern.test(head)) {
      // Only fail if the rest is too thin (echo + thin body = bad)
      const bodyAfterEcho = trimmed.substring(head.indexOf('\n') + 1 || 100).trim();
      if (bodyAfterEcho.length < 80) {
        return {
          valid: false,
          reason: 'Creative response echoes task without substantive content',
        };
      }
    }
  }

  // ─── Filler phrase check ────────────────────────────────────────────────
  const lower = trimmed.toLowerCase();
  for (const filler of FILLER_PHRASES) {
    if (lower.includes(filler)) {
      return {
        valid: false,
        reason: `Creative response contains filler: "${filler}"`,
      };
    }
  }

  // ─── Repetition check ──────────────────────────────────────────────────
  // Detect if the same sentence is repeated 3+ times (degenerate output)
  const sentences = trimmed.split(/[.!?]\s+/).filter(s => s.length > 20);
  if (sentences.length >= 3) {
    const freq = {};
    for (const s of sentences) {
      const key = s.trim().toLowerCase().substring(0, 60);
      freq[key] = (freq[key] || 0) + 1;
      if (freq[key] >= 3) {
        return {
          valid: false,
          reason: 'Creative response contains degenerate repetition',
        };
      }
    }
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fluff Detection — used by synthesis.js (TOOL_CALL path)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns indicating fluff — response that talks around the data
 * instead of presenting it.
 */
const FLUFF_PATTERNS = [
  // CZ
  /na základě (dostupných|vyhledaných) informací/i,
  /z výsledků vyhledávání (vyplývá|je patrné)/i,
  /podívejme se na/i,
  /je důležité (zmínit|poznamenat|uvést)/i,
  /rád bych (upozornil|zmínil|poznamenal)/i,
  /v kontextu (vaší|této) otázky/i,
  /pojďme se podívat/i,
  /dovolte mi (shrnout|představit)/i,
  // EN
  /based on (the|my) (search|available) (results|information)/i,
  /let me (summarize|break down|walk you through)/i,
  /it('s| is) (important|worth) (to note|noting|mentioning)/i,
  /I('d| would) like to (point out|highlight|mention)/i,
  /in (the context|light) of your question/i,
  /let's (take a look|dive into|explore)/i,
];

/**
 * Detect fluff in synthesis output.
 * Fluff = meta-commentary about the data instead of presenting it.
 *
 * @param {string} content — LLM synthesis output
 * @param {Array} successfulData — Tool results that were synthesized
 * @returns {{ isFluff: boolean, reason?: string, confidence: number }}
 */
export function detectFluff(content, successfulData = []) {
  if (!content || typeof content !== 'string') {
    return { isFluff: true, reason: 'Empty synthesis output', confidence: 0.1 };
  }

  const trimmed = content.trim();

  // Very short synthesis when data was available = likely fluff
  if (successfulData.length > 0 && trimmed.length < 40) {
    return {
      isFluff: true,
      reason: `Synthesis too short (${trimmed.length} chars) with ${successfulData.length} data sources`,
      confidence: 0.3,
    };
  }

  // Check first 300 chars for fluff patterns
  const head = trimmed.substring(0, 300);
  for (const pattern of FLUFF_PATTERNS) {
    if (pattern.test(head)) {
      // Fluff intro is acceptable if followed by substantive content
      const afterMatch = trimmed.substring(100).trim();
      if (afterMatch.length < 50) {
        return {
          isFluff: true,
          reason: `Fluff intro without substance: ${pattern.source.substring(0, 40)}`,
          confidence: 0.4,
        };
      }
      // Fluff intro + some content = mild fluff, still worth flagging
      return {
        isFluff: true,
        reason: `Fluff preamble detected: ${pattern.source.substring(0, 40)}`,
        confidence: 0.65,
      };
    }
  }

  // Check ratio: if content has data sources but response doesn't reference specifics
  if (successfulData.length >= 2 && trimmed.length > 100) {
    // Count numbers/specifics in response
    const numberCount = (trimmed.match(/\d+/g) || []).length;
    const urlCount = (trimmed.match(/https?:\/\//g) || []).length;
    const specifics = numberCount + urlCount;

    if (specifics === 0 && trimmed.length < 300) {
      return {
        isFluff: true,
        reason: 'No specific data (numbers, URLs) despite multiple sources',
        confidence: 0.55,
      };
    }
  }

  return { isFluff: false, confidence: 0.9 };
}

/**
 * Build a retry prompt that instructs the LLM to eliminate fluff.
 *
 * @param {string} originalPrompt — The synthesis prompt that produced fluff
 * @param {{ reason: string }} fluffCheck — Fluff detection result
 * @returns {string} — Enhanced prompt
 */
export function buildFluffRetryPrompt(originalPrompt, fluffCheck) {
  return `${originalPrompt}\n\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: ${fluffCheck.reason}\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `POŽADAVKY:\n` +
    `- ZAČNI odpovědí, ne úvodem/preambulí\n` +
    `- Žádné "na základě vyhledávání", "podívejme se", "je důležité zmínit"\n` +
    `- Uveď KONKRÉTNÍ fakta: čísla, data, jména, URL\n` +
    `- Piš jako expert, ne jako zprostředkovatel dat\n` +
    `═══════════════════════════════════════════════════════════════`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Atomic Answer Gate — validates single-fact (FACTUAL) responses
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Synthesis quality thresholds per intent type.
 */
export const SYNTHESIS_THRESHOLDS = Object.freeze({
  FACTUAL: { minSentences: 1, maxSentences: 5, minChars: 20, maxChars: 800 },
  SEARCH:  { minSentences: 1, maxSentences: 15, minChars: 40, maxChars: 3000 },
  REPORT:  { minSentences: 3, maxSentences: 50, minChars: 200, maxChars: 8000 },
  CREATIVE:{ minSentences: 2, maxSentences: 100, minChars: 100, maxChars: 10000 },
  DEFAULT: { minSentences: 1, maxSentences: 20, minChars: 10, maxChars: 5000 },
});

/**
 * Count sentences in text.
 * Splits on sentence-ending punctuation followed by whitespace or end-of-string.
 *
 * @param {string} text
 * @returns {number}
 */
export function countSentences(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  // Split on sentence boundaries: .!? followed by space/newline or end
  const sentences = trimmed
    .split(/[.!?](?:\s|$)/)
    .filter(s => s.trim().length > 0);

  // At least 1 if there's any content
  return Math.max(sentences.length, trimmed.length > 0 ? 1 : 0);
}

/**
 * Atomic Answer Gate — validates that FACTUAL intent responses are
 * concise, direct, and contain a concrete answer (not meta-commentary).
 *
 * "Atomic" = the response should lead with a single definitive fact,
 * optionally followed by brief context. Not a wall of text, not an echo.
 *
 * @param {string} content — LLM response
 * @param {Object} opts
 * @param {string} [opts.intent='FACTUAL'] — CRE intent
 * @returns {{ valid: boolean, reason?: string, sentences?: number }}
 */
export function atomicAnswerGate(content, opts = {}) {
  const { intent = 'FACTUAL' } = opts;
  const thresholds = SYNTHESIS_THRESHOLDS[intent] || SYNTHESIS_THRESHOLDS.DEFAULT;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, reason: 'Empty response', sentences: 0 };
  }

  const trimmed = content.trim();
  const sentences = countSentences(trimmed);

  // Too short
  if (trimmed.length < thresholds.minChars) {
    return {
      valid: false,
      reason: `Response too short: ${trimmed.length}/${thresholds.minChars} chars`,
      sentences,
    };
  }

  // Too long (for FACTUAL — response should be concise)
  if (intent === 'FACTUAL' && trimmed.length > thresholds.maxChars) {
    return {
      valid: false,
      reason: `FACTUAL response too verbose: ${trimmed.length}/${thresholds.maxChars} chars`,
      sentences,
    };
  }

  // Too many sentences for a factual answer
  if (intent === 'FACTUAL' && sentences > thresholds.maxSentences) {
    return {
      valid: false,
      reason: `FACTUAL response has ${sentences} sentences (max ${thresholds.maxSentences})`,
      sentences,
    };
  }

  // Check for meta-start patterns (factual should start with the answer)
  if (intent === 'FACTUAL') {
    const head = trimmed.substring(0, 150);
    const metaStarts = [
      /^(To je|That's a|That is a) (dobrá|zajímavá|good|great|interesting) (otázka|question)/i,
      /^(Samozřejmě|Certainly|Of course|Sure),?\s/i,
      /^(Dovolte mi|Let me|Allow me)\s/i,
    ];
    for (const pattern of metaStarts) {
      if (pattern.test(head)) {
        return {
          valid: false,
          reason: 'FACTUAL response starts with meta-preamble instead of the answer',
          sentences,
        };
      }
    }
  }

  return { valid: true, sentences };
}

/**
 * Build retry prompt for atomic answer gate failure.
 *
 * @param {string} originalPrompt
 * @param {{ reason: string }} gateResult
 * @returns {string}
 */
export function buildAtomicRetryPrompt(originalPrompt, gateResult) {
  return `${originalPrompt}\n\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `⚠️ ODPOVĚĎ ODMÍTNUTA: ${gateResult.reason}\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `POŽADAVKY:\n` +
    `- ZAČNI odpovědí — první věta MUSÍ obsahovat konkrétní fakt\n` +
    `- Maximálně 3-5 vět celkem\n` +
    `- Žádné preambule ("To je dobrá otázka", "Samozřejmě")\n` +
    `- Žádné opakování otázky\n` +
    `═══════════════════════════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for testing
// ─────────────────────────────────────────────────────────────────────────────
export const _test = {
  SKELETON_MARKERS,
  ECHO_BACK_PATTERNS,
  FILLER_PHRASES,
  FLUFF_PATTERNS,
  CREATIVE_MIN_LENGTH,
};

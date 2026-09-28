// CRE v86.0 M3 — Semantic Feedback Detection
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects implicit and explicit user feedback signals from the conversation.
//
// Signal types:
//   POSITIVE_EXPLICIT  — "díky", "super", "thanks", "perfektní"
//   POSITIVE_IMPLICIT  — follow-up without complaint (user accepted prev response)
//   NEGATIVE_EXPLICIT  — "špatně", "blbost", "wrong", "ne tak"
//   NEGATIVE_IMPLICIT  — user reformulates same question (implicit rejection)
//   CORRECTION         — "ne, myslel jsem...", "actually I meant...", "oprav to"
//   NEUTRAL            — no detectable signal
//
// Architecture:
//   Called at turn start in conversation handler, BEFORE CRE classification.
//   Returns feedback signal, which handlers use to:
//   1. Record to PreferenceEngine (positive/negative)
//   2. Store correction in LTM (correction type)
//   3. Reinforce LTM entries that contributed to successful responses
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// FEEDBACK SIGNAL TYPES
// ════════════════════════════════════════════════════════════════════════════

export const FeedbackSignal = {
  POSITIVE_EXPLICIT: 'positive_explicit',
  POSITIVE_IMPLICIT: 'positive_implicit',
  NEGATIVE_EXPLICIT: 'negative_explicit',
  NEGATIVE_IMPLICIT: 'negative_implicit',
  CORRECTION: 'correction',
  NEUTRAL: 'neutral',
};

// ════════════════════════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ════════════════════════════════════════════════════════════════════════════

// Explicit positive — user explicitly thanks or approves
const POSITIVE_EXPLICIT_PATTERNS = [
  /\b(d[ií]ky|díky moc|dekuji|děkuji|d[ěe]kuju|thanks?|thank you|thx|great|super|perfekt|skvěl|výborn|excellent|awesome|perfect|good job|well done|přesně|exactly|genau|danke)\b/i,
  /^(ok[áa]?|fajn|fine|cool|nice|dobr[éáeý])\s*[!.]*$/i,
  /👍|👏|🎉|💯|❤️/,
];

// Explicit negative — user explicitly rejects
const NEGATIVE_EXPLICIT_PATTERNS = [
  /\b([sš]patn[ěé]|blbost|nesmysl|wrong|bad|horrible|terrible|awful|nic moc|ne\s*tak|nefunguje|to nen[ií]|that'?s not|incorrect|inaccurate)\b/i,
  /\b(oprav|fix|změň|zmen|předělej|predelej|redo|try again|znovu|opakuj|přepiš|prepis|rewrite)\b/i,
  /👎|😡|😤|🙁/,
];

// Correction — user is providing the right answer
const CORRECTION_PATTERNS = [
  /\b(ne,?\s+myslel|ne,?\s+mám na mysli|ne,?\s+chtěl|actually\s+i\s+meant|i\s+meant|no,?\s+i\s+want|oprav\s+to\s+na|správně\s+je|the\s+correct|should\s+be)\b/i,
  /\b(to\s+je\s+špatně|to\s+neni\s+správně|that'?s\s+wrong|that'?s\s+incorrect)\b.*[,:]\s*.+/i,
  /^ne[,.]?\s+/i, // starts with "ne," followed by correction
];

// Reformulation — user rephrases same question (implicit negative)
const REFORMULATION_INDICATORS = [
  /\b(jinak\s+řečeno|jinak|jinými slovy|in other words|to put it differently|let me rephrase|rephrase)\b/i,
  /\b(zkus(it)?\s+to\s+jinak|try\s+(it\s+)?differently|try\s+again)\b/i,
];

// ════════════════════════════════════════════════════════════════════════════
// TOPIC SIMILARITY (simple overlap check)
// ════════════════════════════════════════════════════════════════════════════

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 3)
  );
}

function topicSimilarity(input, previousInput) {
  if (!input || !previousInput) return 0;
  const a = extractKeywords(input);
  const b = extractKeywords(previousInput);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap++;
  }
  return overlap / Math.max(a.size, b.size);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect user feedback signal from current input.
 *
 * Must be called BEFORE CRE classification, at the start of each turn.
 *
 * @param {string} input - Current user message
 * @param {Object} sessionState - Session state with lastDecision, lastUserInput
 * @returns {{
 *   type: string,       // FeedbackSignal type
 *   confidence: number, // 0.0–1.0
 *   signal: string,     // Human-readable description
 *   correctionData?: {  // Only for CORRECTION type
 *     original: string, // What was wrong
 *     corrected: string // What's right (extracted from user input)
 *   }
 * }}
 */
export function detectFeedback(input, sessionState) {
  if (!input || !sessionState?.lastDecision) {
    return { type: FeedbackSignal.NEUTRAL, confidence: 0, signal: 'no_context' };
  }

  const trimmed = input.trim();

  // 1. Check for CORRECTION first (most specific)
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      const correctionData = extractCorrection(trimmed, sessionState.lastUserInput);
      return {
        type: FeedbackSignal.CORRECTION,
        confidence: 0.85,
        signal: 'user_correction',
        correctionData,
      };
    }
  }

  // 2. Check for NEGATIVE EXPLICIT
  for (const pattern of NEGATIVE_EXPLICIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        type: FeedbackSignal.NEGATIVE_EXPLICIT,
        confidence: 0.9,
        signal: 'explicit_negative',
      };
    }
  }

  // 3. Check for POSITIVE EXPLICIT
  for (const pattern of POSITIVE_EXPLICIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        type: FeedbackSignal.POSITIVE_EXPLICIT,
        confidence: 0.9,
        signal: 'explicit_positive',
      };
    }
  }

  // 4. Check for NEGATIVE IMPLICIT (reformulation of same topic)
  const isReformulation = REFORMULATION_INDICATORS.some(p => p.test(trimmed));
  const similarity = topicSimilarity(trimmed, sessionState.lastUserInput);

  if (isReformulation || similarity > 0.5) {
    // High topic overlap + new phrasing = user wasn't satisfied
    if (isReformulation) {
      return {
        type: FeedbackSignal.NEGATIVE_IMPLICIT,
        confidence: 0.75,
        signal: 'reformulation',
      };
    }
    // Pure topic similarity without reformulation markers is weaker signal
    if (similarity > 0.6) {
      return {
        type: FeedbackSignal.NEGATIVE_IMPLICIT,
        confidence: 0.5,
        signal: 'topic_repeat',
      };
    }
  }

  // 5. POSITIVE IMPLICIT — user moves to NEW topic (accepted previous response)
  if (similarity < 0.3 && sessionState.lastDecision) {
    return {
      type: FeedbackSignal.POSITIVE_IMPLICIT,
      confidence: 0.6,
      signal: 'topic_change',
    };
  }

  // 6. Default: NEUTRAL
  return { type: FeedbackSignal.NEUTRAL, confidence: 0, signal: 'ambiguous' };
}

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract what was wrong and what's right from a correction message.
 *
 * Examples:
 *   "ne, myslel jsem React" → { original: <prev>, corrected: "React" }
 *   "správně je 42" → { original: <prev>, corrected: "42" }
 *
 * @param {string} input - The correction message
 * @param {string} previousInput - What user originally asked
 * @returns {{ original: string, corrected: string }}
 */
function extractCorrection(input, previousInput) {
  // Try to extract the corrected part after comma or colon
  const afterSeparator = input.match(/[,:]\s*(.+)$/);
  if (afterSeparator) {
    return {
      original: previousInput || '',
      corrected: afterSeparator[1].trim(),
    };
  }

  // Try to extract after "ne, " or "no, "
  const afterNe = input.match(/^ne[,.]?\s+(.+)/i);
  if (afterNe) {
    return {
      original: previousInput || '',
      corrected: afterNe[1].trim(),
    };
  }

  // Fallback: the whole input is the correction
  return {
    original: previousInput || '',
    corrected: input,
  };
}

/**
 * Classify feedback as positive or negative for PreferenceEngine.
 * Maps detailed signal types to simple positive/negative.
 *
 * @param {string} feedbackType - FeedbackSignal type
 * @returns {'positive' | 'negative' | null}
 */
export function classifyFeedback(feedbackType) {
  switch (feedbackType) {
    case FeedbackSignal.POSITIVE_EXPLICIT:
    case FeedbackSignal.POSITIVE_IMPLICIT:
      return 'positive';
    case FeedbackSignal.NEGATIVE_EXPLICIT:
    case FeedbackSignal.NEGATIVE_IMPLICIT:
    case FeedbackSignal.CORRECTION:
      return 'negative';
    default:
      return null;
  }
}

export default { detectFeedback, classifyFeedback, FeedbackSignal };

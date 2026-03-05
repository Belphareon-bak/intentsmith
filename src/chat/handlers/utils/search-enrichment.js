// Search Query Enrichment — extracted from decisions.js (v93.1)
//
// Follow-up queries get lastTurnTopic prepended to create meaningful searches.
// Without this, DDG receives "A co jeho teorém?" which returns irrelevant results.
//
// Examples:
//   lastTurnTopic: "Pythagoras"
//   input: "A co jeho teorém?" → "Pythagoras teorém"
//   input: "Kdy se narodil?"   → "Pythagoras kdy se narodil"
//   input: "A co Einstein?"    → "Einstein" (has own subject, no enrichment)

import { logger } from '../../../core/logger.js';

// Czech/English follow-up indicators — pronouns/references without subject
const FOLLOW_UP_INDICATORS = [
  // CZ: follow-up connectors + pronouns
  /^a (co|jak|kde|kdy|proč)\b/i,      // "A co jeho teorém?"
  /^(a |)(ten|ta|to|ti|ty)\b/i,       // "A ten?"
  /\b(jeho|její|jejich|toho|tomu|tím|tom)\b/i,  // possessive/demonstrative
  /^(kdy|kde|jak|proč) se\b/i,        // "Kdy se narodil?" (no subject)
  // SK: follow-up
  /^a (čo|ako|kde|kedy|prečo)\b/i,    // "A čo jeho teorém?"
  /\b(jeho|jej|ich|toho|tomu|tým|tom)\b/i,  // SK possessive (overlap with CZ)
  /^(kedy|kde|ako|prečo) sa\b/i,      // "Kedy sa narodil?"
  // DE: follow-up
  /^und (was|wie|wo|wann|warum)\b/i,   // "Und was ist mit...?"
  /\b(sein|seine[rmns]?|ihr[ems]?|dessen|deren|davon|damit|darüber)\b/i, // DE pronouns
  /^(wann|wo|wie|warum) (hat|ist|war|wurde)\b/i,  // "Wann wurde er geboren?"
  // PL: follow-up
  /^a (co|jak|gdzie|kiedy|dlaczego)\b/i,  // "A co z jego..."
  /\b(jego|jej|ich|tego|temu|tym)\b/i,     // PL possessive
  /^(kiedy|gdzie|jak|dlaczego) si[ęe]\b/i, // "Kiedy się urodził?"
  // FR: follow-up
  /^et (que|comment|où|quand|pourquoi)\b/i, // "Et que dire de..."
  /\b(son|sa|ses|leur|leurs|celui|celle|ceux|celles|en|y)\b/i, // FR pronouns
  // ES: follow-up
  /^y (qué|cómo|dónde|cuándo|por qué)\b/i, // "¿Y qué hay de..."
  /\b(su|sus|él|ella|ellos|ellas|eso|esto|aquel)\b/i, // ES pronouns
  // EN: follow-up
  /\b(he|his|she|her|its|their|that|those|it)\b/i,    // English pronouns
  /^(when|where|how|why) (did|was|were|is)\b/i,       // "When was he born?"
];

// Patterns that indicate the input has its OWN subject (no enrichment needed)
// Must skip sentence-initial capitalization and question words
const QUESTION_WORDS = /^(co|kdo|kde|kdy|jak|proč|jaký|jaké|která|který|kolik|čo|kto|ako|kedy|prečo|aký|aké|koľko|was|wer|wo|wann|wie|warum|welch|wieviel|co|kto|jak|gdzie|kiedy|dlaczego|ile|jaki|jakie|qu[eéi]|qui|où|quand|comment|pourquoi|combien|quel|qué|quién|dónde|cuándo|cómo|cuánto|what|who|where|when|how|why|which|does|did|is|are|was|were|und|et|a|y|and)\s/i;

function hasOwnSubject(input) {
  // Strip leading question/connector words to find the real subject
  const stripped = input.replace(QUESTION_WORDS, '').trim();

  // Check for proper nouns (capitalized words that aren't sentence-initial)
  // Look for capitalized words NOT at position 0 of stripped text
  const words = stripped.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Skip first word (might be capitalized just because sentence start)
    if (i === 0 && words.length > 1) continue;
    // Check if word starts with uppercase and is long enough to be a name
    if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]{2,}/.test(w)) {
      return true;
    }
  }

  // Check explicit subject patterns: "co je X", "kdo je X"
  if (/^(co je|kdo je|co jsou|kdo byl|what is|who is|who was)\b/i.test(input)) {
    return true;
  }

  return false;
}

/**
 * v61.2: Detect "meta" follow-ups that carry no meaningful search terms.
 * These are messages like "dej mi to", "jo přesně", "tak ten report",
 * "no to jsem myslel" — the user is asking for the SAME thing, not a new search.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isMetaContinuation(input) {
  const trimmed = input.trim().toLowerCase();

  // Direct meta patterns (CZ/SK/EN/DE/PL)
  const META_PATTERNS = [
    /^(no\s+)?(to\s+)?(jsem\s+myslel|přesně|exactly|genau)/i,
    /^(tak\s+)?(mi\s+)?(to\s+)?(dej|ukaž|pošli|give|show|send)/i,
    /^(jo|ano|yeah?|yes|ja)\s*(,\s*)?(to|přesně|exactly|genau)?/i,
    /^dej\s+(mi\s+)?(ten|to|tu)\s+(report|výsledek|result)/i,
    /^(ukaž|zobraz|pošli)\s+(mi\s+)?(to|ten|tu)/i,
    /^(tak|no)\s+(co|jak)\s+(ten|ta|to)\b/i,
    /^(chci|chtěl)\s+(ten|to|tu)\s+(report|výsledek|result|odpověď)/i,
  ];

  if (META_PATTERNS.some(p => p.test(trimmed))) return true;

  // Heuristic: strip common filler words and check if fewer than 3 content words remain
  const stripped = trimmed
    .replace(/\b(no|tak|jo|ano|a|to|ten|ta|tu|ty|ti|mi|mě|mně|si|se|jsem|myslel|přesně|prosím|dej|ukaž|report|dál|please|just|the|that|it|me|give|show)\b/gi, '')
    .replace(/[,!?.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If after stripping meta words, fewer than 2 content words remain → meta continuation
  const contentWords = stripped.split(' ').filter(w => w.length > 2);
  return contentWords.length < 2;
}

/**
 * Enrich a follow-up search query with context from the last turn.
 *
 * @param {string} input - Current user input
 * @param {string|null} lastTurnTopic - Topic extracted from previous turn
 * @returns {{ query: string, enriched: boolean, topic: string|null }}
 */
export function enrichSearchQuery(input, lastTurnTopic) {
  if (!lastTurnTopic || !input) {
    return { query: input, enriched: false, topic: null };
  }

  // Check if input is a follow-up (has pronouns/references without own subject)
  const isFollowUp = FOLLOW_UP_INDICATORS.some(p => p.test(input));

  if (!isFollowUp || hasOwnSubject(input)) {
    return { query: input, enriched: false, topic: lastTurnTopic };
  }

  // Strip follow-up connectors ("A co", "A jak") and pronouns for cleaner query
  let cleaned = input
    .replace(/^a\s+/i, '')           // strip leading "A "
    .replace(/\b(jeho|její|jejich|he|his|she|her|its|their|that|those|it)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Build enriched query: topic + cleaned follow-up
  const enriched = `${lastTurnTopic} ${cleaned}`.trim();

  logger.info('EnrichQuery', 'Follow-up query enriched with topic', {
    original: input.substring(0, 60),
    enriched: enriched.substring(0, 60),
    topic: lastTurnTopic,
  });

  return { query: enriched, enriched: true, topic: lastTurnTopic };
}

/**
 * Transforms history into a lightweight format for the synthesis prompt.
 * LLM sees what the user asked and a summary of what was answered,
 * so pronouns like "jeho" can be resolved.
 */
export function buildConversationContext(history) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return null;
  }

  return history.slice(-3).map(h => ({
    userInput: h.userInput || null,
    // Truncate assistant response to avoid bloating the prompt
    assistantSummary: h.response?.content
      ? h.response.content.substring(0, 150) + (h.response.content.length > 150 ? '...' : '')
      : null,
  })).filter(t => t.userInput || t.assistantSummary);
}

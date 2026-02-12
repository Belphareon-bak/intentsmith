// C3-Agent v56.2.2 — Query Canonicalizer
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Transform sanitized search queries into effective search queries.
//
// The sanitizer removes instructional words (odpověz, stručně, prosím...).
// But it leaves behind CONNECTIVE NOISE — words that are neither instructions
// nor searchable content:
//
//   "Řekni mi o Pythagorovi" → sanitizer → "mi o Pythagorovi"
//   "Vysvětli mi co je to fotosyntéza" → sanitizer → "mi co je to fotosyntéza"
//
// The canonicalizer strips this connective noise to produce a clean search query:
//
//   "mi o Pythagorovi" → canonicalizer → "Pythagorovi"
//   "mi co je to fotosyntéza" → canonicalizer → "fotosyntéza"
//
// PIPELINE POSITION:
//   raw input → sanitizeSearchQuery() → canonicalizeQuery() → executeWebSearch()
//
// DESIGN CONSTRAINTS:
//   ✅ Pure function, deterministic
//   ✅ No LLM calls
//   ✅ No intent changes (input SEARCH → output SEARCH)
//   ✅ Multilingual (CZ, SK, EN, DE, PL, FR, ES)
//   ✅ Never produces empty string (fallback to input)
//   ❌ No inflection normalization (Pythagorovi → Pythagoras is Phase 2)
//   ❌ No entity type classification
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// NOISE PREFIX PATTERNS
// ════════════════════════════════════════════════════════════════════════════
// These are connective fragments left behind after sanitizer removes
// instructional words. Ordered longest-first for greedy matching.
//
// Pattern design: Each regex is anchored to ^, case-insensitive.
// They consume the noise prefix and leave the content behind.
// ════════════════════════════════════════════════════════════════════════════

const NOISE_PREFIXES = [
  // ── Czech (longest first) ─────────────────────────────────────
  // v61.2: "chci report z/o X" → "X" (REPORT intent queries)
  /^chci\s+report\s+(z|ze|o|na\s+t[ée]ma)\s+/i,
  /^chci\s+(zpr[áa]vu|report|shrnut[ií]|p[řr]ehled)\s+(z|ze|o|na\s+t[ée]ma)\s+/i,
  /^dej\s+mi\s+(report|zpr[áa]vu|shrnut[ií]|p[řr]ehled)\s+(z|ze|o|na\s+t[ée]ma)\s+/i,
  // "chci X" / "chtěl bych X" — generic want prefix
  /^(chci|cht[ěe]l\s+bych?|pot[řr]ebuji|pot[řr]ebuju)\s+/i,
  // "A teď mi řekni o X" → sanitizer → "A teď mi o X"
  /^a\s+te[ďd]\s+mi\s+o\s+/i,
  // "Řekni mi něco o X" → sanitizer → "mi něco o X"
  /^mi\s+n[ěe][čc]o\s+o\s+/i,
  // "Řekni mi více o X" → sanitizer → "mi více o X"
  /^mi\s+(v[íi]ce|v[íi]c)\s+o\s+/i,
  // "Vysvětli mi co je to X" → sanitizer → "mi co je to X"
  /^mi\s+co\s+je\s+to\s+/i,
  // "Vysvětli mi co je X" → sanitizer → "mi co je X"
  /^mi\s+co\s+je\s+/i,
  // "Řekni mi o X" → sanitizer → "mi o X"
  /^mi\s+o\s+/i,
  // "co je to X" (bare prefix)
  /^co\s+je\s+to\s+/i,
  // "co je X" (bare)
  /^co\s+je\s+/i,
  // "A teď mi X" (residual connector)
  /^a\s+te[ďd]\s+mi\s+/i,
  // "A co X" / "A jak X" (follow-up connectors that leak through)
  /^a\s+(co|jak|kde|kdy|kdo)\s+/i,
  // "najdi informace o X" / "najdi mi X"
  /^najdi\s+(informace\s+o|mi)\s+/i,
  // "najdi o X" / "hledej o X"
  /^(najdi|hledej|vyhledej)\s+o\s+/i,
  // bare "mi " at start
  /^mi\s+/i,

  // ── Slovak ────────────────────────────────────────────────────
  /^mi\s+[čc]o\s+je\s+to\s+/i,
  /^mi\s+[čc]o\s+je\s+/i,
  /^mi\s+o\s+/i,
  /^[čc]o\s+je\s+to\s+/i,
  /^[čc]o\s+je\s+/i,
  /^n[áa]jdi\s+(inform[áa]cie\s+o|mi)\s+/i,

  // ── English ───────────────────────────────────────────────────
  // "tell me about X" → sanitizer may leave "me about X"
  /^me\s+about\s+/i,
  // "find information about X" → "information about X"
  /^information\s+about\s+/i,
  /^info\s+about\s+/i,
  // "what is X" — usually fine for search, but strip if redundant
  // NOT stripping "what is" — it's actually a valid search prefix

  // ── German ────────────────────────────────────────────────────
  // "mir etwas über X" → residual after sanitizer
  /^mir\s+(etwas\s+)?[üu]ber\s+/i,
  // "Informationen über X"
  /^informationen\s+[üu]ber\s+/i,

  // ── Polish ────────────────────────────────────────────────────
  /^mi\s+co\s+to\s+jest\s+/i,
  /^co\s+to\s+jest\s+/i,
  /^informacje\s+o\s+/i,

  // ── French ────────────────────────────────────────────────────
  /^moi\s+ce\s+que?\s+(c'est|est)\s+/i,
  /^qu'est-ce\s+que?\s+(c'est|le|la|l')\s+/i,
  /^des?\s+informations?\s+sur\s+/i,

  // ── Spanish ───────────────────────────────────────────────────
  /^informaci[óo]n\s+sobre\s+/i,
  /^qu[ée]\s+es\s+(el|la|un|una)\s+/i,
];

// ════════════════════════════════════════════════════════════════════════════
// RESIDUAL PUNCTUATION PATTERNS
// ════════════════════════════════════════════════════════════════════════════
// After instruction word removal, orphaned punctuation may remain:
//   "prosím: co je to DNA?" → sanitizer → "prosím: co je to DNA?"
//   After noise stripping: ": DNA?" — need to clean leading ":"

const RESIDUAL_PUNCTUATION = [
  /^[:\-–—,;]+\s*/,        // Leading colons, dashes, commas
  /\s+[:\-–—,;]+$/,        // Trailing orphan punctuation
  /^["'„""'']+\s*/,        // Leading orphan quotes
  /\s*["'„""'']+$/,        // Trailing orphan quotes (with or without space)
];

// ════════════════════════════════════════════════════════════════════════════
// TRIVIAL WORD FILTER
// ════════════════════════════════════════════════════════════════════════════
// After all stripping, if the result is just a trivial word, it's not useful.
// We keep it as-is (fallback to original) rather than searching for "o" or "mi".

const TRIVIAL_WORDS = new Set([
  // CZ/SK
  'mi', 'o', 'co', 'je', 'to', 'jak', 'se', 'a', 'že', 'na', 'v', 'k', 'z',
  'do', 'od', 'za', 'po', 'při', 'pro', 'ale', 'i', 'ani', 'nebo',
  // EN
  'me', 'about', 'the', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'and', 'or',
  // DE
  'mir', 'über', 'der', 'die', 'das', 'und', 'ist',
  // PL
  'mi', 'o', 'co', 'to', 'jest', 'i', 'lub',
]);

// ════════════════════════════════════════════════════════════════════════════
// MAIN CANONICALIZATION FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Canonicalize a sanitized search query.
 *
 * Takes the output of sanitizeSearchQuery() and strips connective noise
 * to produce a cleaner, more effective search query.
 *
 * ALWAYS returns a non-empty string. Falls back to input if stripping
 * would produce empty/trivial result.
 *
 * @param {string} sanitizedQuery - Output of sanitizeSearchQuery()
 * @returns {{ query: string, changed: boolean, stripped: string[] }}
 */
export function canonicalizeQuery(sanitizedQuery) {
  if (!sanitizedQuery || typeof sanitizedQuery !== 'string') {
    return { query: sanitizedQuery || '', changed: false, stripped: [] };
  }

  const original = sanitizedQuery.trim();
  if (original.length === 0) {
    return { query: '', changed: false, stripped: [] };
  }

  let q = original;
  const stripped = [];

  // ── Phase 1: Strip noise prefixes ─────────────────────────────────────
  for (const pattern of NOISE_PREFIXES) {
    const match = q.match(pattern);
    if (match) {
      stripped.push(match[0].trim());
      q = q.replace(pattern, '').trim();
      // Only apply ONE prefix pattern (they're ordered longest-first)
      break;
    }
  }

  // ── Phase 1.5: Strip mid-query filler phrases ────────────────────────
  // v61.2: "politiky ze serveru novinky.cz" → "politiky novinky.cz"
  const FILLER_PHRASES = [
    /\bze?\s+serveru\b/gi,        // "ze serveru", "z serveru"
    /\bna\s+str[áa]nce\b/gi,      // "na stránce"
    /\bna\s+str[áa]nk[áa]ch\b/gi, // "na stránkách"
    /\bna\s+webu\b/gi,            // "na webu"
    /\bna\s+internetu\b/gi,       // "na internetu"
    /\bz\s+webu\b/gi,             // "z webu"
    /\bfrom\s+(the\s+)?(website|site|server)\b/gi, // EN: "from the website"
    /\bvon\s+(der\s+)?Webseite\b/gi, // DE: "von der Webseite"
  ];
  for (const fp of FILLER_PHRASES) {
    const before = q;
    q = q.replace(fp, ' ').trim();
    if (q !== before) stripped.push(fp.source);
  }

  // ── Phase 2: Clean residual punctuation ───────────────────────────────
  for (const pattern of RESIDUAL_PUNCTUATION) {
    q = q.replace(pattern, '').trim();
  }

  // ── Phase 3: Final cleanup ────────────────────────────────────────────
  q = q.replace(/\s+/g, ' ').trim();

  // ── Phase 4: Validate result ──────────────────────────────────────────
  // If we stripped too much, fall back to original
  const resultWords = q.split(/\s+/).filter(w => w.length > 0);
  const nonTrivialWords = resultWords.filter(w => !TRIVIAL_WORDS.has(w.toLowerCase()));

  if (q.length < 2 || nonTrivialWords.length === 0) {
    // Stripping was too aggressive — revert to original
    return { query: original, changed: false, stripped: [] };
  }

  const changed = q !== original;

  if (changed) {
    logger.info('Canonicalizer', 'Query canonicalized', {
      original: original.substring(0, 80),
      canonical: q.substring(0, 80),
      stripped: stripped.join(', '),
    });
  }

  return { query: q, changed, stripped };
}

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORT
// ════════════════════════════════════════════════════════════════════════════

export default { canonicalizeQuery };

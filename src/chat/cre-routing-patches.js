// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — CRE Routing Patches (Q2 + Q3)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fixes:
//   Q2: EN "Thanks for the motivation!" triggers SEARCH (5/5 = 100% repro)
//       → Should be CONVERSATIONAL (gratitude/farewell)
//   Q3: EN "Write me a simple HTTP server in Node.js" triggers SEARCH
//       → Should be CODE
//
// Integration: Add these patterns to classifyIntent() in cre-decision.js
//              BEFORE the existing SEARCH/FACTUAL classification.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Q2: Gratitude / Farewell patterns ───────────────────────────────────────
// These are SHORT POSITIVE messages that should NEVER trigger SEARCH.
// The existing CRE catches bare "thanks" but NOT "Thanks for the tips!"
//
// Strategy: if message matches gratitude/farewell → return CONVERSATIONAL immediately.
// This check should run BEFORE search/factual classification.

export const GRATITUDE_FAREWELL_PATTERNS = [
  // English gratitude
  /^thanks?\b/i,
  /^thank\s+you\b/i,
  /^thx\b/i,
  /^cheers\b/i,
  /^much\s+appreciated\b/i,
  /^great[\s,!.]*(?:thanks?|thank\s+you)?/i,
  /^awesome[\s,!.]*(?:thanks?)?/i,
  /^perfect[\s,!.]*(?:thanks?)?/i,
  /^nice[\s,!.]*(?:thanks?)?/i,
  /^wonderful[\s,!.]*$/i,
  /^excellent[\s,!.]*$/i,
  /^cool[\s,!.]*(?:thanks?)?/i,

  // English farewell
  /^bye\b/i, /^goodbye\b/i, /^see\s+you\b/i, /^later\b/i,
  /^good\s*(?:bye|night|luck)\b/i,
  /^have\s+a\s+(?:good|great|nice)\b/i,
  /^take\s+care\b/i,

  // Czech gratitude
  /^díky\b/i, /^diky\b/i, /^děkuji?\b/i, /^dekuji?\b/i,
  /^super[\s,!.]*(?:díky|diky)?/i,
  /^skvělé?[\s,!.]*(?:díky|diky)?/i,
  /^výborně?[\s,!.]*(?:díky|diky)?/i,
  /^paráda[\s,!.]*$/i,

  // Czech farewell
  /^nashledanou\b/i, /^na\s*shledanou\b/i, /^nashle\b/i,
  /^čau\b/i, /^cau\b/i, /^ahoj\b/i,   // Note: "ahoj" at START can be greeting or farewell
  /^pa\s*pa\b/i, /^papa\b/i,
  /^měj\s+se\b/i, /^mej\s+se\b/i,

  // Combined: "Thanks for [anything]!" — catch-all for gratitude with context
  /^thanks?\s+(?:for|a\s+lot|so\s+much)\b/i,
  /^díky\s+(?:za|moc)\b/i,
  /^diky\s+(?:za|moc)\b/i,
  /^děkuju?\s+(?:za|moc|ti)\b/i,
];

/**
 * Check if input is a gratitude/farewell message.
 * Returns true if the message should be classified as CONVERSATIONAL.
 */
export function isGratitudeOrFarewell(input) {
  const trimmed = input.trim();

  // Quick length check: gratitude/farewell is typically short
  // "Thanks for the fantastic conversation about cooking recipes!" = still gratitude
  // But allow up to ~100 chars to catch longer thank-you messages
  if (trimmed.length > 100) return false;

  // Exclude "Thanks to [noun]..." — this is a preposition, not gratitude
  // "Thanks to recent research..." ≠ "Thanks for the tips!"
  if (/^thanks?\s+to\s+(?!you\b)/i.test(trimmed)) return false;

  for (const pattern of GRATITUDE_FAREWELL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Sentiment heuristic: short message + no question mark + positive words
  if (trimmed.length < 50 && !trimmed.includes('?')) {
    const positiveWords = /\b(thanks?|great|good|nice|awesome|cool|super|skvěl|výborn|parád|díky|diky|děkuj)/i;
    if (positiveWords.test(trimmed)) return true;
  }

  return false;
}

// ─── Q3: Code request patterns ───────────────────────────────────────────────
// "Write me a simple HTTP server in Node.js" should be CODE, not SEARCH.
// The existing CRE catches "napiš kód pro sorting" but not English code requests.

export const CODE_REQUEST_PATTERNS = [
  // English imperative code requests
  /^(?:write|create|build|make|generate|code|implement|develop)\s+(?:me\s+)?(?:a\s+)?(?:simple\s+)?(?:(?:HTTP|API|REST|CRUD|web)\s+)?(?:server|client|script|function|class|module|component|app|application|program|bot|tool|parser|handler|middleware|route|endpoint)/i,
  /^(?:write|create|build|make|generate)\s+(?:me\s+)?(?:a\s+)?(?:\w+\s+){0,3}(?:in|using|with)\s+(?:Node\.?js|Python|Java|Rust|Go|TypeScript|JavaScript|C\+\+|Ruby|PHP|Bash|Shell)/i,
  /^(?:write|create|build)\s+(?:me\s+)?(?:a\s+)?(?:simple\s+)?(?:program|script|code)\b/i,
  /^(?:can you\s+)?(?:write|code|implement)\s+(?:me\s+)?/i,
  /^(?:show|give)\s+me\s+(?:a\s+)?(?:code|example|implementation|snippet)\b/i,

  // Czech imperative code requests (extending existing patterns)
  /^(?:napiš|napíš|vytvoř|udělej|udelej)\s+(?:mi\s+)?(?:jednoduch[ýáé]\s+)?(?:HTTP|API|REST)\s+server/i,
  /^(?:napiš|napíš|vytvoř|udělej|udelej)\s+(?:mi\s+)?(?:jednoduch[ýáé]\s+)?(?:skript|program|kód|funkci|třídu|modul|komponent|bot|nástroj)\b/i,
  /^(?:napiš|napíš|vytvoř|udělej|udelej)\s+(?:mi\s+)?(?:\w+\s+){0,3}(?:v|pomocí|v jazyce)\s+(?:Node\.?js|Python|Java|Rust|Go|TypeScript|JavaScript|C\+\+|PHP|Bash)/i,
  /^(?:napiš|napíš|vytvoř|udělej|udelej)\s+(?:mi\s+)?(?:jednoduch[ýáé]\s+)?(?:\w+\s+){0,2}server\b/i,
];

/**
 * Check if input is a code request.
 * Returns true if the message should be classified as CODE.
 */
// Creative writing nouns — these are NOT code requests even if they start with "write"
const CREATIVE_WRITING_EXCLUSION = /\b(poem|poetry|story|tale|essay|letter|song|lyrics|joke|novel|chapter|paragraph|haiku|sonnet|limerick|fable|myth|narrative|báse[ňn]|příběh|pohádku?|povídku?|esej|dopis|vtip|píse[ňn]|básničku?)\b/i;

export function isCodeRequest(input) {
  const trimmed = input.trim();
  // "write a poem" / "write a story" = creative, not code
  if (CREATIVE_WRITING_EXCLUSION.test(trimmed)) return false;
  for (const pattern of CODE_REQUEST_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

export default {
  GRATITUDE_FAREWELL_PATTERNS,
  CODE_REQUEST_PATTERNS,
  isGratitudeOrFarewell,
  isCodeRequest,
};

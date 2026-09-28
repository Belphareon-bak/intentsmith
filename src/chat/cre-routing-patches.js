// ═══════════════════════════════════════════════════════════════════════════════
// IntentSmith-Agent — CRE Routing Patches (Q2 + Q3)
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

// Full-message matches only; exported patterns obey the same rule as the helper.
export const GRATITUDE_FAREWELL_PATTERNS = [
  /^(?:(?:thanks?|thank you|thx|cheers|much appreciated)(?: (?:a lot|so much|very much|for (?:the )?(?:tips|help|motivation|conversation|info|everything|that)))?(?:[, ]+that was (?:interesting|educational|helpful))?|(?:great|awesome|perfect|nice|cool)(?:[,! ]+thanks?)?|(?:diky|dekuji|dekuju)(?: (?:moc|ti|za (?:pomoc|tipy|motivaci)))?|(?:super|skvele|vyborne)(?:[,! ]+diky)?|parada|wonderful|excellent|bye|goodbye|see you|later|good night|good luck|have a (?:good|great|nice) (?:day|evening|night|weekend)|take care|nashledanou|na shledanou|nashle|cau|ahoj|pa pa|papa|mej se)[\s.!]*$/u,
];
export function isGratitudeOrFarewell(input) {
  const text = input.trim().normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  return GRATITUDE_FAREWELL_PATTERNS.some(pattern => pattern.test(text));
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

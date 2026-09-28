// ═══════════════════════════════════════════════════════════════════════════════
// D6 Output Quality Gate — v56.0 Sprint 4
// ═══════════════════════════════════════════════════════════════════════════════
//
//   Validates LLM output AFTER generation, BEFORE returning to user.
//   Three dimensions:
//     D6.1 — Zombie/meta detection (responses about responding)
//     D6.2 — Content density (minimum substantive content)
//     D6.3 — Response intent enforcement (response matches requested intent)
//
//   Contract:
//     enforceOutputContract(content, opts) → { ok, failDimension?, reason? }
//     buildOutputGateRetryPrompt(prompt, verdict) → string
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// D6.1 — Zombie / Meta Response Patterns
// ─────────────────────────────────────────────────────────────────────────────

const ZOMBIE_PATTERNS_CS = [
  // Self-referential
  /^(Jako jazykový model|Jako AI|Jako umělá inteligence)/i,
  /nemohu (zodpovědět|odpovědět|pomoci).*bez dalš/i,
  /nerozumím.*otázce.*upřesn/i,
  /^Omlouvám se,?\s+(ale\s+)?(nemohu|nemůžu|nedokážu)/i,
  /moje znalosti (jsou omezené|sahají pouze)/i,
  // Capability denial
  /nemám přístup k (internetu|aktuálním|reálným)/i,
  /nemohu vyhledávat na (webu|internetu)/i,
  // Process narration
  /^(Zde|Tady) (je|jsou) (moje?|m[áa]) odpov[eě][dď]/i,
  /^Připravil jsem (pro vás|ti)/i,
  /^(Here is|Here are) (my|the) (response|answer)/i,
  // Echo
  /^(Ptáte se|Ptáš se) na /i,
];

const ZOMBIE_PATTERNS_EN = [
  /^(As a language model|As an AI|I'm just an AI)/i,
  /I (cannot|can't) (answer|respond|help).*without (more|additional)/i,
  /I('m| am) not sure what you('re| are) asking/i,
  /^I apologize,?\s+(but\s+)?I (cannot|can't|am unable)/i,
  /my (knowledge|training) (is limited|only goes|cutoff)/i,
  /I don't have access to (the internet|real-time|current)/i,
];

const ZOMBIE_PATTERNS = [...ZOMBIE_PATTERNS_CS, ...ZOMBIE_PATTERNS_EN];

// Hollow filler — zombie only when response is short (< 100 chars)
const HOLLOW_FILLER_PATTERNS = [
  /^(Rád|Ráda) ti (pomůžu|pomohu|poradím)/i,
  /^Samozřejmě,?\s+(rád[a]?\s+)?(pomůžu|pomohu)/i,
  /^(Of course|Sure|Happy to help)/i,
];

/**
 * D6.1: Detect zombie/meta responses.
 * A zombie response talks ABOUT responding instead of actually responding.
 *
 * @param {string} content
 * @returns {{ isZombie: boolean, pattern?: string }}
 */
function detectZombie(content) {
  if (!content || typeof content !== 'string') {
    return { isZombie: true, pattern: 'empty_content' };
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { isZombie: true, pattern: 'empty_content' };
  }

  // Check first 300 chars — zombie patterns appear at start
  const head = trimmed.substring(0, 300);

  for (const pattern of ZOMBIE_PATTERNS) {
    if (pattern.test(head)) {
      // Meta opener with substantial tail (>100 chars after first sentence) — PASS
      const firstDot = trimmed.indexOf('. ');
      if (firstDot > 0 && trimmed.length - firstDot > 100) {
        continue; // Has real content after the meta opener
      }
      return { isZombie: true, pattern: pattern.source.substring(0, 60) };
    }
  }

  // Hollow filler — only zombie when standalone (< 100 chars)
  if (trimmed.length < 100) {
    for (const pattern of HOLLOW_FILLER_PATTERNS) {
      if (pattern.test(head)) {
        return { isZombie: true, pattern: 'hollow_filler' };
      }
    }
  }

  return { isZombie: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// D6.2 — Content Density
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intent-based minimum content thresholds (chars).
 * Short intents (greetings, confirmations) have lower thresholds.
 */
const DENSITY_THRESHOLDS = {
  CONVERSATIONAL: 10,   // "Ahoj!" is valid
  GREETING: 5,
  CLARIFICATION: 20,
  CONFIRMATION: 5,
  SEARCH: 80,
  REPORT: 200,
  FACTUAL: 30,
  CREATIVE: 100,
  CODE: 50,
  ANALYSIS: 100,
  SYNTHESIS: 60,
  ITEM_LOOKUP: 40,
  // v58.0: DESIGN — structured docs must be substantial
  DESIGN: 500,
  DEFAULT: 30,
};

/**
 * D6.2: Check minimum content density.
 * Ensures the response has enough substantive content for the intent.
 *
 * @param {string} content
 * @param {string} intent
 * @returns {{ dense: boolean, actualLength: number, threshold: number }}
 */
function checkDensity(content, intent, responseIntent = null) {
  const trimmed = (content || '').trim();
  const intentThreshold = DENSITY_THRESHOLDS[intent] || DENSITY_THRESHOLDS.DEFAULT;
  const threshold = responseIntent === 'MINIMAL'
    ? Math.min(intentThreshold, DENSITY_THRESHOLDS.CONVERSATIONAL)
    : intentThreshold;

  // Strip markdown formatting for measurement
  const stripped = trimmed
    .replace(/[#*_~`>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) → text
    .replace(/\s+/g, ' ')
    .trim();

  return {
    dense: stripped.length >= threshold,
    actualLength: stripped.length,
    threshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// D6.3 — Response Intent Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that indicate the response is echoing the question instead of answering.
 */
const ECHO_PATTERNS = [
  /^(Rozumím|Chápu|Pochopil jsem),?\s+(že\s+)?(chcete|chceš|potřebujete)/i,
  /^(I understand|Got it|I see),?\s+(you('re| are)\s+(asking|looking|wanting))/i,
  /^(Takže|So)\s+(vy\s+)?(chcete|chceš|you want)/i,
];

/**
 * D6.3: Verify response matches the requested intent.
 * - For CONVERSATIONAL with responseIntent, checks responseIntent alignment
 * - For structured intents (SEARCH, REPORT), checks for echo/deflection patterns
 *
 * @param {string} content
 * @param {string} intent
 * @param {string|null} responseIntent
 * @returns {{ aligned: boolean, reason?: string }}
 */
function checkIntentAlignment(content, intent, responseIntent) {
  if (!content || content.trim().length === 0) {
    return { aligned: false, reason: 'empty_response' };
  }

  const head = content.substring(0, 200).trim();

  // Check echo patterns — response restates the question without answering
  for (const pattern of ECHO_PATTERNS) {
    if (pattern.test(head)) {
      return { aligned: false, reason: `echo_pattern: ${pattern.source.substring(0, 40)}` };
    }
  }

  // For CREATIVE intent: must not be a generic template/skeleton
  if (intent === 'CREATIVE') {
    const skeletonMarkers = ['[sem vložte', '[insert here', '[TODO', '...your text...', '...váš text...'];
    for (const marker of skeletonMarkers) {
      if (content.toLowerCase().includes(marker.toLowerCase())) {
        return { aligned: false, reason: `creative_skeleton: contains placeholder "${marker}"` };
      }
    }
  }

  // v58.0: For DESIGN intent: must not contain hedging, must have structure
  if (intent === 'DESIGN') {
    // Hedging phrases that indicate chatbot mode, not architect mode
    // v62.2e: removed "existuje mnoho možností" — too generic for Czech tech responses
    const DESIGN_HEDGING = [
      /informace (jsou|byly) omezené/i,
      /doporučuji konzultovat/i,
      /záleží na (kontextu|požadavcích|vašich)/i,
      /limited information/i,
      /it depends on/i,
      /consult with/i,
    ];
    for (const pattern of DESIGN_HEDGING) {
      if (pattern.test(content)) {
        return { aligned: false, reason: `design_hedging: "${pattern.source.substring(0, 40)}"` };
      }
    }

    // Language leak detection (Polish/Spanish from search contamination)
    const LANGUAGE_LEAKS = [
      /\b(informacje|ograniczone|zalecam|również|proszę)\b/i,  // Polish
      /\b(lo siento|no puedo|en español|también|puede)\b/i,    // Spanish
    ];
    for (const pattern of LANGUAGE_LEAKS) {
      if (pattern.test(content)) {
        return { aligned: false, reason: `design_language_leak: "${pattern.source.substring(0, 30)}"` };
      }
    }
  }

  return { aligned: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforce the D6 output quality contract.
 *
 * @param {string} content — LLM output content
 * @param {Object} opts
 * @param {string} opts.intent — CRE intent (CONVERSATIONAL, SEARCH, REPORT, etc.)
 * @param {string|null} [opts.responseIntent] — Expected response intent (for synthesis)
 * @returns {{ ok: boolean, failDimension?: string, reason?: string }}
 */
export function enforceOutputContract(content, opts = {}) {
  const { intent = 'CONVERSATIONAL', responseIntent = null } = opts;

  // ─── D6.1: Zombie check ───────────────────────────────────────────────
  const zombie = detectZombie(content);
  if (zombie.isZombie) {
    return {
      ok: false,
      failDimension: 'D6.1_ZOMBIE',
      reason: `Zombie/meta response detected: ${zombie.pattern}`,
    };
  }

  // ─── D6.2: Density check ──────────────────────────────────────────────
  const density = checkDensity(content, intent, responseIntent);
  if (!density.dense) {
    return {
      ok: false,
      failDimension: 'D6.2_DENSITY',
      reason: `Content too sparse for ${intent}: ${density.actualLength}/${density.threshold} chars`,
    };
  }

  // ─── D6.3: Intent alignment ───────────────────────────────────────────
  const alignment = checkIntentAlignment(content, intent, responseIntent);
  if (!alignment.aligned) {
    return {
      ok: false,
      failDimension: 'D6.3_INTENT',
      reason: `Response misaligned with intent ${intent}: ${alignment.reason}`,
    };
  }

  return { ok: true };
}

/**
 * Build a retry prompt that instructs the LLM to fix the specific D6 failure.
 *
 * @param {string} originalPrompt — The prompt that produced the failing output
 * @param {{ failDimension: string, reason: string }} verdict — D6 gate verdict
 * @returns {string} — Enhanced prompt with correction instructions
 */
export function buildOutputGateRetryPrompt(originalPrompt, verdict) {
  const corrections = {
    'D6.1_ZOMBIE': [
      '⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: Meta/zombie odpověď.',
      'POŽADAVEK: Odpověz PŘÍMO na otázku. Žádné fráze typu "jako jazykový model",',
      '"nemohu odpovědět", "nemám přístup". Pokud nevíš, řekni co víš a co ne.',
      'NIKDY nezačínej omlouvou nebo vysvětlováním svých limitů.',
    ],
    'D6.2_DENSITY': [
      '⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: Příliš krátká/prázdná.',
      'POŽADAVEK: Odpověz s KONKRÉTNÍM obsahem. Uveď fakta, čísla, příklady.',
      'Minimum obsahu: odpověď musí být substantivní a informativní.',
    ],
    'D6.3_INTENT': [
      '⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: Odpověď neodpovídá záměru.',
      'POŽADAVEK: Odpověz PŘÍMO. Neopakuj otázku, nevysvětluj co budeš dělat.',
      'Rovnou odpověz s konkrétním obsahem. Žádné placeholdery, žádné šablony.',
    ],
  };

  const lines = corrections[verdict.failDimension] || [
    `⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: ${verdict.reason}`,
    'POŽADAVEK: Zlepši kvalitu odpovědi dle zpětné vazby.',
  ];

  return `${originalPrompt}\n\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `${lines.join('\n')}\n` +
    `═══════════════════════════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for testing
// ─────────────────────────────────────────────────────────────────────────────
export {
  detectZombie,
  checkDensity,
  checkIntentAlignment,
  ZOMBIE_PATTERNS,
  DENSITY_THRESHOLDS,
  ECHO_PATTERNS,
  HOLLOW_FILLER_PATTERNS,
};

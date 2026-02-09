// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Language Enforcement Module (Q1 + Q6)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fixes:
//   Q1: Qwen 2.5:32b switches to Slovak/Russian/Chinese mid-response (~10% of CZ answers)
//   Q6: LLM complains about diacritics-free Czech input ("zkreslil jsi text")
//
// Integration: import functions and apply in synthesis.js + controller.js
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Slovak detection patterns ───────────────────────────────────────────────
// These are Slovak-ONLY forms that don't exist in Czech.
// Czech "který" vs Slovak "ktorý", Czech "protože" vs Slovak "pretože", etc.

const SK_MARKERS = [
  // ── High-confidence: unique Slovak chars/forms ──
  // ľ (L-caron) is ONLY Slovak — never appears in Czech
  /ľ/i,                                // Any word with ľ = Slovak
  // ô (O-circumflex) is Slovak-only
  /ô/,                                 // môže, dôležité, etc.
  // Slovak ä
  /\bpäť\b/i, /\bpamäť/i, /\bsvät/i,
  // ── Medium-confidence: Slovak word forms ──
  /(?:^|\s)sú(?:\s|[.,!?]|$)/i,       // "sú" = CZ "jsou" (word boundary safe)
  /(?:^|\s)ktorý/i,                    // ktorý/ktorá/ktoré (CZ: který)
  /(?:^|\s)pretože/i,                  // pretože (CZ: protože)
  /zaujímav/i,                         // zaujímavý (CZ: zajímavý)
  /(?:^|\s)ešte(?:\s|[.,!?]|$)/i,     // ešte (CZ: ještě)
  /výskum/i,                           // výskum (CZ: výzkum)
  /niekoľko/i,                         // niekoľko (CZ: několik)
  /spoloč/i,                           // spoločnosť (CZ: společnost)
  /infraštrukt/i,                      // infraštruktúra (CZ: infrastruktura)
  /povedať/i,                          // povedať (CZ: říct/povědět)
  /osobné/i,                           // osobné (CZ: osobní)
  /(?:^|\s)prípad/i,                   // prípad (CZ: případ)
  /histór/i,                           // história (CZ: historie)
  /zdravotn[ií]c/i,                    // zdravotníctvo (CZ: zdravotnictví)
  /odvetv/i,                           // odvetvia (CZ: odvětví)
];

// Minimum markers to flag as Slovak contamination
export const SK_THRESHOLD = 2;

// ─── Russian/Chinese detection ───────────────────────────────────────────────

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

// ─── Language enforcement functions ──────────────────────────────────────────

/**
 * Detect if response contains Slovak contamination.
 * Returns { contaminated: boolean, markers: string[], count: number }
 */
export function detectSlovakContamination(text) {
  const markers = [];
  for (const re of SK_MARKERS) {
    const match = text.match(re);
    if (match) markers.push(match[0]);
  }
  return {
    contaminated: markers.length >= SK_THRESHOLD,
    markers,
    count: markers.length,
  };
}

/**
 * Detect if response contains non-target language contamination.
 * Returns { clean: boolean, issues: string[] }
 */
export function validateResponseLanguage(text, expectedLang = 'cs') {
  const issues = [];

  // Check for Cyrillic characters (Russian contamination)
  if (CYRILLIC_RE.test(text)) {
    issues.push('cyrillic_contamination');
  }

  // Check for CJK characters (Chinese contamination)
  if (CJK_RE.test(text)) {
    issues.push('cjk_contamination');
  }

  // Check for Slovak contamination when expecting Czech
  if (expectedLang === 'cs') {
    const sk = detectSlovakContamination(text);
    if (sk.contaminated) {
      issues.push(`slovak_contamination(${sk.count}): ${sk.markers.slice(0, 3).join(', ')}`);
    }
  }

  return {
    clean: issues.length === 0,
    issues,
  };
}

/**
 * Build strict language enforcement instruction for system prompt.
 * This is APPENDED to the existing system prompt, not replacing it.
 */
export function buildStrictLanguageInstruction(lang) {
  const instructions = {
    cs: `

JAZYKOVÉ PRAVIDLO (KRITICKÉ — DODRŽUJ VŽDY):
- Odpovídej VÝHRADNĚ v češtině.
- NIKDY neodpovídej slovensky — žádné "sú", "ktorý", "pretože", "veľmi", "môže".
- NIKDY neodpovídej rusky, čínsky, ani v jiném jazyce.
- Pokud si nejistý, zda je slovo české nebo slovenské, použij český ekvivalent.
- Český = jsou, který, protože, velmi, může, ještě, případ, zajímavý.
- Slovenský (ZAKÁZANÝ) = sú, ktorý, pretože, veľmi, môže, ešte, prípad, zaujímavý.

VSTUP BEZ DIAKRITIKY:
- Čeština bez háčků a čárek je NORMÁLNÍ vstup.
- NIKDY to nekomentuj, neomlouvej se za to, neříkej "zkreslil jsi text".
- Prostě odpověz na dotaz — česky, s diakritikou.`,

    en: `

LANGUAGE RULE (CRITICAL):
- Respond EXCLUSIVELY in English.
- NEVER switch to Czech, Slovak, Russian, or any other language.
- ALL responses, including dates, times, and calculations, must be in English.`,

    de: `

SPRACHREGEL (KRITISCH):
- Antworte AUSSCHLIESSLICH auf Deutsch.
- NIEMALS in andere Sprachen wechseln.`,

    sk: `

JAZYKOVÉ PRAVIDLO (KRITICKÉ):
- Odpovedaj VÝHRADNE po slovensky.
- NIKDY neodpovedaj po česky ani v inom jazyku.`,
  };

  return instructions[lang] || instructions['en'];
}

/**
 * Build retry prompt when language validation fails.
 * This is a STRONGER instruction for the second attempt.
 */
export function buildLanguageRetryInstruction(lang, issues) {
  if (lang === 'cs') {
    return `CHYBA: Tvá předchozí odpověď obsahovala slovenské/cizojazyčné výrazy (${issues.join(', ')}).
OPRAV TO. Odpověz ZNOVU, tentokrát ČISTĚ ČESKY.
Žádné slovenské výrazy. Žádná cyrilice. Žádné čínské znaky.
Kontroluj každé slovo — "jsou" ne "sú", "který" ne "ktorý", "protože" ne "pretože".`;
  }
  return `ERROR: Your previous response contained non-${lang} language (${issues.join(', ')}).
Respond AGAIN, this time EXCLUSIVELY in ${lang}. No other languages.`;
}

export default {
  detectSlovakContamination,
  validateResponseLanguage,
  buildStrictLanguageInstruction,
  buildLanguageRetryInstruction,
  SK_MARKERS,
  SK_THRESHOLD,
  CYRILLIC_RE,
  CJK_RE,
};

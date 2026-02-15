// C3-Agent v56.2.1 — Language Detection & Prompt Injection
// ══════════════════════════════════════════════════════════════════════════════
// Sprint E: Expanded from CS/EN to 7 languages (CS, SK, EN, DE, PL, FR, ES).
//
// Design: Simple heuristic, NOT NLP library.
// Detection via unique characters + common patterns per language.
// Default assumption: if ambiguous → Czech (primary user base).
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Detected language result
 * @typedef {'cs' | 'sk' | 'en' | 'de' | 'pl' | 'fr' | 'es' | 'unknown'} DetectedLanguage
 */

// ════════════════════════════════════════════════════════════════════════════
// UNIQUE CHARACTER MARKERS (highest-signal detection)
// ════════════════════════════════════════════════════════════════════════════

const CZ_UNIQUE = /[řůě]/i;             // ř, ů, ě are uniquely Czech
const CZ_DIACRITICS = /[ěščřžýáíéúůďťňó]/i;  // Broader Czech/Slovak shared set
const SK_UNIQUE = /[ľôŕĺ]/i;            // ľ, ô, ŕ, ĺ are uniquely Slovak
const DE_UNIQUE = /ß/;                   // ß is uniquely German
const DE_CHARS = /[äöüß]/i;             // German chars (ä/ö/ü shared with some)
const PL_UNIQUE = /[łąęźż]/i;           // ł, ą, ę, ź, ż are uniquely Polish
const FR_UNIQUE = /[çœ]|[«»]/;          // ç, œ, «» are French markers
const FR_CHARS = /[àâçéèêëîïôùûüÿœæ]/i; // Broader French char set
const ES_UNIQUE = /[ñ¿¡]/;              // ñ, ¿, ¡ are uniquely Spanish

// ════════════════════════════════════════════════════════════════════════════
// WORD PATTERNS PER LANGUAGE (high-confidence, unambiguous)
// ════════════════════════════════════════════════════════════════════════════

const PATTERNS = {
  cs: [
    /\b(prosím|díky|děkuji|ahoj|dobrý\s*den)\b/i,
    /\b(je|jsou|byl|byla|bylo|být|jsem|jsi|jsme|jste)\b/i,
    /\b(najdi|vyhledej|hledej|zjisti|řekni|popiš|vysvětli)\b/i,
    /(?:^|\s)(co\s+je|jak\s+se|kde\s+je|kdy\s+je|kolik)(?:\s|[?!.,;]|$)/i,
    // v63.0: CZ-unique standalone words for CS/SK disambiguation
    // These exist ONLY in Czech (SK equivalents: ako, čo, podľa, prečo, zda→či)
    /\b(jak|co|podle|proč|zda|dál|vůbec|ovšem|totiž|sice|vždyť)\b/i,
    /\b(chci|potřebuji|můžeš|mohl|mohla|bys)\b/i,
    /\b(ano|ne|jo|nechci|rozumím|chápu)\b/i,
    /\b(protože|aby|když|jestli|pokud|než|zatímco)\b/i,
    /\b(něco|někdo|nikdo|nic|všechno|každý)\b/i,
    /\b(tento|tato|toto|těchto|tomto|tohle)\b/i,
    // v57.3: No-diacritics Czech (users often type without háčky/čárky)
    /\b(udelej|udělej|udelat|pridat|pridej)\b/i,
    /\b(zprav[ay]?|novinky|novinek|clanek|clanky)\b/i,
    /\b(webu|stranky|stranek|stranka)\b/i,
    /\b(cesky|ceskem|cestine|ceskem\s+jazyce)\b/i,
    /\b(z\s+webu)\b/i,
    /\b(mi|mne|si|nam|vas|tebe)\b/i,
    /\b(diky|dekuju|dekuji|prosim)\b/i,
    /\b(zkus|zkusit|zopakuj|zopakovat)\b/i,
    /\b(pomoc|pomoct|pomoz|pomoci|poradit|porad)\b/i,
    /\b(chyba|chybi|spatne|spatny|problem)\b/i,
  ],

  sk: [
    /\b(prosím|ďakujem|ahoj|dobrý\s*deň)\b/i,
    /\b(je|sú|bol|bola|bolo|byť|som|si|sme|ste)\b/i,
    /(?:^|\s)(čo\s+je|ako\s+sa|kde\s+je|kedy|koľko)(?:\s|[?!.,;]|$)/i,
    /\b(nájdi|vyhľadaj|povedz|opíš|vysvetli)\b/i,
    /\b(áno|nie|chcem|potrebujem|môžeš)\b/i,
    /\b(pretože|aby|keď|ak|pokiaľ)\b/i,
    /\b(niečo|niekto|nikto|nič|všetko|každý)\b/i,
    /\b(alebo|prečo|potom|tiež|veľmi)\b/i,
  ],

  en: [
    /\b(please|thanks|thank\s+you|hello|hey)\b/i,
    /\b(the|this|that|these|those)\b/i,
    /\b(would|could|should|might|shall)\b/i,
    /\b(explain|describe|find|search|create|build|write)\b/i,
    /\b(because|although|however|therefore|meanwhile)\b/i,
    /\b(I|you|we|they|he|she|it)\b/i,
    /\b(my|your|our|their|his|her|its)\b/i,
    /\b(what|which|where|when|why|how)\b/i,
  ],

  de: [
    /\b(bitte|danke|hallo|guten\s*(tag|morgen|abend))\b/i,
    /\b(ist|sind|war|waren|sein|bin|bist|haben|hat|geht)\b/i,
    /(?:^|\s)(was\s+ist|wer\s+ist|wo\s+ist|wie\s+funktioniert|warum)(?:\s|[?!.,;]|$)/i,
    /\b(erkläre|beschreibe|finde|suche|erstelle)\b/i,
    /\b(ja|nein|nicht|kein|keine|keinen)\b/i,
    /\b(weil|obwohl|jedoch|deshalb|außerdem)\b/i,
    /\b(der|die|das|den|dem|des|ein|eine|einen|einem)\b/i,
    /\b(und|oder|aber|auch|noch|schon|sehr)\b/i,
    /\b(ich|du|er|sie|wir|ihr|mein|dein|sein|unser)\b/i,
    /\b(wie|wo|wann|wer|was|welche[rs]?|Ihnen)\b/i,
  ],

  pl: [
    /\b(proszę|dziękuję|cześć|dzień\s*dobry)\b/i,
    /\b(jest|są|był|była|było|być|jestem|jesteś|jesteśmy)\b/i,
    /(?:^|\s)(co\s+to\s+jest|kto\s+to|gdzie\s+jest|kiedy|ile)(?:\s|[?!.,;]|$)/i,
    /\b(wyjaśnij|opisz|znajdź|szukaj|stwórz)\b/i,
    /\b(tak|nie|chcę|potrzebuję|możesz)\b/i,
    /\b(ponieważ|chociaż|jednak|dlatego|również)\b/i,
    /\b(ten|ta|to|tego|tej|tych|tamten)\b/i,
    /\b(i|lub|ale|też|jeszcze|bardzo|już)\b/i,
  ],

  fr: [
    /\b(s'il\s+(te|vous)\s+plaît|merci|bonjour|salut|bonsoir)\b/i,
    /\b(est|sont|était|étaient|être|suis|es|sommes|êtes)\b/i,
    /(?:^|\s)(qu'est-ce\s+que?|qui\s+est|où\s+est|comment|pourquoi)(?:\s|[?!.,;]|$)/i,
    /\b(explique|décris|trouve|cherche|crée)\b/i,
    /\b(oui|non|je|tu|il|elle|nous|vous|ils|elles)\b/i,
    /\b(parce\s+que|bien\s+que|cependant|donc|aussi)\b/i,
    /\b(le|la|les|un|une|des|du|au|aux)\b/i,
    /\b(et|ou|mais|aussi|encore|très|déjà)\b/i,
    /\b(ce|cette|ces|mon|ton|son|notre|votre|leur)\b/i,
  ],

  es: [
    /\b(por\s+favor|gracias|hola|buenos?\s*(días|tardes|noches))\b/i,
    /\b(es|son|era|eran|ser|soy|eres|somos|están)\b/i,
    /(?:^|\s)(qué\s+es|quién\s+es|dónde\s+está|cómo|por\s+qué|cuánto)(?:\s|[?!.,;]|$)/i,
    /\b(explica|describe|encuentra|busca|crea)\b/i,
    /\b(sí|no|quiero|necesito|puedes)\b/i,
    /\b(porque|aunque|sin\s+embargo|por\s+lo\s+tanto|también)\b/i,
    /\b(el|la|los|las|un|una|unos|unas|del|al)\b/i,
    /\b(y|o|pero|también|todavía|muy|ya)\b/i,
    /\b(yo|tú|él|ella|nosotros|ustedes|mi|tu|su|nuestro)\b/i,
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// DETECTION ENGINE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Count how many patterns match in the text.
 * Resets lastIndex for safety (avoids stateful /g regex bugs).
 */
function countMatches(text, patterns) {
  let count = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) count++;
  }
  return count;
}

/**
 * Detect language of user input.
 *
 * Strategy:
 *   1. Unique characters → immediate high-confidence match
 *   2. Shared diacritics → disambiguate with patterns
 *   3. Pure pattern counting for ASCII-only text (EN, etc.)
 *   4. If ambiguous → 'unknown'
 *
 * @param {string} text - User input
 * @returns {{ language: DetectedLanguage, confidence: number }}
 */
export function detectLanguage(text) {
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', confidence: 0 };
  }

  const trimmed = text.trim();

  // Very short input (≤ 3 chars) — can't determine reliably
  if (trimmed.length <= 3) {
    return { language: 'unknown', confidence: 0 };
  }

  // ── Phase 1: Unique character detection (highest confidence) ──────────

  if (CZ_UNIQUE.test(trimmed)) return { language: 'cs', confidence: 0.95 };
  if (SK_UNIQUE.test(trimmed)) return { language: 'sk', confidence: 0.95 };
  if (PL_UNIQUE.test(trimmed)) return { language: 'pl', confidence: 0.95 };
  if (DE_UNIQUE.test(trimmed)) return { language: 'de', confidence: 0.95 };
  if (ES_UNIQUE.test(trimmed)) return { language: 'es', confidence: 0.90 };
  if (FR_UNIQUE.test(trimmed)) return { language: 'fr', confidence: 0.90 };

  // ── Phase 1b: Shared diacritics — disambiguate with patterns ──────────

  // Czech diacritics (shared with SK but no SK-unique chars found above)
  if (CZ_DIACRITICS.test(trimmed)) {
    const czScore = countMatches(trimmed, PATTERNS.cs);
    const skScore = countMatches(trimmed, PATTERNS.sk);
    if (skScore > czScore) return { language: 'sk', confidence: 0.80 };
    return { language: 'cs', confidence: 0.90 };
  }

  // German ä/ö/ü without ß
  if (DE_CHARS.test(trimmed)) return { language: 'de', confidence: 0.85 };

  // French diacritics (à, â, é, è, etc.)
  if (FR_CHARS.test(trimmed)) {
    const frScore = countMatches(trimmed, PATTERNS.fr);
    const esScore = countMatches(trimmed, PATTERNS.es);
    if (esScore > frScore) return { language: 'es', confidence: 0.75 };
    return { language: 'fr', confidence: 0.80 };
  }

  // ── Phase 2: Pattern counting (ASCII-only text) ───────────────────────

  const scores = {};
  for (const [lang, patterns] of Object.entries(PATTERNS)) {
    scores[lang] = countMatches(trimmed, patterns);
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = sorted[0];
  const [, secondScore] = sorted[1] || [null, 0];

  if (topScore === 0) return { language: 'unknown', confidence: 0 };

  // Clear winner
  if (topScore >= secondScore * 2) {
    const confidence = Math.min(0.85, 0.5 + topScore * 0.1);
    return { language: topLang, confidence };
  }

  // Single match, no competition
  if (topScore > 0 && secondScore === 0) {
    return { language: topLang, confidence: 0.75 };
  }

  // v61.3: Pure ASCII text with English matches → prefer English over unknown→Czech default
  // Czech users typing without diacritics still use Czech-specific words (chci, prosim, najdi)
  // but pure English text (only matching EN patterns) shouldn't default to Czech via 'unknown'
  const isPureAscii = /^[\x20-\x7E\n\r\t]*$/.test(trimmed);
  if (isPureAscii && scores.en > 0 && scores.en >= scores.cs) {
    return { language: 'en', confidence: 0.55 };
  }

  // Too close to call
  return { language: 'unknown', confidence: 0.3 };
}

// ════════════════════════════════════════════════════════════════════════════
// PROMPT LANGUAGE INJECTION
// ════════════════════════════════════════════════════════════════════════════

const LANGUAGE_INSTRUCTIONS = {
  cs: `
═══════════════════════════════════════════════════════════════════════════════
🌐 JAZYK: ODPOVÍDEJ VÝHRADNĚ ČESKY
═══════════════════════════════════════════════════════════════════════════════
- Celá odpověď MUSÍ být v češtině
- Pokud jsou zdrojová data v angličtině, PŘELOŽ klíčové informace do češtiny
- Technické termíny ponech v originále pouze pokud nemají zavedený český ekvivalent
- NIKDY nemixuj jazyky (žádné anglické věty uprostřed české odpovědi)
═══════════════════════════════════════════════════════════════════════════════`,

  sk: `
═══════════════════════════════════════════════════════════════════════════════
🌐 JAZYK: ODPOVEDAJ VÝHRADNE SLOVENSKY
═══════════════════════════════════════════════════════════════════════════════
- Celá odpoveď MUSÍ byť v slovenčine
- Ak sú zdrojové dáta v angličtine, PRELOŽ kľúčové informácie do slovenčiny
- Technické termíny ponechaj v origináli, len ak nemajú zavedený slovenský ekvivalent
- NIKDY nemixuj jazyky
═══════════════════════════════════════════════════════════════════════════════`,

  en: `
═══════════════════════════════════════════════════════════════════════════════
🌐 LANGUAGE: RESPOND EXCLUSIVELY IN ENGLISH
═══════════════════════════════════════════════════════════════════════════════
- Entire response MUST be in English
- If source data is in Czech/other languages, translate key information to English
- Do NOT mix languages
═══════════════════════════════════════════════════════════════════════════════`,

  de: `
═══════════════════════════════════════════════════════════════════════════════
🌐 SPRACHE: ANTWORTE AUSSCHLIESSLICH AUF DEUTSCH
═══════════════════════════════════════════════════════════════════════════════
- Die gesamte Antwort MUSS auf Deutsch sein
- Wenn Quelldaten in anderen Sprachen vorliegen, ÜBERSETZE Schlüsselinformationen ins Deutsche
- Fachbegriffe nur im Original belassen, wenn kein deutscher Fachbegriff existiert
- NIEMALS Sprachen mischen
═══════════════════════════════════════════════════════════════════════════════`,

  pl: `
═══════════════════════════════════════════════════════════════════════════════
🌐 JĘZYK: ODPOWIADAJ WYŁĄCZNIE PO POLSKU
═══════════════════════════════════════════════════════════════════════════════
- Cała odpowiedź MUSI być po polsku
- Jeśli dane źródłowe są w innym języku, PRZETŁUMACZ kluczowe informacje na polski
- Terminy techniczne pozostaw w oryginale tylko jeśli nie mają polskiego odpowiednika
- NIGDY nie mieszaj języków
═══════════════════════════════════════════════════════════════════════════════`,

  fr: `
═══════════════════════════════════════════════════════════════════════════════
🌐 LANGUE : RÉPONDEZ EXCLUSIVEMENT EN FRANÇAIS
═══════════════════════════════════════════════════════════════════════════════
- La réponse entière DOIT être en français
- Si les données sources sont dans d'autres langues, TRADUISEZ les informations clés en français
- Les termes techniques peuvent rester en anglais s'il n'existe pas d'équivalent français courant
- Ne JAMAIS mélanger les langues
═══════════════════════════════════════════════════════════════════════════════`,

  es: `
═══════════════════════════════════════════════════════════════════════════════
🌐 IDIOMA: RESPONDE EXCLUSIVAMENTE EN ESPAÑOL
═══════════════════════════════════════════════════════════════════════════════
- Toda la respuesta DEBE estar en español
- Si los datos fuente están en otros idiomas, TRADUCE la información clave al español
- Los términos técnicos pueden permanecer en inglés solo si no tienen equivalente en español
- NUNCA mezcles idiomas
═══════════════════════════════════════════════════════════════════════════════`,
};

/**
 * Build language enforcement instruction for system prompts.
 * Returns empty string if language is unknown (no enforcement).
 *
 * @param {DetectedLanguage} language
 * @returns {string}
 */
export function buildLanguageInstruction(language) {
  return LANGUAGE_INSTRUCTIONS[language] || '';
}

/**
 * Convenience: detect + build instruction in one call.
 *
 * @param {string} userInput
 * @param {string} [defaultLanguage='cs'] — fallback if detection is 'unknown'
 * @returns {{ language: DetectedLanguage, confidence: number, instruction: string }}
 */
export function getLanguageContext(userInput, defaultLanguage = 'cs') {
  const detection = detectLanguage(userInput);

  // Use default for unknown
  const effectiveLanguage = detection.language === 'unknown'
    ? defaultLanguage
    : detection.language;

  return {
    language: effectiveLanguage,
    confidence: detection.confidence,
    instruction: buildLanguageInstruction(effectiveLanguage),
  };
}

export default {
  detectLanguage,
  buildLanguageInstruction,
  getLanguageContext,
};

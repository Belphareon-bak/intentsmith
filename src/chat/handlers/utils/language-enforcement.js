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
  // v63.0: Additional markers for heavy contamination detection
  /(?:^|\s)všetk[oiy]/i,              // všetko/všetci/všetkých (CZ: všechno/všichni)
  /(?:^|\s)doska\b/i,                 // doska (CZ: deska — motherboard context)
  /(?:^|\s)sa\s/i,                     // reflexive "sa" (CZ: "se")
  /(?:^|\s)pri\s/i,                    // preposition "pri" (CZ: "při")
  /nejaký/i,                           // nejaký (CZ: nějaký)
  /hranie/i,                           // hranie (CZ: hraní)
  /ponúka/i,                           // ponúka (CZ: nabízí)
  /(?:^|\s)podľa/i,                    // podľa (CZ: podle)
];

// Minimum markers to flag as Slovak contamination
export const SK_THRESHOLD = 2;

// ─── Russian/Chinese detection ───────────────────────────────────────────────

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

// ─── v62.2: English contamination detection ────────────────────────────────
// Detects when LLM switches to English mid-response for non-English queries.
// Uses English-only structural phrases that don't appear in Czech/Slovak text.
const EN_MARKERS = [
  /\bBased on the provided\b/i,
  /\bHere is a\b/i,
  /\bHere are the\b/i,
  /\bAccording to\b/i,
  /\bIn summary\b/i,
  /\bOverview of\b/i,
  /\bKey Points:/i,
  /\bKey Takeaways/i,
  /\bThe following\b/i,
  /\bAs of\s+\d{4}/i,
  /\bIt is worth noting\b/i,
  /\bIn conclusion\b/i,
  /\bHowever,\s+it\b/i,
  /\bAdditionally,\s+/i,
  /\bFurthermore,\s+/i,
  /\bThis means that\b/i,
];

const EN_THRESHOLD = 3;  // v62.2e: raised 2→3 — less aggressive, reduce false retries

// v62.2e: Technology/proper noun terms — excluded from diacritics ratio check
// These words naturally have no Czech diacritics but aren't English contamination
const TECH_TERMS = new Set([
  'react', 'angular', 'vue', 'svelte', 'next', 'nuxt', 'remix',
  'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'rust', 'go', 'ruby', 'dart',
  'docker', 'kubernetes', 'nginx', 'apache', 'redis', 'kafka',
  'postgresql', 'mongodb', 'mysql', 'sqlite', 'graphql', 'rest', 'api', 'http', 'https',
  'linux', 'windows', 'macos', 'android', 'ios', 'ubuntu', 'debian',
  'github', 'gitlab', 'bitbucket', 'npm', 'yarn', 'pip', 'cargo',
  'cpu', 'gpu', 'ram', 'ssd', 'hdd', 'nvme', 'wifi', 'bluetooth', 'usb', 'ethernet',
  'html', 'css', 'sass', 'webpack', 'vite', 'babel', 'eslint',
  'node', 'express', 'django', 'flask', 'spring', 'laravel', 'rails',
  'aws', 'azure', 'gcp', 'firebase', 'vercel', 'netlify',
  'tesla', 'spacex', 'paypal', 'neuralink', 'openai',
  'amd', 'intel', 'nvidia', 'ryzen', 'core', 'geforce', 'radeon',
  'iphone', 'samsung', 'pixel', 'macbook', 'thinkpad',
  'xss', 'csrf', 'sql', 'injection', 'oauth', 'jwt', 'cors',
  'flutter', 'ci', 'cd', 'devops', 'agile', 'scrum', 'kanban',
  'websocket', 'tcp', 'udp', 'dns', 'ssl', 'tls', 'ssh', 'ftp',
]);

// ─── Language enforcement functions ──────────────────────────────────────────

/**
 * Detect if response is predominantly in English when it shouldn't be.
 * Two-layer detection:
 *   1. Marker-based: specific English structural phrases (threshold: 3)
 *   2. Diacritics-ratio: if >50% of non-tech sentences lack Czech diacritics
 * v62.2e: Tech term filtering + diacritics_ratio alone no longer triggers contamination
 * Returns { contaminated: boolean, markers: string[], count: number }
 */
export function detectEnglishContamination(text) {
  const markers = [];
  for (const re of EN_MARKERS) {
    const match = text.match(re);
    if (match) markers.push(match[0]);
  }

  // Layer 2: Diacritics ratio check for longer responses
  // Czech text naturally contains ěščřžýáíéúůďťň — English has none
  // v62.2e: Filter out sentences dominated by tech terms (React, Docker, PostgreSQL etc.)
  let hasDiacriticsIssue = false;
  if (text.length > 200) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length >= 3) {
      const CZ_DIACRITICS = /[ěščřžýáíéúůďťňĚŠČŘŽÝÁÍÉÚŮĎŤŇ]/;
      const noDiacriticsSentences = sentences.filter(s => {
        if (CZ_DIACRITICS.test(s)) return false;  // Has Czech diacritics — fine
        // v62.2e: Skip sentences with >40% tech terms (no diacritics expected)
        const words = s.trim().toLowerCase().split(/\s+/);
        const techCount = words.filter(w => TECH_TERMS.has(w.replace(/[^a-z0-9]/g, ''))).length;
        if (words.length > 0 && techCount / words.length > 0.4) return false;
        return true;
      });
      const ratio = noDiacriticsSentences.length / sentences.length;
      if (ratio > 0.5) {  // v62.2e: raised from 0.4 → 0.5
        hasDiacriticsIssue = true;
        markers.push(`diacritics_ratio(${Math.round(ratio * 100)}%)`);
      }
    }
  }

  // v62.2e: diacritics_ratio alone does NOT trigger contamination
  // Require: >=3 real EN structural markers, OR (>=2 real markers AND diacritics issue)
  const realMarkerCount = markers.filter(m => !m.startsWith('diacritics_ratio')).length;
  return {
    contaminated: realMarkerCount >= EN_THRESHOLD || (realMarkerCount >= 2 && hasDiacriticsIssue),
    markers,
    count: markers.length,
  };
}

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

  // v62.2: Check for English contamination when expecting non-English
  // Detects when LLM switches to English mid-response for CZ/SK/DE queries
  if (expectedLang !== 'en') {
    const enContamination = detectEnglishContamination(text);
    if (enContamination.contaminated) {
      issues.push(`english_contamination(${enContamination.count}): ${enContamination.markers.slice(0, 3).join(', ')}`);
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
    const hasEnglish = issues.some(i => i.includes('english'));
    const hasSlovak = issues.some(i => i.includes('slovak'));
    let instruction = `CHYBA: Tvá předchozí odpověď obsahovala cizojazyčné výrazy (${issues.join(', ')}).
OPRAV TO. Odpověz ZNOVU, tentokrát ČISTĚ ČESKY.`;
    if (hasSlovak) {
      instruction += `\nŽádné slovenské výrazy. Kontroluj každé slovo — "jsou" ne "sú", "který" ne "ktorý", "protože" ne "pretože".`;
    }
    if (hasEnglish) {
      instruction += `\nCELÁ odpověď musí být ČESKY. Žádné anglické věty, fráze ani nadpisy. Přelož vše do češtiny.`;
    }
    instruction += `\nŽádná cyrilice. Žádné čínské znaky.`;
    return instruction;
  }
  return `ERROR: Your previous response contained non-${lang} language (${issues.join(', ')}).
Respond AGAIN, this time EXCLUSIVELY in ${lang}. No other languages.`;
}

// ─── v62.2b: Mechanical Slovak→Czech word replacement ─────────────────────────
// Last-resort fallback when LLM rewrite also produces Slovak.
// Covers the most common SK→CZ word pairs that qwen2.5:32b produces.
// v62.2e: Unicode-safe word boundaries for non-ASCII characters
// JS \b fails with č,š,ž,ř,ť,ď,ň,ľ,ô,á,é,í,ó,ú,ý,ů — they're not \w
// Use (?<=^|\s) for word start with non-ASCII, (?=\s|[.,;:!?]|$) for word end
const _S = '(?<=^|\\s)';  // Unicode-safe word START boundary
const _E = '(?=\\s|[.,;:!?]|$)';  // Unicode-safe word END boundary

const SK_TO_CZ_MAP = [
  // ── High-frequency words (fix \b issues for non-ASCII) ──
  [new RegExp(`${_S}sú${_E}`, 'gi'), 'jsou'],
  [/\bktorý/gi, 'který'], [/\bktorá/gi, 'která'], [/\bktoré/gi, 'které'], [/\bktorú/gi, 'kterou'],
  [/\bpretože/gi, 'protože'],
  [/\bveľmi/gi, 'velmi'], [/\bveľa/gi, 'hodně'],
  [/\bmôže/gi, 'může'], [/\bmôžu/gi, 'mohou'], [/\bmôžete/gi, 'můžete'],
  [new RegExp(`${_S}ešte${_E}`, 'gi'), 'ještě'],
  [/\bniekoľko/gi, 'několik'],
  [/\bprípad/gi, 'případ'], [/\bprípadov/gi, 'případů'], [/\bprípadoch/gi, 'případech'],
  [/\bzaujímav/gi, 'zajímav'],
  [/\bvýskum/gi, 'výzkum'],
  [/\bspoloč/gi, 'společ'],
  [/\bpovedať/gi, 'říct'],
  [new RegExp(`${_S}osobné${_E}`, 'gi'), 'osobní'],
  [/\bhistóri/gi, 'histori'],
  [/\bzdravotn[ií]ctv/gi, 'zdravotnictv'],
  [/\bodvetvi/gi, 'odvětví'],
  [/\bnajdôležit/gi, 'nejdůležit'],
  [/\bnajlepš/gi, 'nejlepš'],
  [/\bnajviac/gi, 'nejvíce'],
  [/\bnapríklad/gi, 'například'],
  [/\bniekto/gi, 'někdo'],
  [/\bniečo/gi, 'něco'],
  [/\bdôležit/gi, 'důležit'],
  [/\bpotrebu/gi, 'potřebu'],
  [/\bpotrebov/gi, 'potřebov'],
  [/\bpotrebuj/gi, 'potřebuj'],
  [/\balebo/gi, 'nebo'],
  [/\bako\b/gi, 'jak'],
  [new RegExp(`${_S}tiež${_E}`, 'gi'), 'také'],
  [/\bpreto\b/gi, 'proto'],
  [/\bvšak\b/gi, 'však'],
  [/\bteraz/gi, 'teď'],
  [/\bmedzi/gi, 'mezi'],
  [/\bpríliš/gi, 'příliš'],
  [/\bpráve/gi, 'právě'],
  [/\bodporúčam(?=\s|[.,;:!?]|$)/gi, 'doporučuji'],
  [/\bodporúčame/gi, 'doporučujeme'],
  [/\bodporúčaný/gi, 'doporučený'],  [/\bodporúčaná/gi, 'doporučená'],
  [/\bodporúča(?=\s|[.,;:!?]|$)/gi, 'doporučuje'],
  // v62.2d: Additional high-frequency SK→CZ pairs
  [/\bpre\b/gi, 'pro'],
  [new RegExp(`${_S}čo${_E}`, 'gi'), 'co'],              // \bčo\b fails — č is non-ASCII
  [/\bich\b/gi, 'je'],
  [/\buistite/gi, 'ujistěte'],
  [new RegExp(`${_S}štandardn`, 'gi'), 'standardn'],      // š is non-ASCII
  [/\brozmysl/gi, 'rozmysl'],
  [/\baspoň/gi, 'alespoň'],
  [/\bsamozrejme/gi, 'samozřejmě'],
  [new RegExp(`${_S}samozrejmé${_E}`, 'gi'), 'samozřejmé'],
  [/\bzahrňuj/gi, 'zahrnuj'],
  [/\bpríprav/gi, 'příprav'],
  [/\bvyber[aá]ť/gi, 'vybírat'],
  [/\bpostaviť/gi, 'postavit'],
  [/\bkúpiť/gi, 'koupit'],
  [/\bspúšťa/gi, 'spouští'],
  // v62.2e: Gaming PC / HW terms (R3 Slovak drift)
  [new RegExp(`${_S}základná`, 'gi'), 'základní'],
  [new RegExp(`${_S}hlavná`, 'gi'), 'hlavní'],
  [/\bdoska\b/gi, 'deska'],
  [/\bpamäť/gi, 'paměť'],
  [/\bvýber/gi, 'výběr'],
  [/\bponúka/gi, 'nabíz'],
  [/\bhrať/gi, 'hrát'],
  [/\bzvážiť/gi, 'zvážit'],
  [/\blacn/gi, 'levn'],
  [/\bsúčasn/gi, 'současn'],
  [/\bpribližn/gi, 'přibližn'],
  [new RegExp(`${_S}úspech`, 'gi'), 'úspěch'],            // ú is non-ASCII
  [/\bdosiahn/gi, 'dosáhn'],
  // v62.2e: Sports / Olympics terms (F7 Slovak drift)
  [new RegExp(`${_S}športov`, 'gi'), 'sportov'],           // š is non-ASCII
  [/\bpreteky/gi, 'závody'],
  [/\bvíťaz/gi, 'vítěz'],
  [new RegExp(`${_S}účastn`, 'gi'), 'účastn'],             // ú is non-ASCII
  [/\breprezent/gi, 'reprezent'],
  // v62.2e: Additional common SK words
  [/\bbol\b/gi, 'byl'],               // bol → byl (was)
  [/\bbola\b/gi, 'byla'],             // bola → byla
  [/\bboli\b/gi, 'byli'],             // boli → byli
  [/\btreba\b/gi, 'třeba'],           // treba → třeba
  [/\bpretek/gi, 'závod'],            // preteky/pretekov → závody/závodů
  [new RegExp(`${_S}ďalej${_E}`, 'gi'), 'dále'],  // ďalej → dále
  [new RegExp(`${_S}ďalší`, 'gi'), 'další'],       // ďalší → další

  // ═══════════════════════════════════════════════════════════════════════════
  // v63.0: Comprehensive SK→CZ expansion (R3 gaming PC fix)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Critical: isSlovak() escape rules ──
  // These SK forms trigger test failure — MUST be converted
  [new RegExp(`${_S}nie je${_E}`, 'gi'), 'není'],
  [new RegExp(`${_S}nie sú${_E}`, 'gi'), 'nejsou'],
  [new RegExp(`${_S}možno${_E}`, 'gi'), 'možná'],
  [/\bnejaký/gi, 'nějaký'], [/\bnejakú/gi, 'nějakou'], [/\bnejaké/gi, 'nějaké'],
  [/\bnejakej/gi, 'nějaké'], [/\bnejakým/gi, 'nějakým'],
  [new RegExp(`${_S}ďakujem${_E}`, 'gi'), 'děkuji'],
  [new RegExp(`${_S}ďakujeme${_E}`, 'gi'), 'děkujeme'],

  // ── Reflexive pronoun (extremely common in SK) ──
  [new RegExp(`${_S}sa${_E}`, 'gi'), 'se'],

  // ── Prepositions ──
  [new RegExp(`${_S}pri${_E}`, 'gi'), 'při'],
  [new RegExp(`${_S}podľa${_E}`, 'gi'), 'podle'],
  [new RegExp(`${_S}okrem${_E}`, 'gi'), 'kromě'],
  [new RegExp(`${_S}vďaka${_E}`, 'gi'), 'díky'],
  [new RegExp(`${_S}napriek${_E}`, 'gi'), 'navzdory'],

  // ── Pronouns ──
  [new RegExp(`${_S}všetko${_E}`, 'gi'), 'všechno'],
  [new RegExp(`${_S}všetci${_E}`, 'gi'), 'všichni'],
  [new RegExp(`${_S}všetkých${_E}`, 'gi'), 'všech'],
  [new RegExp(`${_S}všetkým${_E}`, 'gi'), 'všem'],
  [new RegExp(`${_S}nikto${_E}`, 'gi'), 'nikdo'],

  // ── Conjunctions / adverbs ──
  [new RegExp(`${_S}prípadne${_E}`, 'gi'), 'případně'],
  [new RegExp(`${_S}taktiež${_E}`, 'gi'), 'také'],
  [new RegExp(`${_S}dokonca${_E}`, 'gi'), 'dokonce'],
  [new RegExp(`${_S}väčšinou${_E}`, 'gi'), 'většinou'],
  [new RegExp(`${_S}rovnako${_E}`, 'gi'), 'stejně'],
  [new RegExp(`${_S}akonáhle${_E}`, 'gi'), 'jakmile'],
  [new RegExp(`${_S}hoci${_E}`, 'gi'), 'ačkoli'],
  [new RegExp(`${_S}pokiaľ${_E}`, 'gi'), 'pokud'],
  [new RegExp(`${_S}aj${_E}`, 'gi'), 'i'],

  // ── Verbs: stem changes (NOT caught by ť→t rule) ──
  [/\bspraviť/gi, 'udělat'], [/\bspravte/gi, 'udělejte'],
  [/\bpozrieť/gi, 'podívat'], [/\bpozrite/gi, 'podívejte'],
  [/\bzistiť/gi, 'zjistit'],
  [new RegExp(`${_S}riešiť${_E}`, 'gi'), 'řešit'],
  [new RegExp(`${_S}riešen`, 'gi'), 'řešen'],
  [/\bhovorí(?=\s|[.,;:!?]|$)/gi, 'říká'],
  [/\bhovoríme/gi, 'říkáme'],
  [/\brobí(?=\s|[.,;:!?]|$)/gi, 'dělá'],
  [/\brobiť/gi, 'dělat'],
  [/\bvyhnúť/gi, 'vyhnout'],
  [/\bdosiahnuť/gi, 'dosáhnout'],
  [/\bdosiahne/gi, 'dosáhne'],
  [new RegExp(`${_S}pomôcť${_E}`, 'gi'), 'pomoci'],
  [/\bzaistiť/gi, 'zajistit'],
  [new RegExp(`${_S}ponúkať${_E}`, 'gi'), 'nabízet'],
  [new RegExp(`${_S}ponúka${_E}`, 'gi'), 'nabízí'],
  [/\bdajte/gi, 'dejte'],
  [/\bpoužívať/gi, 'používat'],
  [/\bpotrebujete/gi, 'potřebujete'],

  // ── Verb conjugations: -jú → -jí (3rd person plural) ──
  [/\bmajú/gi, 'mají'],
  [/\bpracujú/gi, 'pracují'],
  [/\bpoužívajú/gi, 'používají'],
  [/\bvyužívajú/gi, 'využívají'],
  [/\bponúkajú/gi, 'nabízejí'],
  [/\bexistujú/gi, 'existují'],

  // ── Nouns (common SK→CZ) ──
  [new RegExp(`${_S}riešenie${_E}`, 'gi'), 'řešení'],
  [new RegExp(`${_S}riešení${_E}`, 'gi'), 'řešení'],
  [/\bzariadeni/gi, 'zařízení'],
  [/\bprostredi/gi, 'prostředí'],
  [new RegExp(`${_S}nastaveni[ea]${_E}`, 'gi'), 'nastavení'],
  [/\bpripojeni/gi, 'připojení'],
  [/\bchladeni/gi, 'chlazení'],
  [new RegExp(`${_S}správani[ea]${_E}`, 'gi'), 'chování'],
  [/\bvýrobca/gi, 'výrobce'], [/\bvýrobcov/gi, 'výrobců'],
  [new RegExp(`${_S}množstvo${_E}`, 'gi'), 'množství'],
  [new RegExp(`${_S}napätie${_E}`, 'gi'), 'napětí'],
  [new RegExp(`${_S}priestor`, 'gi'), 'prostor'],
  [/\bprostriedok/gi, 'prostředek'], [/\bprostriedky/gi, 'prostředky'],
  [new RegExp(`${_S}skúsenosť${_E}`, 'gi'), 'zkušenost'],
  [new RegExp(`${_S}skúsenosti${_E}`, 'gi'), 'zkušenosti'],
  [/\bspotreba/gi, 'spotřeba'], [/\bspotreby/gi, 'spotřeby'],
  [new RegExp(`${_S}funkčnosť${_E}`, 'gi'), 'funkčnost'],
  [new RegExp(`${_S}súčasť${_E}`, 'gi'), 'součást'],
  [new RegExp(`${_S}súčasti${_E}`, 'gi'), 'součásti'],
  [new RegExp(`${_S}súbor`, 'gi'), 'soubor'],
  [/\bhranie/gi, 'hraní'],
  [/\bvideohier/gi, 'videoher'],
  [new RegExp(`${_S}úložisko${_E}`, 'gi'), 'úložiště'],
  [new RegExp(`${_S}úložiska${_E}`, 'gi'), 'úložiště'],

  // ── Adjectives ──
  [/\bkvalitn[ýáé]/gi, 'kvalitní'],
  [/\bhern[ýáé]/gi, 'herní'],
  [new RegExp(`${_S}dostatočn`, 'gi'), 'dostatečn'],
  [new RegExp(`${_S}ideáln[ýáé]${_E}`, 'gi'), 'ideální'],
  [new RegExp(`${_S}minimáln[ýáé]${_E}`, 'gi'), 'minimální'],
  [new RegExp(`${_S}väčší${_E}`, 'gi'), 'větší'],
  [new RegExp(`${_S}rýchlejší${_E}`, 'gi'), 'rychlejší'],
  [new RegExp(`${_S}lacnejší${_E}`, 'gi'), 'levnější'],
  [new RegExp(`${_S}drahší${_E}`, 'gi'), 'dražší'],
  [new RegExp(`${_S}rôzn`, 'gi'), 'různ'],
  [new RegExp(`${_S}žiadn[ýáé]${_E}`, 'gi'), 'žádný'],
  [new RegExp(`${_S}potrebn[ýáé]${_E}`, 'gi'), 'potřebný'],
  [new RegExp(`${_S}operačn[ýáé]${_E}`, 'gi'), 'operační'],
  [new RegExp(`${_S}grafick[ýáé]${_E}`, 'gi'), 'grafická'],

  // ═══════════════════════════════════════════════════════════════════════════
  // End v63.0 expansion
  // ═══════════════════════════════════════════════════════════════════════════

  // v62.2e: Generic Slovak infinitive -ť → Czech -t (broad catch-all)
  [/([aeiouáéíóúý])ť(?=\s|[.,;:!?]|$)/gi, '$1t'],
  // Character-level transformations (must be LAST — catches remaining)
  [/ôž/g, 'ůž'], [/ôl/g, 'ůl'],  // môže→může pattern
  [/ľ/g, 'l'],  // Slovak ľ has no Czech equivalent — just use l
  [/ô/g, 'ů'],  // Common mapping: ô→ů
];

// ─── v63.0: Aggressive suffix patterns (heavy contamination only, ≥3 markers) ──
// These are productive morphological patterns that are too broad for light
// contamination but safe when the text is predominantly Slovak.
const SK_TO_CZ_AGGRESSIVE_MAP = [
  // 3rd person plural suffix: -jú → -jí (generic, catches all remaining -jú verbs)
  [/jú(?=\s|[.,;:!?]|$)/gi, 'jí'],
  // Verbal noun suffix: -enie → -ení (nastavenie→nastavení, pripojenie→připojení)
  [/enie(?=\s|[.,;:!?]|$)/gi, 'ení'],
  // Verbal noun suffix: -anie → -ání (písanie→psaní, čítanie→čtení — not always right but close)
  [/anie(?=\s|[.,;:!?]|$)/gi, 'ání'],
  // Verbal noun suffix: -nie → -ní (hranie→hraní, tvrdenie→tvrzení)
  [/nie(?=\s|[.,;:!?]|$)/gi, 'ní'],
  // Adjective suffix: -ový/-ová/-ové (same in both, but catches -ovej→-ové)
  [/ovej(?=\s|[.,;:!?]|$)/gi, 'ové'],
  // Past participle: -ený → -ený (same, but -ený can come from SK -ený with different stem)
  // Comparative: -ejší → -ější (rýchlejší→rychlejší pattern)
  [/ejší/gi, 'ější'],
];

/**
 * Mechanically replace common Slovak words with Czech equivalents.
 * This is a LAST RESORT — not perfect, but better than pure Slovak output.
 *
 * @param {string} text - Input text (possibly Slovak-contaminated)
 * @param {boolean} aggressive - When true, also apply broad suffix patterns
 *   (safe only for heavily-contaminated text with ≥3 SK markers)
 * @returns {string} Text with Slovak words replaced by Czech equivalents
 */
export function mechanicalSlovakToCzech(text, aggressive = false) {
  let result = text;
  for (const [pattern, replacement] of SK_TO_CZ_MAP) {
    result = result.replace(pattern, replacement);
  }
  // v63.0: Aggressive suffix patterns for heavy contamination
  if (aggressive) {
    for (const [pattern, replacement] of SK_TO_CZ_AGGRESSIVE_MAP) {
      result = result.replace(pattern, replacement);
    }
  }
  // v62.2e: Re-capitalize sentence starts (lookbehind replacements can lowercase them)
  result = result.replace(/(^|[.!?]\s+)([a-záéíóúůýčďěňřšťž])/gm,
    (_, pre, ch) => pre + ch.toUpperCase()
  );
  return result;
}

export default {
  detectSlovakContamination,
  detectEnglishContamination,
  validateResponseLanguage,
  buildStrictLanguageInstruction,
  buildLanguageRetryInstruction,
  mechanicalSlovakToCzech,
  SK_MARKERS,
  SK_THRESHOLD,
  EN_MARKERS,
  EN_THRESHOLD,
  CYRILLIC_RE,
  CJK_RE,
};

// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Search Auto-Retry (A2)
// ═══════════════════════════════════════════════════════════════════════════════
//
// When search returns POOR or EMPTY results, automatically reformulate the
// query and retry. Strategies:
//   1. Simplify: Remove filler words, keep keywords
//   2. Translate: CZ query → EN (broader results)
//   3. Expand: Add context terms
//   4. Fallback: Use alternative query structure
//
// Integration: Wrap existing search call in retryableSearch()
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Czech stop words (to strip from queries) ────────────────────────────────

const CZ_STOP_WORDS = new Set([
  'a', 'ale', 'ani', 'ano', 'asi', 'az', 'až', 'bez', 'bude', 'budem', 'budeš',
  'by', 'byl', 'byla', 'byli', 'bylo', 'být', 'co', 'či', 'článek', 'článku',
  'další', 'dnes', 'do', 'ho', 'i', 'ja', 'já', 'jak', 'jaká', 'jaké', 'jaký',
  'je', 'jeho', 'její', 'jejích', 'jen', 'ještě', 'ji', 'jí', 'jich', 'jim',
  'jimi', 'jsou', 'jsem', 'jsi', 'jsme', 'jste', 'k', 'kam', 'kde', 'kdo',
  'když', 'ke', 'která', 'které', 'kteří', 'který', 'kvůli', 'ma', 'má', 'mají',
  'me', 'mě', 'mezi', 'mi', 'mít', 'mně', 'mnou', 'moc', 'moje', 'moji', 'možná',
  'můj', 'musí', 'my', 'na', 'nad', 'nám', 'námi', 'napište', 'napíšete', 'napiš',
  'nás', 'naše', 'ne', 'nebo', 'nechci', 'něco', 'něj', 'nejsou', 'není', 'nějak',
  'několik', 'ni', 'nic', 'nich', 'ním', 'nimi', 'no', 'nový', 'nové',
  'o', 'od', 'on', 'ona', 'oni', 'ono', 'ony', 'pak', 'po', 'pod', 'podle',
  'pokud', 'pouze', 'potom', 'právě', 'pro', 'proč', 'prosím', 'protože', 'před',
  'přes', 'při', 's', 'se', 'si', 'snad', 'spíš', 'svůj', 'ta', 'tak', 'také',
  'takže', 'tam', 'tato', 'te', 'tě', 'tedy', 'ten', 'tento', 'ti', 'tím', 'to',
  'toho', 'tohle', 'tom', 'tomu', 'tomto', 'tu', 'tuto', 'tvůj', 'ty', 'tyto',
  'u', 'už', 'v', 've', 'velmi', 'vi', 'vše', 'všech', 'všechno', 'všichni',
  'však', 'vy', 'z', 'za', 'zatím', 'ze', 'že',
]);

const EN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'or', 'and',
  'but', 'not', 'no', 'if', 'this', 'that', 'these', 'those', 'it', 'its',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
  'some', 'any', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'very', 'just', 'also', 'than', 'then', 'so', 'too', 'only',
  'please', 'tell', 'show', 'find', 'give', 'get',
]);

// ─── Query reformulation strategies ──────────────────────────────────────────

/**
 * Strategy 1: Simplify — extract only meaningful keywords.
 * "Jaké jsou nejlepší restaurace v Praze pro rodiny?" → "restaurace Praha rodiny"
 */
export function simplifyQuery(query, lang = 'cs') {
  const stopWords = lang === 'cs' ? CZ_STOP_WORDS : EN_STOP_WORDS;
  const words = query
    .toLowerCase()
    .replace(/[?!.,;:()""„"]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return words.join(' ');
}

/**
 * Strategy 2: Translate key terms CZ → EN for broader search.
 * Not a full translator — just common search terms.
 */
const CZ_TO_EN = {
  'restaurace': 'restaurants', 'nejlepší': 'best', 'Praha': 'Prague', 'Brno': 'Brno',
  'počasí': 'weather', 'zprávy': 'news', 'cena': 'price', 'kde': 'where',
  'kdy': 'when', 'kolik': 'how much', 'kurz': 'exchange rate', 'akcie': 'stocks',
  'nemocnice': 'hospital', 'letiště': 'airport', 'hotely': 'hotels', 'školy': 'schools',
  'práce': 'jobs', 'bydlení': 'housing', 'doprava': 'transport', 'volby': 'elections',
  'sport': 'sports', 'kultura': 'culture', 'historie': 'history',
  'technologie': 'technology', 'věda': 'science', 'zdraví': 'health',
  'vzdělání': 'education', 'ekonomika': 'economy', 'politika': 'politics',
  'recenze': 'reviews', 'srovnání': 'comparison', 'návod': 'tutorial',
};

export function translateToEnglish(query) {
  let translated = query;
  for (const [cz, en] of Object.entries(CZ_TO_EN)) {
    translated = translated.replace(new RegExp(cz, 'gi'), en);
  }
  // If nothing changed, return null (no translation available)
  return translated !== query ? translated : null;
}

/**
 * Strategy 3: Expand with synonyms/context.
 * "restaurace Praha" → "restaurace Praha jídlo doporučení 2025"
 */
export function expandQuery(query, lang = 'cs') {
  const currentYear = new Date().getFullYear();
  const suffix = lang === 'cs' ? `${currentYear}` : `${currentYear}`;

  // Only add year if not already present
  if (!query.includes(String(currentYear)) && !query.includes(String(currentYear - 1))) {
    return `${query} ${suffix}`;
  }
  return query;
}

/**
 * Strategy 4: Alternative phrasing.
 * Restructure query for different search engine behavior.
 */
export function alternativeQuery(query, lang = 'cs') {
  const simplified = simplifyQuery(query, lang);
  const words = simplified.split(' ');

  if (words.length <= 2) return null; // Too short to restructure

  // Reverse keyword order (sometimes helps with different search engines)
  return words.reverse().join(' ');
}

// ─── Retry orchestration ─────────────────────────────────────────────────────

/**
 * Generate retry query variants for a failed search.
 *
 * @param {string} originalQuery - The original query that returned POOR/EMPTY
 * @param {string} lang - Detected language
 * @param {string} grade - Result grade from scoreSearchResults ('POOR'|'EMPTY')
 * @returns {string[]} Array of reformulated queries to try (max 3)
 */
export function generateRetryQueries(originalQuery, lang = 'cs', grade = 'EMPTY') {
  const variants = [];

  // Strategy 1: Simplify (always try first)
  const simplified = simplifyQuery(originalQuery, lang);
  if (simplified && simplified !== originalQuery.toLowerCase().trim()) {
    variants.push(simplified);
  }

  // Strategy 2: For Czech queries, try English translation
  if (lang === 'cs') {
    const translated = translateToEnglish(originalQuery);
    if (translated) {
      variants.push(simplifyQuery(translated, 'en'));
    }
  }

  // Strategy 3: Expand with year (for POOR, not EMPTY — EMPTY needs simpler query)
  if (grade === 'POOR') {
    const expanded = expandQuery(simplified || originalQuery, lang);
    if (expanded !== (simplified || originalQuery)) {
      variants.push(expanded);
    }
  }

  // Strategy 4: Alternative structure (last resort)
  if (variants.length < 2) {
    const alt = alternativeQuery(originalQuery, lang);
    if (alt) variants.push(alt);
  }

  // Deduplicate and limit to 3
  return [...new Set(variants)].slice(0, 3);
}

/**
 * Execute search with automatic retry on poor results.
 *
 * @param {Function} searchFn - Async function: (query) → { results, grade }
 * @param {string} query - Original query
 * @param {string} lang - Language
 * @param {object} [options]
 * @param {number} [options.maxRetries=2] - Max retry attempts
 * @param {Function} [options.scoreResults] - Score function: (results, query) → { grade }
 * @returns {Promise<{
 *   results: any[],
 *   grade: string,
 *   query: string,
 *   retried: boolean,
 *   retryCount: number,
 *   originalGrade: string|null,
 * }>}
 */
export async function retryableSearch(searchFn, query, lang = 'cs', options = {}) {
  const { maxRetries = 2, scoreResults } = options;

  // First attempt
  let result = await searchFn(query);
  let grade = result.grade || (scoreResults ? scoreResults(result.results, query).grade : 'UNKNOWN');

  if (grade === 'GOOD' || grade === 'FAIR') {
    return { ...result, query, retried: false, retryCount: 0, originalGrade: null };
  }

  // Generate retry variants
  const retryQueries = generateRetryQueries(query, lang, grade);
  const originalGrade = grade;

  for (let i = 0; i < Math.min(retryQueries.length, maxRetries); i++) {
    const retryQuery = retryQueries[i];
    try {
      const retryResult = await searchFn(retryQuery);
      const retryGrade = retryResult.grade
        || (scoreResults ? scoreResults(retryResult.results, retryQuery).grade : 'UNKNOWN');

      // If retry is better, use it
      if (retryGrade === 'GOOD' || retryGrade === 'FAIR') {
        return {
          ...retryResult,
          query: retryQuery,
          retried: true,
          retryCount: i + 1,
          originalGrade,
        };
      }

      // Update for next iteration if this was still better
      if (gradeRank(retryGrade) > gradeRank(grade)) {
        result = retryResult;
        grade = retryGrade;
      }
    } catch {
      // Retry failed — continue to next variant
      continue;
    }
  }

  // Return best result we got (even if still POOR)
  return {
    ...result,
    query: result.query || query,
    retried: true,
    retryCount: retryQueries.length,
    originalGrade,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gradeRank(grade) {
  const ranks = { 'GOOD': 4, 'FAIR': 3, 'POOR': 2, 'EMPTY': 1, 'UNKNOWN': 0 };
  return ranks[grade] || 0;
}

export default {
  simplifyQuery,
  translateToEnglish,
  expandQuery,
  alternativeQuery,
  generateRetryQueries,
  retryableSearch,
};

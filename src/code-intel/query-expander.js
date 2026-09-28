// Query Expander v1 — Heuristic query expansion (no LLM)
// ══════════════════════════════════════════════════════════════════════════════
//
// Extracts identifiers, technical terms, and sub-terms from user input.
// Pure heuristic — fast, deterministic, zero API calls.
//
// ══════════════════════════════════════════════════════════════════════════════

// Stop words — filtered out from search terms
const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose',
  'where', 'when', 'why', 'how',
  'not', 'no', 'nor', 'but', 'or', 'and', 'so', 'if', 'then',
  'than', 'too', 'very', 'just', 'also', 'about', 'with', 'from',
  'into', 'for', 'on', 'in', 'at', 'to', 'of', 'by', 'up', 'out',
  'all', 'some', 'any', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'such', 'only', 'same',
  'here', 'there', 'now', 'then', 'once',
  'please', 'help', 'want', 'need', 'look', 'show', 'tell', 'give',
  'really', 'actually', 'basically', 'simply',
]);

const STOP_WORDS_CZ = new Set([
  'je', 'jsou', 'byl', 'byla', 'bylo', 'být', 'bude', 'budou',
  'ten', 'ta', 'to', 'ti', 'ty', 'tato', 'tento', 'toto',
  'co', 'jak', 'kde', 'kdy', 'proč', 'kdo', 'který', 'která', 'které',
  'se', 'si', 'mi', 'mu', 'ji', 'ho', 'je', 'nás', 'vás', 'jim',
  'na', 'do', 'od', 'za', 'po', 'pro', 'při', 'ke', 'ze', 've', 'nad', 'pod',
  'ale', 'nebo', 'ani', 'tak', 'že', 'aby', 'protože', 'pokud', 'když',
  'mám', 'máš', 'má', 'máme', 'mají', 'chci', 'chce', 'chtěl',
  'tady', 'tam', 'teď', 'pak',
  'můj', 'tvůj', 'jeho', 'její', 'náš', 'váš', 'jejich',
  'něco', 'někdo', 'nějaký', 'žádný', 'každý', 'všechno', 'nic',
  'jen', 'jenom', 'pouze', 'také', 'taky', 'ještě', 'už', 'stále',
  'prosím', 'pomoz', 'ukaž', 'řekni', 'dej',
  'moc', 'velmi', 'hodně', 'trochu',
]);

const ALL_STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_CZ]);

// Technical terms that are always relevant
const TECHNICAL_TERMS = new Set([
  'error', 'exception', 'timeout', 'null', 'undefined', 'bug', 'crash',
  'fail', 'failure', 'warning', 'deprecated', 'broken',
  'memory', 'leak', 'deadlock', 'race', 'mutex', 'lock',
  'auth', 'login', 'token', 'session', 'password', 'jwt', 'oauth',
  'api', 'endpoint', 'route', 'handler', 'middleware', 'controller',
  'database', 'query', 'schema', 'migration', 'index',
  'config', 'env', 'settings', 'options',
  'import', 'export', 'module', 'package', 'dependency',
  'test', 'spec', 'assert', 'mock', 'fixture',
  'async', 'await', 'promise', 'callback', 'event',
  'cache', 'queue', 'worker', 'thread', 'process',
  'render', 'component', 'state', 'props', 'hook',
  'chyba', 'selhání', 'problém', 'havárie',
]);

// ─── Identifier Detection ─────────────────────────────────────────────────────

// camelCase, PascalCase, snake_case, UPPER_CASE identifiers
const IDENTIFIER_REGEX = /\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\b/g;

// camelCase/PascalCase splitter
function splitCamelCase(identifier) {
  // "forwardingAddress" → ["forwarding", "Address"] → ["forwarding", "address"]
  // "NOT_RETURNED_BY_DEFAULT" → ["NOT", "RETURNED", "BY", "DEFAULT"]
  const parts = identifier
    .replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase split
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ABCDef → ABC Def
    .replace(/_/g, ' ')                        // snake_case split
    .split(/\s+/)
    .map(p => p.toLowerCase())
    .filter(p => p.length >= 2);

  return parts;
}

function isIdentifier(word) {
  // Must have mixed case, underscore, or dollar sign — or be >3 chars non-stop-word
  return /[A-Z]/.test(word) && /[a-z]/.test(word)  // camelCase
    || word.includes('_')                            // snake_case
    || word.includes('$')                            // $variable
    || word.includes('.')                             // dotted.path
    || /^[A-Z]{2,}$/.test(word);                     // UPPER_CASE
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Expand a user query into search terms.
 *
 * @param {string} input - User query
 * @returns {{primary: string[], secondary: string[], terms: string[], original: string}}
 */
export function expandQuery(input) {
  if (!input) return { primary: [], secondary: [], terms: [], original: '' };

  const primary = [];    // High-priority: identifiers, technical terms
  const secondary = [];  // Sub-terms from camelCase decomposition
  const terms = [];      // All non-stop-word terms

  // 1. Extract identifiers (camelCase, snake_case, etc.)
  const identifiers = [];
  const matches = input.matchAll(IDENTIFIER_REGEX);
  for (const m of matches) {
    const word = m[1];
    if (isIdentifier(word) && !ALL_STOP_WORDS.has(word.toLowerCase())) {
      identifiers.push(word);
    }
  }

  // Deduplicate identifiers
  const seen = new Set();
  for (const id of identifiers) {
    if (!seen.has(id)) {
      seen.add(id);
      primary.push(id);

      // Decompose camelCase/snake_case into sub-terms
      const parts = splitCamelCase(id);
      for (const part of parts) {
        if (!seen.has(part) && !ALL_STOP_WORDS.has(part) && part !== id.toLowerCase()) {
          seen.add(part);
          secondary.push(part);
        }
      }
    }
  }

  // 2. Extract remaining non-stop-word terms
  const words = input
    .replace(/[^\w\sáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  for (const word of words) {
    const lower = word.toLowerCase();
    if (!ALL_STOP_WORDS.has(lower) && !seen.has(lower) && !seen.has(word)) {
      seen.add(lower);
      terms.push(word);

      // Promote technical terms to primary
      if (TECHNICAL_TERMS.has(lower)) {
        primary.push(word);
      }
    }
  }

  return {
    primary,
    secondary,
    terms,
    original: input,
  };
}

/**
 * Build search queries from expanded terms.
 * Returns queries ordered by priority (most specific first).
 *
 * @param {{primary: string[], secondary: string[], terms: string[]}} expanded
 * @returns {string[]}
 */
export function buildSearchQueries(expanded) {
  const queries = [];

  // Primary identifiers first (most specific)
  for (const p of expanded.primary) {
    queries.push(p);
  }

  // Secondary (decomposed parts) — only if no primary found
  if (queries.length === 0) {
    for (const s of expanded.secondary) {
      queries.push(s);
    }
  }

  // Remaining terms as fallback
  if (queries.length === 0) {
    for (const t of expanded.terms) {
      queries.push(t);
    }
  }

  return queries;
}

export default { expandQuery, buildSearchQueries };

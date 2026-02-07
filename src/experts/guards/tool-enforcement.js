// C3-Agent v57.2 — Tool-Only Enforcement Guard
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
// Detects numeric claims in LLM responses that are NOT backed by tool data.
// Forces retry when unverifiable numbers are found.
//
// USE CASE:
// Accountant specialist must NEVER hallucinate numbers.
// Every price, percentage, date, amount must come from a tool call.
//
// ACTIVATION:
// Only runs when expertHints.toolEnforcement === true
// (opt-in per expert via styleRules.toolEnforcement)
//
// ══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Number Extraction from LLM Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} NumericClaim
 * @property {string} raw        - The raw matched string (e.g. "15 499 Kč")
 * @property {string} normalized - Normalized value for comparison (e.g. "15499")
 * @property {string} category   - 'currency'|'percentage'|'date_iso'|'date_cz'|'decimal'|'integer'
 * @property {string} context    - ~50 chars surrounding the number
 */

// Patterns ordered by specificity (first match wins to avoid double-extraction)
const CLAIM_PATTERNS = [
  // Currency amounts: "15 499 Kč", "$299.99", "1500 EUR"
  {
    regex: /(\d[\d\s.,]*\d)\s*(Kč|CZK|EUR|USD|€|\$|Kc)/gi,
    category: 'currency',
    normalize: m => m[1].replace(/[\s.]/g, '').replace(',', '.'),
  },
  // Percentages: "21%", "3.5 %", "3,5%"
  {
    regex: /(\d+[.,]?\d*)\s*%/g,
    category: 'percentage',
    normalize: m => m[1].replace(',', '.'),
  },
  // ISO dates: "2025-04-01"
  {
    regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    category: 'date_iso',
    normalize: m => `${m[1]}${m[2]}${m[3]}`,
  },
  // Czech dates: "1.4.2025", "01. 04. 2025"
  {
    regex: /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g,
    category: 'date_cz',
    normalize: m => `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`,
  },
  // Decimals: "3.14", "1,5"
  {
    regex: /\b(\d+[.,]\d+)\b/g,
    category: 'decimal',
    normalize: m => m[1].replace(',', '.'),
  },
  // Large integers (4+ digits): "150000", "15 000"
  {
    regex: /\b(\d[\d\s]{2,}\d)\b/g,
    category: 'integer',
    normalize: m => m[1].replace(/\s/g, ''),
  },
  // Medium integers (2-3 digits, not at line start as list markers)
  {
    regex: /(?<!^|\n)(?<![.\-/v])\b(\d{2,3})\b(?!\s*[.):%])/gm,
    category: 'integer',
    normalize: m => m[1],
  },
];

// URLs — numbers inside URLs are not claims
const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

/**
 * Extract numeric claims from LLM response text.
 * @param {string} responseText
 * @returns {NumericClaim[]}
 */
export function extractNumericClaims(responseText) {
  if (!responseText) return [];

  // Remove URLs (numbers in URLs are not claims)
  const urlRanges = [];
  for (const m of responseText.matchAll(URL_REGEX)) {
    urlRanges.push([m.index, m.index + m[0].length]);
  }

  // Track which character positions have already been matched
  const matched = new Set();
  const claims = [];

  for (const pattern of CLAIM_PATTERNS) {
    // Reset regex lastIndex
    pattern.regex.lastIndex = 0;
    let match;

    while ((match = pattern.regex.exec(responseText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if inside a URL
      if (urlRanges.some(([us, ue]) => start >= us && end <= ue)) continue;

      // Skip if overlaps with already-matched region
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (matched.has(i)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      // Mark positions as matched
      for (let i = start; i < end; i++) matched.add(i);

      const raw = match[0].trim();
      const normalized = pattern.normalize(match);

      // Skip single-digit results
      if (/^\d$/.test(normalized)) continue;

      // Extract surrounding context
      const ctxStart = Math.max(0, start - 25);
      const ctxEnd = Math.min(responseText.length, end + 25);
      const context = responseText.slice(ctxStart, ctxEnd).replace(/\n/g, ' ');

      claims.push({ raw, normalized, category: pattern.category, context });
    }
  }

  return claims;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe Number Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a numeric claim is "safe" (doesn't need tool backing).
 * @param {NumericClaim} claim
 * @returns {boolean}
 */
export function isSafeNumber(claim) {
  const { raw, normalized, category } = claim;

  // Single-digit numbers (0-9) — always safe
  if (/^\d$/.test(normalized)) return true;

  // List markers: "1.", "2)", "3:"
  if (/^\d+[.):]/.test(raw)) return true;

  // Footnote/reference: "[1]", "[2]"
  if (/^\[\d+\]/.test(raw)) return true;

  // Version-like: "v57", "v2.1"
  if (/^v\d/i.test(raw)) return true;

  // Standalone years (1900-2099) — safe only if NOT currency/percentage
  if (category === 'integer' && /^(19|20)\d{2}$/.test(normalized)) return true;

  // Small two-digit numbers in non-currency context (10-31 as common prose numbers)
  // These are ambiguous, so only safe for dates and very common numbers
  if (category === 'integer' && parseInt(normalized) <= 12) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Number Extraction from Tool Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all numbers from tool result data for matching.
 * @param {Array<{type: string, data: any, meta?: any}>} toolResults
 * @returns {Set<string>} Normalized number strings
 */
export function extractNumbersFromToolData(toolResults) {
  const numbers = new Set();
  if (!toolResults?.length) return numbers;

  for (const result of toolResults) {
    extractNumbersFromValue(result.data, numbers);
  }

  return numbers;
}

/**
 * Recursively extract numbers from any value.
 * @private
 */
function extractNumbersFromValue(value, numbers) {
  if (value == null) return;

  if (typeof value === 'number') {
    numbers.add(String(value));
    // Also add common formatted variants
    if (Number.isInteger(value)) {
      numbers.add(String(value));
    } else {
      numbers.add(value.toFixed(2));
      numbers.add(value.toFixed(1));
    }
    return;
  }

  if (typeof value === 'string') {
    // Extract all number-like patterns from the string
    for (const pattern of CLAIM_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(value)) !== null) {
        numbers.add(pattern.normalize(match));
      }
    }
    // Also extract raw integers/decimals with simple patterns
    for (const m of value.matchAll(/\d[\d\s.,]*\d/g)) {
      const n = m[0].replace(/[\s.]/g, '').replace(',', '.');
      numbers.add(n);
    }
    for (const m of value.matchAll(/\b\d{2,}\b/g)) {
      numbers.add(m[0]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) extractNumbersFromValue(item, numbers);
    return;
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      extractNumbersFromValue(value[key], numbers);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy Number Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a number approximately matches any number in the set.
 * Tolerance: ±1% for numbers > 100, exact match otherwise.
 * @param {string} normalized
 * @param {Set<string>} toolNumbers
 * @returns {boolean}
 */
export function fuzzyNumberMatch(normalized, toolNumbers) {
  const num = parseFloat(normalized);
  if (isNaN(num)) return false;

  // Exact match first
  if (toolNumbers.has(normalized)) return true;

  // For numbers > 100, allow ±1% tolerance (rounding)
  if (num > 100) {
    const tolerance = num * 0.01;
    for (const tn of toolNumbers) {
      const toolNum = parseFloat(tn);
      if (!isNaN(toolNum) && Math.abs(num - toolNum) <= tolerance) {
        return true;
      }
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ToolEnforcementVerdict
 * @property {boolean} ok          - All numeric claims are backed
 * @property {NumericClaim[]} unbacked - Claims not found in tool data
 * @property {NumericClaim[]} backed   - Claims successfully traced
 * @property {NumericClaim[]} safe     - Claims excluded by safe-number rules
 * @property {string} [reason]     - Human-readable failure reason
 */

/**
 * Verify that all numeric claims in a response are backed by tool data.
 *
 * @param {string} responseText
 * @param {Array} toolResults - Array of successful tool result objects
 * @returns {ToolEnforcementVerdict}
 */
export function verifyNumericClaims(responseText, toolResults) {
  const claims = extractNumericClaims(responseText);
  const toolNumbers = extractNumbersFromToolData(toolResults || []);

  const backed = [];
  const unbacked = [];
  const safe = [];

  for (const claim of claims) {
    if (isSafeNumber(claim)) {
      safe.push(claim);
      continue;
    }

    if (fuzzyNumberMatch(claim.normalized, toolNumbers)) {
      backed.push(claim);
      continue;
    }

    unbacked.push(claim);
  }

  return {
    ok: unbacked.length === 0,
    unbacked,
    backed,
    safe,
    reason: unbacked.length > 0
      ? `${unbacked.length} numeric claim(s) not backed by tool data: ${unbacked.slice(0, 3).map(c => `"${c.raw}"`).join(', ')}`
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build retry prompt when unbacked numbers are detected.
 *
 * @param {string} originalPrompt
 * @param {ToolEnforcementVerdict} verdict
 * @returns {string}
 */
export function buildToolEnforcementRetryPrompt(originalPrompt, verdict) {
  const unbackedList = verdict.unbacked
    .slice(0, 5)
    .map(c => `- "${c.raw}" (context: ...${c.context}...)`)
    .join('\n');

  return `${originalPrompt}\n\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `PREVIOUS RESPONSE REJECTED: Unbacked numeric claims detected.\n` +
    `═══════════════════════════════════════════════════════════════\n` +
    `These numbers in your response are NOT present in the provided data:\n` +
    `${unbackedList}\n\n` +
    `REQUIREMENTS:\n` +
    `- Every number, price, date, percentage MUST come from the provided tool data\n` +
    `- If a number is not in the data, REMOVE it or replace with "údaj není k dispozici"\n` +
    `- Do NOT invent, estimate, or round numbers that are not in the source data\n` +
    `- You may use qualitative language ("nízká cena", "vysoké procento") instead\n` +
    `═══════════════════════════════════════════════════════════════`;
}

export default {
  extractNumericClaims,
  isSafeNumber,
  extractNumbersFromToolData,
  fuzzyNumberMatch,
  verifyNumericClaims,
  buildToolEnforcementRetryPrompt,
};

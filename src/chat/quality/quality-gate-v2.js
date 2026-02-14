// ═══════════════════════════════════════════════════════════════════════════════
// QualityGate v2 — Deterministic Post-Processing Pipeline
// ═══════════════════════════════════════════════════════════════════════════════
//
// v62.3: Unified quality gate with 4 deterministic layers.
// Runs AFTER LLM generation, BEFORE returning to user.
// No LLM calls. No retry. No new sentences. No meaning changes.
//
//   Layer 1: Structural Fix   — JSON leak strip, whitespace, CJK
//   Layer 2: Language Fix     — Mechanical SK→CZ, Cyrillic strip
//   Layer 3: Intent Guarantees — LinkGuard (SEARCH), intent flags
//   Layer 4: Content Enforcement — Zombie/sparse detection (flag only)
//
// Contract:
//   runQualityGateV2(text, context) → QGv2Result
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  mechanicalSlovakToCzech,
  detectSlovakContamination,
  validateResponseLanguage,
} from '../handlers/utils/language-enforcement.js';
import { stripCJKContamination } from '../handlers/utils/response-sanitizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Structural Fix
// ─────────────────────────────────────────────────────────────────────────────
// Fixes malformed LLM output: raw JSON leaks, excessive whitespace, CJK chars.
// All transformations are safe — they only fix formatting, never alter meaning.

function structuralFix(text, fixes) {
  let result = text;

  // 1a. JSON leak — entire response is a raw JSON object
  // Only extract if the response is ENTIRELY JSON (not JSON embedded in markdown)
  const trimmed = result.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}') && !trimmed.includes('\n\n')) {
    try {
      const parsed = JSON.parse(trimmed);
      const extracted = parsed.content || parsed.text || parsed.response
                     || parsed.message || parsed.answer || parsed.result;
      if (typeof extracted === 'string' && extracted.length > 0) {
        result = extracted.trim();
        fixes.push('structural:json_extract');
      }
    } catch { /* not valid JSON — leave as-is */ }
  }

  // 1b. JSON array leak
  if (trimmed.startsWith('[') && trimmed.endsWith(']') && !trimmed.includes('\n\n')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (parsed.every(item => typeof item === 'string')) {
          result = parsed.join('\n');
          fixes.push('structural:json_array_join');
        } else if (parsed[0]?.content) {
          result = parsed.map(item => item.content).join('\n');
          fixes.push('structural:json_array_extract');
        }
      }
    } catch { /* not valid JSON array */ }
  }

  // 1c. Whitespace normalization — 3+ consecutive newlines → 2
  const beforeWs = result;
  result = result.replace(/\n{3,}/g, '\n\n');
  if (result !== beforeWs) fixes.push('structural:whitespace_normalize');

  // 1d. CJK character contamination strip
  const beforeCjk = result;
  result = stripCJKContamination(result);
  if (result !== beforeCjk) fixes.push('structural:cjk_strip');

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: Language Fix
// ─────────────────────────────────────────────────────────────────────────────
// Mechanical Slovak→Czech word replacement.
// Fast (0ms, pure regex). Catches ~90% of SK contamination from qwen2.5:32b.
// Also detects remaining language issues (EN, Cyrillic) for flagging.

function languageFix(text, context, fixes, issues) {
  let result = text;
  const { lang = 'cs' } = context;

  if (lang !== 'cs') return result;

  // 2a. Mechanical Slovak→Czech replacement
  const skCheck = detectSlovakContamination(result);
  if (skCheck.contaminated) {
    const before = result;
    result = mechanicalSlovakToCzech(result);
    // Count actual character-level changes for stats
    let changeCount = 0;
    for (let i = 0; i < Math.min(before.length, result.length); i++) {
      if (before[i] !== result[i]) changeCount++;
    }
    changeCount += Math.abs(before.length - result.length);
    fixes.push(`language:sk_to_cz(${skCheck.count} markers, ${changeCount} chars changed)`);
  }

  // 2b. Detect remaining language issues (EN, Cyrillic) — flag only, can't fix mechanically
  const langValidation = validateResponseLanguage(result, lang);
  if (!langValidation.clean) {
    for (const issue of langValidation.issues) {
      // SK contamination was already handled above — only flag non-SK issues
      if (!issue.startsWith('slovak_')) {
        issues.push({ layer: 'language', type: issue });
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3: Intent Guarantees
// ─────────────────────────────────────────────────────────────────────────────
// Intent-specific post-processing that guarantees contract compliance.
// SEARCH must have source links. FACTUAL should have numbers.
// Only adds metadata (URLs) — never generates new prose.

function intentGuarantees(text, context, fixes, issues) {
  let result = text;
  const { intent, searchSubType, sourceUrls = [] } = context;

  // 3a. LinkGuard — SEARCH responses must have ≥2 source links
  // Idempotent: skip if **Zdroje:** section already exists (previous pipeline run)
  const hasSourcesSection = /\*\*Zdroje:\*\*/i.test(result);
  if ((intent === 'SEARCH' || searchSubType) && result.length > 100 && !hasSourcesSection) {
    const linkCount = (result.match(/https?:\/\/\S+/g) || []).length;
    if (linkCount < 2 && sourceUrls.length > 0) {
      const urlBlock = sourceUrls.slice(0, 5).map((u, i) =>
        `[${i + 1}] [${u.title || 'Zdroj'}](${u.url})`
      ).join('\n');
      result += `\n\n**Zdroje:**\n${urlBlock}`;
      fixes.push(`intent:link_guard(+${Math.min(sourceUrls.length, 5)} urls)`);
    } else if (linkCount < 2 && sourceUrls.length === 0) {
      issues.push({ layer: 'intent', type: 'search_no_sources' });
    }
  } else if ((intent === 'SEARCH' || searchSubType) && result.length <= 100) {
    issues.push({ layer: 'intent', type: 'search_too_short', length: result.length });
  }

  // 3b. FACTUAL: should contain at least one number
  if (intent === 'FACTUAL') {
    if (!/\d/.test(result)) {
      issues.push({ layer: 'intent', type: 'factual_no_number' });
    }
  }

  // 3c. REPORT: should have substantial content
  if (intent === 'REPORT') {
    const stripped = result.replace(/[#*_~`>|]/g, '').replace(/\s+/g, ' ').trim();
    if (stripped.length < 200) {
      issues.push({ layer: 'intent', type: 'report_too_short', length: stripped.length });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4: Content Enforcement
// ─────────────────────────────────────────────────────────────────────────────
// Detect-only layer. Flags quality issues without modifying text.
// Used for logging/metrics — retry is handled upstream in synthesis.js.

function contentEnforcement(text, context, issues) {
  // 4a. Zombie/meta response detection
  const ZOMBIE_STARTS = [
    /^(Jako jazykový model|Jako AI|Jako umělá inteligence)/i,
    /^Omlouvám se,?\s+(ale\s+)?(nemohu|nemůžu|nedokážu)/i,
    /^I apologize,?\s+(but\s+)?I (cannot|can't|am unable)/i,
    /^(As a language model|As an AI|I'm just an AI)/i,
    /nemám přístup k (internetu|aktuálním|reálným)/i,
    /I don't have access to (the internet|real-time|current)/i,
  ];

  const head = text.substring(0, 300);
  for (const pattern of ZOMBIE_STARTS) {
    if (pattern.test(head)) {
      // Check if there's substantial content after the meta opener
      const firstDot = text.indexOf('. ');
      if (firstDot > 0 && text.length - firstDot > 100) {
        continue; // Has real content after meta opener — tolerable
      }
      issues.push({ layer: 'content', type: 'zombie_detected', pattern: pattern.source.substring(0, 40) });
      break;
    }
  }

  // 4b. Sparse content detection
  const stripped = text.replace(/[#*_~`>|]/g, '').replace(/\s+/g, ' ').trim();
  if (stripped.length < 20) {
    issues.push({ layer: 'content', type: 'sparse_content', length: stripped.length });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality scoring
// ─────────────────────────────────────────────────────────────────────────────

// Penalty weights for numeric score (0 = perfect, 100 = unusable)
const SCORE_WEIGHTS = {
  // Content — critical (response is broken)
  empty_input:         100,
  zombie_detected:      40,
  sparse_content:       35,
  // Intent — significant (contract violation)
  search_no_sources:    20,
  search_too_short:     25,
  factual_no_number:    10,
  report_too_short:     15,
  // Language — moderate (readability issue, not content issue)
  english_contamination: 8,
  cyrillic_detected:     5,
};

// Output score: issues only — quality of what the user will see.
// Used for retry decisions: if QG fixed everything, score is 0, no retry.
function computeScore(issues) {
  let penalty = 0;
  for (const issue of issues) {
    penalty += SCORE_WEIGHTS[issue.type] || 5;
  }
  return Math.min(100, Math.max(0, penalty));
}

// Raw score: issues + fix penalties — how dirty was the raw LLM output.
// Used for metrics/monitoring: tracks upstream LLM regression.
function computeScoreRaw(fixes, issues) {
  let penalty = computeScore(issues);

  for (const fix of fixes) {
    if (fix.startsWith('structural:')) penalty += 2;
    if (fix.startsWith('language:')) {
      const match = fix.match(/(\d+) chars changed/);
      const charsChanged = match ? parseInt(match[1], 10) : 0;
      // Scaled: 1pt per 10 chars changed, min 3, max 15
      penalty += Math.min(15, Math.max(3, Math.floor(charsChanged / 10)));
    }
    if (fix.startsWith('intent:')) penalty += 3;
  }

  return Math.min(100, Math.max(0, penalty));
}

function computeFlags(fixes, issues) {
  const flags = {
    structuralFixed: fixes.some(f => f.startsWith('structural:')),
    languageFixed: fixes.some(f => f.startsWith('language:')),
    intentFixed: fixes.some(f => f.startsWith('intent:')),
    hasIntentIssues: issues.some(i => i.layer === 'intent'),
    hasContentIssues: issues.some(i => i.layer === 'content'),
    hasLanguageIssues: issues.some(i => i.layer === 'language'),
  };

  // languageDriftHigh: SK→CZ replacement changed >50 characters
  // Signals upstream LLM regression or heavy contamination
  if (flags.languageFixed) {
    const langFix = fixes.find(f => f.startsWith('language:'));
    if (langFix) {
      const match = langFix.match(/(\d+) chars changed/);
      const charsChanged = match ? parseInt(match[1], 10) : 0;
      flags.languageDriftHigh = charsChanged > 50;
    }
  }

  return flags;
}

function computeSeverity(issues) {
  if (issues.some(i => i.type === 'zombie_detected' || i.type === 'sparse_content')) return 'HIGH';
  if (issues.some(i => i.layer === 'intent')) return 'MEDIUM';
  if (issues.length > 0) return 'LOW';
  return 'NONE';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the QualityGate v2 deterministic pipeline.
 *
 * @param {string} text — LLM output content
 * @param {Object} context
 * @param {string} [context.lang='cs'] — Target language
 * @param {string} [context.intent] — CRE intent (SEARCH, REPORT, FACTUAL, etc.)
 * @param {string} [context.searchSubType] — SEARCH sub-type (NEWS, SPEC, etc.)
 * @param {Array} [context.sourceUrls] — Pre-extracted source URLs [{ title, url }]
 * @returns {{ text: string, fixesApplied: string[], issuesDetected: Object[], qualityFlags: Object, severity: string, score: number, scoreRaw: number }}
 */
export function runQualityGateV2(text, context = {}) {
  if (!text || typeof text !== 'string') {
    return {
      text: text || '',
      fixesApplied: [],
      issuesDetected: [{ layer: 'content', type: 'empty_input' }],
      qualityFlags: {
        structuralFixed: false, languageFixed: false, intentFixed: false,
        hasIntentIssues: false, hasContentIssues: true, hasLanguageIssues: false,
      },
      severity: 'HIGH',
      score: 100,
      scoreRaw: 100,
    };
  }

  const fixes = [];
  const issues = [];

  // Layer 1: Structural Fix (JSON, whitespace, CJK)
  let result = structuralFix(text, fixes);

  // Layer 2: Language Fix (SK→CZ mechanical, flag EN/Cyrillic)
  result = languageFix(result, context, fixes, issues);

  // Layer 3: Intent Guarantees (LinkGuard, intent-specific flags)
  result = intentGuarantees(result, context, fixes, issues);

  // Layer 4: Content Enforcement (zombie/sparse detection — flag only)
  contentEnforcement(result, context, issues);

  return {
    text: result,
    fixesApplied: fixes,
    issuesDetected: issues,
    qualityFlags: computeFlags(fixes, issues),
    severity: computeSeverity(issues),
    score: computeScore(issues),
    scoreRaw: computeScoreRaw(fixes, issues),
  };
}

// Testing exports
export { structuralFix, languageFix, intentGuarantees, contentEnforcement };

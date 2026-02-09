// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Confidence Styling (A3)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Adds visual confidence indicators to responses based on data quality.
// Integrates with existing confidence-scaling.js (ConfidenceLevel, score).
//
// Three display modes:
//   1. Badge: Emoji + short label prepended to response
//   2. Footer: Confidence note appended at end
//   3. Inline: Natural hedging woven into response text
//
// Integration: call styleWithConfidence() in controller.js after synthesis,
//              BEFORE returning to user.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Confidence Level Constants ──────────────────────────────────────────────
// Mirror ConfidenceLevel from confidence-scaling.js for standalone use

export const Confidence = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNCERTAIN: 'UNCERTAIN',
};

// ─── Badge Definitions ───────────────────────────────────────────────────────

const BADGES = {
  cs: {
    HIGH:      { emoji: '✅', label: '' },              // No badge for high confidence
    MEDIUM:    { emoji: '📊', label: '' },              // No badge for medium (default)
    LOW:       { emoji: '⚠️', label: 'Omezené zdroje' },
    UNCERTAIN: { emoji: '❓', label: 'Nejisté — omezená data' },
  },
  en: {
    HIGH:      { emoji: '✅', label: '' },
    MEDIUM:    { emoji: '📊', label: '' },
    LOW:       { emoji: '⚠️', label: 'Limited sources' },
    UNCERTAIN: { emoji: '❓', label: 'Uncertain — limited data' },
  },
};

// ─── Footer Templates ────────────────────────────────────────────────────────

const FOOTERS = {
  cs: {
    HIGH:      '',
    MEDIUM:    '',
    LOW:       '\n\n---\n*⚠️ Odpověď je založena na omezeném počtu zdrojů. Ověřte si klíčové informace.*',
    UNCERTAIN: '\n\n---\n*❓ K tomuto tématu jsem našel jen velmi omezené informace. Doporučuji ověřit z dalších zdrojů.*',
  },
  en: {
    HIGH:      '',
    MEDIUM:    '',
    LOW:       '\n\n---\n*⚠️ This response is based on limited sources. Please verify key information.*',
    UNCERTAIN: '\n\n---\n*❓ I found very limited information on this topic. I recommend verifying from additional sources.*',
  },
};

// ─── Source Attribution ──────────────────────────────────────────────────────

/**
 * Build source attribution string from search results.
 * Shows top sources used in the answer.
 *
 * @param {Array<{url: string, title: string, trust?: string}>} sources
 * @param {string} lang
 * @param {number} maxSources - Max sources to show
 * @returns {string} Formatted source line (empty if no sources)
 */
export function formatSourceAttribution(sources, lang = 'cs', maxSources = 3) {
  if (!sources || sources.length === 0) return '';

  const filtered = sources
    .filter(s => s.url && s.title)
    .slice(0, maxSources);

  if (filtered.length === 0) return '';

  const label = lang === 'cs' ? 'Zdroje' : 'Sources';
  const sourceList = filtered.map(s => {
    const domain = extractDomain(s.url);
    return `[${s.title || domain}](${s.url})`;
  }).join(' · ');

  return `\n\n*${label}: ${sourceList}*`;
}

/**
 * Extract domain from URL.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url.substring(0, 30);
  }
}

// ─── Confidence-to-style mapping ─────────────────────────────────────────────

/**
 * Map numeric confidence score to level.
 * Aligns with existing confidence-scaling.js thresholds.
 *
 * @param {number} score - 0.0 to 1.0
 * @returns {string} Confidence level
 */
export function scoreToLevel(score) {
  if (score >= 0.75) return Confidence.HIGH;
  if (score >= 0.5) return Confidence.MEDIUM;
  if (score >= 0.25) return Confidence.LOW;
  return Confidence.UNCERTAIN;
}

/**
 * Get CSS class name for confidence level (for HTML/webUI rendering).
 *
 * @param {string} level - Confidence level
 * @returns {string} CSS class name
 */
export function confidenceCssClass(level) {
  const classes = {
    HIGH: 'confidence-high',
    MEDIUM: 'confidence-medium',
    LOW: 'confidence-low',
    UNCERTAIN: 'confidence-uncertain',
  };
  return classes[level] || 'confidence-medium';
}

/**
 * Get confidence indicator for terminal/plain text display.
 *
 * @param {string} level
 * @param {string} lang
 * @returns {{ emoji: string, label: string, cssClass: string }}
 */
export function getConfidenceIndicator(level, lang = 'cs') {
  const badges = BADGES[lang] || BADGES['en'];
  const badge = badges[level] || badges.MEDIUM;
  return {
    ...badge,
    cssClass: confidenceCssClass(level),
  };
}

// ─── Main styling function ───────────────────────────────────────────────────

/**
 * Apply confidence styling to a response.
 *
 * @param {string} response - The synthesized response text
 * @param {object} confidence - Confidence object from calculateAnswerConfidence()
 * @param {string} confidence.level - HIGH|MEDIUM|LOW|UNCERTAIN
 * @param {number} confidence.score - 0.0 to 1.0
 * @param {string[]} [confidence.factors] - Contributing factors
 * @param {object} [options]
 * @param {string} [options.lang='cs'] - Language
 * @param {string} [options.mode='footer'] - Display mode: 'badge'|'footer'|'both'|'none'
 * @param {Array} [options.sources] - Search result sources for attribution
 * @param {boolean} [options.showSources=true] - Whether to show source attribution
 * @returns {{ text: string, level: string, indicator: object, styled: boolean }}
 */
export function styleWithConfidence(response, confidence, options = {}) {
  const {
    lang = 'cs',
    mode = 'footer',
    sources = [],
    showSources = true,
  } = options;

  if (!response || !confidence) {
    return { text: response || '', level: 'MEDIUM', indicator: getConfidenceIndicator('MEDIUM', lang), styled: false };
  }

  const level = confidence.level || scoreToLevel(confidence.score || 0.5);
  const indicator = getConfidenceIndicator(level, lang);

  // HIGH and MEDIUM = no visual modification (clean response)
  if (level === Confidence.HIGH || level === Confidence.MEDIUM) {
    let text = response;

    // Still add source attribution for MEDIUM+ if sources available
    if (showSources && sources.length > 0 && level === Confidence.MEDIUM) {
      text += formatSourceAttribution(sources, lang);
    }

    return { text, level, indicator, styled: false };
  }

  // LOW and UNCERTAIN = add confidence indicators
  let text = response;
  const footers = FOOTERS[lang] || FOOTERS['en'];

  // Badge mode: prepend warning
  if (mode === 'badge' || mode === 'both') {
    if (indicator.label) {
      text = `${indicator.emoji} **${indicator.label}**\n\n${text}`;
    }
  }

  // Footer mode: append note
  if (mode === 'footer' || mode === 'both') {
    text += footers[level] || '';
  }

  // Source attribution
  if (showSources && sources.length > 0) {
    text += formatSourceAttribution(sources, lang);
  }

  return { text, level, indicator, styled: true };
}

// ─── CSS for webUI ───────────────────────────────────────────────────────────

/**
 * Get CSS styles for confidence indicators in webUI.
 * Include this in the chat UI stylesheet.
 *
 * @returns {string} CSS string
 */
export function getConfidenceCss() {
  return `
/* C3-Agent Confidence Indicators */
.confidence-high { }
.confidence-medium { }
.confidence-low {
  border-left: 3px solid #F59E0B;
  padding-left: 12px;
  margin-left: 4px;
}
.confidence-low::before {
  content: '⚠️';
  margin-right: 6px;
}
.confidence-uncertain {
  border-left: 3px solid #EF4444;
  padding-left: 12px;
  margin-left: 4px;
  opacity: 0.9;
}
.confidence-uncertain::before {
  content: '❓';
  margin-right: 6px;
}
.confidence-source-attribution {
  font-size: 0.85em;
  color: #64748B;
  border-top: 1px solid #E2E8F0;
  padding-top: 8px;
  margin-top: 12px;
}
`.trim();
}

export default {
  Confidence,
  scoreToLevel,
  confidenceCssClass,
  getConfidenceIndicator,
  formatSourceAttribution,
  styleWithConfidence,
  getConfidenceCss,
};

// CRE v45.0 KOLO 5.2 — Source Trust Weighting
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Classify sources: official | media | community | unknown
// - Affects ordering in synthesis (official first)
// - Affects certainty in formulation
//
// PURPOSE:
// Official source ≠ blog ≠ wiki mirror
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Source Trust Levels
// ─────────────────────────────────────────────────────────────────────────────

export const SourceTrust = {
  OFFICIAL: 'official',     // Government, company official pages, .gov, .edu
  MEDIA: 'media',           // Established news outlets, verified journalism
  COMMUNITY: 'community',   // Wikipedia, forums, blogs, user-generated
  UNKNOWN: 'unknown',       // Cannot determine, treat with caution
};

// Trust weights for synthesis prioritization
export const TRUST_WEIGHTS = {
  [SourceTrust.OFFICIAL]: 1.0,
  [SourceTrust.MEDIA]: 0.8,
  [SourceTrust.COMMUNITY]: 0.5,
  [SourceTrust.UNKNOWN]: 0.3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Domain Classification Patterns
// ─────────────────────────────────────────────────────────────────────────────

const OFFICIAL_DOMAINS = [
  // Government
  /\.gov$/i,
  /\.gov\.[a-z]{2}$/i,  // e.g., .gov.cz, .gov.uk
  /\.gob\.[a-z]{2}$/i,  // Spanish government
  /\.gouv\.[a-z]{2}$/i, // French government

  // Education
  /\.edu$/i,
  /\.edu\.[a-z]{2}$/i,
  /\.ac\.[a-z]{2}$/i,   // Academic (UK, etc.)

  // Czech official
  /mvcr\.cz$/i,
  /mfcr\.cz$/i,
  /cnb\.cz$/i,
  /cssz\.cz$/i,
  /czso\.cz$/i,
  /portal\.gov\.cz$/i,

  // International organizations
  /\.un\.org$/i,
  /\.who\.int$/i,
  /\.europa\.eu$/i,
  /\.worldbank\.org$/i,

  // Major companies (official sources for their products)
  /microsoft\.com$/i,
  /apple\.com$/i,
  /google\.com$/i,
  /github\.com$/i,
  /developer\./i,
  /docs\./i,
];

const MEDIA_DOMAINS = [
  // Czech media
  /idnes\.cz$/i,
  /ihned\.cz$/i,
  /novinky\.cz$/i,
  /seznam\.cz$/i,
  /aktualne\.cz$/i,
  /lidovky\.cz$/i,
  /respekt\.cz$/i,
  /irozhlas\.cz$/i,
  /ct24\.cz$/i,

  // International media
  /bbc\.com$/i,
  /bbc\.co\.uk$/i,
  /reuters\.com$/i,
  /apnews\.com$/i,
  /nytimes\.com$/i,
  /theguardian\.com$/i,
  /washingtonpost\.com$/i,
  /economist\.com$/i,

  // Tech media
  /techcrunch\.com$/i,
  /wired\.com$/i,
  /arstechnica\.com$/i,
  /theverge\.com$/i,
  /engadget\.com$/i,
];

const COMMUNITY_DOMAINS = [
  // Wikis
  /wikipedia\.org$/i,
  /wikimedia\.org$/i,
  /fandom\.com$/i,
  /wiki\./i,

  // Forums and Q&A
  /reddit\.com$/i,
  /stackexchange\.com$/i,
  /stackoverflow\.com$/i,
  /quora\.com$/i,

  // Blogs
  /medium\.com$/i,
  /substack\.com$/i,
  /wordpress\.com$/i,
  /blogspot\.com$/i,
  /tumblr\.com$/i,

  // Social
  /twitter\.com$/i,
  /x\.com$/i,
  /facebook\.com$/i,
  /linkedin\.com$/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// URL to Domain Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract domain from URL
 * @param {string} url - Full URL or domain
 * @returns {string} Domain name
 */
export function extractDomain(url) {
  if (!url) return '';

  try {
    // Handle both full URLs and bare domains
    let domain = url;

    if (url.includes('://')) {
      const urlObj = new URL(url);
      domain = urlObj.hostname;
    }

    // Remove www. prefix
    domain = domain.replace(/^www\./, '');

    return domain.toLowerCase();
  } catch {
    // If URL parsing fails, try to extract domain directly
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
    return match ? match[1].toLowerCase() : url.toLowerCase();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Trust Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify source trust level based on URL/domain
 * @param {string} source - URL or domain
 * @returns {Object} { trust: SourceTrust, weight: number, reasons: string[] }
 */
export function classifySourceTrust(source) {
  const domain = extractDomain(source);
  const reasons = [];

  if (!domain) {
    return {
      trust: SourceTrust.UNKNOWN,
      weight: TRUST_WEIGHTS[SourceTrust.UNKNOWN],
      reasons: ['no_domain'],
    };
  }

  // Check official domains
  for (const pattern of OFFICIAL_DOMAINS) {
    if (pattern.test(domain)) {
      reasons.push(`official_pattern: ${pattern.source}`);
      return {
        trust: SourceTrust.OFFICIAL,
        weight: TRUST_WEIGHTS[SourceTrust.OFFICIAL],
        reasons,
      };
    }
  }

  // Check media domains
  for (const pattern of MEDIA_DOMAINS) {
    if (pattern.test(domain)) {
      reasons.push(`media_pattern: ${pattern.source}`);
      return {
        trust: SourceTrust.MEDIA,
        weight: TRUST_WEIGHTS[SourceTrust.MEDIA],
        reasons,
      };
    }
  }

  // Check community domains
  for (const pattern of COMMUNITY_DOMAINS) {
    if (pattern.test(domain)) {
      reasons.push(`community_pattern: ${pattern.source}`);
      return {
        trust: SourceTrust.COMMUNITY,
        weight: TRUST_WEIGHTS[SourceTrust.COMMUNITY],
        reasons,
      };
    }
  }

  // Default to unknown
  reasons.push('unclassified_domain');
  return {
    trust: SourceTrust.UNKNOWN,
    weight: TRUST_WEIGHTS[SourceTrust.UNKNOWN],
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Annotate Tool Results with Trust
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Annotate tool results with source trust information
 * @param {Array} toolResults - Array of tool results
 * @returns {Array} Annotated results with _sourceTrust field
 */
export function annotateWithTrust(toolResults) {
  return toolResults.map(result => {
    const source = result.source || result.url || '';
    const trustInfo = classifySourceTrust(source);

    return {
      ...result,
      _sourceTrust: trustInfo,
    };
  });
}

/**
 * Sort tool results by trust level (official first)
 * @param {Array} annotatedResults - Results with _sourceTrust
 * @returns {Array} Sorted results
 */
export function sortByTrust(annotatedResults) {
  return [...annotatedResults].sort((a, b) => {
    const trustA = a._sourceTrust?.weight || 0;
    const trustB = b._sourceTrust?.weight || 0;
    return trustB - trustA;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trust-Based Synthesis Instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate synthesis instructions based on source trust
 * @param {Array} annotatedResults - Results with _sourceTrust
 * @returns {string} Instructions for synthesis prompt
 */
export function getTrustSynthesisInstructions(annotatedResults) {
  const trustCounts = {
    [SourceTrust.OFFICIAL]: 0,
    [SourceTrust.MEDIA]: 0,
    [SourceTrust.COMMUNITY]: 0,
    [SourceTrust.UNKNOWN]: 0,
  };

  for (const result of annotatedResults) {
    const trust = result._sourceTrust?.trust || SourceTrust.UNKNOWN;
    trustCounts[trust]++;
  }

  const instructions = [];

  // Priority guidance
  if (trustCounts[SourceTrust.OFFICIAL] > 0) {
    instructions.push(`OFICIÁLNÍ ZDROJE (${trustCounts[SourceTrust.OFFICIAL]}): Prioritizuj tyto informace.`);
  }

  if (trustCounts[SourceTrust.MEDIA] > 0) {
    instructions.push(`MEDIÁLNÍ ZDROJE (${trustCounts[SourceTrust.MEDIA]}): Použij pro kontext a aktuálnost.`);
  }

  if (trustCounts[SourceTrust.COMMUNITY] > 0) {
    instructions.push(`KOMUNITNÍ ZDROJE (${trustCounts[SourceTrust.COMMUNITY]}): Ověř informace, mohou být nepřesné.`);
  }

  // Confidence guidance based on trust mix
  const hasOfficial = trustCounts[SourceTrust.OFFICIAL] > 0;
  const onlyUnknown = trustCounts[SourceTrust.UNKNOWN] === annotatedResults.length;

  if (onlyUnknown) {
    instructions.push('UPOZORNĚNÍ: Všechny zdroje jsou neověřené. Formuluj velmi opatrně.');
  } else if (!hasOfficial && trustCounts[SourceTrust.COMMUNITY] > trustCounts[SourceTrust.MEDIA]) {
    instructions.push('UPOZORNĚNÍ: Převažují komunitní zdroje. Zvaž přidat \"podle dostupných zdrojů\".');
  }

  return instructions.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Relevance + Trust Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate combined quality score (relevance * trust weight)
 * @param {Object} result - Tool result with _relevance and _sourceTrust
 * @returns {number} Combined score
 */
export function getCombinedQualityScore(result) {
  const relevanceScore = result._relevance?.score || 0.5;
  const trustWeight = result._sourceTrust?.weight || 0.5;

  // Weighted combination: 70% relevance, 30% trust
  return relevanceScore * 0.7 + trustWeight * 0.3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  SourceTrust,
  TRUST_WEIGHTS,
  extractDomain,
  classifySourceTrust,
  annotateWithTrust,
  sortByTrust,
  getTrustSynthesisInstructions,
  getCombinedQualityScore,
};

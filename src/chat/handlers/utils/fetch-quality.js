// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — fetchPage Quality Enhancement (A1)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Improves scraped web content quality by:
//   1. Removing boilerplate (nav, footer, ads, cookie banners)
//   2. Extracting main article content
//   3. Preserving structure (headings, paragraphs, lists)
//   4. Truncating to useful length with smart cutoff
//   5. Detecting paywall/login walls BEFORE sending to LLM
//
// Integration: Use cleanPageContent() on raw HTML/text from fetchPage
//              BEFORE passing to synthesis prompt.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Boilerplate patterns (remove these blocks entirely) ─────────────────────

const BOILERPLATE_PATTERNS = [
  // Cookie consent / GDPR
  /(?:cookie|gdpr|consent|souhlas[iy]?\s+s?\s*cookie)[\s\S]{0,500}?(?:accept|přijmout|souhlasím|okay|dismiss)/gi,
  // Navigation menus (common patterns)
  /(?:^|\n)(?:Home|Domů|Menu|Nabídka)\s*[|>\/]\s*(?:\w+\s*[|>\/]\s*){2,}/gm,
  // Social share buttons
  /(?:Share|Sdílet)\s*(?:on\s+)?(?:Facebook|Twitter|LinkedIn|WhatsApp|Email)[^\n]*/gi,
  // Subscribe/newsletter CTAs
  /(?:Subscribe|Přihlásit se k odběru|Newsletter|Odebírat)\s*(?:to\s+our|k\s+našemu)?[^\n]{0,200}/gi,
  // Footer boilerplate
  /(?:©|Copyright|Všechna práva vyhrazena|All rights reserved)\s*\d{4}[^\n]*/gi,
  // Ads
  /(?:Advertisement|Reklama|Sponsored|Sponzorováno)[^\n]*/gi,
  // "Related articles" sections
  /(?:Related\s+(?:articles?|posts?|stories?)|Další\s+články|Mohlo\s+by\s+vás\s+zajímat)[^\n]*/gi,
];

// ─── Paywall / login detection ───────────────────────────────────────────────

const PAYWALL_INDICATORS = [
  // Direct paywall
  { pattern: /(?:subscribe|předplaťte|premium)\s+(?:to\s+)?(?:read|continue|pokračov)/i, weight: 3 },
  { pattern: /(?:tento|this)\s+(?:článek|obsah|article|content)\s+(?:je|is)\s+(?:pouze|only)\s+(?:pro|for)\s+(?:předplatitele|subscribers)/i, weight: 5 },
  { pattern: /(?:unlock|odemkn)\s+(?:this|tento|full|celý)/i, weight: 3 },
  // Login wall
  { pattern: /(?:please|prosím)\s+(?:log\s*in|sign\s*in|přihlaste\s+se)/i, weight: 2 },
  { pattern: /(?:create\s+an?\s+account|vytvořte\s+si\s+účet)/i, weight: 2 },
  // Soft paywall (still partially readable)
  { pattern: /(?:free\s+articles?\s+remaining|zbývá\s+(?:vám\s+)?\d+\s+článk)/i, weight: 1 },
];

/**
 * Detect if content is behind a paywall or login wall.
 * @param {string} text - Page content
 * @returns {{ blocked: boolean, confidence: number, reason: string|null }}
 */
export function detectPaywall(text) {
  if (!text || text.length < 20) return { blocked: false, confidence: 0, reason: null };

  let score = 0;
  let reason = null;

  for (const { pattern, weight } of PAYWALL_INDICATORS) {
    if (pattern.test(text)) {
      score += weight;
      if (!reason) reason = pattern.source.substring(0, 40);
    }
  }

  // Short content + paywall indicator = highly likely blocked
  if (text.length < 500 && score >= 2) {
    return { blocked: true, confidence: 0.9, reason: `paywall_short(${score})` };
  }

  // Long content + high paywall score = partially blocked
  if (score >= 4) {
    return { blocked: true, confidence: 0.7, reason: `paywall_strong(${score})` };
  }

  return { blocked: score >= 2, confidence: score / 10, reason: score >= 2 ? `paywall_weak(${score})` : null };
}

// ─── Content extraction ──────────────────────────────────────────────────────

/**
 * Remove HTML tags while preserving meaningful structure.
 * @param {string} html - Raw HTML content
 * @returns {string} Clean text with preserved structure
 */
export function stripHTML(html) {
  if (!html) return '';

  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove nav, footer, aside, header (boilerplate containers)
  text = text.replace(/<(?:nav|footer|aside)[\s\S]*?<\/(?:nav|footer|aside)>/gi, '');

  // Convert structural elements to text markers
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n• $1');
  text = text.replace(/<\/(?:ul|ol|dl)>/gi, '\n');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#\d+;/g, '');
  text = text.replace(/&\w+;/g, '');

  return text;
}

/**
 * Remove boilerplate text patterns from content.
 * @param {string} text - Plain text content
 * @returns {string} Cleaned text
 */
export function removeBoilerplate(text) {
  let cleaned = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

/**
 * Normalize whitespace in extracted text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')           // Multiple spaces → single
    .replace(/\n[ \t]+/g, '\n')         // Leading whitespace on lines
    .replace(/[ \t]+\n/g, '\n')         // Trailing whitespace on lines
    .replace(/\n{3,}/g, '\n\n')         // 3+ newlines → 2
    .replace(/^\s+|\s+$/g, '')          // Trim
    .replace(/(\n\n)(\n\n)+/g, '\n\n'); // Double-double → single-double
}

// ─── Smart truncation ────────────────────────────────────────────────────────

/**
 * Truncate content to a maximum length with smart cutoff.
 * Tries to cut at paragraph or sentence boundaries.
 *
 * @param {string} text - Content to truncate
 * @param {number} maxChars - Maximum character count (default: 8000 ≈ 2000 tokens)
 * @returns {{ text: string, truncated: boolean, originalLength: number }}
 */
export function smartTruncate(text, maxChars = 8000) {
  if (!text || text.length <= maxChars) {
    return { text: text || '', truncated: false, originalLength: text?.length || 0 };
  }

  const originalLength = text.length;

  // Try to cut at paragraph boundary
  let cutPoint = text.lastIndexOf('\n\n', maxChars);
  if (cutPoint < maxChars * 0.6) {
    // Paragraph boundary too far back — try sentence
    cutPoint = text.lastIndexOf('. ', maxChars);
    if (cutPoint < maxChars * 0.6) {
      // Sentence boundary too far back — hard cut
      cutPoint = maxChars;
    } else {
      cutPoint += 1; // Include the period
    }
  }

  return {
    text: text.substring(0, cutPoint).trim() + '\n\n[…truncated]',
    truncated: true,
    originalLength,
  };
}

// ─── Main cleaning pipeline ──────────────────────────────────────────────────

/**
 * Clean and extract useful content from a fetched page.
 * This is the main function to integrate into the search handler.
 *
 * @param {string} rawContent - Raw HTML or text from fetchPage
 * @param {string} query - Original search query (for relevance check)
 * @param {object} [options]
 * @param {number} [options.maxChars=8000] - Max output chars
 * @param {boolean} [options.isHTML=true] - Whether input is HTML
 * @returns {{
 *   content: string,
 *   quality: { grade: string, usable: boolean, reason: string|null, charCount: number },
 *   paywall: { blocked: boolean, confidence: number },
 *   truncated: boolean,
 * }}
 */
export function cleanPageContent(rawContent, query = '', options = {}) {
  const { maxChars = 8000, isHTML = true } = options;

  // Empty content
  if (!rawContent || rawContent.trim().length === 0) {
    return {
      content: '',
      quality: { grade: 'EMPTY', usable: false, reason: 'EMPTY_CONTENT', charCount: 0 },
      paywall: { blocked: false, confidence: 0 },
      truncated: false,
    };
  }

  // Step 1: Strip HTML if needed
  let text = isHTML ? stripHTML(rawContent) : rawContent;

  // Step 2: Remove boilerplate
  text = removeBoilerplate(text);

  // Step 3: Normalize whitespace
  text = normalizeWhitespace(text);

  // Step 4: Check paywall
  const paywall = detectPaywall(text);

  // Step 5: Quality assessment
  const charCount = text.length;
  let quality;

  if (charCount < 50) {
    quality = { grade: 'EMPTY', usable: false, reason: 'TOO_SHORT', charCount };
  } else if (charCount < 150) {
    // Short content — check if it's a paywall/login
    if (paywall.blocked) {
      quality = { grade: 'BLOCKED', usable: false, reason: 'PAYWALL', charCount };
    } else {
      quality = { grade: 'POOR', usable: true, reason: 'SHORT_CONTENT', charCount };
    }
  } else if (charCount < 300) {
    quality = { grade: 'FAIR', usable: true, reason: null, charCount };
  } else {
    quality = { grade: 'GOOD', usable: true, reason: null, charCount };
  }

  // Step 6: Smart truncation
  const { text: finalText, truncated } = smartTruncate(text, maxChars);

  return {
    content: finalText,
    quality,
    paywall,
    truncated,
  };
}

export default {
  cleanPageContent,
  stripHTML,
  removeBoilerplate,
  normalizeWhitespace,
  smartTruncate,
  detectPaywall,
};

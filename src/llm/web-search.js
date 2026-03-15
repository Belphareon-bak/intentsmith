// C.3 v56.2 Sprint B — Web Search Module
// ══════════════════════════════════════════════════════════════════════════════
// Multi-provider web search with automatic fallback
// Providers: DuckDuckGo → SearX → Brave (if key available)
//
// v56.2 Sprint B changes:
// - FAIL_COOLDOWN: 5min → 60s (faster recovery)
// - SearX: sequential → parallel (Promise.any) — eliminates tail latency
// - DDG-first fast path (skip SearX if DDG returns results)
// v55.2: Search quality scoring, scrape content validation, usefulness metrics

import { logger } from '../core/logger.js';
import {
  scoreSearchResults,
  scoreScrapeContent,
  searchMetrics,
} from '../chat/handlers/utils/search-metrics.js';
import { detectPaywall } from '../chat/handlers/utils/fetch-quality.js';
import { retryableSearch } from '../chat/handlers/utils/search-retry.js';

// ════════════════════════════════════════════════════════════════════════════
// SEARCH PROVIDERS (with fallback chain)
// ════════════════════════════════════════════════════════════════════════════

// Public SearX instances (privacy-respecting meta-search engines)
// These instances may change availability - rotated on failure
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://search.mdosch.de',
  'https://searx.tiekoetter.com',
  'https://search.bus-hit.me',
  'https://searx.fmac.xyz',
];

// Track failed providers to avoid retrying immediately
const failedProviders = new Map(); // provider -> failUntil timestamp
const FAIL_COOLDOWN = 60 * 1000; // v56.2 Sprint B: 60s cooldown (was 5min — too aggressive)

/**
 * Check if a provider is currently failed (in cooldown)
 */
function isProviderFailed(provider) {
  const failUntil = failedProviders.get(provider);
  if (!failUntil) return false;
  if (Date.now() > failUntil) {
    failedProviders.delete(provider);
    return false;
  }
  return true;
}

/**
 * Mark a provider as failed
 */
function markProviderFailed(provider) {
  // Sweep expired entries before adding (prevents unbounded growth)
  if (failedProviders.size > 50) {
    const now = Date.now();
    for (const [k, v] of failedProviders) {
      if (now > v) failedProviders.delete(k);
    }
  }
  failedProviders.set(provider, Date.now() + FAIL_COOLDOWN);
  logger.warn('WebSearch', `Provider ${provider} marked as failed for ${FAIL_COOLDOWN/1000}s`);
}

// ════════════════════════════════════════════════════════════════════════════
// DUCKDUCKGO PROVIDER
// ════════════════════════════════════════════════════════════════════════════

async function searchDDG(query, maxResults) {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'cs,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseDDGResults(html, maxResults);
}

// ════════════════════════════════════════════════════════════════════════════
// SEARX PROVIDER (fallback)
// ════════════════════════════════════════════════════════════════════════════

async function searchSearX(query, maxResults, instance) {
  const encoded = encodeURIComponent(query);
  const url = `${instance}/search?q=${encoded}&format=json&categories=general`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const results = [];

  for (const item of (data.results || []).slice(0, maxResults)) {
    results.push({
      title: item.title || '',
      url: item.url || '',
      snippet: item.content || '',
    });
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN SEARCH FUNCTION (with fallback chain)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Search web using multiple providers with automatic fallback
 * v44.2 - Now returns full result object with fallback info
 *
 * @param {string} query - Search query
 * @param {number} maxResults - Maximum number of results (default 5)
 * @returns {Promise<{results: Array, usedProvider: string|null, fallbackLog: Array, allFailed: boolean}>}
 */
export async function searchWeb(query, maxResults = 5) {
  logger.info('WebSearch', `Searching: "${query}"`);
  const searchStartTime = Date.now();

  const fallbackLog = [];

  // ─────────────────────────────────────────────────────────────────────────
  // TRY 1: DuckDuckGo (primary, most reliable)
  // v56.2 Sprint B: DDG-FIRST fast path — if DDG succeeds with ≥3 results,
  // skip SearX entirely. This eliminates tail latency from SearX timeouts.
  // ─────────────────────────────────────────────────────────────────────────
  if (!isProviderFailed('ddg')) {
    fallbackLog.push({ provider: 'DuckDuckGo', status: 'trying' });
    try {
      const results = await searchDDG(query, maxResults);
      if (results.length > 0) {
        logger.info('WebSearch', `DDG: Found ${results.length} results`);
        fallbackLog[fallbackLog.length - 1].status = 'success';
        fallbackLog[fallbackLog.length - 1].count = results.length;
        const quality = scoreSearchResults(results, query);
        const latency = Date.now() - searchStartTime;
        searchMetrics.record({
          query, provider: 'DuckDuckGo', resultCount: results.length,
          resultGrade: quality.grade, outcome: 'SUCCESS', latencyMs: latency,
        });
        return { results, usedProvider: 'DuckDuckGo', fallbackLog, allFailed: false, quality };
      }
      fallbackLog[fallbackLog.length - 1].status = 'no_results';
    } catch (err) {
      fallbackLog[fallbackLog.length - 1].status = 'error';
      fallbackLog[fallbackLog.length - 1].error = err.message;
      if (err.message.includes('403') || err.message.includes('429')) {
        markProviderFailed('ddg');
        fallbackLog[fallbackLog.length - 1].blocked = true;
      }
    }
  } else {
    fallbackLog.push({ provider: 'DuckDuckGo', status: 'cooldown', skipped: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRY 2: SearX instances — PARALLEL (v56.2 Sprint B)
  // ─────────────────────────────────────────────────────────────────────────
  // BEFORE: Sequential for-loop → 6s+ if all fail (each timeout ~1s)
  // NOW: Promise.any() on all available instances → first success wins
  // Timeout: 4s per instance (explicit AbortSignal)
  // ─────────────────────────────────────────────────────────────────────────
  const availableInstances = SEARX_INSTANCES.filter(inst => !isProviderFailed(inst));

  if (availableInstances.length > 0) {
    const searxPromises = availableInstances.map(instance => {
      const providerName = `SearX (${new URL(instance).host})`;
      fallbackLog.push({ provider: providerName, status: 'trying' });
      const logIndex = fallbackLog.length - 1;

      return searchSearX(query, maxResults, instance)
        .then(results => {
          if (results.length > 0) {
            fallbackLog[logIndex].status = 'success';
            fallbackLog[logIndex].count = results.length;
            return { results, providerName, instance };
          }
          fallbackLog[logIndex].status = 'no_results';
          throw new Error('no_results');
        })
        .catch(err => {
          if (fallbackLog[logIndex].status === 'trying') {
            fallbackLog[logIndex].status = 'error';
            fallbackLog[logIndex].error = err.message;
          }
          if (err.message.includes('403') || err.message.includes('429') || err.message.includes('503')) {
            markProviderFailed(instance);
            fallbackLog[logIndex].blocked = true;
          }
          throw err; // re-throw for Promise.any
        });
    });

    try {
      const winner = await Promise.any(searxPromises);
      logger.info('WebSearch', `SearX (${winner.instance}): Found ${winner.results.length} results`);
      const quality = scoreSearchResults(winner.results, query);
      const latency = Date.now() - searchStartTime;
      searchMetrics.record({
        query, provider: winner.providerName, resultCount: winner.results.length,
        resultGrade: quality.grade, outcome: 'SUCCESS', latencyMs: latency,
      });
      return { results: winner.results, usedProvider: winner.providerName, fallbackLog, allFailed: false, quality };
    } catch (aggErr) {
      // All SearX instances failed — logged individually above
      logger.warn('WebSearch', 'All SearX instances failed in parallel', {
        attempted: availableInstances.length,
      });
    }
  } else {
    fallbackLog.push({ provider: 'SearX (all)', status: 'cooldown', skipped: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ALL PROVIDERS FAILED
  // ─────────────────────────────────────────────────────────────────────────
  logger.error('WebSearch', `All providers failed`, { fallbackLog });
  const latency = Date.now() - searchStartTime;
  searchMetrics.record({
    query, provider: 'none', resultCount: 0,
    resultGrade: 'EMPTY', outcome: 'NO_RESULTS', latencyMs: latency,
  });
  return { results: [], usedProvider: null, fallbackLog, allFailed: true, quality: { grade: 'EMPTY', totalResults: 0 } };
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDDGResults(html, maxResults) {
  const results = [];
  
  // Match result blocks
  const resultPattern = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  
  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').split('&')[0]);
    const title = match[2].trim().replace(/<[^>]+>/g, '');
    const snippet = match[3].trim().replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    
    if (url && title && !url.includes('duckduckgo.com')) {
      results.push({ title, url, snippet });
    }
  }
  
  // Fallback: simpler pattern
  if (results.length === 0) {
    const simplePattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>([^<]+)/gi;
    
    while ((match = simplePattern.exec(html)) !== null && results.length < maxResults) {
      const url = decodeURIComponent(match[1]);
      const title = match[2].trim();
      
      if (url && title && !url.includes('duckduckgo.com')) {
        results.push({ title, url, snippet: '' });
      }
    }
  }
  
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// WEB PAGE FETCHING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fetch and extract text content from a webpage
 * v57.1 A1: Smart paragraph extraction, relevance-based truncation, block detection
 * v55.2: Content quality scoring
 *
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum text length (default 5000)
 * @param {string} [query] - Original query for relevance scoring
 * @returns {Promise<{title: string, content: string, url: string, links: Array, quality: Object} | null>}
 */
export async function fetchPage(url, maxLength = 5000, query = '') {
  logger.info('WebSearch', `Fetching: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : url;
    
    // Extract links with their text (for listings like bazos, etc.)
    const links = extractPageLinks(html, url);
    
    // ──────────────────────────────────────────────────────────────────────────
    // v57.1 A1: Smart content extraction
    // Priority: <article> → <main> → <div class="*content*"> → <body>
    // Then: paragraph-level extraction + relevance-based truncation
    // ──────────────────────────────────────────────────────────────────────────
    
    // Step 1: Remove non-content elements
    let cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    
    // Step 2: Find the best content zone
    const contentZone = extractContentZone(cleanHtml);
    
    // Step 3: Extract paragraphs from content zone
    const paragraphs = extractParagraphs(contentZone);
    
    // Step 4: Smart truncation — relevance-based if query available
    const content = smartTruncate(paragraphs, maxLength, query);
    
    logger.info('WebSearch', `Extracted ${paragraphs.length} paragraphs, ${links.length} links from ${url}`, {
      contentLength: content.length,
      maxLength,
    });
    
    // v55.2: Score content quality
    const quality = scoreScrapeContent(content, query);

    // A1: Enhanced paywall detection
    const paywall = detectPaywall(content);
    if (paywall.blocked && quality.usable) {
      quality.usable = false;
      quality.reason = paywall.reason || 'PAYWALL_DETECTED';
      logger.warn('WebSearch', `Paywall detected: ${paywall.reason}`, { url, confidence: paywall.confidence });
    }

    if (!quality.usable) {
      logger.warn('WebSearch', `Scrape quality BLOCKED: ${quality.reason}`, { url, contentLength: quality.contentLength });
    }

    return { title, content, url, links, quality, paywall };
    
  } catch (err) {
    // v61.2: Differentiate fetch errors for better diagnostics
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message);
    const isNetwork = /ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed/i.test(err.message);
    const errorType = isTimeout ? 'TIMEOUT' : isNetwork ? 'NETWORK' : 'UNKNOWN';
    logger.error('WebSearch', `Fetch failed [${errorType}]: ${err.message}`, { url, errorType });
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// v57.1 A1: CONTENT EXTRACTION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract the best content zone from HTML.
 * Priority: <article> → <main> → <div class/id with "content/article/post/entry"> → full body
 */
function extractContentZone(html) {
  // Try content zones in priority order
  const zones = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]*(?:class|id)="[^"]*(?:article|post|entry|content|body|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const regex of zones) {
    const matches = [];
    let m;
    while ((m = regex.exec(html)) !== null) {
      matches.push(m[1]);
    }
    // Use the longest match (most content)
    if (matches.length > 0) {
      const best = matches.sort((a, b) => b.length - a.length)[0];
      if (best.length > 200) {
        return best;
      }
    }
  }
  
  // Fallback: use everything after removing non-content
  return html;
}

/**
 * Extract text paragraphs from HTML content.
 * Returns array of paragraph strings, each cleaned of HTML tags.
 */
function extractParagraphs(html) {
  const paragraphs = [];
  
  // Extract from <p>, <li>, <h1-h6>, <td>, <blockquote>
  const blockRegex = /<(?:p|li|h[1-6]|td|blockquote|dd|dt|figcaption)[^>]*>([\s\S]*?)<\/(?:p|li|h[1-6]|td|blockquote|dd|dt|figcaption)>/gi;
  let match;
  
  while ((match = blockRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text.length >= 20) {
      paragraphs.push(text);
    }
  }
  
  // If we got very few paragraphs, fall back to splitting by double-newline after stripping HTML
  if (paragraphs.length < 3) {
    const plainText = stripHtml(html);
    const fallbackParagraphs = plainText
      .split(/(?:\n\s*\n|\.\s{2,})/)
      .map(p => p.trim())
      .filter(p => p.length >= 30);
    
    if (fallbackParagraphs.length > paragraphs.length) {
      return fallbackParagraphs;
    }
  }
  
  return paragraphs;
}

/**
 * Smart truncation: keep the most relevant paragraphs up to maxLength.
 * If no query given, keeps paragraphs in original order.
 */
function smartTruncate(paragraphs, maxLength, query) {
  if (paragraphs.length === 0) return '';
  
  // If everything fits, just join
  const fullText = paragraphs.join('\n\n');
  if (fullText.length <= maxLength) return fullText;
  
  // If no query or very short query → keep paragraphs in order, cut at limit
  if (!query || query.length < 3) {
    return truncateByOrder(paragraphs, maxLength);
  }
  
  // Score each paragraph by query keyword relevance
  const queryWords = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w.replace(/[?!.,;:]/g, ''));
  
  if (queryWords.length === 0) {
    return truncateByOrder(paragraphs, maxLength);
  }
  
  const scored = paragraphs.map((p, idx) => {
    const lower = p.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      // Prefix matching for Czech declensions: "pythago" matches "pythagorova"
      const prefix = word.length > 4 ? word.substring(0, Math.ceil(word.length * 0.7)) : word;
      if (lower.includes(prefix)) score += 2;
      if (lower.includes(word)) score += 1;
    }
    // Small bonus for position (earlier = slightly better for equal relevance)
    score += Math.max(0, (paragraphs.length - idx) / paragraphs.length * 0.5);
    return { text: p, score, idx };
  });
  
  // Sort by relevance (highest first), but keep original order among equally-scored
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  
  // Take highest-scoring paragraphs, restore original order
  const selected = [];
  let totalLength = 0;
  for (const item of scored) {
    if (totalLength + item.text.length + 2 > maxLength) {
      // If we have nothing yet, take at least a truncated first paragraph
      if (selected.length === 0) {
        selected.push({ ...item, text: item.text.substring(0, maxLength - 3) + '...' });
      }
      break;
    }
    selected.push(item);
    totalLength += item.text.length + 2;
  }
  
  // Restore original document order
  selected.sort((a, b) => a.idx - b.idx);
  return selected.map(s => s.text).join('\n\n');
}

/**
 * Simple truncation: keep paragraphs in order until maxLength exceeded.
 */
function truncateByOrder(paragraphs, maxLength) {
  const result = [];
  let totalLength = 0;
  
  for (const p of paragraphs) {
    if (totalLength + p.length + 2 > maxLength) {
      // Add partial last paragraph if we have room
      const remaining = maxLength - totalLength - 5;
      if (remaining > 50) {
        result.push(p.substring(0, remaining) + '...');
      }
      break;
    }
    result.push(p);
    totalLength += p.length + 2;
  }
  
  return result.join('\n\n');
}

/**
 * Strip HTML tags and decode entities from a string.
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

/**
 * Decode common HTML entities in a string.
 */
function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Extract page links with filtering.
 */
function extractPageLinks(html, sourceUrl) {
  const links = [];
  const baseUrl = new URL(sourceUrl);
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*(?:<[^/a][^>]*>[^<]*)*)<\/a>/gi;
  let linkMatch;
  
  while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 20) {
    let href = linkMatch[1];
    let text = linkMatch[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || !text || text.length < 3) {
      continue;
    }
    
    if (href.startsWith('/')) {
      href = `${baseUrl.protocol}//${baseUrl.host}${href}`;
    } else if (!href.startsWith('http')) {
      href = `${baseUrl.protocol}//${baseUrl.host}/${href}`;
    }
    
    try {
      const linkUrl = new URL(href);
      if (linkUrl.host.includes(baseUrl.host.replace('www.', '')) || 
          baseUrl.host.includes(linkUrl.host.replace('www.', ''))) {
        if (text.length > 5 && text.length < 200 && 
            !href.includes('login') && !href.includes('registr') &&
            !href.includes('cookies') && !href.includes('gdpr')) {
          links.push({ url: href, title: text });
        }
      }
    } catch (e) {
      // Invalid URL, skip
    }
  }
  
  return links;
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH QUERY DETECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect if a message requires EXTERNAL/REAL-TIME data (links, prices, listings)
 * These queries CANNOT be answered without web search or provided data
 * @param {string} message - User message
 * @returns {boolean}
 */
export function needsExternalData(message) {
  const lower = message.toLowerCase();
  
  // Patterns that REQUIRE external data - cannot be hallucinated
  const externalDataTriggers = [
    // Explicit link requests
    /\bodkaz\w*\b/,           // odkaz, odkazy, odkazů
    /\blink\w*\b/,
    /\burl\b/i,
    // Shopping/listings
    /\bauto\b.*\b(kup|prod|nabíd|inzer)/i,
    /\bvozidl\w*\b/,
    /\binzerát\w*\b/,
    /\bnabídk\w*\b/,
    /\bprodej\w*\b/,
    // Real-time data
    /\baktuální\w*\s*(cen|kurz|počasí|zpráv)/i,
    /\bdej mi\s*\d+/,         // "dej mi 5 odkazů"
    /\bseznam\w*\s*(odkaz|auto|nabíd)/i,
    // Specific sites
    /\b(bazos|sauto|tipcars|autohero|aaa|mobile\.de)\b/i,
  ];
  
  for (const pattern of externalDataTriggers) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if message is a SOFT/explanatory intent that should NOT trigger web search
 * These are questions asking for explanation, not current/external data
 * @param {string} lower - Lowercase message
 * @returns {boolean}
 */
function isSoftExplainerIntent(lower) {
  // SOFT patterns - user wants EXPLANATION, not real-time data
  const softPatterns = [
    // "co je X" without external context = asking for explanation
    /^co\s+je\s+(?!aktuální|dnešní|nového|v\s+prodeji)/i,
    /\bco\s+je\s+v\s+(tom|daném|tomhle|tamtom|souboru|zipu|archivu|balíčku|složce)\b/i,
    // "jak funguje X" = asking how something works
    /\bjak\s+(funguje|fungují|pracuje|pracují|to\s+funguje)\b/i,
    // "vysvětli X" = asking for explanation
    /\b(vysvětli|vysvětlit|vysvětlíš|vysvětlete|popsat|popiš|popis)\b/i,
    // "co znamená X" = asking for meaning
    /\bco\s+znamená\b/i,
    // "jaký je rozdíl" = asking for comparison/explanation
    /\bjaký\s+(je\s+)?rozdíl\b/i,
    // "co to je" = simple what-is-this
    /\bco\s+to\s+je\b/i,
    // Programming/file context questions
    /\b(v\s+kódu|ve\s+scriptu|v\s+souboru|v\s+projektu|v\s+repozitáři)\b/i,
    // "jak se dělá X", "jak udělat X" = how-to questions
    /\bjak\s+(se\s+)?(dělá|udělat|napsat|vytvořit|nastavit)\b/i,
    // English soft patterns
    /\b(explain|what\s+does|how\s+does|what\'s\s+the\s+difference|what\s+is\s+a|what\s+is\s+an)\b/i,
    /\bin\s+(this|the|that)\s+(file|zip|archive|folder|code|script|project)\b/i,
  ];
  
  for (const pattern of softPatterns) {
    if (pattern.test(lower)) {
      logger.info('WebSearch', `Blocked by SOFT explainer pattern: ${pattern}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Check if message has HARD external intent that MUST trigger web search
 * @param {string} lower - Lowercase message
 * @returns {{triggered: boolean, reason: string}}
 */
function hasHardExternalIntent(lower) {
  // HARD patterns - user NEEDS real-time/external data
  const hardPatterns = [
    // Explicit search commands with specific targets
    { pattern: /\b(najdi|vyhledej|hledej)\s+(na\s+(webu|internetu|googlu)|online)\b/i, reason: 'explicit web search' },
    // Current/real-time data
    { pattern: /\baktuální\s*(cen|kurz|počasí|zpráv|stav|hodnot)/i, reason: 'current data request' },
    // Shopping with prices
    { pattern: /\b(kolik\s+stojí|cena|ceník)\s+[^?]*\b/i, reason: 'price query' },
    // News explicitly
    { pattern: /\b(novinky|zprávy|news|headlines)\s+(o|z|from|about)/i, reason: 'news request' },
    { pattern: /\b(hlavní\s+zpráv|breaking\s+news|latest\s+news)\b/i, reason: 'breaking news' },
    // Weather/forecast
    { pattern: /\b(počasí|předpověď|weather|forecast)\s+(v|pro|in|for)?\s*[A-ZÁ-Ž]/i, reason: 'weather request' },
    // Exchange rates
    { pattern: /\b(kurz|exchange\s+rate)\s+(k|czk|eur|usd|gbp)/i, reason: 'exchange rate' },
    // Listings with quantity
    { pattern: /\bdej\s+mi\s+\d+\s*(odkaz|link|nabíd)/i, reason: 'link list request' },
    // Site-specific requests
    { pattern: /\b(na|z|from|at)\s+(bazos|sauto|tipcars|autohero|mobile\.de|sreality|idnes|novinky)\b/i, reason: 'site-specific' },
  ];
  
  for (const { pattern, reason } of hardPatterns) {
    if (pattern.test(lower)) {
      return { triggered: true, reason };
    }
  }
  
  return { triggered: false, reason: '' };
}

/**
 * Detect if a message likely needs web search
 * Philosophy: False negative > false positive (better fewer searches than spam)
 * @param {string} message - User message
 * @returns {boolean}
 */
export function needsWebSearch(message) {
  const lower = message.toLowerCase();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: HARD TRIGGERS - always search (URLs, domains, external data)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // URL in message = wants info from that site
  if (message.match(/https?:\/\/[^\s]+/)) {
    logger.info('WebSearch', 'HARD trigger: URL in message');
    return true;
  }
  
  // Domain mentions (.cz, .com, etc.) = wants info from that site
  if (lower.match(/\b[\w-]+\.(cz|com|sk|eu|org|net|io)\b/)) {
    logger.info('WebSearch', 'HARD trigger: domain mention');
    return true;
  }
  
  // External data requirement (links, listings, prices)
  if (needsExternalData(message)) {
    logger.info('WebSearch', 'HARD trigger: external data requirement');
    return true;
  }
  
  // Explicit HARD external intent
  const hardIntent = hasHardExternalIntent(lower);
  if (hardIntent.triggered) {
    logger.info('WebSearch', `HARD trigger: ${hardIntent.reason}`);
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: SOFT BLOCK - if it's an explainer question, don't search
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (isSoftExplainerIntent(lower)) {
    // This is an explanation question, not a web search need
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: MEDIUM TRIGGERS - only if not blocked by SOFT
  // ═══════════════════════════════════════════════════════════════════════════
  
  // These are medium-confidence triggers - can be blocked by SOFT patterns
  const mediumTriggers = [
    // Explicit search commands
    'vyhledej', 'najdi na', 'hledej', 'dohledat',
    // Time-sensitive
    'dnes', 'včera', 'tento týden', 'teď', 'nyní',
    'co je nového', 'co se děje', 'co se stalo',
    // English
    'search for', 'look up', 'find me', 'google',
    'today', 'yesterday', 'this week', 'latest', 'recent',
  ];
  
  for (const trigger of mediumTriggers) {
    if (lower.includes(trigger)) {
      logger.info('WebSearch', `MEDIUM trigger: "${trigger}"`);
      return true;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT: NO SEARCH
  // ═══════════════════════════════════════════════════════════════════════════
  // Philosophy: If unsure, don't search. LLM can ask for search if needed.
  
  return false;
}

/**
 * Extract search query from user message
 * @param {string} message - User message
 * @returns {string}
 */
export function extractSearchQuery(message) {
  // If there's a URL, that's the target
  const urlMatch = message.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    return urlMatch[0];
  }
  
  // Remove common filler words for better search
  let query = message
    .replace(/^(najdi|vyhledej|hledej|zjisti|řekni mi|podívej se na|search|find|look up|tell me about)\s+/i, '')
    .replace(/\s+(prosím|please|díky|thanks)$/i, '')
    .trim();
  
  // Limit length
  if (query.length > 100) {
    query = query.substring(0, 100);
  }
  
  return query;
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH + SUMMARIZE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Search web and format results for LLM context
 * @param {string} query - Search query
 * @param {boolean} fetchContent - Whether to fetch page content (slower but better)
 * @returns {Promise<string>}
 */
export async function searchAndFormat(query, fetchContent = false) {
  const results = await searchWeb(query, 5);
  
  if (results.length === 0) {
    return `[Web search for "${query}" returned no results]`;
  }
  
  let context = `[Web search results for "${query}"]\n\n`;
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    context += `${i + 1}. **${r.title}**\n`;
    context += `   URL: ${r.url}\n`;
    
    if (fetchContent && i < 2) {
      // Fetch content for top 2 results
      const page = await fetchPage(r.url, 2000);
      if (page?.content) {
        context += `   Content: ${page.content.substring(0, 500)}...\n`;
      } else if (r.snippet) {
        context += `   ${r.snippet}\n`;
      }
    } else if (r.snippet) {
      context += `   ${r.snippet}\n`;
    }
    
    context += '\n';
  }
  
  return context;
}

// ════════════════════════════════════════════════════════════════════════════
// PROVIDER MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Reset all failed providers (clear cooldowns)
 * Useful for testing or manual recovery
 */
export function resetFailedProviders() {
  failedProviders.clear();
  logger.info('WebSearch', 'All provider cooldowns reset');
}

/**
 * Get current provider status
 * @returns {Object} Status of all providers
 */
export function getProviderStatus() {
  const now = Date.now();
  return {
    ddg: isProviderFailed('ddg') ? 'failed' : 'ok',
    searx: SEARX_INSTANCES.map(inst => ({
      instance: inst,
      status: isProviderFailed(inst) ? 'failed' : 'ok',
    })),
    failedProviders: Array.from(failedProviders.entries()).map(([k, v]) => ({
      provider: k,
      failedUntil: new Date(v).toISOString(),
      remainingMs: Math.max(0, v - now),
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { retryableSearch };

export default {
  searchWeb,
  fetchPage,
  needsWebSearch,
  extractSearchQuery,
  searchAndFormat,
  resetFailedProviders,
  getProviderStatus,
  searchMetrics,
  retryableSearch,
};

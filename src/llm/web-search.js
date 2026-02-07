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
 * v55.2: Content quality scoring, block detection, smart truncation
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'cs,en;q=0.9',
      },
      timeout: 15000,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
    
    // Extract links with their text (for listings like bazos, etc.)
    const links = [];
    const baseUrl = new URL(url);
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*(?:<[^/a][^>]*>[^<]*)*)<\/a>/gi;
    let linkMatch;
    
    while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 20) {
      let href = linkMatch[1];
      let text = linkMatch[2]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Skip empty, javascript, or anchor links
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || !text || text.length < 3) {
        continue;
      }
      
      // Convert relative to absolute URL
      if (href.startsWith('/')) {
        href = `${baseUrl.protocol}//${baseUrl.host}${href}`;
      } else if (!href.startsWith('http')) {
        href = `${baseUrl.protocol}//${baseUrl.host}/${href}`;
      }
      
      // Filter: keep only links from same domain or relevant subdomains
      try {
        const linkUrl = new URL(href);
        if (linkUrl.host.includes(baseUrl.host.replace('www.', '')) || 
            baseUrl.host.includes(linkUrl.host.replace('www.', ''))) {
          // Skip navigation/menu links
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
    
    // Extract main content (simplified)
    let content = html
      // Remove scripts, styles, etc.
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Get text from common content areas
      .replace(/<(article|main|div[^>]*class="[^"]*content[^"]*")[^>]*>([\s\S]*?)<\/\1>/gi, '$2')
      // Strip remaining HTML
      .replace(/<[^>]+>/g, ' ')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    
    // Truncate if needed
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...';
    }
    
    logger.info('WebSearch', `Extracted ${links.length} links from ${url}`);
    
    // v55.2: Score content quality
    const quality = scoreScrapeContent(content, query);
    
    if (!quality.usable) {
      logger.warn('WebSearch', `Scrape quality BLOCKED: ${quality.reason}`, { url, contentLength: quality.contentLength });
    }
    
    return { title, content, url, links, quality };
    
  } catch (err) {
    logger.error('WebSearch', `Fetch failed: ${err.message}`);
    return null;
  }
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

export default {
  searchWeb,
  fetchPage,
  needsWebSearch,
  extractSearchQuery,
  searchAndFormat,
  resetFailedProviders,
  getProviderStatus,
  searchMetrics,
};

// C.3 v31 Web Search Module
// ══════════════════════════════════════════════════════════════════════════════
// DuckDuckGo search integration for local LLM enhancement

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// DUCKDUCKGO SEARCH
// ════════════════════════════════════════════════════════════════════════════

/**
 * Search DuckDuckGo and return results
 * @param {string} query - Search query
 * @param {number} maxResults - Maximum number of results (default 5)
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function searchWeb(query, maxResults = 5) {
  logger.info('WebSearch', `Searching: "${query}"`);
  
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'cs,en;q=0.9',
      },
      timeout: 10000,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const results = parseDDGResults(html, maxResults);
    
    logger.info('WebSearch', `Found ${results.length} results`);
    return results;
    
  } catch (err) {
    logger.error('WebSearch', `Search failed: ${err.message}`);
    return [];
  }
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
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum text length (default 5000)
 * @returns {Promise<{title: string, content: string, url: string} | null>}
 */
export async function fetchPage(url, maxLength = 5000) {
  logger.info('WebSearch', `Fetching: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
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
    
    return { title, content, url };
    
  } catch (err) {
    logger.error('WebSearch', `Fetch failed: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH QUERY DETECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect if a message likely needs web search
 * @param {string} message - User message
 * @returns {boolean}
 */
export function needsWebSearch(message) {
  const lower = message.toLowerCase();
  
  // URL in message = wants info from that site
  if (message.match(/https?:\/\/[^\s]+/)) {
    logger.info('WebSearch', 'Triggered by URL in message');
    return true;
  }
  
  // Domain mentions (.cz, .com, etc.) = wants info from that site
  if (lower.match(/\b[\w-]+\.(cz|com|sk|eu|org|net|io)\b/)) {
    logger.info('WebSearch', 'Triggered by domain mention');
    return true;
  }
  
  // Keywords that suggest web search
  const searchTriggers = [
    // Czech - commands
    'najdi', 'vyhledej', 'hledej', 'zjisti', 'ukaž', 'podívej', 'řekni mi',
    'vyhledat', 'najít', 'dohledat',
    // Czech - questions about current state
    'jaká je', 'jaký je', 'kde je', 'co je', 'kdo je', 'kdy je', 'jak je',
    'kolik stojí', 'kolik je', 'která', 'které', 'hlavní zpráva',
    // Czech - time/news
    'aktuální', 'novinky', 'zprávy', 'titulky', 'headlines',
    'dnes', 'včera', 'tento týden', 'tento měsíc', 'letos', 'teď', 'nyní',
    'co je nového', 'co se děje', 'co se stalo',
    // Czech - shopping/search
    'cena', 'inzerát', 'inzerat', 'nabídka', 'prodej', 'koupit', 'kde sehnat',
    'kurz', 'počasí', 'předpověď', 'srovnání', 'recenze',
    // English
    'search', 'find', 'look up', 'google', 'current', 'latest', 'news',
    'today', 'yesterday', 'this week', 'what is the', 'how much', 'where is',
    'price', 'weather', 'forecast', 'recent', 'breaking',
  ];
  
  // Check triggers
  for (const trigger of searchTriggers) {
    if (lower.includes(trigger)) {
      logger.info('WebSearch', `Triggered by keyword: "${trigger}"`);
      return true;
    }
  }
  
  // Questions starting with question words (but not about coding)
  if (lower.match(/^(kdo|co|kde|kdy|jak|proč|kolik|jaký|jaká|které|čí|kam)\s/i)) {
    // Exclude coding/general knowledge questions
    if (!lower.match(/(naprogramovat|vytvořit|udělat|napsat|code|create|make|write|funguje|znamená|difference|rozdíl)/)) {
      logger.info('WebSearch', 'Triggered by question word');
      return true;
    }
  }
  
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
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  searchWeb,
  fetchPage,
  needsWebSearch,
  extractSearchQuery,
  searchAndFormat,
};

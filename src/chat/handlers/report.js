// handlers/report.js — REPORT pipeline helpers
// ══════════════════════════════════════════════════════════════════════════════
// v44.11 - REPORT Pipeline: SEARCH→SCRAPE→SYNTHESIZE
// Helpers for building degraded fallbacks and synthesizing reports
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';

/**
 * Build degraded REPORT fallback when search fails or returns no results.
 * NEVER asks user for clarification - provides orientational overview instead.
 *
 * @param {string} input - Original user query
 * @param {Object} decision - CRE decision
 * @param {Object} searchResult - Failed search result
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
export function buildReportFallback(input, decision, searchResult, context) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 0.4,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      degraded: true,
      reason: 'SEARCH_FAILED_OR_NO_RESULTS',
      searchStatus: searchResult.status,
    },
  });

  const errorInfo = searchResult.toolResults
    ?.filter(r => !r.success)
    ?.map(r => r.error || 'unknown')
    ?.join(', ') || 'unknown';

  logger.warn('ReportHelper', 'REPORT fallback triggered', {
    query: input.substring(0, 50),
    errorInfo,
  });

  const content = `⚠️ **Nelze získat aktuální zdroje**

Vyhledávání selhalo nebo nevrátilo žádné výsledky.

**Důvod:** ${errorInfo.includes('timeout') ? 'Vypršel časový limit' :
             errorInfo.includes('blocked') ? 'Zdroje dočasně nedostupné' :
             'Vyhledávání nebylo úspěšné'}

---

📋 **Orientační přehled** (bez aktuálních zdrojů):

K tématu "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}" mohu nabídnout:
• Obecné informace z mých znalostí
• Doporučení relevantních zdrojů k ruční kontrole
• Strukturu reportu, kterou můžete doplnit

Chcete pokračovat s orientačním přehledem, nebo zkusit vyhledávání znovu?`;

  if (context.sessionState) {
    context.sessionState.recordDecision(decision, input);
  }

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Synthesize a report from search and scrape results.
 *
 * @param {Object} options
 * @param {string} options.query - Original user query
 * @param {Array} options.searchResults - Search result items
 * @param {Array} options.scrapeResults - Scraped content items
 * @returns {string} Synthesized report content
 */
export function synthesizeReport({ query, searchResults, scrapeResults }) {
  const parts = [];

  parts.push(`📊 **Report: ${query.substring(0, 80)}${query.length > 80 ? '...' : ''}**\n`);
  parts.push(`*Zpracováno ${searchResults.length} zdrojů*\n`);
  parts.push('---\n');

  if (scrapeResults && scrapeResults.length > 0) {
    parts.push('## 📄 Shrnutí zdrojů\n');

    scrapeResults.forEach((scraped, i) => {
      if (scraped?.content || scraped?.text) {
        const content = scraped.content || scraped.text;
        const title = scraped.title || searchResults[i]?.title || `Zdroj ${i + 1}`;
        const url = scraped.url || searchResults[i]?.url;

        parts.push(`### ${title}\n`);
        if (url) parts.push(`🔗 ${url}\n`);
        parts.push(`\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}\n\n`);
      }
    });
  } else {
    parts.push('## 🔍 Nalezené zdroje\n');

    searchResults.slice(0, 5).forEach((result, i) => {
      parts.push(`### ${i + 1}. ${result.title || 'Bez názvu'}\n`);
      if (result.url) parts.push(`🔗 ${result.url}\n`);
      if (result.snippet) parts.push(`\n${result.snippet}\n`);
      parts.push('\n');
    });
  }

  parts.push('---\n');
  parts.push('## 📚 Zdroje\n');
  searchResults.slice(0, 5).forEach((result, i) => {
    if (result.url) {
      parts.push(`${i + 1}. [${result.title || result.url}](${result.url})\n`);
    }
  });

  return parts.join('');
}

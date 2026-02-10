// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B6: Multi-Source Agent
// ═══════════════════════════════════════════════════════════════════════════════
//
// Agent that monitors multiple sources simultaneously and merges results.
// Use case: "Sleduj pozemky na Sreality + Bezrealitky + Reality.cz"
//
// Features:
//   - Multiple sources per agent (URL, RSS, API)
//   - Cross-source deduplication (by title/URL similarity)
//   - Per-source health tracking
//   - Merged results sorted by relevance/newness
//   - Source-specific filtering
//
// Integration: Extends existing agent runner. Agent definition gets `sources[]`
//              instead of single `source`.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Source Types ────────────────────────────────────────────────────────────

export const SourceType = {
  URL: 'url',
  RSS: 'rss',
  API: 'api',
};

// ─── Multi-Source Configuration ──────────────────────────────────────────────

/**
 * @typedef {Object} SourceConfig
 * @property {string} id - Unique source identifier
 * @property {string} type - 'url' | 'rss' | 'api'
 * @property {string} url - Source URL
 * @property {string} [name] - Human-readable name
 * @property {string[]} [keywords] - Filter keywords
 * @property {number} [priority=1] - Source priority (higher = more important)
 * @property {object} [headers] - Custom HTTP headers
 * @property {string} [selector] - CSS selector for URL type
 * @property {number} [maxItems=10] - Max items per fetch
 */

/**
 * Validate multi-source agent definition.
 *
 * @param {object} definition - Agent definition
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMultiSourceDefinition(definition) {
  const errors = [];

  if (!definition) {
    return { valid: false, errors: ['Missing definition'] };
  }

  const sources = definition.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push('sources must be a non-empty array');
    return { valid: false, errors };
  }

  if (sources.length > 10) {
    errors.push('Maximum 10 sources per agent');
  }

  const ids = new Set();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s.id) errors.push(`sources[${i}]: missing id`);
    if (!s.url) errors.push(`sources[${i}]: missing url`);
    if (!s.type || !Object.values(SourceType).includes(s.type)) {
      errors.push(`sources[${i}]: invalid type '${s.type}' (must be url|rss|api)`);
    }
    if (s.id && ids.has(s.id)) errors.push(`sources[${i}]: duplicate id '${s.id}'`);
    if (s.id) ids.add(s.id);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Result Normalization ────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedItem
 * @property {string} id - Unique item ID
 * @property {string} sourceId - Source that found this item
 * @property {string} sourceName - Human-readable source name
 * @property {string} title - Item title
 * @property {string} [url] - Item URL
 * @property {string} [description] - Item description/snippet
 * @property {Date} [publishedAt] - Publication date
 * @property {number} priority - Source priority
 * @property {object} [raw] - Original item data
 */

/**
 * Normalize items from different source types into a common format.
 *
 * @param {object[]} rawItems - Items from a source
 * @param {SourceConfig} sourceConfig - Source configuration
 * @returns {NormalizedItem[]}
 */
export function normalizeItems(rawItems, sourceConfig) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item, idx) => ({
    id: item.id || item.guid || item.link || `${sourceConfig.id}-${idx}`,
    sourceId: sourceConfig.id,
    sourceName: sourceConfig.name || sourceConfig.id,
    title: item.title || item.name || '(bez názvu)',
    url: item.link || item.url || null,
    description: item.description || item.snippet || item.summary || null,
    publishedAt: item.pubDate ? new Date(item.pubDate) : item.publishedAt ? new Date(item.publishedAt) : null,
    priority: sourceConfig.priority || 1,
    raw: item,
  }));
}

// ─── Cross-Source Deduplication ───────────────────────────────────────────────

/**
 * Calculate similarity between two strings (Jaccard index on words).
 */
function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

/**
 * Deduplicate items across sources.
 * Two items are considered duplicates if:
 *   - Same URL (exact match), or
 *   - Title similarity > 0.6 (Jaccard index)
 *
 * When duplicates found, keep the one from the higher-priority source.
 *
 * @param {NormalizedItem[]} items - All items from all sources
 * @param {number} [similarityThreshold=0.6]
 * @returns {{ unique: NormalizedItem[], duplicates: Array<{kept: NormalizedItem, removed: NormalizedItem}> }}
 */
export function deduplicateItems(items, similarityThreshold = 0.6) {
  const unique = [];
  const duplicates = [];

  for (const item of items) {
    let isDuplicate = false;

    for (let i = 0; i < unique.length; i++) {
      const existing = unique[i];

      // URL exact match
      if (item.url && existing.url && item.url === existing.url) {
        isDuplicate = true;
        // Keep higher priority
        if (item.priority > existing.priority) {
          duplicates.push({ kept: item, removed: existing });
          unique[i] = item;
        } else {
          duplicates.push({ kept: existing, removed: item });
        }
        break;
      }

      // Title similarity
      const sim = wordSimilarity(item.title, existing.title);
      if (sim >= similarityThreshold) {
        isDuplicate = true;
        if (item.priority > existing.priority) {
          duplicates.push({ kept: item, removed: existing });
          unique[i] = item;
        } else {
          duplicates.push({ kept: existing, removed: item });
        }
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(item);
    }
  }

  return { unique, duplicates };
}

// ─── Multi-Source Fetch Orchestration ─────────────────────────────────────────

/**
 * Fetch items from multiple sources concurrently.
 *
 * @param {SourceConfig[]} sources - Source configurations
 * @param {object} [options]
 * @param {Function} [options.fetchSource] - Source fetcher: (config) → items[]
 * @param {number} [options.timeoutMs=15000] - Per-source timeout
 * @param {boolean} [options.continueOnError=true] - Continue if one source fails
 * @returns {Promise<{
 *   items: NormalizedItem[],
 *   bySource: Object<string, NormalizedItem[]>,
 *   errors: Array<{ sourceId: string, error: string }>,
 *   stats: { total: number, unique: number, duplicates: number, failed: number },
 * }>}
 */
export async function fetchMultipleSources(sources, options = {}) {
  const { fetchSource, timeoutMs = 15000, continueOnError = true } = options;
  const allItems = [];
  const bySource = {};
  const errors = [];

  // Fetch all sources concurrently
  const fetchPromises = sources.map(async (source) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let rawItems;
      if (fetchSource) {
        rawItems = await fetchSource(source, controller.signal);
      } else {
        // Default: fetch URL and return empty (integration point)
        rawItems = [];
      }
      clearTimeout(timeout);

      const normalized = normalizeItems(rawItems, source);
      const limited = normalized.slice(0, source.maxItems || 10);
      bySource[source.id] = limited;
      allItems.push(...limited);
    } catch (err) {
      errors.push({ sourceId: source.id, error: err.message });
      bySource[source.id] = [];
      if (!continueOnError) throw err;
    }
  });

  await Promise.allSettled(fetchPromises);

  // Deduplicate across sources
  const { unique, duplicates: dupes } = deduplicateItems(allItems);

  // Sort by priority (desc), then by publishedAt (newest first)
  unique.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.publishedAt && b.publishedAt) return b.publishedAt - a.publishedAt;
    return 0;
  });

  return {
    items: unique,
    bySource,
    errors,
    stats: {
      total: allItems.length,
      unique: unique.length,
      duplicates: dupes.length,
      failed: errors.length,
      sources: sources.length,
    },
  };
}

// ─── Source Health Tracking ───────────────────────────────────────────────────

export class SourceHealthTracker {
  constructor() {
    /** @type {Map<string, { successes: number, failures: number, lastSuccess: Date|null, lastError: string|null, avgLatency: number }>} */
    this.health = new Map();
  }

  recordSuccess(sourceId, latencyMs) {
    const h = this._getOrCreate(sourceId);
    h.successes++;
    h.lastSuccess = new Date();
    h.lastError = null;
    h.avgLatency = (h.avgLatency * (h.successes - 1) + latencyMs) / h.successes;
  }

  recordFailure(sourceId, error) {
    const h = this._getOrCreate(sourceId);
    h.failures++;
    h.lastError = error;
  }

  getHealth(sourceId) {
    return this.health.get(sourceId) || null;
  }

  getAllHealth() {
    const result = {};
    for (const [id, h] of this.health) {
      result[id] = {
        ...h,
        reliability: h.successes + h.failures > 0
          ? h.successes / (h.successes + h.failures)
          : 0,
      };
    }
    return result;
  }

  isHealthy(sourceId, minReliability = 0.5) {
    const h = this.health.get(sourceId);
    if (!h) return true; // Unknown = assume healthy
    const total = h.successes + h.failures;
    if (total < 3) return true; // Not enough data
    return (h.successes / total) >= minReliability;
  }

  _getOrCreate(sourceId) {
    if (!this.health.has(sourceId)) {
      this.health.set(sourceId, { successes: 0, failures: 0, lastSuccess: null, lastError: null, avgLatency: 0 });
    }
    return this.health.get(sourceId);
  }

  reset() { this.health.clear(); }
}

// ─── Agent Definition Builder ────────────────────────────────────────────────

/**
 * Build a multi-source agent definition from user preferences.
 * Used by agent builder wizard.
 *
 * @param {object} params
 * @param {string} params.name - Agent name
 * @param {Array<{url: string, type: string, name?: string}>} params.sources
 * @param {string} [params.schedule] - Cron schedule (default: every 30min)
 * @param {string} [params.channel='ntfy'] - Notification channel
 * @param {string} [params.recipient] - Channel recipient
 * @param {string[]} [params.keywords] - Global filter keywords
 * @param {string} [params.condition='new_items'] - Trigger condition
 * @returns {object} Agent definition for DB storage
 */
export function buildMultiSourceAgent(params) {
  const {
    name, sources, schedule = '*/30 * * * *', channel = 'ntfy',
    recipient = '', keywords = [], condition = 'new_items',
  } = params;

  return {
    name,
    sources: sources.map((s, i) => ({
      id: s.id || `source-${i}`,
      type: s.type || SourceType.URL,
      url: s.url,
      name: s.name || `Zdroj ${i + 1}`,
      keywords: s.keywords || keywords,
      priority: s.priority || 1,
      maxItems: s.maxItems || 10,
    })),
    schedule: { cron: schedule },
    condition: { type: condition },
    action: {
      type: 'notify',
      channel,
      recipient,
    },
    multiSource: true,
  };
}

export default {
  SourceType,
  validateMultiSourceDefinition,
  normalizeItems,
  deduplicateItems,
  fetchMultipleSources,
  SourceHealthTracker,
  buildMultiSourceAgent,
};

// Online Discovery v121.1 — L4 Discovery from Ollama Library Pages
// ══════════════════════════════════════════════════════════════════════════════
//
// Discovers model variants from ollama.com/library/{family} HTML pages
// for families already present in L1 (installed locally).
//
// Pipeline:
//   installed families → fetch library pages → parse tags → estimate benchmarks
//   → build provisional entries → persist to discovered_models DB → scoring
//
// Guards:
//   - Rate limit: max 3 family fetches per cycle
//   - 30-day pruning for stale entries
//   - Multi-selector fallback for HTML parsing
//   - Silent failure per family (never blocks)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  normalizeFamily, estimateVram, estimateBenchmarks,
  buildFamilyScalingModels, inheritFromNearest,
} from './benchmark-estimator.js';

const MAX_FAMILY_FETCHES = 8;
const STALE_DAYS = 30;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const MIN_USEFUL_PARAMS = 3; // Skip models < 3B (too small for production)

// ─── HTML Tag Parsing ────────────────────────────────────────────────────────

/**
 * Parse model tags from Ollama library HTML page.
 * Multi-selector fallback: structured data → regex.
 *
 * @param {string} html - Raw HTML from ollama.com/library/{family}
 * @param {string} family - Family name for tag construction
 * @returns {Array<{tag: string, params: number|null}>}
 */
export function parseTagsFromHtml(html, family) {
  if (!html || !family) return [];

  const results = [];
  const seen = new Set();
  const MAX_TAGS = 30; // v124.6: Cap parsed tags

  // v124.6: Basic HTML structure validation
  if (!html.includes('<') || html.length < 50) return [];

  // Strategy 1: look for tag links (href="/library/{family}:{tag}")
  const linkPattern = new RegExp(
    `href=["']/library/${escapeRegex(family)}:([^"'\\s]+)["']`,
    'gi'
  );
  let match;
  while ((match = linkPattern.exec(html)) !== null && results.length < MAX_TAGS) {
    const tag = match[1].toLowerCase().trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      results.push({ tag, params: parseParamsFromTag(tag) });
    }
  }

  // Strategy 2: fallback regex — look for tag-like patterns with param sizes
  if (results.length === 0) {
    const tagPattern = /\b(\d+(?:\.\d+)?b(?:-[a-z0-9]+)?)\b/gi;
    while ((match = tagPattern.exec(html)) !== null && results.length < MAX_TAGS) {
      const tag = match[1].toLowerCase();
      if (!seen.has(tag)) {
        seen.add(tag);
        results.push({ tag, params: parseParamsFromTag(tag) });
      }
    }
  }

  return results;
}

/**
 * Extract parameter count from a tag string.
 * '27b' → 27, '14b-q4' → 14, '30b-a3b' → 30
 */
function parseParamsFromTag(tag) {
  const m = tag.match(/^(\d+(?:\.\d+)?)b/i);
  return m ? parseFloat(m[1]) : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── OnlineDiscovery Class ──────────────────────────────────────────────────

export class OnlineDiscovery {
  constructor() {
    this._db = null;
    this._registryClient = null;
    this._cache = new Map(); // family → { tags, fetchedAt }
    this._scalingModels = null;
    this._catalogNames = null;
  }

  setDb(db) {
    this._db = db;
  }

  setRegistryClient(client) {
    this._registryClient = client;
  }

  /**
   * Main entry: discover new model variants for installed families.
   * Rate limited to MAX_FAMILY_FETCHES per call.
   *
   * @param {string[]} installedFamilies - Library names from installed models (e.g. 'qwen3.5', 'deepseek-r1')
   * @param {Object} [opts]
   * @param {Array} [opts.catalog] - CATALOG array (for scaling models)
   * @param {number} [opts.gpuVramMb] - Available GPU VRAM in MB (for pre-filtering oversized models)
   * @returns {Promise<Array<ProvisionalEntry>>}
   */
  async discoverForFamilies(installedFamilies, opts = {}) {
    if (!installedFamilies || installedFamilies.length === 0) return [];

    // Build scaling models from catalog (lazy, cached per call)
    if (!this._scalingModels && opts.catalog) {
      this._scalingModels = buildFamilyScalingModels(opts.catalog);
    }

    // Cache catalog names for filtering
    if (!this._catalogNames && opts.catalog) {
      this._catalogNames = new Set(opts.catalog.map(e => e.name));
    }

    const gpuVramMb = opts.gpuVramMb || 0;
    const results = [];
    let fetchCount = 0;

    // Dedupe families by normalized name
    const seen = new Set();
    const uniqueFamilies = [];
    for (const f of installedFamilies) {
      const norm = normalizeFamily(f);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        uniqueFamilies.push(f);
      }
    }

    for (const family of uniqueFamilies) {
      if (fetchCount >= MAX_FAMILY_FETCHES) break;

      try {
        // Check cache
        const cached = this._cache.get(normalizeFamily(family));
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          const newTags = this._filterNewTags(family, cached.tags);
          for (const tag of newTags) {
            const entry = this._buildProvisionalEntry(family, tag, gpuVramMb);
            if (entry) results.push(entry);
          }
          continue; // Cache hit — doesn't count toward rate limit
        }

        // Fetch from Ollama library
        const html = await this._fetchFamilyPage(family);
        if (!html) {
          fetchCount++;
          continue;
        }

        fetchCount++;
        const tags = parseTagsFromHtml(html, family);

        // Cache result
        this._cache.set(normalizeFamily(family), { tags, fetchedAt: Date.now() });

        if (tags.length === 0) {
          logger.debug('OnlineDiscovery', `No tags parsed for family ${family}`);
          continue;
        }

        const newTags = this._filterNewTags(family, tags);
        for (const tag of newTags) {
          const entry = this._buildProvisionalEntry(family, tag, gpuVramMb);
          if (entry) results.push(entry);
        }
      } catch (err) {
        logger.warn('OnlineDiscovery', `discovery_warning: failed for ${family}: ${err.message}`);
        // Continue — error in one family doesn't block others
      }
    }

    return results;
  }

  /**
   * Fetch HTML page for a family from Ollama library.
   * Uses registryClient if available, otherwise direct fetch.
   */
  async _fetchFamilyPage(family) {
    if (this._registryClient) {
      try {
        return await this._registryClient.fetchLibraryPage(family);
      } catch {
        return null;
      }
    }

    // Direct fetch fallback
    try {
      const url = `https://ollama.com/library/${encodeURIComponent(family)}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'c3-agent/1.0' },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  /**
   * Filter out tags that are already in catalog or discovered_models.
   */
  _filterNewTags(family, tags) {
    if (!tags || tags.length === 0) return [];

    // Load existing discovered names from DB
    const discoveredNames = new Set();
    if (this._db) {
      try {
        const rows = this._db.prepare('SELECT name FROM discovered_models').all();
        for (const r of rows) discoveredNames.add(r.name);
      } catch (_) {}
    }

    return tags.filter(t => {
      const fullName = `${family}:${t.tag}`;
      // Skip if in catalog
      if (this._catalogNames?.has(fullName)) return false;
      // Skip if already discovered
      if (discoveredNames.has(fullName)) return false;
      // Skip if no params could be parsed
      if (!t.params) return false;
      return true;
    });
  }

  /**
   * Build a provisional catalog entry with estimated benchmarks.
   */
  _buildProvisionalEntry(family, tagInfo, gpuVramMb) {
    const { tag, params } = tagInfo;
    if (!params || params <= 0) return null;

    // Pre-filter: skip models too small for production
    if (params < MIN_USEFUL_PARAMS) return null;

    // Pre-filter: skip models that won't fit in GPU VRAM (90% threshold)
    const baseVramMb = estimateVram(params);
    if (gpuVramMb > 0 && baseVramMb > gpuVramMb * 0.90) return null;

    const fullName = `${family}:${tag}`;

    // Estimate benchmarks via log-space interpolation
    let benchmarks = null;
    let benchmarkConfidence = 0;

    if (this._scalingModels) {
      const est = estimateBenchmarks(family, params, this._scalingModels);
      benchmarks = est.benchmarks;
      benchmarkConfidence = est.confidence;
    }

    // Inherit non-benchmark fields from nearest catalog entry
    let category = 'general';
    let capabilities = null;
    let contextWindow = null;

    if (this._scalingModels) {
      const inherited = inheritFromNearest(family, params, this._scalingModels);
      if (inherited.category) category = inherited.category;
      if (inherited.capabilities) capabilities = inherited.capabilities;
      if (inherited.contextWindow != null) contextWindow = inherited.contextWindow;
    }

    return {
      name: fullName,
      family,
      version: tag,
      params,
      category,
      baseVramMb,
      effectiveVramMb: null,
      contextWindow,
      releaseDate: null,
      benchmarks,
      benchmarkConfidence,
      capabilities,
      provisional: true,
      source: 'L4',
      discoveredAt: new Date().toISOString(),
    };
  }

  /**
   * Persist provisional entries to discovered_models table (upsert).
   */
  async persistEntries(entries) {
    if (!this._db || !entries || entries.length === 0) return;

    const stmt = this._db.prepare(`
      INSERT INTO discovered_models
        (name, family, params, category, base_vram_mb, context_window,
         benchmarks_json, benchmark_confidence, capabilities_json, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        params = excluded.params,
        category = excluded.category,
        base_vram_mb = excluded.base_vram_mb,
        context_window = excluded.context_window,
        benchmarks_json = excluded.benchmarks_json,
        benchmark_confidence = excluded.benchmark_confidence,
        capabilities_json = excluded.capabilities_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    const tx = this._db.transaction(() => {
      for (const e of entries) {
        stmt.run(
          e.name, e.family, e.params, e.category,
          e.baseVramMb, e.contextWindow,
          e.benchmarks ? JSON.stringify(e.benchmarks) : null,
          e.benchmarkConfidence,
          e.capabilities ? JSON.stringify(e.capabilities) : null,
          e.source || 'L4'
        );
      }
    });

    try {
      tx();
    } catch (err) {
      logger.warn('OnlineDiscovery', `Persist failed: ${err.message}`);
    }
  }

  /**
   * Persist L5 enrichment (WhatLLM benchmark source) back to discovered_models.
   * Called after enrichCandidates() to make source visible in scoring UI.
   */
  persistEnrichment(entries) {
    if (!this._db || !entries?.length) return;
    try {
      const stmt = this._db.prepare(`
        UPDATE discovered_models SET
          benchmarks_json = ?, benchmark_confidence = ?, benchmark_source = ?
        WHERE name = ?`);
      const tx = this._db.transaction(() => {
        for (const e of entries) {
          stmt.run(
            e.benchmarks ? JSON.stringify(e.benchmarks) : null,
            e.benchmarkConfidence,
            e.benchmarkSource || 'whatllm',
            e.name
          );
        }
      });
      tx();
    } catch (err) {
      logger.warn('OnlineDiscovery', `Enrichment persist failed: ${err.message}`);
    }
  }

  /**
   * Load all discovered models from DB as provisional entries.
   */
  async getDiscoveredModels() {
    if (!this._db) return [];

    try {
      const rows = this._db.prepare('SELECT * FROM discovered_models').all();
      return rows.map(r => ({
        name: r.name,
        family: r.family,
        params: r.params,
        category: r.category,
        baseVramMb: r.base_vram_mb,
        effectiveVramMb: null,
        contextWindow: r.context_window,
        releaseDate: null,
        benchmarks: r.benchmarks_json ? JSON.parse(r.benchmarks_json) : null,
        benchmarkConfidence: r.benchmark_confidence,
        capabilities: r.capabilities_json ? JSON.parse(r.capabilities_json) : null,
        provisional: true,
        source: r.source || 'L4',
        benchmarkSource: r.benchmark_source || null,
        discoveredAt: r.discovered_at,
        installed: false,
      }));
    } catch (err) {
      logger.warn('OnlineDiscovery', `Load failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Remove discovered entries older than STALE_DAYS.
   */
  async pruneStale() {
    if (!this._db) return 0;

    try {
      const result = this._db.prepare(`
        DELETE FROM discovered_models
        WHERE updated_at < datetime('now', '-${STALE_DAYS} days')
      `).run();
      const pruned = result.changes || 0;
      if (pruned > 0) {
        logger.info('OnlineDiscovery', `Pruned ${pruned} stale discovered models`);
      }
      return pruned;
    } catch (err) {
      logger.warn('OnlineDiscovery', `Prune failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Reset internal caches (for testing).
   */
  clearCaches() {
    this._cache.clear();
    this._scalingModels = null;
    this._catalogNames = null;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const onlineDiscovery = new OnlineDiscovery();

export default { OnlineDiscovery, onlineDiscovery, parseTagsFromHtml };

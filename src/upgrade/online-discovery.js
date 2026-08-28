// Online Discovery v121.1 — L4 Discovery from Ollama Library Pages
// ══════════════════════════════════════════════════════════════════════════════
//
// Discovers model variants from ollama.com/library/{family} HTML pages
// for families already present in L1 (installed locally).
//
// Pipeline:
//   installed families → fetch library pages → parse tags
//   → factual provisional entries → persist to discovered_models DB
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
  modelDiscoveryFetch,
} from '../network/outbound-policy.js';
import {
  estimateVram, buildFamilyMetadataModels, inheritFromNearest, extractLibraryName,
} from './model-metadata-estimator.js';

const MAX_FAMILY_FETCHES = readIntEnv('C3_DISCOVERY_MAX_FAMILIES', 8, 1, 200);
const MAX_VARIANTS_PER_FAMILY = readIntEnv('C3_DISCOVERY_MAX_VARIANTS_PER_FAMILY', 6, 1, 30);
const HIGH_PRIORITY_RATIO = readFloatEnv('C3_DISCOVERY_HIGH_PRIORITY_RATIO', 0.70, 0, 1);
const REGISTRY_SEED_LIMIT = readIntEnv('C3_DISCOVERY_REGISTRY_SEED_LIMIT', 50, 1, 200);
const KNOWN_FAMILY_LIMIT = readIntEnv('C3_DISCOVERY_KNOWN_FAMILY_LIMIT', 120, 1, 1000);
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

  // v124.6: Basic payload validation
  // Keep plain-text fallback path for scraped snippets (no strict HTML required).
  if (!html.includes('<') && !/\d+(?:\.\d+)?b/i.test(html)) return [];

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

function canonicalLibraryFamily(name) {
  return extractLibraryName(String(name || '').trim().toLowerCase());
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readIntEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function readFloatEnv(name, fallback, min, max) {
  const parsed = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

// ─── OnlineDiscovery Class ──────────────────────────────────────────────────

export class OnlineDiscovery {
  constructor() {
    this._db = null;
    this._registryClient = null;
    this._cache = new Map(); // family → { tags, fetchedAt }
    this._familyMetadata = null;
    this._catalogNames = null;
  }

  setDb(db) {
    this._db = db;
  }

  setRegistryClient(client) {
    this._registryClient = client;
  }

  /**
   * Main entry: discover model variants using guided + bounded family planning.
   *
   * Discovery strategy:
   *  - High-priority pool (default 70%): installed/current/explicit seeds
   *  - Diversity pool (default 30%): registry index + known families
   *  - Hard bounds: max families per cycle + max variants per family
   *
   * @param {string[]} installedFamilies - Library names from installed models (e.g. 'qwen3.5', 'deepseek-r1')
   * @param {Object} [opts]
   * @param {Array} [opts.catalog] - CATALOG array (for scaling models)
   * @param {number} [opts.gpuVramMb] - Available GPU VRAM in MB (for pre-filtering oversized models)
   * @param {string[]} [opts.seedFamilies] - Explicit seed families (e.g. from user pulls/current bindings)
   * @param {string[]} [opts.currentFamilies] - Families currently bound to roles
   * @param {string[]} [opts.registrySeedFamilies] - Optional pre-fetched registry seed families
   * @param {string[]} [opts.knownFamilies] - Optional known families from storage
   * @param {number} [opts.maxFamilies] - Bound on processed families this cycle
   * @param {number} [opts.maxVariantsPerFamily] - Bound on variants parsed per family
   * @param {number} [opts.highPriorityRatio] - Fraction reserved for high-priority pool (0..1)
   * @returns {Promise<Array<ProvisionalEntry>>}
   */
  async discoverForFamilies(installedFamilies, opts = {}) {
    // Build scaling models from catalog (lazy, cached per call)
    if (!this._familyMetadata && opts.catalog) {
      this._familyMetadata = buildFamilyMetadataModels(opts.catalog);
    }

    // Cache catalog names for filtering
    if (!this._catalogNames && opts.catalog) {
      this._catalogNames = new Set(opts.catalog.map(e => e.name));
    }

    const gpuVramMb = opts.gpuVramMb || 0;
    const maxFamilies = clamp(
      Number.isFinite(opts.maxFamilies) ? Math.floor(opts.maxFamilies) : MAX_FAMILY_FETCHES,
      1,
      200
    );
    const maxVariantsPerFamily = clamp(
      Number.isFinite(opts.maxVariantsPerFamily) ? Math.floor(opts.maxVariantsPerFamily) : MAX_VARIANTS_PER_FAMILY,
      1,
      30
    );
    const highPriorityRatio = clamp(
      Number.isFinite(opts.highPriorityRatio) ? opts.highPriorityRatio : HIGH_PRIORITY_RATIO,
      0,
      1
    );

    const results = [];
    let fetchCount = 0;
    const discoveredNames = this._loadDiscoveredNamesFromDb();
    const familyPlan = await this._buildFamilyPlan(installedFamilies, {
      ...opts,
      maxFamilies,
      highPriorityRatio,
    });
    if (familyPlan.length === 0) return [];

    for (const family of familyPlan) {
      if (fetchCount >= maxFamilies) break;

      try {
        // Check cache
        const familyKey = canonicalLibraryFamily(family);
        const cached = this._cache.get(familyKey);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          const newTags = this._limitTagsForFamily(
            this._filterNewTags(family, cached.tags, discoveredNames),
            maxVariantsPerFamily,
            gpuVramMb
          );
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
        this._cache.set(familyKey, { tags, fetchedAt: Date.now() });

        if (tags.length === 0) {
          logger.debug('OnlineDiscovery', `No tags parsed for family ${family}`);
          continue;
        }

        const newTags = this._limitTagsForFamily(
          this._filterNewTags(family, tags, discoveredNames),
          maxVariantsPerFamily,
          gpuVramMb
        );
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

  async _buildFamilyPlan(installedFamilies, opts = {}) {
    const maxFamilies = clamp(opts.maxFamilies ?? MAX_FAMILY_FETCHES, 1, 200);
    const highPriorityRatio = clamp(opts.highPriorityRatio ?? HIGH_PRIORITY_RATIO, 0, 1);
    const highSlots = clamp(Math.round(maxFamilies * highPriorityRatio), 0, maxFamilies);
    const diversitySlots = Math.max(0, maxFamilies - highSlots);

    const seedMap = new Map();
    const addSeed = (family, source, basePriority, diversityBoost = 0) => {
      const normalized = canonicalLibraryFamily(family);
      if (!normalized) return;
      const current = seedMap.get(normalized) || {
        family: normalized,
        priority: 0,
        diversity: 0,
        sources: new Set(),
      };
      current.priority += basePriority;
      current.diversity += diversityBoost;
      current.sources.add(source);
      seedMap.set(normalized, current);
    };

    const installed = Array.isArray(installedFamilies) ? installedFamilies : [];
    for (const f of installed) addSeed(f, 'installed', 100, 0);

    const currentFamilies = Array.isArray(opts.currentFamilies) ? opts.currentFamilies : [];
    for (const f of currentFamilies) addSeed(f, 'current', 85, 0);

    const explicitSeeds = Array.isArray(opts.seedFamilies) ? opts.seedFamilies : [];
    for (const f of explicitSeeds) addSeed(f, 'explicit', 80, 1);

    const registrySeeds = await this._collectRegistrySeeds(opts);
    for (const f of registrySeeds) addSeed(f, 'registry', 70, 3);

    const knownSeeds = await this._collectKnownFamilies(opts);
    for (const f of knownSeeds) addSeed(f, 'known', 40, 2);

    const all = [...seedMap.values()].map((x) => ({
      ...x,
      sourceCount: x.sources.size,
      fromInstalled: x.sources.has('installed'),
      fromRegistry: x.sources.has('registry'),
      fromKnown: x.sources.has('known'),
    }));

    if (all.length === 0) return [];

    all.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
      return a.family.localeCompare(b.family);
    });

    const selected = [];
    const selectedSet = new Set();

    for (const item of all) {
      if (selected.length >= highSlots) break;
      selected.push(item);
      selectedSet.add(item.family);
    }

    if (diversitySlots > 0) {
      const diversityPool = all
        .filter(item => !selectedSet.has(item.family))
        .sort((a, b) => {
          if (b.diversity !== a.diversity) return b.diversity - a.diversity;
          if (b.priority !== a.priority) return b.priority - a.priority;
          return a.family.localeCompare(b.family);
        });
      for (const item of diversityPool) {
        if (selected.length >= maxFamilies) break;
        selected.push(item);
        selectedSet.add(item.family);
      }
    }

    // Fill any remaining slots deterministically.
    if (selected.length < maxFamilies) {
      for (const item of all) {
        if (selected.length >= maxFamilies) break;
        if (selectedSet.has(item.family)) continue;
        selected.push(item);
        selectedSet.add(item.family);
      }
    }

    logger.debug('OnlineDiscovery', `Family plan: ${selected.length}/${all.length} selected`, {
      highSlots,
      diversitySlots,
      top: selected.slice(0, 8).map(x => `${x.family}(${x.priority})`),
    });

    return selected.map(x => x.family);
  }

  async _collectRegistrySeeds(opts = {}) {
    if (Array.isArray(opts.registrySeedFamilies) && opts.registrySeedFamilies.length > 0) {
      return opts.registrySeedFamilies;
    }
    if (!this._registryClient || typeof this._registryClient.fetchLibraryIndexFamilies !== 'function') {
      return [];
    }
    try {
      return await this._registryClient.fetchLibraryIndexFamilies({ limit: REGISTRY_SEED_LIMIT });
    } catch {
      return [];
    }
  }

  async _collectKnownFamilies(opts = {}) {
    if (Array.isArray(opts.knownFamilies) && opts.knownFamilies.length > 0) {
      return opts.knownFamilies;
    }
    const out = new Set();
    if (!this._db) return [];
    try {
      const rows = this._db.prepare(`
        SELECT DISTINCT family
        FROM discovered_models
        WHERE family IS NOT NULL AND family <> ''
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(KNOWN_FAMILY_LIMIT);
      for (const r of rows) {
        const family = canonicalLibraryFamily(r.family);
        if (family) out.add(family);
      }
    } catch (_) {}

    // Universe rows might contain models from user pulls that never landed in catalog.
    try {
      const rows = this._db.prepare(`
        SELECT model_name
        FROM model_universe_raw
        WHERE model_name IS NOT NULL AND model_name <> ''
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(KNOWN_FAMILY_LIMIT);
      for (const r of rows) {
        const family = canonicalLibraryFamily(r.model_name);
        if (family) out.add(family);
      }
    } catch (_) {}

    return [...out];
  }

  _loadDiscoveredNamesFromDb() {
    const discoveredNames = new Set();
    if (!this._db) return discoveredNames;
    try {
      const rows = this._db.prepare('SELECT name FROM discovered_models').all();
      for (const r of rows) discoveredNames.add(r.name);
    } catch (_) {}
    return discoveredNames;
  }

  _limitTagsForFamily(tags, maxVariantsPerFamily, gpuVramMb) {
    if (!Array.isArray(tags) || tags.length === 0) return [];
    const scored = tags
      .map((t) => ({ tag: t, score: this._scoreTagCandidate(t, gpuVramMb) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxVariantsPerFamily)
      .map(x => x.tag);
    return scored;
  }

  _scoreTagCandidate(tagInfo, gpuVramMb) {
    const params = Number(tagInfo?.params || 0);
    if (!Number.isFinite(params) || params <= 0) return -1000;
    let score = params;

    // Slightly favor practical fits near ~65% VRAM utilization.
    if (gpuVramMb > 0) {
      const util = estimateVram(params) / gpuVramMb;
      if (util > 0.95) score -= 100;
      else score += (1 - Math.abs(0.65 - util)) * 12;
    } else if (params >= 7 && params <= 40) {
      score += 6;
    }

    // Keep room for smaller variants in bounded windows (diversity).
    if (params <= 12) score += 2;
    return score;
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
      const res = await modelDiscoveryFetch(url, {
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
  _filterNewTags(family, tags, discoveredNamesInput = null) {
    if (!tags || tags.length === 0) return [];

    const discoveredNames = discoveredNamesInput || this._loadDiscoveredNamesFromDb();

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
   * Build a factual provisional catalog entry.
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

    // Inherit descriptive fields from the nearest same-family catalog entry.
    let category = 'general';
    let capabilities = null;
    let contextWindow = null;

    if (this._familyMetadata) {
      const inherited = inheritFromNearest(family, params, this._familyMetadata);
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
         capabilities_json, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        params = excluded.params,
        category = excluded.category,
        base_vram_mb = excluded.base_vram_mb,
        context_window = excluded.context_window,
        capabilities_json = excluded.capabilities_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    const tx = this._db.transaction(() => {
      for (const e of entries) {
        stmt.run(
          e.name, e.family, e.params, e.category,
          e.baseVramMb, e.contextWindow,
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
        capabilities: r.capabilities_json ? JSON.parse(r.capabilities_json) : null,
        provisional: true,
        source: r.source || 'L4',
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
    this._familyMetadata = null;
    this._catalogNames = null;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const onlineDiscovery = new OnlineDiscovery();

export default { OnlineDiscovery, onlineDiscovery, parseTagsFromHtml };

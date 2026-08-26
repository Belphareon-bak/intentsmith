// Registry Client v118 — Online model verification with cache
// ══════════════════════════════════════════════════════════════════════════════
//
// Lightweight online verification against Ollama library.
// HEAD https://ollama.com/library/{family} → 200=exists, 404=removed
// Fallback: GET if HEAD fails.
//
// Cache in model_catalog_cache table (TTL 7d).
// Goes offline after 3 consecutive failures, retries after 1h.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  MODEL_DISCOVERY_OUTBOUND_AUTHORITY,
  outboundFetch,
} from '../network/outbound-policy.js';

const REGISTRY_BASE = 'https://ollama.com/library';
const CACHE_TTL_DAYS = 7;
const MAX_FAILURES = 3;
const OFFLINE_RETRY_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT = 10000; // 10s
const MAX_CONCURRENCY = 3;
const DEFAULT_LIBRARY_INDEX_CACHE_MS = 6 * 60 * 60 * 1000;
const parsedIndexCacheMs = Number.parseInt(process.env.C3_REGISTRY_INDEX_TTL_MS || '', 10);
const parsedIndexLimit = Number.parseInt(process.env.C3_REGISTRY_INDEX_LIMIT || '', 10);
const LIBRARY_INDEX_CACHE_MS = Number.isFinite(parsedIndexCacheMs) && parsedIndexCacheMs >= 1000
  ? parsedIndexCacheMs
  : DEFAULT_LIBRARY_INDEX_CACHE_MS;
const LIBRARY_INDEX_LIMIT = Number.isFinite(parsedIndexLimit) && parsedIndexLimit > 0
  ? Math.min(parsedIndexLimit, 200)
  : 60;

export class RegistryClient {
  constructor() {
    this._db = null;
    this._cache = new Map();
    this._failureCount = 0;
    this._offlineSince = null;
    this._libraryIndexCache = null; // { families: string[], fetchedAt: number }
  }

  setDb(db) {
    this._db = db;
  }

  /**
   * Load cached verification results from DB.
   */
  loadCache() {
    if (!this._db) return;
    try {
      const rows = this._db.prepare(`
        SELECT model_name, exists_in_registry, verified_at FROM model_catalog_cache
      `).all();
      for (const row of rows) {
        this._cache.set(row.model_name, {
          exists: !!row.exists_in_registry,
          verifiedAt: row.verified_at,
        });
      }
    } catch (_) {}
  }

  /**
   * Verify a single model exists in Ollama registry.
   * @param {string} name - Model family name (e.g. 'qwen3', 'deepseek-r1')
   * @returns {Promise<{ exists: boolean, cached: boolean, error?: string }>}
   */
  async verify(name) {
    // Check cache first
    const cached = this._cache.get(name);
    if (cached && !this._isCacheExpired(cached.verifiedAt)) {
      return { exists: cached.exists, cached: true };
    }

    // Check offline status
    if (this._isOffline()) {
      return { exists: true, cached: false, error: 'offline' }; // Assume exists when offline
    }

    try {
      const exists = await this._checkRegistry(name);
      this._failureCount = 0;
      this._offlineSince = null;
      this._updateCache(name, exists);
      return { exists, cached: false };
    } catch (err) {
      this._failureCount++;
      if (this._failureCount >= MAX_FAILURES) {
        this._offlineSince = Date.now();
        logger.warn('RegistryClient', `Offline after ${MAX_FAILURES} failures: ${err.message}`);
      }
      return { exists: true, cached: false, error: err.message }; // Assume exists on error
    }
  }

  /**
   * Verify multiple models with concurrency limit.
   * @param {string[]} names - Model family names
   * @returns {Promise<Map<string, { exists: boolean, cached: boolean }>>}
   */
  async verifyBatch(names) {
    const results = new Map();
    const queue = [...names];
    const running = new Set();

    const processNext = async () => {
      if (queue.length === 0) return;
      const name = queue.shift();
      running.add(name);
      try {
        const result = await this.verify(name);
        results.set(name, result);
      } catch (err) {
        results.set(name, { exists: true, cached: false, error: err.message });
      }
      running.delete(name);
      await processNext();
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENCY, names.length); i++) {
      workers.push(processNext());
    }
    await Promise.all(workers);

    return results;
  }

  /**
   * Check if client is in offline mode.
   */
  isOffline() {
    return this._isOffline();
  }

  /**
   * Fetch full HTML page from Ollama library for a family.
   * Used by L4 OnlineDiscovery for tag parsing.
   *
   * @param {string} family - Model family name (e.g. 'qwen3', 'gemma3')
   * @returns {Promise<string|null>} Raw HTML or null on failure
   */
  async fetchLibraryPage(family) {
    if (this._isOffline()) return null;

    const familyName = family.replace(/:.*/, '');
    const url = `${REGISTRY_BASE}/${encodeURIComponent(familyName)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      const response = await outboundFetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'c3-agent/1.0' },
      }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY);
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      this._failureCount = 0;
      this._offlineSince = null;
      return await response.text();
    } catch (err) {
      this._failureCount++;
      if (this._failureCount >= MAX_FAILURES) {
        this._offlineSince = Date.now();
        logger.warn('RegistryClient', `Offline after ${MAX_FAILURES} failures: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Fetch family seeds from Ollama library index page.
   * Used by guided L4 discovery to discover unknown families dynamically.
   *
   * @param {Object} [opts]
   * @param {number} [opts.limit=LIBRARY_INDEX_LIMIT]
   * @returns {Promise<string[]>}
   */
  async fetchLibraryIndexFamilies(opts = {}) {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0
      ? Math.min(Math.floor(opts.limit), 200)
      : LIBRARY_INDEX_LIMIT;
    const now = Date.now();

    if (this._libraryIndexCache && (now - this._libraryIndexCache.fetchedAt) < LIBRARY_INDEX_CACHE_MS) {
      return this._libraryIndexCache.families.slice(0, limit);
    }

    if (this._isOffline()) {
      return this._libraryIndexCache?.families?.slice(0, limit) || [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await outboundFetch(REGISTRY_BASE, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'c3-agent/1.0' },
      }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY);

      if (!response.ok) {
        return this._libraryIndexCache?.families?.slice(0, limit) || [];
      }

      const html = await response.text();
      const families = this._parseLibraryIndexFamilies(html, Math.max(limit, LIBRARY_INDEX_LIMIT));
      this._libraryIndexCache = { families, fetchedAt: now };
      this._failureCount = 0;
      this._offlineSince = null;
      return families.slice(0, limit);
    } catch (err) {
      this._failureCount++;
      if (this._failureCount >= MAX_FAILURES) {
        this._offlineSince = Date.now();
        logger.warn('RegistryClient', `Offline after ${MAX_FAILURES} failures: ${err.message}`);
      }
      return this._libraryIndexCache?.families?.slice(0, limit) || [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _parseLibraryIndexFamilies(html, limit = LIBRARY_INDEX_LIMIT) {
    if (!html || typeof html !== 'string') return [];
    const boundedLimit = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 200)
      : LIBRARY_INDEX_LIMIT;
    const out = [];
    const seen = new Set();
    const re = /href=["']\/library\/([^"'?#/]+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null && out.length < boundedLimit) {
      let family = m[1];
      try { family = decodeURIComponent(family); } catch (_) {}
      family = String(family || '').split(':')[0].trim().toLowerCase();
      if (!family) continue;
      if (!/^[a-z0-9._-]+$/.test(family)) continue;
      if (seen.has(family)) continue;
      seen.add(family);
      out.push(family);
    }
    return out;
  }

  async _checkRegistry(name) {
    const familyName = name.replace(/:.*/, ''); // Strip params/tag
    const url = `${REGISTRY_BASE}/${familyName}`;

    // Try HEAD first
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      const response = await outboundFetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY);
      clearTimeout(timeoutId);

      if (response.status === 200) return true;
      if (response.status === 404) return false;
      // Other status — fall through to GET
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('HEAD timeout');
      // HEAD failed — try GET fallback
    }

    // GET fallback
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const response = await outboundFetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY);
    clearTimeout(timeoutId);

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw new Error(`Registry HTTP ${response.status}`);
  }

  _isOffline() {
    if (!this._offlineSince) return false;
    if (Date.now() - this._offlineSince >= OFFLINE_RETRY_MS) {
      // Retry window — reset offline
      this._offlineSince = null;
      this._failureCount = 0;
      return false;
    }
    return true;
  }

  _isCacheExpired(verifiedAt) {
    if (!verifiedAt) return true;
    const ageMs = Date.now() - Date.parse(verifiedAt);
    return ageMs > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  _updateCache(name, exists) {
    const now = new Date().toISOString();
    this._cache.set(name, { exists, verifiedAt: now });

    if (this._db) {
      try {
        this._db.prepare(`
          INSERT OR REPLACE INTO model_catalog_cache (model_name, exists_in_registry, verified_at)
          VALUES (?, ?, ?)
        `).run(name, exists ? 1 : 0, now);
      } catch (_) {}
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const registryClient = new RegistryClient();

export default { RegistryClient, registryClient };

// CRE v36.9.3 Memory Policy
// ══════════════════════════════════════════════════════════════════════════════
//
// Simple fact store for session context. No LLM, no magic.
//
// Features:
// - store(key, value, meta): Store a fact with optional TTL, source, tags
// - recall(key): Recall a fact by key
// - recallByTag(tag): Recall all facts with a given tag
// - forget(key): Explicitly remove a fact
// - TTL-based expiration (checked on recall)
// - Namespace support (user.*, session.*, tool.*)
//
// Stop-condition:
//   memory.store({ key: 'user.budget', value: '200000' }) → stored
//   memory.recall({ key: 'user.budget' }) → '200000'
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// MEMORY ENTRY
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MemoryEntry
 * @property {string} key
 * @property {*} value
 * @property {number} storedAt
 * @property {number|null} expiresAt - null = never expires
 * @property {string} source - who stored it (tool, user, system)
 * @property {string[]} tags - for category-based recall
 * @property {number} accessCount
 * @property {number} lastAccessedAt
 */

// ════════════════════════════════════════════════════════════════════════════
// MEMORY POLICY
// ════════════════════════════════════════════════════════════════════════════

export class MemoryPolicy {
  constructor(options = {}) {
    this.store = new Map();
    this.maxEntries = options.maxEntries || 500;
    this.defaultTTL = options.defaultTTL || null; // null = no expiry
    this.onEvict = options.onEvict || null; // callback(key, entry)
  }

  /**
   * Store a fact
   *
   * @param {string} key - Dot-notation key (e.g. 'user.budget', 'session.lastTool')
   * @param {*} value - Any serializable value
   * @param {Object} [meta]
   * @param {number} [meta.ttl] - Time to live in ms (null = forever)
   * @param {string} [meta.source] - Origin: 'user', 'tool', 'system'
   * @param {string[]} [meta.tags] - Category tags
   * @returns {{ stored: true, key: string }}
   */
  set(key, value, meta = {}) {
    if (!key || typeof key !== 'string') {
      return { error: 'Key must be a non-empty string', code: 'INVALID_KEY' };
    }

    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictOldest();
    }

    const ttl = meta.ttl ?? this.defaultTTL;
    const entry = {
      key,
      value,
      storedAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : null,
      source: meta.source || 'system',
      tags: meta.tags || [],
      accessCount: 0,
      lastAccessedAt: null,
    };

    this.store.set(key, entry);
    logger.debug('MemoryPolicy', `Stored: ${key}`, { source: entry.source, tags: entry.tags });

    return { stored: true, key };
  }

  /**
   * Recall a fact by key
   *
   * @param {string} key
   * @returns {* | { error: string, code: string }}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return { error: `Key not found: ${key}`, code: 'NOT_FOUND' };
    }

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return { error: `Key expired: ${key}`, code: 'EXPIRED' };
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    return { value: entry.value, meta: { source: entry.source, tags: entry.tags, storedAt: entry.storedAt } };
  }

  /**
   * Recall all facts matching a tag
   *
   * @param {string} tag
   * @returns {Array<{ key: string, value: * }>}
   */
  getByTag(tag) {
    const results = [];
    const now = Date.now();

    for (const [key, entry] of this.store) {
      // Skip expired
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (entry.tags.includes(tag)) {
        entry.accessCount++;
        entry.lastAccessedAt = now;
        results.push({ key, value: entry.value });
      }
    }

    return results;
  }

  /**
   * Recall all facts matching a namespace prefix
   * e.g. getByPrefix('user.') returns all user.* keys
   *
   * @param {string} prefix
   * @returns {Array<{ key: string, value: * }>}
   */
  getByPrefix(prefix) {
    const results = [];
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) {
        entry.accessCount++;
        entry.lastAccessedAt = now;
        results.push({ key, value: entry.value });
      }
    }

    return results;
  }

  /**
   * Forget a fact (explicit deletion)
   *
   * @param {string} key
   * @returns {{ deleted: boolean, key: string }}
   */
  forget(key) {
    const existed = this.store.delete(key);
    if (existed) {
      logger.debug('MemoryPolicy', `Forgot: ${key}`);
    }
    return { deleted: existed, key };
  }

  /**
   * Check if key exists (and is not expired)
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get memory stats
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expired++;
      }
    }
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      expired,
      bySource: this.countByField('source'),
      byTag: this.countTags(),
    };
  }

  /**
   * Clear all entries
   */
  clear() {
    this.store.clear();
    logger.debug('MemoryPolicy', 'Memory cleared');
  }

  /**
   * Evict oldest entry (by storedAt)
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.store) {
      if (entry.storedAt < oldestTime) {
        oldestTime = entry.storedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.store.get(oldestKey);
      this.store.delete(oldestKey);
      if (this.onEvict) this.onEvict(oldestKey, entry);
      logger.debug('MemoryPolicy', `Evicted: ${oldestKey}`);
    }
  }

  countByField(field) {
    const counts = {};
    for (const entry of this.store.values()) {
      const val = entry[field] || 'unknown';
      counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  }

  countTags() {
    const counts = {};
    for (const entry of this.store.values()) {
      for (const tag of entry.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    return counts;
  }
}

// Singleton
export const memory = new MemoryPolicy();

export default MemoryPolicy;

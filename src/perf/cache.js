// Plan & Result Cache v47.0
// ══════════════════════════════════════════════════════════════════════════════
//
// LRU cache for:
// - Plan templates (avoid regenerating similar plans)
// - Tool results (avoid re-fetching)
// - LLM responses (expensive calls)
//
// Features:
// - TTL-based expiration
// - LRU eviction
// - Size limits
// - Hit/miss stats
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// LRU CACHE
// ════════════════════════════════════════════════════════════════════════════

class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.name = options.name || 'cache';

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expired: 0,
    };
  }

  /**
   * Get a value from cache
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.expired++;
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key, value, ttl = this.ttl) {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    // Remove existing entry (to update position)
    this.cache.delete(key);

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    });

    return this;
  }

  /**
   * Check if key exists (without affecting LRU order)
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Evict oldest entry (first in map)
   */
  evictOldest() {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get cache stats
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0,
    };
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, evictions: 0, expired: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SPECIALIZED CACHES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Plan Template Cache
 *
 * Caches plan templates keyed by goal similarity hash.
 * Useful for repeated similar requests.
 */
class PlanCache extends LRUCache {
  constructor(options = {}) {
    super({
      name: 'plan-cache',
      maxSize: options.maxSize || 50,
      ttl: options.ttl || 30 * 60 * 1000, // 30 minutes
      ...options,
    });
  }

  /**
   * Generate a cache key for a goal
   */
  keyFor(goal) {
    // Normalize goal description
    const normalized = goal.toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    // Hash it
    return createHash('sha256')
      .update(normalized)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get a cached plan for a goal
   */
  getPlan(goal) {
    const key = this.keyFor(goal);
    return this.get(key);
  }

  /**
   * Cache a plan for a goal
   */
  setPlan(goal, plan) {
    const key = this.keyFor(goal);
    return this.set(key, plan);
  }
}

/**
 * Tool Result Cache
 *
 * Caches tool execution results.
 * Only caches idempotent/safe tools.
 */
class ToolResultCache extends LRUCache {
  constructor(options = {}) {
    super({
      name: 'tool-result-cache',
      maxSize: options.maxSize || 200,
      ttl: options.ttl || 5 * 60 * 1000, // 5 minutes
      ...options,
    });

    // Tools that are safe to cache
    this.cacheableTools = new Set([
      'web.search',
      'web.fetch',
      'fs.read',
      'data.parse',
      'memory.recall',
    ]);
  }

  /**
   * Check if tool results can be cached
   */
  isCacheable(tool) {
    return this.cacheableTools.has(tool);
  }

  /**
   * Generate a cache key for a tool call
   */
  keyFor(tool, params) {
    const input = JSON.stringify({ tool, params });
    return createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get cached tool result
   */
  getResult(tool, params) {
    if (!this.isCacheable(tool)) return undefined;

    const key = this.keyFor(tool, params);
    return this.get(key);
  }

  /**
   * Cache a tool result
   */
  setResult(tool, params, result, ttl) {
    if (!this.isCacheable(tool)) return this;

    const key = this.keyFor(tool, params);
    return this.set(key, result, ttl);
  }

  /**
   * Add a cacheable tool
   */
  addCacheableTool(tool) {
    this.cacheableTools.add(tool);
  }
}

/**
 * LLM Response Cache
 *
 * Caches LLM responses for deterministic prompts.
 * Longer TTL since LLM calls are expensive.
 */
class LLMCache extends LRUCache {
  constructor(options = {}) {
    super({
      name: 'llm-cache',
      maxSize: options.maxSize || 100,
      ttl: options.ttl || 60 * 60 * 1000, // 1 hour
      ...options,
    });
  }

  /**
   * Generate a cache key for a prompt
   */
  keyFor(prompt, model = 'default') {
    const input = JSON.stringify({ prompt, model });
    return createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get cached LLM response
   */
  getResponse(prompt, model) {
    const key = this.keyFor(prompt, model);
    const cached = this.get(key);

    if (cached) {
      logger.debug('LLMCache', 'Cache hit', { keyPrefix: key.substring(0, 8) });
    }

    return cached;
  }

  /**
   * Cache an LLM response
   */
  setResponse(prompt, model, response, ttl) {
    const key = this.keyFor(prompt, model);
    return this.set(key, response, ttl);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CACHE MANAGER
// ════════════════════════════════════════════════════════════════════════════

class CacheManager {
  constructor() {
    this.plans = new PlanCache();
    this.tools = new ToolResultCache();
    this.llm = new LLMCache();
  }

  /**
   * Get all cache stats
   */
  getStats() {
    return {
      plans: this.plans.getStats(),
      tools: this.tools.getStats(),
      llm: this.llm.getStats(),
    };
  }

  /**
   * Clear all caches
   */
  clearAll() {
    this.plans.clear();
    this.tools.clear();
    this.llm.clear();
    logger.info('CacheManager', 'All caches cleared');
  }

  /**
   * Log cache stats
   */
  log() {
    const stats = this.getStats();
    logger.info('CacheManager', 'Cache Stats', {
      plans: `${stats.plans.hitRate}% hit rate (${stats.plans.size} entries)`,
      tools: `${stats.tools.hitRate}% hit rate (${stats.tools.size} entries)`,
      llm: `${stats.llm.hitRate}% hit rate (${stats.llm.size} entries)`,
    });
    return stats;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export const cacheManager = new CacheManager();
export const planCache = cacheManager.plans;
export const toolResultCache = cacheManager.tools;
export const llmCache = cacheManager.llm;

export {
  LRUCache,
  PlanCache,
  ToolResultCache,
  LLMCache,
  CacheManager,
};

export default {
  cacheManager,
  planCache,
  toolResultCache,
  llmCache,
  LRUCache,
};

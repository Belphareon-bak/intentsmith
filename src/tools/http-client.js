// CRE v36.9.2 SafeHttpClient
// ══════════════════════════════════════════════════════════════════════════════
//
// HTTP client for tool execution. No LLM, no magic.
//
// Features:
// - Per-domain rate limiting
// - Retry with exponential backoff (on 5xx/network errors)
// - Configurable timeout
// - User-agent rotation
// - Normalized error responses
//
// Stop-condition: HTTP request FIRES even if response is empty.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// USER AGENTS
// ════════════════════════════════════════════════════════════════════════════

const USER_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// ════════════════════════════════════════════════════════════════════════════
// RATE LIMITER
// ════════════════════════════════════════════════════════════════════════════

class DomainRateLimiter {
  constructor(options = {}) {
    this.limits = new Map(); // domain → { tokens, lastRefill, maxTokens, refillRate }
    this.defaultMaxTokens = options.maxTokensPerDomain || 10;
    this.defaultRefillRate = options.refillRateMs || 1000; // 1 token per second
  }

  /**
   * Extract domain from URL
   */
  getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get or create bucket for domain
   */
  getBucket(domain) {
    if (!this.limits.has(domain)) {
      this.limits.set(domain, {
        tokens: this.defaultMaxTokens,
        lastRefill: Date.now(),
        maxTokens: this.defaultMaxTokens,
        refillRate: this.defaultRefillRate,
      });
    }
    return this.limits.get(domain);
  }

  /**
   * Refill tokens based on elapsed time
   */
  refill(bucket) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const newTokens = Math.floor(elapsed / bucket.refillRate);
    if (newTokens > 0) {
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + newTokens);
      bucket.lastRefill = now;
    }
  }

  /**
   * Try to consume a token. Returns { allowed, retryAfterMs }
   */
  consume(url) {
    const domain = this.getDomain(url);
    const bucket = this.getBucket(domain);
    this.refill(bucket);

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return { allowed: true };
    }

    const retryAfterMs = bucket.refillRate - (Date.now() - bucket.lastRefill);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  /**
   * Override limits for a specific domain
   */
  setDomainLimit(domain, maxTokens, refillRateMs) {
    this.limits.set(domain, {
      tokens: maxTokens,
      lastRefill: Date.now(),
      maxTokens,
      refillRate: refillRateMs,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SAFE HTTP CLIENT
// ════════════════════════════════════════════════════════════════════════════

export class SafeHttpClient {
  constructor(options = {}) {
    this.rateLimiter = new DomainRateLimiter(options.rateLimiter);
    this.defaultTimeout = options.timeout || 15000;
    this.maxRetries = options.maxRetries || 3;
    this.retryBaseDelay = options.retryBaseDelay || 1000;
    this.uaIndex = 0;
  }

  /**
   * Get next user-agent (round-robin)
   */
  getNextUserAgent() {
    const ua = USER_AGENTS[this.uaIndex % USER_AGENTS.length];
    this.uaIndex++;
    return ua;
  }

  /**
   * Execute HTTP request with rate limiting, retry, timeout
   *
   * @param {string} url
   * @param {Object} options
   * @param {string} [options.method='GET']
   * @param {Object} [options.headers={}]
   * @param {*} [options.body]
   * @param {number} [options.timeout]
   * @param {number} [options.maxRetries]
   * @returns {Promise<{ok: boolean, status: number, body: string, headers: Object, duration: number} | {ok: false, error: string, code: string}>}
   */
  async request(url, options = {}) {
    const startTime = Date.now();
    const method = options.method || 'GET';
    const timeout = options.timeout || this.defaultTimeout;
    const maxRetries = options.maxRetries ?? this.maxRetries;

    // Rate limit check
    const rateCheck = this.rateLimiter.consume(url);
    if (!rateCheck.allowed) {
      logger.warn('SafeHttpClient', `Rate limited for ${url}`, { retryAfterMs: rateCheck.retryAfterMs });
      return {
        ok: false,
        error: `Rate limited. Retry after ${rateCheck.retryAfterMs}ms`,
        code: 'RATE_LIMITED',
        retryAfterMs: rateCheck.retryAfterMs,
      };
    }

    // Build headers
    const headers = {
      'User-Agent': this.getNextUserAgent(),
      ...options.headers,
    };

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchOptions = {
          method,
          headers,
          signal: controller.signal,
        };

        if (options.body) {
          if (typeof options.body === 'object') {
            fetchOptions.body = JSON.stringify(options.body);
            if (!headers['Content-Type']) {
              headers['Content-Type'] = 'application/json';
            }
          } else {
            fetchOptions.body = options.body;
          }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        const body = await response.text();
        const duration = Date.now() - startTime;

        // Don't retry on 4xx (client errors)
        if (response.status >= 400 && response.status < 500) {
          return {
            ok: false,
            status: response.status,
            body,
            headers: Object.fromEntries(response.headers.entries()),
            duration,
            error: `HTTP ${response.status}`,
            code: 'HTTP_CLIENT_ERROR',
          };
        }

        // Retry on 5xx
        if (response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${body.substring(0, 200)}`);
          if (attempt < maxRetries) {
            await this.sleep(this.retryBaseDelay * attempt);
            continue;
          }
          return {
            ok: false,
            status: response.status,
            body,
            headers: Object.fromEntries(response.headers.entries()),
            duration,
            error: `HTTP ${response.status} after ${maxRetries} attempts`,
            code: 'HTTP_SERVER_ERROR',
          };
        }

        // Success
        return {
          ok: true,
          status: response.status,
          body,
          headers: Object.fromEntries(response.headers.entries()),
          duration,
        };

      } catch (err) {
        lastError = err;

        if (err.name === 'AbortError') {
          logger.warn('SafeHttpClient', `Timeout ${timeout}ms (attempt ${attempt}/${maxRetries}): ${url}`);
          lastError = new Error(`Timeout after ${timeout}ms`);
        } else {
          logger.warn('SafeHttpClient', `Network error (attempt ${attempt}/${maxRetries}): ${err.message}`);
        }

        if (attempt < maxRetries) {
          await this.sleep(this.retryBaseDelay * attempt);
        }
      }
    }

    return {
      ok: false,
      error: lastError?.message || 'Unknown error',
      code: 'NETWORK_ERROR',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Convenience: GET request
   */
  async get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  /**
   * Convenience: POST request
   */
  async post(url, body, options = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  /**
   * Set rate limit for specific domain
   */
  setDomainLimit(domain, maxTokens, refillRateMs) {
    this.rateLimiter.setDomainLimit(domain, maxTokens, refillRateMs);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const httpClient = new SafeHttpClient();

export default SafeHttpClient;

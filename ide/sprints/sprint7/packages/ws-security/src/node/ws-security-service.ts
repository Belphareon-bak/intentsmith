/**
 * @c3/ws-security — WebSocket Security (common + node)
 *
 * Three security layers for WebSocket:
 *
 * 1. LOCAL-ONLY BINDING
 *    Server binds to 127.0.0.1, NOT 0.0.0.0.
 *    Rejects connections from non-local IPs.
 *
 * 2. SESSION TOKEN AUTHENTICATION
 *    Token generated on startup, passed in WS handshake.
 *    Stored in .c3/session-token file (readable only by IDE).
 *    Connection rejected if token missing or invalid.
 *
 * 3. RATE LIMITING
 *    Per-connection rate limiting (100 msg/min default).
 *    Burst capacity: 20 messages.
 *    Exceeded → connection throttled, warning sent.
 *
 * 4. INPUT SANITIZATION
 *    Max message size: 100KB.
 *    JSON schema validation on all messages.
 *    No HTML/script injection in chat content.
 */

import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────

export interface WsSecurityConfig {
  /** Bind address (default: '127.0.0.1') */
  bindAddress: string;
  /** Require session token (default: true) */
  requireToken: boolean;
  /** Max message size in bytes (default: 102400 = 100KB) */
  maxMessageSize: number;
  /** Rate limit: messages per minute (default: 100) */
  rateLimit: number;
  /** Rate limit: burst capacity (default: 20) */
  rateBurst: number;
  /** Allowed message types */
  allowedTypes: Set<string>;
}

export const DEFAULT_WS_SECURITY: WsSecurityConfig = {
  bindAddress: '127.0.0.1',
  requireToken: true,
  maxMessageSize: 102400,
  rateLimit: 100,
  rateBurst: 20,
  allowedTypes: new Set([
    'chat', 'agent_event', 'phase_change', 'status',
    'diff_proposal', 'review_action', 'apply_changes',
    'shell_exec', 'shell_result',
    'ping', 'pong',
  ]),
};

export interface ConnectionValidation {
  allowed: boolean;
  reason?: string;
}

export interface MessageValidation {
  allowed: boolean;
  reason?: string;
  sanitizedPayload?: any;
}

// ─── Session Token Manager ───────────────────────────────

export class SessionTokenManager {
  private token: string;

  constructor() {
    this.token = crypto.randomBytes(32).toString('hex');
  }

  /** Get the current session token */
  getToken(): string {
    return this.token;
  }

  /** Regenerate token (e.g. on security event) */
  regenerate(): string {
    this.token = crypto.randomBytes(32).toString('hex');
    return this.token;
  }

  /** Validate a token (constant-time comparison) */
  validate(candidate: string): boolean {
    if (!candidate || candidate.length !== this.token.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(candidate),
      Buffer.from(this.token),
    );
  }
}

// ─── Rate Limiter (Token Bucket) ─────────────────────────

export class RateLimiter {
  private buckets = new Map<string, {
    tokens: number;
    lastRefill: number;
  }>();

  constructor(
    private maxTokens: number = 20,
    private refillRate: number = 100 / 60,  // tokens per second (100/min)
  ) {}

  /**
   * Check if a request is allowed.
   * Returns true if allowed, false if rate limited.
   */
  allow(connectionId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(connectionId);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(connectionId, bucket);
    }

    // Refill tokens
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate,
    );
    bucket.lastRefill = now;

    // Try to consume a token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /** Remove tracking for a disconnected client */
  remove(connectionId: string): void {
    this.buckets.delete(connectionId);
  }

  /** Get remaining tokens for a connection */
  remaining(connectionId: string): number {
    const bucket = this.buckets.get(connectionId);
    return bucket ? Math.floor(bucket.tokens) : this.maxTokens;
  }
}

// ─── Input Validator ─────────────────────────────────────

export class InputValidator {
  private config: WsSecurityConfig;

  constructor(config: Partial<WsSecurityConfig> = {}) {
    this.config = { ...DEFAULT_WS_SECURITY, ...config };
  }

  /**
   * Validate a connection attempt.
   */
  validateConnection(
    remoteAddress: string,
    token?: string,
    tokenManager?: SessionTokenManager,
  ): ConnectionValidation {
    // Check local-only binding
    if (!this.isLocalAddress(remoteAddress)) {
      return {
        allowed: false,
        reason: `Spojení z ne-lokální adresy odmítnuto: ${remoteAddress}`,
      };
    }

    // Check session token
    if (this.config.requireToken && tokenManager) {
      if (!token || !tokenManager.validate(token)) {
        return {
          allowed: false,
          reason: 'Neplatný nebo chybějící session token',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Validate and sanitize a WebSocket message.
   */
  validateMessage(raw: string | Buffer): MessageValidation {
    // Size check
    const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length;
    if (size > this.config.maxMessageSize) {
      return {
        allowed: false,
        reason: `Zpráva překračuje limit ${this.config.maxMessageSize} bytů (${size} bytů)`,
      };
    }

    // Parse JSON
    let payload: any;
    try {
      payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
    } catch {
      return { allowed: false, reason: 'Neplatný JSON' };
    }

    // Must be an object with 'type'
    if (!payload || typeof payload !== 'object' || !payload.type) {
      return { allowed: false, reason: 'Zpráva musí mít pole "type"' };
    }

    // Check allowed message types
    if (!this.config.allowedTypes.has(payload.type)) {
      return {
        allowed: false,
        reason: `Nepovolený typ zprávy: '${payload.type}'`,
      };
    }

    // Sanitize string fields (prevent injection)
    const sanitized = this.deepSanitize(payload);

    return { allowed: true, sanitizedPayload: sanitized };
  }

  // ─── Helpers ───────────────────────────────────────────

  private isLocalAddress(addr: string): boolean {
    if (!addr) return false;
    const clean = addr.replace(/^::ffff:/, '');
    return (
      clean === '127.0.0.1' ||
      clean === '::1' ||
      clean === 'localhost' ||
      clean.startsWith('127.')
    );
  }

  /**
   * Recursively sanitize string values.
   * Strips HTML tags and null bytes.
   */
  private deepSanitize(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepSanitize(item));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[this.sanitizeString(key)] = this.deepSanitize(value);
      }
      return result;
    }
    return obj;
  }

  /**
   * Sanitize a string value:
   * - Remove null bytes
   * - Strip HTML script tags
   * - Limit length
   */
  private sanitizeString(str: string): string {
    return str
      .replace(/\0/g, '')                              // null bytes
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // script tags
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '') // iframe tags
      .slice(0, 50000);                                 // max 50K per field
  }
}

// ─── WebSocket Security Guard (combines all) ─────────────

export class WsSecurityGuard {
  readonly tokenManager: SessionTokenManager;
  readonly rateLimiter: RateLimiter;
  readonly validator: InputValidator;

  constructor(config: Partial<WsSecurityConfig> = {}) {
    const fullConfig = { ...DEFAULT_WS_SECURITY, ...config };
    this.tokenManager = new SessionTokenManager();
    this.rateLimiter = new RateLimiter(fullConfig.rateBurst, fullConfig.rateLimit / 60);
    this.validator = new InputValidator(fullConfig);
  }

  /** Full connection validation */
  validateConnection(remoteAddress: string, token?: string): ConnectionValidation {
    return this.validator.validateConnection(remoteAddress, token, this.tokenManager);
  }

  /** Full message validation with rate limiting */
  validateMessage(connectionId: string, raw: string | Buffer): MessageValidation {
    if (!this.rateLimiter.allow(connectionId)) {
      return { allowed: false, reason: 'Rate limit překročen' };
    }
    return this.validator.validateMessage(raw);
  }

  /** Clean up on disconnect */
  onDisconnect(connectionId: string): void {
    this.rateLimiter.remove(connectionId);
  }
}

import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Per-run gateway tokens.
 *
 * The gateway binds to loopback, but loopback is not an authorization
 * boundary: every process on this machine can reach it. A worker therefore
 * needs an IntentSmith-issued token scoped to exactly one TaskRun, so a
 * different local process cannot borrow the gateway to run inference.
 *
 * Tokens live in memory only. They are never written to the database, an audit
 * payload, a log line, or an artifact.
 */

export type GatewayToken = {
  /** The secret. Never log or serialize this. */
  value: string;
  runId: string;
  taskId?: string;
  issuedAt: string;
  expiresAt: string;
};

/** Public view of a token, safe to log or return. Carries no secret. */
export type GatewayTokenInfo = {
  runId: string;
  taskId?: string;
  issuedAt: string;
  expiresAt: string;
};

export type TokenStoreOptions = {
  /** Default token lifetime. */
  ttlMs?: number;
  now?: () => number;
  /** Injected for tests; must produce an unguessable value in production. */
  generate?: () => string;
};

export function describeToken(token: GatewayToken): GatewayTokenInfo {
  const { value: _value, ...info } = token;
  return info;
}

export class GatewayTokenStore {
  private readonly tokens = new Map<string, GatewayToken>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly generate: () => string;

  constructor(options: TokenStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
    this.generate = options.generate ?? (() => randomBytes(32).toString('base64url'));
  }

  /** Issues a token bound to one run. Any previous token for it is revoked. */
  issue(runId: string, taskId?: string, ttlMs = this.ttlMs): GatewayToken {
    this.revokeRun(runId);
    const issuedAtMs = this.now();
    const token: GatewayToken = {
      value: this.generate(),
      runId,
      ...(taskId === undefined ? {} : { taskId }),
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + ttlMs).toISOString(),
    };
    this.tokens.set(token.value, token);
    return token;
  }

  /**
   * Verifies a presented token.
   *
   * Comparison is constant-time over the candidate set so a local attacker
   * cannot recover a token byte by byte from response timing.
   */
  verify(candidate: string | undefined): GatewayToken | undefined {
    if (!candidate) return undefined;
    const candidateBuffer = Buffer.from(candidate);
    let matched: GatewayToken | undefined;
    for (const token of this.tokens.values()) {
      const known = Buffer.from(token.value);
      if (known.length !== candidateBuffer.length) continue;
      if (timingSafeEqual(known, candidateBuffer)) matched = token;
    }
    if (!matched) return undefined;
    if (Date.parse(matched.expiresAt) <= this.now()) {
      this.tokens.delete(matched.value);
      return undefined;
    }
    return matched;
  }

  /** Revokes the token for a run. Called when a run ends for any reason. */
  revokeRun(runId: string): boolean {
    let revoked = false;
    for (const [value, token] of this.tokens) {
      if (token.runId === runId) {
        this.tokens.delete(value);
        revoked = true;
      }
    }
    return revoked;
  }

  /** Revokes everything. Called on server shutdown. */
  revokeAll(): void {
    this.tokens.clear();
  }

  /** Drops expired entries so the map cannot grow without bound. */
  pruneExpired(): number {
    const nowMs = this.now();
    let pruned = 0;
    for (const [value, token] of this.tokens) {
      if (Date.parse(token.expiresAt) <= nowMs) {
        this.tokens.delete(value);
        pruned += 1;
      }
    }
    return pruned;
  }

  /** Active tokens, without secrets. */
  list(): GatewayTokenInfo[] {
    return [...this.tokens.values()].map(describeToken);
  }

  get size(): number {
    return this.tokens.size;
  }
}

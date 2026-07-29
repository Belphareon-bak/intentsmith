/**
 * Secret redaction for worker output.
 *
 * A worker holds its gateway token in an environment variable, so the token is
 * one `echo $INTENTSMITH_GATEWAY_TOKEN` away from stdout. It must be treated as
 * compromisable and scrubbed from everything IntentSmith stores or shows.
 *
 * Redaction happens at the boundary where untrusted text enters IntentSmith,
 * not at each place text is written out. Scrubbing at every sink is a list that
 * is always one sink out of date; scrubbing on entry means a new sink inherits
 * the protection automatically.
 */

export const REDACTED = '[redacted:gateway-token]';

/** Shortest secret worth matching; below this, substring matching is noise. */
const MIN_SECRET_LENGTH = 8;

export type Redactor = {
  /** Replaces every occurrence of every registered secret in a string. */
  text(value: string): string;
  /** Deep-redacts any JSON-serializable value, preserving its shape. */
  value<T>(value: T): T;
  /** True when the value still contains a secret. For assertions. */
  leaks(value: unknown): boolean;
  /** Registers another secret, e.g. a token re-issued mid-run. */
  add(secret: string): void;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a redactor for a set of secrets.
 *
 * Secrets shorter than {@link MIN_SECRET_LENGTH} are ignored: matching a short
 * string would corrupt unrelated output without meaningfully protecting
 * anything.
 */
export function createRedactor(secrets: readonly string[] = []): Redactor {
  const registered = new Set<string>();
  let pattern: RegExp | undefined;

  const rebuild = (): void => {
    if (registered.size === 0) {
      pattern = undefined;
      return;
    }
    // Longest first, so a secret that contains another is replaced whole.
    const alternatives = [...registered]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    pattern = new RegExp(alternatives, 'g');
  };

  const add = (secret: string): void => {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return;
    registered.add(secret);
    // Base64url tokens often appear percent- or JSON-escaped in transit.
    try {
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) registered.add(encoded);
    } catch {
      // Nothing to add.
    }
    rebuild();
  };

  for (const secret of secrets) add(secret);

  const text = (value: string): string => {
    if (!pattern || typeof value !== 'string') return value;
    // `replace` with a global regex needs a fresh lastIndex each call.
    pattern.lastIndex = 0;
    return value.replace(pattern, REDACTED);
  };

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 12) return value;
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        // A secret can hide in a key as easily as in a value.
        out[text(key)] = walk(inner, depth + 1);
      }
      return out;
    }
    return value;
  };

  return {
    text,
    value: <T>(value: T): T => walk(value, 0) as T,
    leaks: (value: unknown): boolean => {
      if (registered.size === 0) return false;
      const serialized = typeof value === 'string' ? value : safeStringify(value);
      return [...registered].some(secret => serialized.includes(secret));
    },
    add,
  };
}

/** Stringify that survives cycles, for leak checking only. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, inner: unknown) => {
      if (inner && typeof inner === 'object') {
        if (seen.has(inner as object)) return '[circular]';
        seen.add(inner as object);
      }
      return inner;
    }) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * Asserts a value carries no registered secret.
 *
 * Used as a last line of defence immediately before something is persisted,
 * audited or returned, so a missed redaction path fails loudly in tests rather
 * than silently writing a token to disk.
 */
export function assertRedacted(redactor: Redactor, value: unknown, context: string): void {
  if (redactor.leaks(value)) {
    throw new Error(`A per-run secret leaked into ${context}.`);
  }
}

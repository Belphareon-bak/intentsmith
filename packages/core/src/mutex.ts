/**
 * Serializes async work per key.
 *
 * Lifecycle commands for one task must not interleave: Phase 1 allowed two
 * concurrent `start` calls to both read `pending` before either wrote
 * `running`. Commands for different tasks stay independent.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(fn, fn);
    // Swallow the outcome so one rejection does not poison later waiters.
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    try {
      return await current;
    } finally {
      // Drop the entry once this call is the last one queued for the key.
      if (this.tails.get(key) === settled) this.tails.delete(key);
    }
  }
}

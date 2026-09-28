// Bounded object-URL cache for legacy local media responses.
//
// The caller supplies the already-authorized fetch implementation. Pending
// loads carry an ownership record so invalidate/retain/clear cannot be undone
// by a late response.
'use strict';

function createLegacyLocalObjectUrlCache({
  fetchImpl,
  createObjectURL,
  revokeObjectURL,
  AbortControllerImpl = globalThis.AbortController,
  maxEntries = 24,
  maxPending = 64,
  maxFailures = 256,
  failureTtlMs = 60_000,
  now = Date.now,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('object URL cache requires fetchImpl');
  }
  if (typeof createObjectURL !== 'function') {
    throw new TypeError('object URL cache requires createObjectURL');
  }
  if (typeof revokeObjectURL !== 'function') {
    throw new TypeError('object URL cache requires revokeObjectURL');
  }
  if (typeof AbortControllerImpl !== 'function') {
    throw new TypeError('object URL cache requires AbortController');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) {
    throw new TypeError('object URL cache maxEntries must be 1..256');
  }
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 256) {
    throw new TypeError('object URL cache maxPending must be 1..256');
  }
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 256) {
    throw new TypeError('object URL cache maxFailures must be 1..256');
  }
  if (
    !Number.isInteger(failureTtlMs)
    || failureTtlMs < 1
    || failureTtlMs > 3_600_000
  ) {
    throw new TypeError('object URL cache failureTtlMs must be 1..3600000');
  }
  if (typeof now !== 'function') {
    throw new TypeError('object URL cache now must be a function');
  }

  const entries = new Map();
  const pending = new Map();
  const failures = new Map();

  function normalizeKey(target) {
    if (typeof target !== 'string' || target.length === 0) {
      throw new TypeError('object URL cache target must be a non-empty string');
    }
    return target;
  }

  function revokeEntry(key) {
    const objectUrl = entries.get(key);
    if (!objectUrl) return false;
    try {
      revokeObjectURL(objectUrl);
    } finally {
      entries.delete(key);
    }
    return true;
  }

  function cancelPending(key) {
    const record = pending.get(key);
    if (!record) return false;
    record.active = false;
    pending.delete(key);
    record.controller.abort();
    return true;
  }

  function currentTime() {
    const value = now();
    if (!Number.isFinite(value)) {
      throw new TypeError('object URL cache now must return a finite number');
    }
    return value;
  }

  function purgeExpiredFailures(at = currentTime()) {
    for (const [key, expiresAt] of failures) {
      if (expiresAt <= at) failures.delete(key);
    }
  }

  function hasFreshFailure(key) {
    const expiresAt = failures.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= currentTime()) {
      failures.delete(key);
      return false;
    }
    failures.delete(key);
    failures.set(key, expiresAt);
    return true;
  }

  function recordFailure(key) {
    const at = currentTime();
    purgeExpiredFailures(at);
    failures.delete(key);
    failures.set(key, at + failureTtlMs);
    while (failures.size > maxFailures) {
      failures.delete(failures.keys().next().value);
    }
  }

  function invalidate(target) {
    const key = normalizeKey(target);
    const cancelled = cancelPending(key);
    const revoked = revokeEntry(key);
    const forgotten = failures.delete(key);
    return cancelled || revoked || forgotten;
  }

  function evictCompletedEntries() {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      revokeEntry(oldest);
    }
  }

  function evictPendingLoads() {
    while (pending.size >= maxPending) {
      const oldest = pending.keys().next().value;
      cancelPending(oldest);
    }
  }

  function peek(target) {
    const key = normalizeKey(target);
    const objectUrl = entries.get(key);
    if (!objectUrl) return null;
    entries.delete(key);
    entries.set(key, objectUrl);
    return objectUrl;
  }

  function load(target) {
    const key = normalizeKey(target);
    const cached = peek(key);
    if (cached) return Promise.resolve(cached);
    const current = pending.get(key);
    if (current) return current.promise;
    if (hasFreshFailure(key)) return Promise.resolve(null);

    evictPendingLoads();
    const controller = new AbortControllerImpl();
    const record = {
      active: true,
      controller,
      promise: null,
    };
    const ownsPendingLoad = () => (
      record.active && pending.get(key) === record
    );

    record.promise = Promise.resolve()
      .then(() => {
        if (!ownsPendingLoad()) return null;
        return fetchImpl(key, { signal: controller.signal });
      })
      .then(response => {
        if (!ownsPendingLoad()) return null;
        if (!response || response.ok !== true) {
          const status = response?.status ?? 'unknown';
          throw new Error(`HTTP ${status}`);
        }
        return response.blob();
      })
      .then(blob => {
        if (!ownsPendingLoad()) {
          return null;
        }
        const objectUrl = createObjectURL(blob);
        if (!ownsPendingLoad()) {
          revokeObjectURL(objectUrl);
          return null;
        }
        failures.delete(key);
        entries.set(key, objectUrl);
        evictCompletedEntries();
        return objectUrl;
      })
      .catch(error => {
        if (
          ownsPendingLoad()
          && !entries.has(key)
          && error?.name !== 'AbortError'
        ) {
          recordFailure(key);
        }
        return null;
      })
      .finally(() => {
        if (pending.get(key) === record) {
          pending.delete(key);
        }
      });

    pending.set(key, record);
    return record.promise;
  }

  function knownKeys() {
    purgeExpiredFailures();
    return new Set([
      ...entries.keys(),
      ...pending.keys(),
      ...failures.keys(),
    ]);
  }

  function invalidateWhere(predicate) {
    if (typeof predicate !== 'function') {
      throw new TypeError('object URL cache predicate must be a function');
    }
    let count = 0;
    for (const key of knownKeys()) {
      if (predicate(key) && invalidate(key)) count++;
    }
    return count;
  }

  function retain(targets) {
    if (
      typeof targets === 'string'
      || targets == null
      || typeof targets[Symbol.iterator] !== 'function'
    ) {
      throw new TypeError('object URL cache retain targets must be an iterable');
    }
    const keep = new Set(Array.from(targets, normalizeKey));
    return invalidateWhere(key => !keep.has(key));
  }

  function clear() {
    return invalidateWhere(() => true);
  }

  function stats() {
    purgeExpiredFailures();
    return Object.freeze({
      completed: entries.size,
      pending: pending.size,
      failed: failures.size,
      maxEntries,
      maxPending,
      maxFailures,
      failureTtlMs,
    });
  }

  return Object.freeze({
    clear,
    invalidate,
    invalidateWhere,
    load,
    peek,
    retain,
    stats,
  });
}

module.exports = {
  createLegacyLocalObjectUrlCache,
};

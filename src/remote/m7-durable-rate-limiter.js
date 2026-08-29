import {
  isGenuineM7TransportRateLimitPlan,
} from './m7-transport-admission-policy.js';

export const M7_DURABLE_RATE_LIMITER_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_DURABLE_RATE_LIMIT_ERROR = Object.freeze({
  CAPACITY_EXCEEDED: 'M7_RATE_LIMIT_CAPACITY_EXCEEDED',
  CLOCK_REGRESSION: 'M7_RATE_LIMIT_CLOCK_REGRESSION',
  CONFIG_DRIFT: 'M7_RATE_LIMIT_CONFIG_DRIFT',
  INPUT_INVALID: 'M7_RATE_LIMIT_INPUT_INVALID',
  STORAGE_FAILURE: 'M7_RATE_LIMIT_STORAGE_FAILURE',
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const limiters = new WeakSet();

export class M7DurableRateLimitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'M7DurableRateLimitError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new M7DurableRateLimitError(code, `m7-rate-limit:${message}`, details);
}

function requireDatabase(database) {
  if (!database
    || typeof database.prepare !== 'function'
    || typeof database.transaction !== 'function') {
    fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, 'database-invalid');
  }
  return database;
}

function requireInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, `${field}-invalid`);
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requirePlan(plan) {
  if (!isGenuineM7TransportRateLimitPlan(plan)
    || plan.authority !== 'DURABLE_RATE_LIMIT_CONSUMER_REQUIRED'
    || !IDENTIFIER.test(plan.routeId || '')
    || !Array.isArray(plan.buckets)
    || plan.buckets.length < 1
    || plan.buckets.length > 3) {
    fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, 'plan-not-genuine');
  }
  const identities = new Set();
  for (const bucket of plan.buckets) {
    if (bucket === null
      || typeof bucket !== 'object'
      || !IDENTIFIER.test(bucket.bucket || '')
      || !SHA256.test(bucket.identityDigest || '')
      || !Number.isSafeInteger(bucket.maximum)
      || bucket.maximum < 1
      || bucket.maximum > 10_000
      || !Number.isSafeInteger(bucket.windowSeconds)
      || bucket.windowSeconds < 1
      || bucket.windowSeconds > 86_400
      || identities.has(bucket.identityDigest)) {
      fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, 'plan-bucket-invalid');
    }
    identities.add(bucket.identityDigest);
  }
  return plan;
}

function immediate(database, callback) {
  const transaction = database.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function storage(callback, message) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof M7DurableRateLimitError) throw error;
    fail(M7_DURABLE_RATE_LIMIT_ERROR.STORAGE_FAILURE, message, {
      cause: error?.message || String(error),
    });
  }
}

function windowFor(nowMs, windowSeconds) {
  const windowMs = windowSeconds * 1_000;
  const windowNumber = Math.floor(nowMs / windowMs);
  return {
    windowNumber,
    windowStartedAtMs: windowNumber * windowMs,
    windowEndsAtMs: (windowNumber + 1) * windowMs,
  };
}

function rowConfigurationMatches(row, bucket, routeId) {
  return row.bucket === bucket.bucket
    && row.routeId === routeId
    && row.maximum === bucket.maximum
    && row.windowSeconds === bucket.windowSeconds;
}

export function createM7DurableRateLimiter(database, {
  clock = Date.now,
  maximumRows = 50_000,
  retentionMs = 86_400_000,
} = {}) {
  const db = requireDatabase(database);
  if (typeof clock !== 'function') {
    fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, 'clock-invalid');
  }
  requireInteger(maximumRows, 'maximum-rows', 3, 1_000_000);
  requireInteger(retentionMs, 'retention-ms', 60_000, 31_536_000_000);

  const statements = storage(() => ({
    selectBucket: db.prepare(`
      SELECT identity_digest AS identityDigest, bucket, route_id AS routeId,
        maximum, window_seconds AS windowSeconds, window_number AS windowNumber,
        allowed_count AS allowedCount, window_started_at_ms AS windowStartedAtMs,
        window_ends_at_ms AS windowEndsAtMs, last_observed_at_ms AS lastObservedAtMs
      FROM m7_remote_rate_limit_buckets
      WHERE identity_digest = ?
    `),
    insertBucket: db.prepare(`
      INSERT INTO m7_remote_rate_limit_buckets (
        identity_digest, bucket, route_id, maximum, window_seconds,
        window_number, allowed_count, window_started_at_ms,
        window_ends_at_ms, last_observed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateBucket: db.prepare(`
      UPDATE m7_remote_rate_limit_buckets
      SET bucket = ?, route_id = ?, maximum = ?, window_seconds = ?,
        window_number = ?, allowed_count = ?, window_started_at_ms = ?,
        window_ends_at_ms = ?, last_observed_at_ms = ?
      WHERE identity_digest = ?
    `),
    deleteExpired: db.prepare(`
      DELETE FROM m7_remote_rate_limit_buckets WHERE window_ends_at_ms <= ?
    `),
    countRows: db.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets'),
  }), 'prepare-failed');
  const {
    countRows, deleteExpired, insertBucket, selectBucket, updateBucket,
  } = statements;

  const limiter = {
    stage: M7_DURABLE_RATE_LIMITER_STAGE,
    consume(plan) {
      if (!limiters.has(this)) {
        fail(M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID, 'limiter-not-genuine');
      }
      const genuinePlan = requirePlan(plan);
      const nowMs = requireInteger(clock(), 'clock-value', 1, Number.MAX_SAFE_INTEGER);
      return storage(() => immediate(db, () => {
        const retentionCutoff = Math.max(0, nowMs - retentionMs);
        deleteExpired.run(retentionCutoff);

        const observations = genuinePlan.buckets.map(bucket => {
          const row = selectBucket.get(bucket.identityDigest) || null;
          const window = windowFor(nowMs, bucket.windowSeconds);
          if (row && nowMs < row.lastObservedAtMs) {
            fail(M7_DURABLE_RATE_LIMIT_ERROR.CLOCK_REGRESSION, 'clock-regressed', {
              bucket: bucket.bucket,
            });
          }
          const configurationMatches = rowConfigurationMatches(
            row || {},
            bucket,
            genuinePlan.routeId,
          );
          if (row && !configurationMatches && nowMs < row.windowEndsAtMs) {
            fail(M7_DURABLE_RATE_LIMIT_ERROR.CONFIG_DRIFT, 'active-window-config-drift', {
              bucket: bucket.bucket,
            });
          }
          if (row && configurationMatches && window.windowNumber < row.windowNumber) {
            fail(M7_DURABLE_RATE_LIMIT_ERROR.CLOCK_REGRESSION, 'window-regressed', {
              bucket: bucket.bucket,
            });
          }
          const sameWindow = row
            && configurationMatches
            && window.windowNumber === row.windowNumber;
          const allowedCount = sameWindow ? row.allowedCount + 1 : 1;
          return { allowedCount, bucket, row, sameWindow, window };
        });

        const missing = observations.filter(item => item.row === null).length;
        if (countRows.get().count + missing > maximumRows) {
          fail(M7_DURABLE_RATE_LIMIT_ERROR.CAPACITY_EXCEEDED, 'bucket-capacity-exceeded');
        }

        const denied = observations.filter(item => item.allowedCount > item.bucket.maximum);
        if (denied.length > 0) {
          return deepFreeze({
            allowed: false,
            contract: 'M7DurableRateLimitDecision',
            limitedBuckets: denied.map(item => item.bucket.bucket).sort(),
            observedAtMs: nowMs,
            remainingMinimum: 0,
            retryAfterSeconds: Math.max(...denied.map(item => (
              Math.max(1, Math.ceil((item.window.windowEndsAtMs - nowMs) / 1_000))
            ))),
            routeId: genuinePlan.routeId,
            version: 1,
          });
        }

        for (const observation of observations) {
          const values = [
            observation.bucket.bucket,
            genuinePlan.routeId,
            observation.bucket.maximum,
            observation.bucket.windowSeconds,
            observation.window.windowNumber,
            observation.allowedCount,
            observation.window.windowStartedAtMs,
            observation.window.windowEndsAtMs,
            nowMs,
          ];
          if (observation.row) {
            updateBucket.run(...values, observation.bucket.identityDigest);
          } else {
            insertBucket.run(
              observation.bucket.identityDigest,
              ...values,
            );
          }
        }
        return deepFreeze({
          allowed: true,
          contract: 'M7DurableRateLimitDecision',
          limitedBuckets: [],
          observedAtMs: nowMs,
          remainingMinimum: Math.min(...observations.map(item => (
            item.bucket.maximum - item.allowedCount
          ))),
          retryAfterSeconds: 0,
          routeId: genuinePlan.routeId,
          version: 1,
        });
      }), 'consume-failed');
    },
  };
  Object.freeze(limiter);
  limiters.add(limiter);
  return limiter;
}

export function isGenuineM7DurableRateLimiter(value) {
  return limiters.has(value);
}

export default createM7DurableRateLimiter;

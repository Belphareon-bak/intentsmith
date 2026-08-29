import { createHash } from 'node:crypto';

export const version = '2026_08_30_108_m7_durable_rate_limits';
export const description = 'Add bounded durable M7 transport rate-limit buckets';

export const EXPECTED_M7_DURABLE_RATE_LIMIT_FINGERPRINT_V108 =
  '15dd94aedd35352cbc28cc442246710992fd8744ce690c6c54140a8c0b10042c';

const OBJECT_NAMES = Object.freeze([
  'm7_remote_rate_limit_buckets',
  'idx_m7_remote_rate_limit_expiry',
]);

export function computeM7DurableRateLimitFingerprintV108(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/gu, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function install(db) {
  db.exec(`
    CREATE TABLE m7_remote_rate_limit_buckets (
      identity_digest TEXT PRIMARY KEY CHECK (
        length(identity_digest) = 71
        AND substr(identity_digest, 1, 7) = 'sha256:'
        AND substr(identity_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      bucket TEXT NOT NULL CHECK (
        length(bucket) BETWEEN 1 AND 64
        AND bucket NOT GLOB '*[^a-z0-9-]*'
      ),
      route_id TEXT NOT NULL CHECK (
        length(route_id) BETWEEN 1 AND 64
        AND route_id NOT GLOB '*[^a-z0-9-]*'
      ),
      maximum INTEGER NOT NULL CHECK (
        typeof(maximum) = 'integer' AND maximum BETWEEN 1 AND 10000
      ),
      window_seconds INTEGER NOT NULL CHECK (
        typeof(window_seconds) = 'integer' AND window_seconds BETWEEN 1 AND 86400
      ),
      window_number INTEGER NOT NULL CHECK (
        typeof(window_number) = 'integer' AND window_number >= 0
      ),
      allowed_count INTEGER NOT NULL CHECK (
        typeof(allowed_count) = 'integer'
        AND allowed_count BETWEEN 1 AND maximum
      ),
      window_started_at_ms INTEGER NOT NULL CHECK (
        typeof(window_started_at_ms) = 'integer'
        AND window_started_at_ms = window_number * window_seconds * 1000
      ),
      window_ends_at_ms INTEGER NOT NULL CHECK (
        typeof(window_ends_at_ms) = 'integer'
        AND window_ends_at_ms = (window_number + 1) * window_seconds * 1000
      ),
      last_observed_at_ms INTEGER NOT NULL CHECK (
        typeof(last_observed_at_ms) = 'integer'
        AND last_observed_at_ms >= window_started_at_ms
        AND last_observed_at_ms < window_ends_at_ms
      )
    ) WITHOUT ROWID;

    CREATE INDEX idx_m7_remote_rate_limit_expiry
      ON m7_remote_rate_limit_buckets(window_ends_at_ms, identity_digest);
  `);
}

export function up(db) {
  const current = computeM7DurableRateLimitFingerprintV108(db);
  if (current === EXPECTED_M7_DURABLE_RATE_LIMIT_FINGERPRINT_V108) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_DURABLE_RATE_LIMIT_108_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7DurableRateLimitFingerprintV108(db);
  if (installed !== EXPECTED_M7_DURABLE_RATE_LIMIT_FINGERPRINT_V108) {
    throw new Error(`M7_DURABLE_RATE_LIMIT_108_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };

// Migration parity — a database's schema must not depend on when it was created.
// ==============================================================================
//
// Migration 047 exists because 046 shipped without `unknown_reason`,
// `unknown_at` and `last_checked_at`, and an applied migration never runs again.
// 048 then adds `owner_instance` and the instance registry.  That leaves three
// populations in the wild, and the review's question is whether they converge:
//
//   A  clean install      — the whole chain, 046 (current) + 047 + 048
//   B  early adopter      — 046 in its **original** shape already applied and
//                           stamped; 047 and 048 arrive later
//   C  v136.1 install     — 046 (current) + 047 already applied; only 048 is new
//
// B is the case that matters.  It is the one where "just fix 046" would have
// silently done nothing — the migration is stamped, so it never runs again, and
// the database would keep a `mobile_operations` with no `unknown_reason` while
// `markUnknown()` writes to it on every ambiguous timeout.
//
// What "equivalent" means here, stated before it is asserted:
//
//   * same tables, same columns (name, type, NOT NULL, default, primary key)
//   * same indexes, over the same columns, with the same uniqueness
//   * same applied migration set
//   * same *behaviour* — the same scripted sequence produces the same journal
//     states, reasons and ownership on all three
//
// It explicitly does **not** mean identical column ordinals.  `ALTER TABLE ADD
// COLUMN` appends, so B's columns land in a different order than A's, and no
// migration can change that for a database that already exists.  That is
// harmless only for as long as no statement depends on ordinal position, so the
// last test forbids the two forms that would — `SELECT *` and a column-less
// INSERT — instead of leaving it to convention.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../src/db/migrate.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { registerGatewayInstance } from '../src/mobile/gateway-instance.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile migration parity (046 / 047 / 048) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-parity-'));
const handles = [];

const V046 = '2026_08_09_055_mobile_gateway';
const V047 = '2026_08_09_056_mobile_unknown_reason';
const V048 = '2026_08_09_057_mobile_gateway_instances';

/**
 * `mobile_operations` exactly as migration 046 created it before 047 existed.
 *
 * Copied from `git show 1735e39:src/db/migrations/2026_08_09_055_mobile_gateway.js`.
 * The three UNKNOWN columns and `owner_instance` are absent — that absence is
 * the whole point, and it is asserted below rather than trusted.
 */
const HISTORICAL_046_OPERATIONS = `
  CREATE TABLE mobile_operations (
    device_id           TEXT NOT NULL,
    operation_id        TEXT NOT NULL,
    operation_type      TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    state               TEXT NOT NULL DEFAULT 'PENDING',
    result_json         TEXT,
    error_code          TEXT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME,
    PRIMARY KEY (device_id, operation_id)
  )
`;

/** `mobile_operations` as of v136.1: 046 (current) + 047, but before 048. */
const V136_1_OPERATIONS = `
  CREATE TABLE mobile_operations (
    device_id           TEXT NOT NULL,
    operation_id        TEXT NOT NULL,
    operation_type      TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    state               TEXT NOT NULL DEFAULT 'PENDING',
    result_json         TEXT,
    error_code          TEXT,
    unknown_reason      TEXT,
    unknown_at          DATETIME,
    last_checked_at     DATETIME,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME,
    PRIMARY KEY (device_id, operation_id)
  )
`;

const BASE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_mobile_ops_open ON mobile_operations(device_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_ops_created ON mobile_operations(device_id, created_at)`,
];

function open(name) {
  const db = new Database(path.join(runtimeDir, `${name}.sqlite`));
  db.pragma('journal_mode = WAL');
  handles.push(db);
  return db;
}

/** Roll `mobile_operations` back to an earlier shape and un-stamp the migrations that produced it. */
function rewindTo(db, ddl, versionsToUndo) {
  db.exec('DROP TABLE IF EXISTS mobile_operations');
  db.exec(ddl);
  for (const sql of BASE_INDEXES) db.exec(sql);
  if (versionsToUndo.includes(V048)) {
    db.exec('DROP TABLE IF EXISTS mobile_gateway_instances');
    db.exec('DROP INDEX IF EXISTS idx_mobile_instances_live');
  }
  const stmt = db.prepare('DELETE FROM schema_migrations WHERE version = ?');
  for (const version of versionsToUndo) stmt.run(version);
}

// ── Schema readers ──────────────────────────────────────────────────────────

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map(c => ({ name: c.name, type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk }))
    // Sorted by name: the comparison is about the column *set*, not its ordinals.
    .sort((a, b) => a.name.localeCompare(b.name));
}

function indexesOf(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all()
    .map(index => ({
      name: index.name,
      unique: index.unique,
      partial: index.partial,
      columns: db.prepare(`PRAGMA index_info(${index.name})`).all().map(c => c.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tablesOf(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(r => r.name);
}

function appliedVersions(db) {
  return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
}

const MOBILE_TABLES = [
  'mobile_operations', 'mobile_pairing_codes', 'mobile_approvals',
  'mobile_notifications', 'mobile_gateway_instances',
];

function mobileSchema(db) {
  const schema = {};
  for (const table of MOBILE_TABLES) {
    schema[table] = { columns: columnsOf(db, table), indexes: indexesOf(db, table) };
  }
  schema.api_tokens = { columns: columnsOf(db, 'api_tokens') };
  return schema;
}

/**
 * The same scripted sequence on every database.
 *
 * Timestamps become booleans: "it was stamped" is the contract, the wall-clock
 * value is not, and comparing the values would only make the test flaky.
 */
function behaviour(db) {
  const live = registerGatewayInstance(db, { autoHeartbeat: false });
  const gone = registerGatewayInstance(db, { autoHeartbeat: false });
  const journal = new OperationJournal(db).bindInstance(live.instanceId);

  const timedOut = 'parity01' + 'a'.repeat(16);
  journal.begin({ deviceId: 'dev-p', operationId: timedOut, operationType: 'chat.send', request: { m: 1 } });
  journal.markUnknown('dev-p', timedOut, 'upstream_timeout');

  const orphaned = 'parity02' + 'b'.repeat(16);
  new OperationJournal(db).bindInstance(gone.instanceId).begin({
    deviceId: 'dev-p', operationId: orphaned, operationType: 'chat.send', request: { m: 2 },
  });
  gone.release('clean_shutdown');

  const inFlight = 'parity03' + 'c'.repeat(16);
  journal.begin({ deviceId: 'dev-p', operationId: inFlight, operationType: 'chat.send', request: { m: 3 } });

  const swept = journal.sweepInterrupted();

  const record = journal.lookup('dev-p', timedOut);
  const ownerRow = db.prepare(
    'SELECT owner_instance FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
  ).get('dev-p', inFlight);

  const result = {
    swept,
    timedOut: {
      state: record.state,
      unknownReason: record.unknownReason,
      hasUnknownAt: Boolean(record.unknownAt),
    },
    orphaned: {
      state: journal.lookup('dev-p', orphaned).state,
      unknownReason: journal.lookup('dev-p', orphaned).unknownReason,
    },
    inFlight: {
      state: journal.lookup('dev-p', inFlight).state,
      ownedByLiveInstance: ownerRow.owner_instance === live.instanceId,
    },
    open: journal.openOperations('dev-p')
      .map(op => ({ state: op.state, unknownReason: op.unknownReason, hasLastChecked: Boolean(op.lastCheckedAt) }))
      .sort((a, b) => String(a.unknownReason).localeCompare(String(b.unknownReason))),
  };
  live.release();
  return result;
}

let A;
let B;
let C;

try {
  // ── Build the three populations ──────────────────────────────────────────

  A = open('clean');
  await runMigrations(A);

  B = open('early-adopter');
  await runMigrations(B);
  rewindTo(B, HISTORICAL_046_OPERATIONS, [V047, V048]);

  C = open('v136-1');
  await runMigrations(C);
  rewindTo(C, V136_1_OPERATIONS, [V048]);

  await test('the B fixture really is the pre-047 schema', () => {
    const names = columnsOf(B, 'mobile_operations').map(c => c.name);
    for (const column of ['unknown_reason', 'unknown_at', 'last_checked_at', 'owner_instance']) {
      assert.ok(!names.includes(column), `${column} must be absent, or B tests nothing`);
    }
    assert.ok(appliedVersions(B).includes(V046), '046 must still be stamped as applied');
    assert.ok(!appliedVersions(B).includes(V047));
    assert.ok(!appliedVersions(B).includes(V048));
  });

  await test('a pre-047 database is broken until 047 runs — the reason 047 exists', () => {
    assert.throws(
      () => new OperationJournal(B).markUnknown('dev-x', 'a'.repeat(20), 'upstream_timeout'),
      /unknown_reason/,
      'this is what editing 046 in place would have left in production',
    );
  });

  await test('the C fixture is a v136.1 database: 047 applied, 048 not', () => {
    const names = columnsOf(C, 'mobile_operations').map(c => c.name);
    assert.ok(names.includes('unknown_reason'));
    assert.ok(!names.includes('owner_instance'));
    assert.ok(appliedVersions(C).includes(V047));
    assert.ok(!appliedVersions(C).includes(V048));
  });

  // ── Upgrade B and C ──────────────────────────────────────────────────────

  await test('047 and 048 apply cleanly to an early-adopter database', async () => {
    const result = await runMigrations(B);
    assert.ok(result.applied.includes(V047), `047 must run: ${JSON.stringify(result.applied)}`);
    assert.ok(result.applied.includes(V048), '048 must run');
  });

  await test('only 048 applies to a v136.1 database', async () => {
    const result = await runMigrations(C);
    assert.deepEqual(result.applied, [V048], 'nothing already applied may run twice');
  });

  await test('re-running the chain is a no-op everywhere (idempotence)', async () => {
    for (const [name, db] of [['A', A], ['B', B], ['C', C]]) {
      const result = await runMigrations(db);
      assert.deepEqual(result.applied, [], `${name} applied something on a second run`);
    }
  });

  // ── Parity ───────────────────────────────────────────────────────────────

  await test('PARITY: the three databases end with the same applied migrations', () => {
    assert.deepEqual(appliedVersions(B), appliedVersions(A));
    assert.deepEqual(appliedVersions(C), appliedVersions(A));
  });

  await test('PARITY: the same tables exist', () => {
    assert.deepEqual(tablesOf(B), tablesOf(A));
    assert.deepEqual(tablesOf(C), tablesOf(A));
  });

  await test('PARITY: same columns and same indexes on every mobile table', () => {
    const clean = mobileSchema(A);
    assert.deepEqual(mobileSchema(B), clean, 'an upgraded early-adopter database must match a clean one');
    assert.deepEqual(mobileSchema(C), clean, 'an upgraded v136.1 database must match a clean one');
  });

  await test('PARITY: the same scripted sequence behaves identically on all three', () => {
    const clean = behaviour(A);
    // Named so a failure says which population diverged, not just "not equal".
    assert.deepEqual(behaviour(B), clean, 'early-adopter behaviour differs after upgrade');
    assert.deepEqual(behaviour(C), clean, 'v136.1 behaviour differs after upgrade');

    // And the sequence has to have exercised something, or parity is vacuous.
    assert.equal(clean.swept, 1, 'exactly the released instance\'s operation should sweep');
    assert.equal(clean.timedOut.unknownReason, 'upstream_timeout');
    assert.equal(clean.orphaned.unknownReason, 'process_terminated');
    assert.equal(clean.inFlight.state, 'PENDING');
    assert.equal(clean.inFlight.ownedByLiveInstance, true);
  });

  await test('column ordinals differ, and nothing is allowed to depend on them', () => {
    // Stated rather than hidden: `ALTER TABLE ADD COLUMN` appends, so B's
    // ordinals cannot match A's, and no future migration can fix that for a
    // database that already exists.
    const ordinalsA = db => db.prepare('PRAGMA table_info(mobile_operations)').all().map(c => c.name);
    assert.notDeepEqual(ordinalsA(B), ordinalsA(A), 'if these ever matched, this note is stale');

    // Which is safe exactly as long as no statement is positional.  Both forms
    // that would be are banned here, at the source, for the mobile tables.
    const srcDir = fileURLToPath(new URL('../src/mobile/', import.meta.url));
    const offenders = [];
    for (const file of readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
      const source = readFileSync(path.join(srcDir, file), 'utf8');
      if (/SELECT\s+\*\s+FROM\s+mobile_/i.test(source)) offenders.push(`${file}: SELECT * FROM mobile_*`);
      if (/INSERT\s+INTO\s+mobile_\w+\s+VALUES/i.test(source)) offenders.push(`${file}: column-less INSERT`);
    }
    assert.deepEqual(offenders, [], 'ordinal-dependent SQL makes the column order a contract');
  });
} finally {
  for (const handle of handles) {
    try { handle.close(); } catch { /* already closed */ }
  }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile migration parity: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

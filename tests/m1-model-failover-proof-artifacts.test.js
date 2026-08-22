#!/usr/bin/env node
//
// Decision 015 — a PASS proof must be bound to its immutable artifacts, and the
// expiry edge is strict.
//
// These proofs are deliberately schema-level: the guarantee has to hold against
// direct SQL, because the point of the checkpoint is that a synthetic row can
// no longer look like a real measurement.

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';

const SOURCE_REVISION = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function withDb(callback) {
  const db = new Database(':memory:');
  try {
    await runMigrations(db);
    return await callback(db);
  } finally {
    db.close();
  }
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected callback to throw');
}

function insertArtifact(db, { kind, body = 'artifact-body', sourceRevision = SOURCE_REVISION }) {
  const artifactSha256 = sha256(`${kind}:${body}`);
  db.prepare(`
    INSERT INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, ?, ?, ?, ?)
  `).run(artifactSha256, kind, Buffer.byteLength(body), sourceRevision, 1_700_000_000_000);
  return artifactSha256;
}

function proofColumns(db) {
  return db.prepare('PRAGMA table_info(model_failover_proofs)').all().map(column => column.name);
}

function insertProof(db, overrides = {}) {
  const columns = new Set(proofColumns(db));
  const row = {
    proof_id: 'proof-000000000000001',
    validation_run_id: 'run-1',
    role: 'CHAT',
    suite: 'chat',
    role_contract_sha256: 'c'.repeat(64),
    model_name: 'fixture:27b',
    model_canonical_name: 'fixture:27b',
    model_digest_sha256: DIGEST,
    validation_version: 'v123.1',
    policy_version: 'policy-1',
    score: 1,
    required_score: 1,
    passed_count: 8,
    required_passed_count: 8,
    total_count: 8,
    duration_ms: 1000,
    result: 'PASS',
    inventory_before_name: 'fixture:27b',
    inventory_before_digest: DIGEST,
    inventory_after_name: 'fixture:27b',
    inventory_after_digest: DIGEST,
    started_at_ms: 1_700_000_000_000 - 1000,
    completed_at_ms: 1_700_000_000_000,
    expires_at_ms: 1_700_000_000_000 + 604_800_000,
    created_at_ms: 1_700_000_000_000,
    measurement_artifact_sha256: null,
    acceptance_artifact_sha256: null,
    source_revision: SOURCE_REVISION,
    ...overrides,
  };
  const present = Object.keys(row).filter(key => columns.has(key));
  db.prepare(`
    INSERT INTO model_failover_proofs (${present.join(', ')})
    VALUES (${present.map(() => '?').join(', ')})
  `).run(...present.map(key => row[key]));
}

suite('M1 failover proof artifacts — decision 015 storage and expiry edge');

await testAsync('a proof without a durable measurement artifact is impossible', async () => {
  await withDb((db) => {
    const acceptance = insertArtifact(db, { kind: 'PARENT_ACCEPTANCE' });

    const missing = captureError(() => insertProof(db, {
      acceptance_artifact_sha256: acceptance,
    }));
    assert(/durable measurement artifact/.test(missing.message), missing.message);

    // A hash that is not actually stored is not a substitute for the artifact.
    const invented = captureError(() => insertProof(db, {
      measurement_artifact_sha256: sha256('never-written'),
      acceptance_artifact_sha256: acceptance,
    }));
    assert(/durable measurement artifact/.test(invented.message), invented.message);
  });
});

await testAsync('a proof without a durable acceptance artifact is impossible', async () => {
  await withDb((db) => {
    const measurement = insertArtifact(db, { kind: 'MEASUREMENT' });
    const error = captureError(() => insertProof(db, {
      measurement_artifact_sha256: measurement,
    }));
    assert(/durable parent acceptance artifact/.test(error.message), error.message);
  });
});

await testAsync('the artifact kinds cannot be swapped', async () => {
  await withDb((db) => {
    const measurement = insertArtifact(db, { kind: 'MEASUREMENT' });
    const acceptance = insertArtifact(db, { kind: 'PARENT_ACCEPTANCE' });
    const swapped = captureError(() => insertProof(db, {
      measurement_artifact_sha256: acceptance,
      acceptance_artifact_sha256: measurement,
    }));
    assert(/durable measurement artifact/.test(swapped.message), swapped.message);
  });
});

await testAsync('both artifacts must come from the source revision the proof claims', async () => {
  await withDb((db) => {
    const measurement = insertArtifact(db, { kind: 'MEASUREMENT' });
    const acceptance = insertArtifact(db, {
      kind: 'PARENT_ACCEPTANCE',
      sourceRevision: 'd'.repeat(40),
    });
    const error = captureError(() => insertProof(db, {
      measurement_artifact_sha256: measurement,
      acceptance_artifact_sha256: acceptance,
    }));
    assert(/source revision of both artifacts/.test(error.message), error.message);
  });
});

await testAsync('a fully bound proof is accepted and an orphan artifact stays legal', async () => {
  await withDb((db) => {
    const measurement = insertArtifact(db, { kind: 'MEASUREMENT' });
    const acceptance = insertArtifact(db, { kind: 'PARENT_ACCEPTANCE' });
    insertProof(db, {
      measurement_artifact_sha256: measurement,
      acceptance_artifact_sha256: acceptance,
    });
    assertEqual(
      db.prepare('SELECT COUNT(*) AS n FROM model_failover_proofs').get().n,
      1,
    );

    // The artifact is written first, so an artifact with no proof is expected.
    insertArtifact(db, { kind: 'MEASUREMENT', body: 'orphan' });
    assertEqual(
      db.prepare('SELECT COUNT(*) AS n FROM model_failover_proof_artifacts').get().n,
      3,
    );
  });
});

await testAsync('artifacts are append-only', async () => {
  await withDb((db) => {
    const measurement = insertArtifact(db, { kind: 'MEASUREMENT' });
    const update = captureError(() => db.prepare(
      'UPDATE model_failover_proof_artifacts SET byte_length = 1 WHERE artifact_sha256 = ?',
    ).run(measurement));
    assert(/append-only/.test(update.message), update.message);
    const remove = captureError(() => db.prepare(
      'DELETE FROM model_failover_proof_artifacts WHERE artifact_sha256 = ?',
    ).run(measurement));
    assert(/append-only/.test(remove.message), remove.message);
  });
});

await testAsync('the expiry edge is strict, not inclusive', async () => {
  await withDb((db) => {
    // The accepted meaning is `now < expiresAt`. Migration 046 compared with
    // `>=`, which left exactly one millisecond in which an expired proof could
    // still authorise an activation.
    for (const trigger of [
      'trg_model_failover_events_fallback_proof',
      'trg_model_failover_events_restore_proof',
      'trg_model_failover_state_active_proof_insert',
      'trg_model_failover_state_active_proof_update',
    ]) {
      const sql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      ).get(trigger).sql;
      assert(
        /proof\.expires_at_ms > NEW\./.test(sql),
        `${trigger} does not use the strict comparison`,
      );
      assert(
        !/proof\.expires_at_ms >= NEW\./.test(sql),
        `${trigger} still carries the inclusive comparison`,
      );
    }
  });
});

// The behavioural counterpart of the strict edge — an activation attempted at
// exactly `expiresAt` — needs a complete failover episode fixture (desired
// binding, episode, claim and terminal event), and several earlier triggers
// would fire before the expiry comparison is reached. Rather than assert on
// whichever guard happens to fire first, the edge is pinned above at the level
// where it is unambiguous. The behavioural test belongs to the proof issuer WP,
// which builds that fixture anyway.

summary();

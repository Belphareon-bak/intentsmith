#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} from '../docs/mobile/contracts/fixtures/remote-capability-golden-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  EXPECTED_M7_REMOTE_OPERATION_JOURNAL_FINGERPRINT_V101,
  computeM7RemoteOperationJournalFingerprintV101,
  up as installM7OperationJournal,
} from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import {
  createM7InProcessCapabilityProvider,
} from '../src/remote/m7-in-process-capability-provider.js';
import {
  M7OperationJournal,
  M7_OPERATION_JOURNAL_ERROR,
} from '../src/remote/m7-operation-journal.js';
import {
  computeM7OperationRequestDigest,
  encodeM7OperationJournalEvent,
} from '../src/remote/m7-operation-journal-validation.js';
import { suite, summary, test, testAsync } from './harness.js';

const request = Object.freeze({
  contract: 'MobileSettingUpdateCommand@1',
  version: 1,
  requestId: 'request:settings:001',
  operationId: 'operation:settings:001',
  expectedRevision: 7,
  key: 'appearance.theme',
  value: 'dark',
});
const result = Object.freeze({
  contract: 'MobileSettingUpdateResult@1',
  version: 1,
  requestId: request.requestId,
  operationId: request.operationId,
  key: request.key,
  value: request.value,
  revision: 8,
  outcome: 'CONFIRMED',
  replayed: false,
});

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installM7OperationJournal(db);
  return db;
}

function journal(db, start = 1_000) {
  let now = start;
  return new M7OperationJournal(db, { clock: () => now++ });
}

function invocation(overrides = {}) {
  return {
    deviceId: 'device:001',
    subjectId: 'user:001',
    operationId: request.operationId,
    operationType: 'settings.update',
    request: structuredClone(request),
    execute: async () => structuredClone(result),
    ...overrides,
  };
}

suite('M7 persistent mutation operation journal');

await testAsync('migration installs the exact append-only schema fingerprint and BLOB storage', async () => {
  const db = memoryDb();
  assert.equal(
    computeM7RemoteOperationJournalFingerprintV101(db),
    EXPECTED_M7_REMOTE_OPERATION_JOURNAL_FINGERPRINT_V101,
  );
  const repository = journal(db);
  await repository.run(invocation());
  const rows = db.prepare(`
    SELECT sequence, typeof(record_json) AS recordType
    FROM m7_remote_operation_events ORDER BY sequence
  `).all();
  assert.deepEqual(rows, [
    { sequence: 0, recordType: 'blob' },
    { sequence: 1, recordType: 'blob' },
  ]);
  const columns = db.prepare('PRAGMA table_info(m7_remote_operation_events)').all()
    .map(column => column.name);
  assert.equal(columns.some(name => /request_(json|payload)|request$/u.test(name)), false);
  db.close();
});

await testAsync('restart replay returns the first result without a second handler effect', async () => {
  const db = memoryDb();
  let handlerCalls = 0;
  const first = await journal(db).run(invocation({
    execute: async () => {
      handlerCalls += 1;
      return structuredClone(result);
    },
  }));
  const replay = await journal(db, 2_000).run(invocation({
    execute: async () => {
      handlerCalls += 1;
      return structuredClone(result);
    },
  }));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(handlerCalls, 1);
  assert.equal(Object.isFrozen(replay), true);
  db.close();
});

await testAsync('the real provider replays a persisted mutation without a second core call', async () => {
  const db = memoryDb();
  const operationJournal = journal(db);
  const fixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1.filter(fixture => (
    fixture.capabilityId !== 'm7-control-plane-prerequisite'
  ));
  let settingCalls = 0;
  const handlers = Object.fromEntries(fixtures.map(fixture => [
    fixture.operationId,
    async () => {
      if (fixture.operationId === 'settings.update') settingCalls += 1;
      return structuredClone(fixture.success);
    },
  ]));
  const provider = createM7InProcessCapabilityProvider({
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    validatePayload: validateMobileRemotePayload,
    validateOperationPair: validateMobileRemoteOperationPair,
    handlers,
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: 'device:provider:001',
      subjectId: 'user:provider:001',
      grantedScopes: [...input.requiredScopes],
    }),
    mutationJournal: operationJournal,
  });
  const setting = fixtures.find(fixture => fixture.operationId === 'settings.update');
  const invocationValue = {
    capabilityId: setting.capabilityId,
    capabilityVersion: setting.capabilityVersion,
    operationId: setting.operationId,
    request: structuredClone(setting.request),
  };
  const first = await provider.invoke(invocationValue);
  const replay = await provider.invoke(structuredClone(invocationValue));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(settingCalls, 1);
  assert.equal(operationJournal.getSettlement({
    deviceId: 'device:provider:001',
    subjectId: 'user:provider:001',
    operationId: setting.request.operationId,
  }).state, 'CONFIRMED');
  db.close();
});

await testAsync('same identity with another request or operation type fails closed', async () => {
  const db = memoryDb();
  const repository = journal(db);
  await repository.run(invocation());
  await assert.rejects(
    repository.run(invocation({ request: { ...structuredClone(request), value: 'light' } })),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.CONFLICT,
  );
  await assert.rejects(
    repository.run(invocation({ operationType: 'notification.ack' })),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.CONFLICT,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM m7_remote_operation_events').get().count, 2);
  db.close();
});

await testAsync('device and subject are both part of the operation identity', async () => {
  const db = memoryDb();
  const repository = journal(db);
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return structuredClone(result);
  };
  await repository.run(invocation({ execute }));
  await repository.run(invocation({ deviceId: 'device:002', execute }));
  await repository.run(invocation({ subjectId: 'user:002', execute }));
  assert.equal(calls, 3);
  assert.equal(db.prepare(`
    SELECT count(*) AS count FROM m7_remote_operation_events WHERE sequence = 0
  `).get().count, 3);
  db.close();
});

await testAsync('a concurrent retry observes the durable intent and cannot execute', async () => {
  const db = memoryDb();
  const repository = journal(db);
  let release;
  let calls = 0;
  const first = repository.run(invocation({
    execute: async () => {
      calls += 1;
      return new Promise(resolve => { release = () => resolve(structuredClone(result)); });
    },
  }));
  assert.equal(typeof release, 'function');
  await assert.rejects(
    repository.run(invocation({ execute: async () => { calls += 1; return result; } })),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN,
  );
  release();
  await first;
  assert.equal(calls, 1);
  db.close();
});

await testAsync('a thrown handler becomes durable UNKNOWN and is never retried', async () => {
  const db = memoryDb();
  const repository = journal(db);
  let calls = 0;
  await assert.rejects(
    repository.run(invocation({
      execute: async () => {
        calls += 1;
        const error = new Error('ambiguous effect');
        error.code = 'UPSTREAM_TIMEOUT';
        throw error;
      },
    })),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN,
  );
  await assert.rejects(
    repository.run(invocation({ execute: async () => { calls += 1; return result; } })),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN,
  );
  assert.equal(calls, 1);
  assert.deepEqual(repository.getSettlement({
    deviceId: 'device:001', subjectId: 'user:001', operationId: request.operationId,
  }), {
    known: true,
    operationId: request.operationId,
    operationType: 'settings.update',
    requestDigest: computeM7OperationRequestDigest(request),
    state: 'UNKNOWN',
    result: null,
    errorCode: 'UPSTREAM_TIMEOUT',
    createdAtMs: 1_000,
    updatedAtMs: 1_001,
    revision: 2,
  });
  db.close();
});

test('tampered bytes, column mismatch, update and delete fail at the SQL boundary', () => {
  const db = memoryDb();
  const event = {
    contract: 'M7RemoteOperationJournalEvent', version: 1,
    deviceId: 'device:sql', subjectId: 'user:sql', operationId: 'operation:sql',
    operationType: 'settings.update', requestDigest: computeM7OperationRequestDigest(request),
    sequence: 0, state: 'STARTED', result: null, resultDigest: null,
    errorCode: null, recordedAtMs: 5_000,
  };
  const insert = db.prepare(`
    INSERT INTO m7_remote_operation_events (
      device_id, subject_id, operation_id, operation_type, request_digest,
      sequence, state, result_digest, error_code, recorded_at_ms, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB))
  `);
  const args = [
    event.deviceId, event.subjectId, event.operationId, event.operationType,
    event.requestDigest, event.sequence, event.state, event.resultDigest,
    event.errorCode, event.recordedAtMs, encodeM7OperationJournalEvent(event),
  ];
  insert.run(...args);
  const tamperedEvent = {
    ...event,
    deviceId: 'device:tamper',
    operationId: 'operation:tamper',
  };
  const changed = Buffer.from(
    encodeM7OperationJournalEvent(tamperedEvent)
      .toString('utf8')
      .replace('"STARTED"', '"STARTEC"'),
    'utf8',
  );
  assert.throws(
    () => insert.run(
      tamperedEvent.deviceId,
      tamperedEvent.subjectId,
      tamperedEvent.operationId,
      tamperedEvent.operationType,
      tamperedEvent.requestDigest,
      tamperedEvent.sequence,
      tamperedEvent.state,
      tamperedEvent.resultDigest,
      tamperedEvent.errorCode,
      tamperedEvent.recordedAtMs,
      changed,
    ),
    /AUTHORITY_MISMATCH/u,
  );
  assert.throws(
    () => insert.run('device:other', ...args.slice(1)),
    /AUTHORITY_MISMATCH/u,
  );
  assert.throws(
    () => db.prepare('UPDATE m7_remote_operation_events SET recorded_at_ms = 6000').run(),
    /append-only/u,
  );
  assert.throws(
    () => db.prepare('DELETE FROM m7_remote_operation_events').run(),
    /append-only/u,
  );
  db.close();
});

test('a second SQLite connection without the deterministic validator fails closed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-journal-'));
  const file = path.join(root, 'journal.sqlite');
  const primary = new Database(file);
  installM7OperationJournal(primary);
  const secondary = new Database(file);
  assert.throws(
    () => secondary.prepare(`
      INSERT INTO m7_remote_operation_events (
        device_id, subject_id, operation_id, operation_type, request_digest,
        sequence, state, result_digest, error_code, recorded_at_ms, record_json
      ) VALUES ('device:002', 'user:002', 'operation:002', 'settings.update',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        0, 'STARTED', NULL, NULL, 1000, CAST('{}' AS BLOB))
    `).run(),
    /no such function: m7_remote_operation_event_valid_v1/u,
  );
  secondary.close();
  primary.close();
  rmSync(root, { recursive: true, force: true });
});

await testAsync('storage failures remain typed at both public journal boundaries', async () => {
  const db = memoryDb();
  const repository = journal(db);
  db.close();
  await assert.rejects(
    repository.run(invocation()),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE,
  );
  assert.throws(
    () => repository.getSettlement({
      deviceId: 'device:001',
      subjectId: 'user:001',
      operationId: request.operationId,
    }),
    error => error.code === M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE,
  );
});

summary();

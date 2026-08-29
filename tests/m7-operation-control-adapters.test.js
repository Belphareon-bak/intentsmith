#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import { MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 } from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import {
  EXPECTED_M7_OPERATION_ABANDONMENT_FINGERPRINT_V103,
  computeM7OperationAbandonmentFingerprintV103,
  up as installAbandonments,
} from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import {
  EXPECTED_M7_OPERATION_LIST_INDEX_FINGERPRINT_V104,
  computeM7OperationListIndexFingerprintV104,
  up as installListIndexes,
} from '../src/db/migrations/2026_08_29_104_m7_operation_list_indexes.js';
import { createM7InProcessCapabilityProvider } from '../src/remote/m7-in-process-capability-provider.js';
import { createM7OperationControlAdapters } from '../src/remote/m7-operation-control-adapters.js';
import { createM7OperationJournal } from '../src/remote/m7-operation-journal.js';
import {
  computeM7OperationRequestDigest,
  encodeM7OperationAbandonment,
} from '../src/remote/m7-operation-journal-validation.js';
import { suite, summary, test, testAsync } from './harness.js';

const CURSOR_KEY = Buffer.alloc(32, 0x6f);
const DEVICE = 'device:operation:001';
const SUBJECT = 'user:operation:001';

function setup(file = ':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  installJournal(db);
  installAbandonments(db);
  installListIndexes(db);
  let now = Date.parse('2026-08-29T05:00:00.000Z');
  const journal = createM7OperationJournal(db, { clock: () => ++now });
  const adapters = createM7OperationControlAdapters({ cursorKey: CURSOR_KEY, journal });
  const provider = createM7InProcessCapabilityProvider({
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: DEVICE,
      subjectId: SUBJECT,
      grantedScopes: [...input.requiredScopes],
    }),
    controlPlaneManifest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
    externalValidators: {},
    handlers: adapters.handlers,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    mutationJournal: journal,
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    validateOperationPair: validateMobileRemoteOperationPair,
    validatePayload: validateMobileRemotePayload,
  });
  return { adapters, db, journal, provider };
}

async function unknownOperation(journal, operationId = 'operation:target:unknown') {
  const request = {
    contract: 'SyntheticMutation', version: 1,
    requestId: `request:${operationId}`, operationId,
  };
  await assert.rejects(journal.run({
    deviceId: DEVICE,
    subjectId: SUBJECT,
    operationId,
    operationType: 'settings.update',
    request,
    execute: async () => {
      const error = new Error('synthetic lost outcome');
      error.code = 'SYNTHETIC_OUTCOME_LOST';
      throw error;
    },
  }));
  return request;
}

function invoke(provider, operationId, request, context = {}) {
  return provider.invoke({
    capabilityId: 'm7-control-plane-prerequisite',
    capabilityVersion: 1,
    operationId,
    request,
  }, context);
}

function listRequest(overrides = {}) {
  return {
    contract: 'OperationListQuery', version: 1,
    requestId: 'request:operation:list:001', limit: 1,
    states: ['pending', 'unknown'],
    ...overrides,
  };
}

function abandonRequest(targetOperationId, expectedRevision, overrides = {}) {
  return {
    contract: 'OperationAbandonCommand', version: 1,
    requestId: 'request:operation:abandon:001',
    operationId: 'operation:abandon:001',
    targetOperationId,
    expectedRevision,
    ...overrides,
  };
}

suite('M7 operation control adapters');

test('migration fingerprints append-only abandonment authority', () => {
  const fixture = setup();
  try {
    assert.equal(
      computeM7OperationAbandonmentFingerprintV103(fixture.db),
      EXPECTED_M7_OPERATION_ABANDONMENT_FINGERPRINT_V103,
    );
    const columns = fixture.db.prepare('PRAGMA table_info(m7_remote_operation_abandonments)')
      .all().map(column => column.name);
    assert.equal(columns.includes('record_json'), true);
    assert.equal(columns.some(name => /payload|result_json/u.test(name)), false);
    assert.equal(
      computeM7OperationListIndexFingerprintV104(fixture.db),
      EXPECTED_M7_OPERATION_LIST_INDEX_FINGERPRINT_V104,
    );
  } finally {
    fixture.db.close();
  }
});

await testAsync('list and get expose only the trusted device-subject partition', async () => {
  const fixture = setup();
  try {
    await unknownOperation(fixture.journal);
    const listed = await invoke(fixture.provider, 'operation.list', listRequest());
    assert.equal(listed.status, 'ok');
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].state, 'unknown');
    assert.equal(listed.items[0].canAbandon, true);
    assert.equal(listed.items[0].resultReference, null);
    assert.equal(validateMobileRemotePayload('OperationPage@1', listed).valid, true);

    const found = await invoke(fixture.provider, 'operation.get', {
      contract: 'OperationLookupQuery', version: 1,
      requestId: 'request:operation:get:001',
      operationId: listed.items[0].operationId,
    });
    assert.equal(found.status, 'ok');
    assert.deepEqual(found.operation, listed.items[0]);

    const foreignAdapters = createM7OperationControlAdapters({
      cursorKey: CURSOR_KEY,
      journal: fixture.journal,
    });
    const foreign = await foreignAdapters.getOperation({
      requestId: 'request:operation:get:foreign',
      operationId: listed.items[0].operationId,
    }, { deviceId: 'device:foreign', subjectId: SUBJECT });
    assert.equal(foreign.status, 'error');
    assert.equal(foreign.error.code, 'REMOTE_OPERATION_NOT_FOUND');
  } finally {
    fixture.db.close();
  }
});

await testAsync('cursor binds subject and filter while preserving a complete stable snapshot', async () => {
  const fixture = setup();
  try {
    await unknownOperation(fixture.journal, 'operation:target:001');
    await unknownOperation(fixture.journal, 'operation:target:002');
    const first = await invoke(fixture.provider, 'operation.list', listRequest());
    assert.equal(first.end, false);
    assert.equal(typeof first.nextCursor, 'string');

    const changedFilter = await invoke(fixture.provider, 'operation.list', listRequest({
      requestId: 'request:operation:list:filter',
      cursor: first.nextCursor,
      states: ['unknown'],
    }));
    assert.equal(changedFilter.status, 'error');
    assert.equal(changedFilter.error.code, 'REMOTE_OPERATION_CURSOR_INVALID');

    await unknownOperation(fixture.journal, 'operation:target:003');
    const second = await invoke(fixture.provider, 'operation.list', listRequest({
      requestId: 'request:operation:list:stable',
      cursor: first.nextCursor,
    }));
    assert.equal(second.status, 'ok');
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].operationId, 'operation:target:002');
    assert.equal(second.end, true);
    assert.equal(second.snapshotRevision, first.snapshotRevision);

    const fresh = await invoke(fixture.provider, 'operation.list', listRequest({
      requestId: 'request:operation:list:fresh',
      limit: 10,
    }));
    assert.equal(fresh.items.length, 3);
    assert.notEqual(fresh.snapshotRevision, first.snapshotRevision);
  } finally {
    fixture.db.close();
  }
});

await testAsync('large histories use indexed keyset pages without loading the partition', async () => {
  const fixture = setup();
  try {
    for (let index = 0; index < 240; index += 1) {
      await unknownOperation(fixture.journal, `operation:bulk:${String(index).padStart(3, '0')}`);
    }
    const first = await invoke(fixture.provider, 'operation.list', listRequest({
      requestId: 'request:operation:list:bulk:first',
      limit: 7,
      states: ['unknown'],
    }));
    assert.equal(first.status, 'ok');
    assert.equal(first.items.length, 7);
    assert.equal(first.end, false);

    const second = await invoke(fixture.provider, 'operation.list', listRequest({
      requestId: 'request:operation:list:bulk:second',
      cursor: first.nextCursor,
      limit: 7,
      states: ['unknown'],
    }));
    assert.equal(second.status, 'ok');
    assert.equal(second.items.length, 7);
    assert.equal(second.snapshotRevision, first.snapshotRevision);
    assert.equal(
      new Set([...first.items, ...second.items].map(item => item.operationId)).size,
      14,
    );

    const plan = fixture.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT revision FROM m7_remote_operation_events
      WHERE device_id = ? AND subject_id = ? AND sequence = 0
        AND revision > ? AND revision <= ?
      ORDER BY revision LIMIT ?
    `).all(DEVICE, SUBJECT, 0, Number.MAX_SAFE_INTEGER, 8);
    assert.match(
      plan.map(row => row.detail).join('\n'),
      /idx_m7_remote_operation_list.*device_id=.*subject_id=.*sequence=.*revision/u,
    );
    assert.equal(typeof fixture.journal.listOperations, 'undefined');
  } finally {
    fixture.db.close();
  }
});

await testAsync('abandon is journaled, revision-bound and never relabels or retries the effect', async () => {
  const fixture = setup();
  try {
    const targetId = 'operation:target:abandon';
    await unknownOperation(fixture.journal, targetId);
    const before = fixture.journal.getOperation({
      deviceId: DEVICE, subjectId: SUBJECT, operationId: targetId,
    });
    const request = abandonRequest(targetId, before.revision);
    const result = await invoke(fixture.provider, 'operation.abandon', request);
    assert.equal(result.outcome, 'CONFIRMED');
    assert.equal(result.replayed, false);
    assert.equal(validateMobileRemoteOperationPair({
      capabilityId: 'm7-control-plane-prerequisite',
      capabilityVersion: 1,
      operationId: 'operation.abandon',
      request,
      result,
    }).valid, true);

    const after = fixture.journal.getOperation({
      deviceId: DEVICE, subjectId: SUBJECT, operationId: targetId,
    });
    assert.equal(after.state, 'abandoned');
    assert.equal(after.canAbandon, false);
    assert.equal(after.resultReference, null);
    assert.notEqual(after.revision, before.revision);
    assert.equal(fixture.db.prepare(`
      SELECT count(*) AS count FROM m7_remote_operation_events
      WHERE operation_id = ?
    `).get(targetId).count, 2);

    const replay = await invoke(fixture.provider, 'operation.abandon', request);
    assert.equal(replay.outcome, 'CONFIRMED');
    assert.equal(replay.replayed, true);
    assert.equal(fixture.db.prepare(
      'SELECT count(*) AS count FROM m7_remote_operation_abandonments',
    ).get().count, 1);
  } finally {
    fixture.db.close();
  }
});

await testAsync('stale and terminal targets reject without an abandonment receipt', async () => {
  const fixture = setup();
  try {
    const targetId = 'operation:target:confirmed';
    const targetRequest = {
      contract: 'SyntheticMutation', version: 1,
      requestId: 'request:target:confirmed', operationId: targetId,
    };
    await fixture.journal.run({
      deviceId: DEVICE, subjectId: SUBJECT,
      operationId: targetId, operationType: 'settings.update', request: targetRequest,
      execute: async () => ({
        contract: 'SyntheticMutationResult', version: 1,
        requestId: targetRequest.requestId, operationId: targetId,
        outcome: 'CONFIRMED', replayed: false,
      }),
    });
    const terminal = fixture.journal.getOperation({
      deviceId: DEVICE, subjectId: SUBJECT, operationId: targetId,
    });
    const rejected = await invoke(fixture.provider, 'operation.abandon', abandonRequest(
      targetId,
      terminal.revision,
      { requestId: 'request:operation:abandon:terminal', operationId: 'operation:abandon:terminal' },
    ));
    assert.equal(rejected.outcome, 'REJECTED');
    assert.equal(rejected.error.code, 'REMOTE_OPERATION_NOT_ABANDONABLE');
    assert.equal(fixture.db.prepare(
      'SELECT count(*) AS count FROM m7_remote_operation_abandonments',
    ).get().count, 0);
  } finally {
    fixture.db.close();
  }
});

await testAsync('direct SQL tamper, update, delete and a connection without UDF fail closed', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-abandon-'));
  const file = path.join(root, 'authority.sqlite');
  const primary = setup(file);
  try {
    const eventRequest = {
      contract: 'OperationAbandonCommand', version: 1,
      requestId: 'request:sql', operationId: 'operation:sql:source',
      targetOperationId: 'operation:sql:target', expectedRevision: 'rev:sql',
    };
    const receipt = {
      contract: 'M7RemoteOperationAbandonment', version: 1,
      deviceId: DEVICE, subjectId: SUBJECT,
      targetOperationId: eventRequest.targetOperationId,
      sourceOperationId: eventRequest.operationId,
      sourceRequestDigest: computeM7OperationRequestDigest(eventRequest),
      targetEventRevision: 1,
      targetRequestDigest: `sha256:${'a'.repeat(64)}`,
      recordedAtMs: 1,
    };
    assert.throws(() => primary.db.prepare(`
      INSERT INTO m7_remote_operation_abandonments (
        device_id, subject_id, target_operation_id, source_operation_id,
        source_request_digest, target_event_revision, target_request_digest,
        recorded_at_ms, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB))
    `).run(
      receipt.deviceId, receipt.subjectId, receipt.targetOperationId,
      receipt.sourceOperationId, receipt.sourceRequestDigest,
      receipt.targetEventRevision, receipt.targetRequestDigest,
      receipt.recordedAtMs, encodeM7OperationAbandonment(receipt),
    ), /AUTHORITY_MISSING/u);

    const secondary = new Database(file);
    try {
      assert.throws(() => secondary.prepare(`
        INSERT INTO m7_remote_operation_abandonments (
          device_id, subject_id, target_operation_id, source_operation_id,
          source_request_digest, target_event_revision, target_request_digest,
          recorded_at_ms, record_json
        ) VALUES ('device:x', 'user:x', 'operation:x', 'operation:y',
          'sha256:${'a'.repeat(64)}', 1, 'sha256:${'b'.repeat(64)}', 1, CAST('{}' AS BLOB))
      `).run(), /no such function: m7_remote_operation_abandonment_valid_v1/u);
    } finally {
      secondary.close();
    }
    const validTarget = 'operation:sql:valid-target';
    await unknownOperation(primary.journal, validTarget);
    const target = primary.journal.getOperation({
      deviceId: DEVICE, subjectId: SUBJECT, operationId: validTarget,
    });
    const validAbandon = abandonRequest(validTarget, target.revision, {
      requestId: 'request:sql:valid-abandon',
      operationId: 'operation:sql:valid-abandon',
    });
    assert.equal(
      (await invoke(primary.provider, 'operation.abandon', validAbandon)).outcome,
      'CONFIRMED',
    );
    assert.throws(() => primary.db.prepare(
      'UPDATE m7_remote_operation_abandonments SET recorded_at_ms = 2',
    ).run(), /append-only/u);
    assert.throws(() => primary.db.prepare(
      'DELETE FROM m7_remote_operation_abandonments',
    ).run(), /append-only/u);
  } finally {
    primary.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

summary();

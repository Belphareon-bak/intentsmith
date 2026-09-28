#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  AgentRepository,
  consumeM3AgentNotificationReadPort,
  createM3AgentNotificationReadPort,
  initAgentTables,
} from '../src/agents/repository.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import { up as installReceipts } from '../src/db/migrations/2026_08_29_107_m7_notification_ack_receipts.js';
import { createM7NotificationCoreAdapters } from '../src/remote/m7-notification-core-adapters.js';
import { createM7OperationJournal } from '../src/remote/m7-operation-journal.js';
import { encodeM7NotificationReceiptRecord } from '../src/remote/m7-notification-receipt-validation.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import { suite, summary, test, testAsync } from './harness.js';

const DEVICE = 'device:notification:001';
const SUBJECT = 'user:notification:001';

function setup({ authorize = async input => input.projectId === 7 } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initAgentTables(db);
  installJournal(db);
  installAbandonments(db);
  installReceipts(db);
  const repository = new AgentRepository(db);
  repository.createAgent({
    id: 'project-health', name: 'Project Health', definition: { type: 'MONITOR' },
  });
  const runId = repository.createRun('project-health');
  const firstId = Number(repository.createNotification('project-health', runId, {
    title: 'Project needs attention',
    body: 'Private body must not cross the remote projection.',
    priority: 'high',
    data: { projectId: 7, privateDetail: 'must-not-cross' },
  }));
  const secondId = Number(repository.createNotification('project-health', runId, {
    title: 'Foreign project notification',
    body: 'Foreign body.',
    priority: 'normal',
    data: { projectId: 8 },
  }));
  let time = Date.parse('2026-08-29T11:00:00.000Z');
  const now = () => ++time;
  const port = createM3AgentNotificationReadPort(repository);
  const adapters = createM7NotificationCoreAdapters({
    authorizeNotification: authorize,
    database: db,
    notificationPort: port,
    now,
  });
  const journal = createM7OperationJournal(db, { clock: now });
  const context = Object.freeze({ deviceId: DEVICE, subjectId: SUBJECT });
  return { adapters, context, db, firstId, journal, port, repository, runId, secondId };
}

function listRequest(overrides = {}) {
  return {
    contract: 'NotificationListQuery', version: 1,
    requestId: 'request:notification:list', limit: 25, afterSeq: 0,
    ...overrides,
  };
}

function ackRequest(notificationIds, observedThroughSeq, overrides = {}) {
  return {
    contract: 'NotificationAckCommand', version: 1,
    requestId: 'request:notification:ack', operationId: 'operation:notification:ack',
    notificationIds: [...notificationIds].sort(), observedThroughSeq,
    ...overrides,
  };
}

async function runAck(fixture, request, context = fixture.context) {
  return fixture.journal.run({
    deviceId: context.deviceId,
    subjectId: context.subjectId,
    operationId: request.operationId,
    operationType: 'notification.ack',
    request,
    execute: () => fixture.adapters.acknowledgeNotifications(request, context),
  });
}

suite('M7 notification projection and receipt service');

test('the M3 source port is genuine, narrow and bound to the same database', () => {
  const fixture = setup();
  try {
    assert.throws(
      () => createM3AgentNotificationReadPort({ db: fixture.db }),
      /genuine-repository-required/u,
    );
    assert.throws(
      () => consumeM3AgentNotificationReadPort(fixture.port, new Database(':memory:')),
      /genuine-same-database-port-required/u,
    );
    assert.deepEqual(Object.keys(fixture.port), ['contract', 'version']);
  } finally {
    fixture.db.close();
  }
});

await testAsync('list is bounded, redacted, twice-authorized and subject scoped', async () => {
  const authorizationCalls = [];
  const fixture = setup({
    authorize: async input => {
      authorizationCalls.push(input);
      return input.subjectId === SUBJECT && input.projectId === 7;
    },
  });
  try {
    const page = await fixture.adapters.listNotifications(listRequest(), fixture.context);
    const validation = validateMobileRemotePayload('NotificationPage@1', page);
    assert.deepEqual(validation.errors, [], JSON.stringify(page));
    assert.equal(page.status, 'ok', JSON.stringify(page));
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].notificationId, `notification:m3:${fixture.firstId}`);
    assert.equal(page.items[0].target.id, `agent-run:${fixture.runId}`);
    assert.equal(page.items[0].readAt, null);
    assert.equal(JSON.stringify(page).includes('Private body'), false);
    assert.equal(JSON.stringify(page).includes('must-not-cross'), false);
    assert.equal(authorizationCalls.filter(call => call.projectId === 7).length, 2);
    assert.equal(authorizationCalls.every(call => !Object.hasOwn(call, 'title')), true);
    assert.equal(page.nextAfterSeq, fixture.firstId);
    assert.equal(page.caughtUp, false);
    const exhausted = await fixture.adapters.listNotifications(listRequest({
      requestId: 'request:notification:exhausted', afterSeq: page.nextAfterSeq,
    }), fixture.context);
    assert.deepEqual(exhausted.items, []);
    assert.equal(exhausted.nextAfterSeq, fixture.secondId);
    assert.equal(exhausted.caughtUp, true);
  } finally {
    fixture.db.close();
  }
});

await testAsync('list cursor advances past denied rows without skipping the next allowed item', async () => {
  const fixture = setup();
  try {
    const thirdId = Number(fixture.repository.createNotification('project-health', fixture.runId, {
      title: 'Second allowed notification',
      body: 'Private second body.',
      priority: 'normal',
      data: { projectId: 7 },
    }));
    const first = await fixture.adapters.listNotifications(listRequest({ limit: 1 }), fixture.context);
    assert.deepEqual(first.items.map(item => item.notificationId), [
      `notification:m3:${fixture.firstId}`,
    ]);
    assert.equal(first.nextAfterSeq, fixture.firstId);
    assert.equal(first.caughtUp, false);

    const second = await fixture.adapters.listNotifications(listRequest({
      requestId: 'request:notification:list:continued',
      limit: 1,
      afterSeq: first.nextAfterSeq,
    }), fixture.context);
    assert.deepEqual(second.items.map(item => item.notificationId), [
      `notification:m3:${thirdId}`,
    ]);
    assert.equal(second.caughtUp, true);
  } finally {
    fixture.db.close();
  }
});

await testAsync('ack is journal-bound, durable, replay-safe and per device', async () => {
  const fixture = setup();
  try {
    const notificationId = `notification:m3:${fixture.firstId}`;
    const request = ackRequest([notificationId], fixture.firstId);
    let first;
    try {
      first = await runAck(fixture, request);
    } catch (error) {
      assert.fail(error.stack);
    }
    const validation = validateMobileRemotePayload('NotificationAckResult@1', first);
    assert.deepEqual(validation.errors, []);
    assert.equal(first.outcome, 'CONFIRMED', JSON.stringify(first));
    const replay = await runAck(fixture, request);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(first.acknowledgedIds, [notificationId]);
    assert.equal(fixture.db.prepare(
      'SELECT count(*) AS count FROM m7_remote_notification_ack_receipts',
    ).get().count, 1);
    assert.throws(
      () => fixture.db.prepare(`
        UPDATE m7_remote_notification_ack_receipts SET recorded_at_ms = recorded_at_ms + 1
      `).run(),
      /append-only/u,
    );
    assert.throws(
      () => fixture.db.prepare('DELETE FROM m7_remote_notification_ack_receipts').run(),
      /append-only/u,
    );

    const ownerPage = await fixture.adapters.listNotifications(listRequest({
      requestId: 'request:notification:owner-after',
    }), fixture.context);
    assert.match(ownerPage.items[0].readAt, /^2026-08-29T11:00:00\.\d{3}Z$/u);

    const otherDevicePage = await fixture.adapters.listNotifications(listRequest({
      requestId: 'request:notification:other-device',
    }), { deviceId: 'device:notification:002', subjectId: SUBJECT });
    assert.equal(otherDevicePage.items[0].readAt, null);
  } finally {
    fixture.db.close();
  }
});

await testAsync('ack cannot cross observed sequence or foreign authority', async () => {
  const fixture = setup();
  try {
    const notificationId = `notification:m3:${fixture.firstId}`;
    const beyond = await runAck(
      fixture,
      ackRequest([notificationId], fixture.firstId - 1, {
        requestId: 'request:notification:beyond', operationId: 'operation:notification:beyond',
      }),
    );
    assert.equal(beyond.outcome, 'REJECTED');

    const foreignId = `notification:m3:${fixture.secondId}`;
    const foreign = await runAck(
      fixture,
      ackRequest([foreignId], fixture.secondId, {
        requestId: 'request:notification:foreign', operationId: 'operation:notification:foreign',
      }),
    );
    assert.equal(foreign.outcome, 'REJECTED');
    assert.equal(fixture.db.prepare(
      'SELECT count(*) AS count FROM m7_remote_notification_ack_receipts',
    ).get().count, 0);
  } finally {
    fixture.db.close();
  }
});

await testAsync('authority loss at the pre-effect recheck cannot leave a receipt', async () => {
  let calls = 0;
  const fixture = setup({
    authorize: async input => input.projectId === 7 && ++calls === 1,
  });
  try {
    const result = await runAck(
      fixture,
      ackRequest([`notification:m3:${fixture.firstId}`], fixture.firstId),
    );
    assert.equal(result.outcome, 'REJECTED');
    assert.equal(calls, 2);
    assert.equal(fixture.db.prepare(
      'SELECT count(*) AS count FROM m7_remote_notification_ack_receipts',
    ).get().count, 0);
  } finally {
    fixture.db.close();
  }
});

await testAsync('a restarted SQLite connection re-registers receipt validation before ACK', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'm7-notification-restart-',
  ));
  const databasePath = path.join(directory, 'notifications.db');
  let first = new Database(databasePath);
  let second = null;
  try {
    first.pragma('foreign_keys = ON');
    initAgentTables(first);
    installJournal(first);
    installAbandonments(first);
    installReceipts(first);
    const initialRepository = new AgentRepository(first);
    initialRepository.createAgent({
      id: 'restart-agent', name: 'Restart Agent', definition: { type: 'MONITOR' },
    });
    const runId = initialRepository.createRun('restart-agent');
    const sequence = Number(initialRepository.createNotification('restart-agent', runId, {
      title: 'Durable notification', body: 'Private.', priority: 'normal',
      data: { projectId: 7 },
    }));
    first.close();
    first = null;

    second = new Database(databasePath);
    second.pragma('foreign_keys = ON');
    const repository = new AgentRepository(second);
    const port = createM3AgentNotificationReadPort(repository);
    let time = Date.parse('2026-08-29T12:00:00.000Z');
    const now = () => ++time;
    const adapters = createM7NotificationCoreAdapters({
      authorizeNotification: async input => input.projectId === 7,
      database: second,
      notificationPort: port,
      now,
    });
    const journal = createM7OperationJournal(second, { clock: now });
    const request = ackRequest([`notification:m3:${sequence}`], sequence, {
      requestId: 'request:notification:restart',
      operationId: 'operation:notification:restart',
    });
    const result = await journal.run({
      deviceId: DEVICE,
      subjectId: SUBJECT,
      operationId: request.operationId,
      operationType: 'notification.ack',
      request,
      execute: () => adapters.acknowledgeNotifications(request, {
        deviceId: DEVICE, subjectId: SUBJECT,
      }),
    });
    assert.equal(result.outcome, 'CONFIRMED', JSON.stringify(result));
  } finally {
    first?.close();
    second?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('receipt table rejects unauthorised direct writes and is append-only', () => {
  const fixture = setup();
  try {
    const record = {
      contract: 'M7NotificationAckReceipt', version: 1,
      deviceId: DEVICE, subjectId: SUBJECT,
      notificationId: `notification:m3:${fixture.firstId}`,
      notificationSequence: fixture.firstId,
      sourceRevision: `sha256:${'a'.repeat(64)}`,
      operationId: 'operation:notification:forged',
      requestDigest: `sha256:${'b'.repeat(64)}`,
      observedThroughSeq: fixture.firstId,
      recordedAtMs: 1,
    };
    assert.throws(() => fixture.db.prepare(`
      INSERT INTO m7_remote_notification_ack_receipts (
        device_id, subject_id, notification_id, notification_sequence, source_revision,
        operation_id, source_operation_revision, request_digest, observed_through_seq,
        recorded_at_ms, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      DEVICE, SUBJECT, record.notificationId, fixture.firstId, record.sourceRevision,
      record.operationId, 1, record.requestDigest, fixture.firstId, 1,
      encodeM7NotificationReceiptRecord(record),
    ), /AUTHORITY_MISSING|FOREIGN KEY/u);
  } finally {
    fixture.db.close();
  }
});

summary();

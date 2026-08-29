import { createHash } from 'node:crypto';

import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';
import { consumeM3AgentNotificationReadPort } from '../agents/repository.js';
import { computeM7OperationRequestDigest } from './m7-operation-journal-validation.js';
import {
  encodeM7NotificationReceiptRecord,
  registerM7NotificationReceiptFunctions,
} from './m7-notification-receipt-validation.js';

export const M7_NOTIFICATION_CORE_ERROR = Object.freeze({
  ACK_REJECTED: 'REMOTE_NOTIFICATION_ACK_REJECTED',
  AUTHORITY_INVALID: 'REMOTE_NOTIFICATION_AUTHORITY_INVALID',
  READ_FAILED: 'REMOTE_NOTIFICATION_READ_FAILED',
  SCAN_LIMIT: 'REMOTE_NOTIFICATION_SCAN_LIMIT',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const NOTIFICATION_ID = /^notification:m3:([1-9][0-9]{0,15})$/u;
const PRIORITIES = new Set(['low', 'normal', 'high']);
const DEFAULT_MAX_SCAN = 2_000;
const MAX_DATA_BYTES = 65_536;

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireDatabase(value) {
  const db = value?.db ?? value;
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('m7-notifications:sqlite-database-required');
  }
  return db;
}

function requireFunction(value, label, fallback = null) {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'function') throw new TypeError(`m7-notifications:${label}-required`);
  return resolved;
}

function requireMaxScan(value) {
  const resolved = value ?? DEFAULT_MAX_SCAN;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 100_000) {
    throw new TypeError('m7-notifications:max-scan-invalid');
  }
  return resolved;
}

function requireContext(value) {
  if (!plain(value)
    || !IDENTIFIER.test(value.deviceId || '')
    || !IDENTIFIER.test(value.subjectId || '')) {
    throw new TypeError('m7-notifications:trusted-context-invalid');
  }
  return value;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('m7-notifications:timestamp-invalid');
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new TypeError('m7-notifications:timestamp-invalid');
  return new Date(milliseconds).toISOString();
}

function nowMs(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('m7-notifications:clock-invalid');
  }
  return value;
}

function safeTitle(value) {
  if (typeof value !== 'string'
    || value.length < 1
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > 512
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError('m7-notifications:title-invalid');
  }
  return value;
}

function parseData(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_DATA_BYTES) {
    throw new TypeError('m7-notifications:data-invalid');
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TypeError('m7-notifications:data-invalid');
  }
  if (!plain(value)) throw new TypeError('m7-notifications:data-invalid');
  return value;
}

function projectIdFromData(data) {
  if (data === null) return null;
  const candidate = data.projectId ?? data.project_id ?? null;
  if (candidate === null) return null;
  const numeric = typeof candidate === 'string' && /^[1-9][0-9]*$/u.test(candidate)
    ? Number(candidate)
    : candidate;
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new TypeError('m7-notifications:project-id-invalid');
  }
  return numeric;
}

function sourceRevision(row) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(row), 'utf8')
    .digest('hex')}`;
}

function parseSourceRow(row) {
  if (!Number.isSafeInteger(row.sequence)
    || row.sequence < 1
    || !IDENTIFIER.test(row.agentId || '')
    || (row.runId !== null && (!Number.isSafeInteger(row.runId) || row.runId < 1))
    || !PRIORITIES.has(row.priority)) {
    throw new TypeError('m7-notifications:source-row-invalid');
  }
  const data = parseData(row.dataJson);
  const projectId = projectIdFromData(data);
  const target = row.runId !== null
    ? { type: 'run', id: `agent-run:${row.runId}` }
    : projectId !== null
      ? { type: 'project', id: `project:${projectId}` }
      : null;
  return deepFreeze({
    agentId: row.agentId,
    createdAt: canonicalTimestamp(row.createdAt),
    notificationId: `notification:m3:${row.sequence}`,
    priority: row.priority,
    projectId,
    revision: sourceRevision(row),
    runId: row.runId,
    sequence: row.sequence,
    target,
    title: safeTitle(row.title),
  });
}

function authorizationInput(item, context, operationId) {
  return deepFreeze({
    agentId: item.agentId,
    deviceId: context.deviceId,
    notificationId: item.notificationId,
    operationId,
    projectId: item.projectId,
    runId: item.runId,
    subjectId: context.subjectId,
  });
}

async function authorizeExact(authorize, item, context, operationId) {
  const decision = await authorize(authorizationInput(item, context, operationId));
  if (decision !== true && decision !== false) {
    throw new TypeError('m7-notifications:authority-decision-invalid');
  }
  return decision;
}

function listError(request, code, message, retryable = false) {
  return deepFreeze({
    contract: 'NotificationPage', version: 1,
    requestId: request.requestId, status: 'error',
    error: { code, message, retryable },
  });
}

function ackRevision(value) {
  return `rev:notification-ack:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function ackError(request, code, message) {
  return deepFreeze({
    contract: 'NotificationAckResult', version: 1,
    requestId: request.requestId, operationId: request.operationId,
    acknowledgedIds: [], acknowledgedThroughSeq: 0,
    revision: ackRevision({ code, operationId: request.operationId, requestId: request.requestId }),
    outcome: 'REJECTED', replayed: false,
    error: { code, message, retryable: false },
  });
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function sequenceFromNotificationId(value) {
  const match = NOTIFICATION_ID.exec(value || '');
  if (!match) throw new TypeError('m7-notifications:notification-id-invalid');
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence)) throw new TypeError('m7-notifications:notification-id-invalid');
  return sequence;
}

export function createM7NotificationCoreAdapters({
  authorizeNotification,
  database,
  maxNotificationScan,
  notificationPort,
  now,
} = {}) {
  const db = requireDatabase(database);
  // SQLite UDFs are connection-local. Re-register on every runtime
  // construction, including when migration 107 is already recorded.
  registerM7NotificationReceiptFunctions(db);
  const source = consumeM3AgentNotificationReadPort(notificationPort, db);
  const authorize = requireFunction(authorizeNotification, 'authorize-notification');
  const clock = requireFunction(now, 'clock', Date.now);
  const maxScan = requireMaxScan(maxNotificationScan);

  const selectReceipt = db.prepare(`
    SELECT notification_id AS notificationId, notification_sequence AS notificationSequence,
      source_revision AS sourceRevision, recorded_at_ms AS recordedAtMs,
      receipt_revision AS receiptRevision
    FROM m7_remote_notification_ack_receipts
    WHERE device_id = ? AND subject_id = ? AND notification_id = ?
  `);
  const selectIntent = db.prepare(`
    SELECT revision, request_digest AS requestDigest
    FROM m7_remote_operation_events
    WHERE device_id = ? AND subject_id = ? AND operation_id = ?
      AND operation_type = 'notification.ack' AND sequence = 0 AND state = 'STARTED'
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO m7_remote_notification_ack_receipts (
      device_id, subject_id, notification_id, notification_sequence, source_revision,
      operation_id, source_operation_revision, request_digest, observed_through_seq,
      recorded_at_ms, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  async function listNotifications(request, trustedContext) {
    let context;
    try {
      context = requireContext(trustedContext);
      const afterSequence = request.afterSeq ?? 0;
      const rows = source.listAfter({ afterSequence, limit: maxScan + 1 });
      if (rows.length > maxScan) {
        return listError(
          request,
          M7_NOTIFICATION_CORE_ERROR.SCAN_LIMIT,
          'The notification source exceeds the bounded remote projection.',
        );
      }
      const items = [];
      let lastScannedSequence = afterSequence;
      let moreAuthorized = false;
      for (const row of rows) {
        const item = parseSourceRow(row);
        lastScannedSequence = item.sequence;
        if (item.target === null) continue;
        if (!await authorizeExact(authorize, item, context, 'notification.list')) continue;
        if (items.length >= request.limit) {
          moreAuthorized = true;
          break;
        }
        const receipt = selectReceipt.get(context.deviceId, context.subjectId, item.notificationId);
        const projected = deepFreeze({
          notificationId: item.notificationId,
          sequence: item.sequence,
          kind: 'agent.result',
          priority: item.priority,
          title: item.title,
          target: item.target,
          projectId: item.projectId,
          createdAt: item.createdAt,
          readAt: receipt ? new Date(receipt.recordedAtMs).toISOString() : null,
          revision: `rev:notification:${item.revision.slice(7)}`,
        });
        if (await authorizeExact(authorize, item, context, 'notification.list')) items.push(projected);
      }
      const nextAfterSeq = items.length > 0 ? items.at(-1).sequence : lastScannedSequence;
      return deepFreeze({
        contract: 'NotificationPage', version: 1,
        requestId: request.requestId, status: 'ok', items, nextAfterSeq,
        caughtUp: !moreAuthorized && nextAfterSeq >= lastScannedSequence,
      });
    } catch {
      return listError(
        request,
        M7_NOTIFICATION_CORE_ERROR.READ_FAILED,
        'Notifications could not be read safely.',
        true,
      );
    }
  }

  async function acknowledgeNotifications(request, trustedContext) {
    let context;
    try {
      context = requireContext(trustedContext);
      const sequences = request.notificationIds.map(sequenceFromNotificationId);
      if (sequences.some(sequence => sequence > request.observedThroughSeq)) {
        return ackError(
          request,
          M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
          'The acknowledgement exceeds the observed notification sequence.',
        );
      }
      const sourceRows = source.findBySequences(sequences);
      if (sourceRows.length !== sequences.length) {
        return ackError(
          request,
          M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
          'One or more notifications are not available.',
        );
      }
      const parsedById = new Map(sourceRows.map(row => {
        const item = parseSourceRow(row);
        return [item.notificationId, item];
      }));
      const items = request.notificationIds.map(notificationId => parsedById.get(notificationId));
      if (items.some(item => item === undefined || item.target === null)) {
        return ackError(
          request,
          M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
          'One or more notifications are not available.',
        );
      }
      for (const item of items) {
        if (!await authorizeExact(authorize, item, context, 'notification.ack')) {
          return ackError(
            request,
            M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
            'One or more notifications are not available.',
          );
        }
      }
      // Repeat the authority decision before entering the durable effect. Once
      // the receipt exists, this operation must not report a false rejection.
      for (const item of items) {
        if (!await authorizeExact(authorize, item, context, 'notification.ack')) {
          return ackError(
            request,
            M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
            'One or more notifications are not available.',
          );
        }
      }
      const requestDigest = computeM7OperationRequestDigest(request);
      const recordedAtMs = nowMs(clock);
      const receipts = immediate(db, () => {
        const intent = selectIntent.get(context.deviceId, context.subjectId, request.operationId);
        if (!intent || intent.requestDigest !== requestDigest) {
          throw new TypeError('m7-notifications:operation-intent-missing');
        }
        const currentRows = source.findBySequences(sequences);
        if (currentRows.length !== sequences.length) {
          throw new TypeError('m7-notifications:source-changed');
        }
        const currentById = new Map(currentRows.map(row => {
          const item = parseSourceRow(row);
          return [item.notificationId, item];
        }));
        const currentItems = request.notificationIds.map(notificationId => currentById.get(notificationId));
        if (currentItems.some(item => item === undefined)) {
          throw new TypeError('m7-notifications:source-changed');
        }
        return currentItems.map(item => {
          const existing = selectReceipt.get(
            context.deviceId,
            context.subjectId,
            item.notificationId,
          );
          if (existing) {
            if (existing.notificationSequence !== item.sequence
              || existing.sourceRevision !== item.revision) {
              throw new TypeError('m7-notifications:receipt-source-mismatch');
            }
            return existing;
          }
          const record = {
            contract: 'M7NotificationAckReceipt', version: 1,
            deviceId: context.deviceId, subjectId: context.subjectId,
            notificationId: item.notificationId, notificationSequence: item.sequence,
            sourceRevision: item.revision, operationId: request.operationId,
            requestDigest, observedThroughSeq: request.observedThroughSeq, recordedAtMs,
          };
          insertReceipt.run(
            context.deviceId,
            context.subjectId,
            item.notificationId,
            item.sequence,
            item.revision,
            request.operationId,
            intent.revision,
            requestDigest,
            request.observedThroughSeq,
            recordedAtMs,
            encodeM7NotificationReceiptRecord(record),
          );
          return selectReceipt.get(context.deviceId, context.subjectId, item.notificationId);
        });
      });
      const acknowledgedIds = items.map(item => item.notificationId).sort();
      const acknowledgedThroughSeq = Math.max(...items.map(item => item.sequence));
      return deepFreeze({
        contract: 'NotificationAckResult', version: 1,
        requestId: request.requestId, operationId: request.operationId,
        acknowledgedIds, acknowledgedThroughSeq,
        revision: ackRevision({
          acknowledgedIds,
          deviceId: context.deviceId,
          receiptRevisions: receipts.map(receipt => receipt.receiptRevision),
          subjectId: context.subjectId,
        }),
        outcome: 'CONFIRMED', replayed: false,
      });
    } catch {
      return ackError(
        request,
        M7_NOTIFICATION_CORE_ERROR.ACK_REJECTED,
        'Notifications could not be acknowledged safely.',
      );
    }
  }

  return Object.freeze({
    acknowledgeNotifications,
    handlers: Object.freeze({
      'notification.ack': acknowledgeNotifications,
      'notification.list': listNotifications,
    }),
    listNotifications,
  });
}

export default createM7NotificationCoreAdapters;

import { createHash, randomUUID } from 'node:crypto';

const TOKEN = /^[a-z][a-z0-9.-]{0,127}$/;
const METHOD = /^[A-Z]{1,16}$/;
const REASON = /^[A-Z][A-Z0-9_]{0,127}$/;

function digest(prefix, value) {
  return `${prefix}:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function requireToken(value, label, maximum = 128) {
  if (typeof value !== 'string' || value.length > maximum || !TOKEN.test(value)) {
    throw new TypeError(`outbound-audit:${label}-invalid`);
  }
  return value;
}

export class OutboundAuditRepository {
  constructor(database, { clock = Date.now, idFactory = randomUUID } = {}) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('outbound-audit:database-required');
    }
    this.database = database;
    this.clock = clock;
    this.idFactory = idFactory;
    this.insert = database.prepare(`
      INSERT INTO m5_outbound_audit_events (
        event_id, request_id, occurred_at_ms, phase, surface, scope, method,
        target_origin, target_digest, decision, reason_code, http_status, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  createRequestId(seed = randomUUID()) {
    return digest('obr1', seed);
  }

  append({
    requestId,
    phase,
    surface,
    scope,
    method,
    targetOrigin,
    targetDigest,
    decision,
    reasonCode,
    httpStatus = null,
  }) {
    const occurredAtMs = this.clock();
    const eventId = digest('oba1', `${requestId}:${phase}:${occurredAtMs}:${this.idFactory()}`);
    if (!/^obr1:[a-f0-9]{64}$/.test(requestId)) throw new TypeError('outbound-audit:request-id-invalid');
    if (!['decision', 'terminal'].includes(phase)) throw new TypeError('outbound-audit:phase-invalid');
    requireToken(surface, 'surface', 64);
    requireToken(scope, 'scope');
    if (!METHOD.test(method)) throw new TypeError('outbound-audit:method-invalid');
    if (typeof targetOrigin !== 'string' || targetOrigin.length < 1 || targetOrigin.length > 512) {
      throw new TypeError('outbound-audit:target-origin-invalid');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(targetDigest)) throw new TypeError('outbound-audit:target-digest-invalid');
    if (!['allow', 'deny', 'succeeded', 'failed'].includes(decision)) {
      throw new TypeError('outbound-audit:decision-invalid');
    }
    if (!REASON.test(reasonCode)) throw new TypeError('outbound-audit:reason-invalid');
    if (!(httpStatus === null || (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599))) {
      throw new TypeError('outbound-audit:http-status-invalid');
    }
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs <= 0) {
      throw new TypeError('outbound-audit:clock-invalid');
    }
    const record = Object.freeze({
      eventId,
      requestId,
      occurredAtMs,
      phase,
      surface,
      scope,
      method,
      targetOrigin,
      targetDigest,
      decision,
      reasonCode,
      httpStatus,
    });
    this.insert.run(
      eventId,
      requestId,
      occurredAtMs,
      phase,
      surface,
      scope,
      method,
      targetOrigin,
      targetDigest,
      decision,
      reasonCode,
      httpStatus,
      JSON.stringify(record),
    );
    return record;
  }

  summary({ limit = 20 } = {}) {
    const bounded = Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : 20;
    const counts = this.database.prepare(`
      SELECT decision, count(*) AS count
      FROM m5_outbound_audit_events
      WHERE phase = 'decision'
      GROUP BY decision ORDER BY decision
    `).all();
    const recent = this.database.prepare(`
      SELECT record_json AS recordJson FROM m5_outbound_audit_events
      ORDER BY occurred_at_ms DESC, event_id DESC LIMIT ?
    `).all(bounded).map(row => Object.freeze(JSON.parse(row.recordJson)));
    return Object.freeze({
      decisions: Object.freeze(Object.fromEntries(counts.map(row => [row.decision, row.count]))),
      recent: Object.freeze(recent),
    });
  }
}

export function outboundTargetDigest(url) {
  return digest('sha256', url);
}

export default OutboundAuditRepository;

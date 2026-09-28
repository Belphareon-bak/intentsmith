import { CONVERSATION_WEB, canonicalWebUrl, parseWebApproval, requireWebIdentity, webDigest, webError } from '../../contracts/m2/conversation-web-v1.js';
import { OutboundAuditRepository, outboundTargetDigest } from './outbound-audit-repository.js';
import { isLocalOperatorTransportSubject } from '../security/global-auth-policy.js';

const writers = new WeakSet();
export function registerConversationWebWriter(database) {
  database.function('conversation_web_writer', () => writers.has(database) ? 1 : 0);
}

export class ConversationWebRepository {
  #claims = new WeakMap();

  constructor(database, { clock = Date.now } = {}) {
    this.database = database;
    this.clock = clock;
    registerConversationWebWriter(database);
    this.audit = new OutboundAuditRepository(database, { clock });
  }

  #write(fn) {
    writers.add(this.database);
    try { return this.database.transaction(fn)(); }
    finally { writers.delete(this.database); }
  }

  identity(context) {
    const subjectId = requireWebIdentity(context);
    if (!isLocalOperatorTransportSubject(context.authenticatedSubject)) throw webError('WEB_LOCAL_TRANSPORT_REQUIRED');
    const conversation = this.database.prepare('SELECT * FROM conversations WHERE id = ?').get(context.conversationId);
    const message = this.database.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND role = ?')
      .get(context.userMessageId, context.conversationId, 'user');
    if (!conversation || conversation.state !== 'active' || conversation.deleted_at
      || conversation.project_id !== null || !message) throw webError('WEB_CONVERSATION_UNAVAILABLE');
    return { subjectId, message };
  }

  propose(url, context) {
    return this.#write(() => {
      const { subjectId, message } = this.identity(context);
      url = canonicalWebUrl(url);
      const requestId = `web:${webDigest(JSON.stringify([context.conversationId, message.id, url]))}`;
      const existing = this.database.prepare('SELECT * FROM conversation_web_requests WHERE request_id = ?').get(requestId);
      if (existing) return existing;
      const now = this.clock();
      const count = this.database.prepare('SELECT count(*) AS n FROM conversation_web_requests WHERE conversation_id = ? AND created_at_ms > ?')
        .get(context.conversationId, now - 60000).n;
      if (count >= 20) throw webError('WEB_RATE_LIMITED');
      this.database.prepare(`INSERT INTO conversation_web_requests
        (request_id, conversation_id, subject_id, user_message_id, input_digest, url, created_at_ms, expires_at_ms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(requestId, context.conversationId,
        subjectId, message.id, webDigest(message.content), url, now, now + CONVERSATION_WEB.approvalTtlMs);
      return this.read(requestId, context);
    });
  }

  read(requestId, context) {
    const { subjectId } = this.identity(context);
    const row = this.database.prepare(`SELECT * FROM conversation_web_requests
      WHERE request_id = ? AND conversation_id = ? AND subject_id = ?`).get(requestId, context.conversationId, subjectId);
    if (!row) throw webError('WEB_REQUEST_NOT_FOUND');
    const original = this.database.prepare('SELECT content, role, conversation_id FROM messages WHERE id = ?').get(row.user_message_id);
    if (!original || original.role !== 'user' || original.conversation_id !== row.conversation_id
      || webDigest(original.content) !== row.input_digest) throw webError('WEB_ORIGIN_CHANGED');
    if (row.status === 'succeeded' && webDigest(row.output) !== row.output_digest) throw webError('WEB_OUTPUT_CORRUPT');
    return row;
  }

  claim(requestId, context) {
    return this.#write(() => {
      const { message } = this.identity(context);
      const row = this.read(requestId, context);
      if (parseWebApproval(message.content) !== requestId || message.id === row.user_message_id) throw webError('WEB_EXACT_APPROVAL_REQUIRED');
      if (row.status !== 'pending') return { claimed: false, row };
      const now = this.clock();
      if (now >= row.expires_at_ms) throw webError('WEB_APPROVAL_EXPIRED');
      this.database.prepare(`UPDATE conversation_web_requests SET status = 'executing',
        consumed_at_ms = ?, approval_message_id = ? WHERE request_id = ? AND status = 'pending'`)
        .run(now, message.id, requestId);
      this.recordAudit(row, 'decision', 'allow', 'WEB_EXACT_REQUEST_APPROVED');
      const claim = Object.freeze({ claimed: true, row: this.read(requestId, context) });
      this.#claims.set(claim, Object.freeze({ ...claim.row }));
      return claim;
    });
  }

  recordAudit(row, phase, decision, reasonCode, httpStatus = null) {
    this.audit.append({ requestId: this.audit.createRequestId(row.request_id), phase,
      surface: 'conversation-web', scope: 'conversation.https.get', method: 'GET',
      targetOrigin: new URL(row.url).origin, targetDigest: outboundTargetDigest(row.url), decision, reasonCode, httpStatus });
  }

  settle(requestId, context, result, errorCode = null) {
    return this.#write(() => {
      const row = this.read(requestId, context);
      if (row.status !== 'executing') throw webError('WEB_REQUEST_REVOKED');
      if (!errorCode && (!Buffer.isBuffer(result?.bytes) || result.bytes.length > CONVERSATION_WEB.maxResponseBytes
        || result.status !== 200 || typeof result.contentType !== 'string'
        || typeof result.address !== 'string')) throw webError('WEB_OUTPUT_INVALID');
      this.database.prepare(`UPDATE conversation_web_requests SET status = ?, http_status = ?, content_type = ?,
        resolved_address = ?, output = ?, output_digest = ?, error_code = ? WHERE request_id = ? AND status = 'executing'`)
        .run(errorCode ? 'failed' : 'succeeded', result?.status ?? null, result?.contentType ?? null,
          result?.address ?? null, errorCode ? null : result.bytes, errorCode ? null : webDigest(result.bytes), errorCode, requestId);
      this.recordAudit(row, 'terminal', errorCode ? 'failed' : 'succeeded', errorCode || 'WEB_RESPONSE_COMMITTED', result?.status ?? null);
      return this.read(requestId, context);
    });
  }

  failClaim(claim, errorCode) {
    // Closing an attempt must survive loss of conversation scope. Only this
    // repository's actual process-local claim can close its own audit; it can
    // never restore revoked output, approve a request or start another effect.
    const original = claim && this.#claims.get(claim);
    if (!original || !/^WEB_[A-Z_]+$/.test(errorCode || '')) throw webError('WEB_CLAIM_INVALID');
    return this.#write(() => {
      const auditId = this.audit.createRequestId(original.request_id);
      const terminal = this.database.prepare(`SELECT 1 FROM m5_outbound_audit_events
        WHERE request_id = ? AND phase = 'terminal'`).get(auditId);
      if (terminal) return;
      const row = this.database.prepare('SELECT * FROM conversation_web_requests WHERE request_id = ?')
        .get(original.request_id);
      if (row && (!['executing', 'revoked'].includes(row.status)
        || ['conversation_id', 'subject_id', 'user_message_id', 'input_digest', 'url', 'approval_message_id', 'consumed_at_ms']
          .some(key => row[key] !== original[key]))) throw webError('WEB_CLAIM_STATE_INVALID');
      if (row?.status === 'executing') this.database.prepare(`UPDATE conversation_web_requests
        SET status = 'failed', output = NULL, output_digest = NULL, error_code = ?
        WHERE request_id = ? AND status = 'executing'`).run(errorCode, original.request_id);
      this.recordAudit(original, 'terminal', 'failed', errorCode);
    });
  }

  revoke(requestId, context) {
    const row = this.read(requestId, context);
    if (row.status !== 'revoked') this.database.prepare(`UPDATE conversation_web_requests
      SET status = 'revoked', output = NULL, output_digest = NULL, error_code = 'WEB_USER_REVOKED' WHERE request_id = ?`).run(requestId);
    return this.read(requestId, context);
  }
}

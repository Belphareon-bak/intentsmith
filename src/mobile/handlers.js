// /m1 route handlers — B5.
// ==============================================================================
//
// Handlers run only *after* gateway-policy has authorized the request, so none
// of them re-checks the token.  They do re-check anything the policy cannot
// know: whether the operation key is a replay, whether an approval still binds
// to its payload, whether an upstream is reachable.
//
// Split of responsibility with the legacy server (PLAN.md §2 diagram):
//
//   reads  — served from the shared SQLite directly.  The gateway and the
//            server are separate processes over one WAL database, so a read
//            needs no hop and no upstream dependency.
//   chat   — delegated upstream over loopback.  CRE, quality gates, and the
//            LLM live in the server process and stay its responsibility; the
//            gateway must not become a second place where chat is decided
//            (PLAN.md §2 rule 6: no existing contract is weakened for mobile).
//
// Every response goes through `withEnvelope`, which stamps the protocol version
// and the scopes actually in force (§8.7), or through `mobileError`, which
// carries a specific cause (§8.3).
//
// ==============================================================================

import {
  CURSOR_BACKWARD,
  MOBILE_ERRORS,
  PROTOCOL_VERSION,
  UNKNOWN_REASONS,
  decodeCursor,
  mobileError,
  normalizeUnknownReason,
  paginate,
  paginateBackward,
  versioned,
  withEnvelope,
} from './protocol.js';
import { claimPairingCode } from './pairing.js';
import { listMobileNotifications, ackMobileNotifications } from '../notifications/channels/mobile.js';
import { approvalIsBound, evaluateApprovalDecision, decisionState } from '../approvals/authority.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_MESSAGE_LENGTH = 32_000;

// Browser-managed HTTP caches are outside the app's logical cache lifecycle.
// Approval list and decision results therefore carry an explicit transport
// directive without changing their frozen response bodies.
export const APPROVAL_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });

// ── GET /m1/health ───────────────────────────────────────────────────────────
//
// Public and deliberately minimal: it carries no conversation data, no device
// list, and no configuration.  Its only job is to let a client tell "network
// unreachable" apart from "server down" apart from "token rejected", which
// §8.3 requires and which no authenticated endpoint can do.

export async function handleHealth({ upstream }) {
  const upstreamState = await upstream.probe();
  return {
    status: 200,
    body: withEnvelope({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      // Reported separately so a client sees a gateway that is up but cannot
      // reach the brain, rather than a blanket failure.
      upstream: upstreamState.reachable ? 'ok' : 'unreachable',
      upstreamDetail: upstreamState.reachable ? null : upstreamState.reason,
      time: new Date().toISOString(),
    }),
  };
}

// ── GET /m1/capabilities ─────────────────────────────────────────────────────

export async function handleCapabilities({ principal, upstream, corePort = null }) {
  const upstreamState = await upstream.probe();
  return {
    status: 200,
    body: withEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      device: { id: principal.deviceId, name: principal.name },
      // §8.7 — the client's idea of its own scopes is refreshed from the
      // server on every capabilities read, so MD-12 cannot drift.
      scopes: principal.scopes,
      features: {
        chat: principal.scopes.includes('write:chat') && upstreamState.reachable,
        conversations: principal.scopes.includes('read:chat'),
        notifications: principal.scopes.includes('read:notifications'),
        approvals: principal.scopes.includes('read:approvals'),
        // Streaming does not exist upstream (PLAN.md §3): onLLMToken has no
        // producer.  Advertising it would make the client build a UI for a
        // capability the backend cannot deliver.
        streaming: false,
      },
      limits: { maxMessageLength: MAX_MESSAGE_LENGTH, pageSize: DEFAULT_PAGE_SIZE },
      upstream: upstreamState.reachable ? 'ok' : 'unreachable',
      // MM2: the versioned in-process connector is reported separately from
      // legacy booleans so old clients remain compatible and new clients can
      // distinguish unavailable providers from missing scopes.
      remoteCore: corePort?.capabilities(principal) ?? null,
    }, { principal }),
  };
}

// ── GET /m1/conversations ────────────────────────────────────────────────────

export async function handleConversations({ rawDb, principal, query }) {
  const limit = clampLimit(query.get('limit'));
  const cursor = decodeCursor(query.get('cursor'), { stream: 'conversations' });
  if (!cursor.valid) {
    // §8.2 — an unrecognised cursor is refused with a name, never guessed at.
    // `restart: true` tells the client the correct recovery is to load from the
    // beginning, so it does not have to infer that.
    return errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true });
  }

  // One row beyond the page so `hasMore` is observed rather than inferred
  // from a full page (§8.6).
  const rows = rawDb.prepare(`
    SELECT id, title, message_count, state, created_at, updated_at
      FROM conversations
     WHERE state != 'deleted'
     ORDER BY datetime(updated_at) DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(limit + 1, cursor.position);

  const page = paginate({
    rows: rows.map(row => versioned({
      id: row.id,
      title: row.title || 'Nová konverzace',
      messageCount: row.message_count || 0,
      state: row.state || 'active',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    limit,
    stream: 'conversations',
    position: cursor.position,
  });

  return {
    status: 200,
    body: withEnvelope(page.items, {
      principal,
      extra: { hasMore: page.hasMore, nextCursor: page.nextCursor, end: page.end },
    }),
  };
}

// ── GET /m1/conversations/:id ────────────────────────────────────────────────

export async function handleConversationDetail({ rawDb, principal, params, query }) {
  const conversation = rawDb.prepare(`
    SELECT id, title, message_count, state, created_at, updated_at
      FROM conversations WHERE id = ?
  `).get(params.id);

  if (!conversation) return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'conversation' });

  const limit = clampLimit(query.get('limit'), 50);
  const stream = `messages:${params.id}`;

  // §8.2 — `anchor` opens a walk at a named end of the stream; after that the
  // cursor carries the direction.  Sending both would be two different claims
  // about where the page starts, so it is refused rather than silently resolved
  // in favour of one of them.
  const anchor = query.get('anchor');
  const rawCursor = query.get('cursor');
  if (anchor !== null && rawCursor) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'anchor_with_cursor',
      detail: 'anchor opens a walk; a cursor continues one',
    });
  }
  if (anchor !== null && anchor !== 'latest') {
    // An unknown anchor must not fall through to the oldest page: that is how a
    // client ends up believing it is holding the newest messages when it is not.
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'anchor_unknown', anchor, allowed: ['latest'],
    });
  }

  const cursor = decodeCursor(rawCursor, { stream });
  if (!cursor.valid) {
    return errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true });
  }

  const toMessage = row => versioned({
    id: String(row.id),
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    metadata: safeParse(row.metadata),
  });
  const selectMessages = rawDb.prepare(`
    SELECT id, role, content, created_at, metadata
      FROM messages
     WHERE conversation_id = ?
     ORDER BY id ASC
     LIMIT ? OFFSET ?
  `);

  const backward = anchor === 'latest' || cursor.direction === CURSOR_BACKWARD;
  let page;
  if (backward) {
    // `until` is the exclusive upper offset of the page being built: the end of
    // the stream when the walk opens, and the start of the previously served
    // page on every step after that.
    const total = rawDb.prepare(`
      SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?
    `).get(params.id).total;
    const until = anchor === 'latest' ? total : Math.min(cursor.position, total);
    const start = Math.max(0, until - limit);
    const rows = until > start ? selectMessages.all(params.id, until - start, start) : [];
    page = paginateBackward({ rows: rows.map(toMessage), stream, start });
  } else {
    // One row beyond the page so `hasMore` is observed rather than inferred
    // from a full page (§8.6).
    const rows = selectMessages.all(params.id, limit + 1, cursor.position);
    page = paginate({
      rows: rows.map(toMessage),
      limit,
      stream,
      position: cursor.position,
    });
  }

  return {
    status: 200,
    body: withEnvelope({
      conversation: versioned({
        id: conversation.id,
        title: conversation.title || 'Nová konverzace',
        messageCount: conversation.message_count || 0,
        state: conversation.state || 'active',
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      }),
      messages: page.items,
    }, {
      principal,
      extra: {
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        end: page.end,
        // §8.7 — the response states which way this walk runs, so "end" is never
        // ambiguous between "oldest message reached" and "newest message reached".
        direction: backward ? CURSOR_BACKWARD : 'forward',
      },
    }),
  };
}

// ── POST /m1/chat ────────────────────────────────────────────────────────────
//
// The one mutating chat path, and therefore the one that must not be able to
// run twice for a single user intent.  The journal decides that before any
// upstream call happens.

export async function handleChat({ rawDb, journal, upstream, corePort = null, principal, body }) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
  const operationId = body?.operationId;

  if (!message) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'message', reason: 'empty' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'message', reason: 'too_long', max: MAX_MESSAGE_LENGTH });
  }
  if (!conversationId) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'conversationId', reason: 'required' });
  }
  if (!operationId) {
    // Required, not optional: without a key the server cannot make a retry
    // safe, and a client that omits it is asking for duplicate sends.
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'operationId', reason: 'required' });
  }

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'chat.send',
    request: { conversationId, message },
  });

  if (claim.outcome === 'conflict') {
    const descriptor = claim.reason === 'fingerprint_mismatch'
      ? MOBILE_ERRORS.OPERATION_CONFLICT
      : MOBILE_ERRORS.BAD_REQUEST;
    return errorResponse(descriptor, { reason: claim.reason, operationId, record: claim.record ?? null });
  }

  if (claim.outcome === 'limited') {
    // §8.11 — a recognisable refusal, never a queue.  `openOperations` is
    // included so the client can show the user exactly what to resolve.
    return errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      {
        reason: claim.reason,
        open: claim.open ?? null,
        limit: claim.limit ?? null,
        retryAfterMs: claim.retryAfterMs ?? null,
        openOperations: journal.openOperations(principal.deviceId),
      },
    );
  }

  if (claim.outcome === 'replay') {
    // §8.8 — the original result, and no second effect.  `replayed: true` lets
    // the client tell "this went through" from "this just went through".
    return chatOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  // ── Effect ────────────────────────────────────────────────────────────────
  try {
    ensureConversationRow(rawDb, conversationId);

    const upstreamResult = corePort
      ? portChatResult(await corePort.invoke({
        version: 1,
        feature: 'conversations.send',
        input: { conversationId, message },
        principal,
      }))
      : await upstream.postChat({ conversationId, message });

    if (!upstreamResult.ok) {
      // The upstream said no in a way we understand → a decided negative.
      if (upstreamResult.decided) {
        const resolution = journal.reject(
          principal.deviceId, operationId, upstreamResult.code || 'upstream_error',
        );
        if (!resolution.resolved) return chatResolutionResponse(resolution, operationId, principal);
        return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
          reason: upstreamResult.code || 'upstream_error',
          operationId,
          state: 'REJECTED',
        });
      }
      // We could not tell whether the effect happened.  MD-19 rule 3: this is
      // UNKNOWN, and the client must resolve it by *reading* the state — it
      // must not retry with a fresh key, which would turn one send into two.
      //
      // The transport code is narrowed to the closed vocabulary here as well as
      // in the journal, so the screen shown now and the reason read back later
      // are the same word.
      const reason = normalizeUnknownReason(upstreamResult.code);
      journal.markUnknown(principal.deviceId, operationId, reason);
      return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      });
    }

    const result = {
      conversationId,
      response: upstreamResult.data?.response ?? '',
      mode: upstreamResult.data?.mode ?? null,
      confidence: upstreamResult.data?.confidence ?? null,
    };
    try {
      const resolution = journal.confirm(principal.deviceId, operationId, result);
      if (!resolution.resolved) {
        return chatResolutionResponse(resolution, operationId, principal);
      }
    } catch (persistError) {
      // The effect happened; writing it down did not.  Reporting success would
      // promise a record the client can never read back, so this is UNKNOWN
      // with the one cause that says the answer existed and was lost.
      // (A database that is entirely gone defeats this too — then nothing here
      // can record anything, and the 503 below is all that is left.)
      try {
        journal.markUnknown(principal.deviceId, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED);
      } catch { /* nothing left to write to */ }
      return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      });
    }

    return {
      status: 200,
      body: withEnvelope(
        { operationId, state: 'CONFIRMED', result: versioned(result) },
        { principal },
      ),
    };
  } catch (error) {
    // A throw here is genuinely ambiguous — the request may or may not have
    // reached the model.  UNKNOWN is the only honest state.
    journal.markUnknown(principal.deviceId, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION);
    return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: UNKNOWN_REASONS.GATEWAY_EXCEPTION,
      operationId,
      state: 'UNKNOWN',
      resolveBy: `GET /m1/operations/${operationId}`,
    });
  }
}

// ── GET /m1/operations/:operationId ──────────────────────────────────────────
//
// §8.10 / MD-19 §4.1 rule 1.  Carries no payload, needs no scope, and is
// always safe: it is how an UNKNOWN gets resolved without risking a second
// execution.

export async function handleOperationLookup({ journal, principal, params }) {
  const record = journal.lookup(principal.deviceId, params.operationId);

  if (!record.known) {
    // Explicitly "I do not know this key" — distinct from any outcome, so the
    // client can apply MD-19 §4.1 rule 3 (retry with the *same* key only if it
    // still holds the original request) rather than assume success or failure.
    return {
      status: 404,
      body: {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        data: { operationId: params.operationId, known: false, state: null },
      },
    };
  }

  return {
    status: 200,
    body: withEnvelope({
      operationId: params.operationId,
      known: true,
      state: record.state,
      operationType: record.operationType,
      requestFingerprint: record.requestFingerprint,
      result: record.result,
      errorCode: record.errorCode,
      // A lookup is a *read of the last recorded state*, not a reconciliation
      // with whatever ran upstream — GATEWAY.md §6 says so out loud.  This read
      // is itself the current check (the envelope carries `serverTime`), so the
      // stored `lastCheckedAt` would only repeat it; it is reported per entry in
      // `GET /m1/operations`, where it is about *other* attempts and does mean
      // something.
      unknownReason: record.unknownReason,
      unknownAt: record.unknownAt,
      createdAt: record.createdAt,
      resolvedAt: record.resolvedAt,
    }, { principal }),
  };
}

// ── GET /m1/operations ───────────────────────────────────────────────────────
//
// The cap in §8.11 refuses every further mutation once it is reached, and
// PENDING/UNKNOWN never expire.  Without a way to see and release them the cap
// is a one-way ratchet: the app reaches a state it cannot leave.  This route
// and the abandon route below are that way out.

export async function handleOperationList({ journal, principal }) {
  const open = journal.openOperations(principal.deviceId);
  return {
    status: 200,
    body: withEnvelope(open, {
      principal,
      extra: {
        open: open.length,
        limit: journal.limits.maxOpenOperations,
        // At the cap, mutations are already being refused; the client shows
        // recovery rather than a normal composer.
        atLimit: open.length >= journal.limits.maxOpenOperations,
      },
    }),
  };
}

// ── POST /m1/operations/:operationId/abandon ─────────────────────────────────
//
// MD-19 §4.3: the cap is released by resolution or by a deliberate act, never
// by evicting the oldest record.  Abandoning is that deliberate act, and it has
// a stated price — the server-side effect stays unresolved and is no longer
// traceable.  The response says so explicitly rather than reporting a clean
// success.

export async function handleOperationAbandon({ journal, principal, params }) {
  const record = journal.lookup(principal.deviceId, params.operationId);
  if (!record.known) return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'operation' });

  // A resolved record is not occupying the cap and must not be rewritten:
  // discarding a known outcome would destroy the answer, not a hanging attempt.
  if (record.state === 'CONFIRMED' || record.state === 'REJECTED') {
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'already_resolved',
      state: record.state,
    });
  }

  const abandoned = journal.discardOpen(principal.deviceId, params.operationId);
  if (!abandoned) {
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, { reason: 'not_open' });
  }

  const open = journal.openOperations(principal.deviceId);
  return {
    status: 200,
    body: withEnvelope({
      operationId: params.operationId,
      abandoned: true,
      // Said plainly: this closed the record, not the operation.
      effectStillUnknown: record.state === 'UNKNOWN',
      open: open.length,
      limit: journal.limits.maxOpenOperations,
    }, { principal }),
  };
}

// ── POST /m1/pair/claim ──────────────────────────────────────────────────────

export async function handlePairClaim({ rawDb, body, env }) {
  const result = claimPairingCode(rawDb, {
    code: body?.code,
    deviceName: typeof body?.deviceName === 'string' && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 64)
      : 'mobile device',
    env,
  });

  if (!result.ok) {
    return errorResponse(result.error, result.reason ? { reason: result.reason } : {});
  }

  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      data: {
        // Returned exactly once.  There is no endpoint that can read it back.
        token: result.token,
        deviceId: result.deviceId,
        scopes: result.scopes,
        expiresAt: result.expiresAt,
      },
    },
  };
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function handleNotifications({ rawDb, principal, query }) {
  const afterSeq = Number.parseInt(query.get('afterSeq') || '0', 10) || 0;
  const limit = clampLimit(query.get('limit'), 50);

  const rows = listMobileNotifications(rawDb, { deviceId: principal.deviceId, afterSeq, limit });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    status: 200,
    body: withEnvelope(items, {
      principal,
      extra: {
        hasMore,
        end: !hasMore,
        // Sequence-based, not cursor-based: the client asks for "after N",
        // which is naturally monotonic and survives reconnects.
        nextAfterSeq: items.length ? items[items.length - 1].seq : afterSeq,
      },
    }),
  };
}

export async function handleNotificationAck({ rawDb, principal, body }) {
  const ids = Array.isArray(body?.ids) ? body.ids.filter(id => typeof id === 'string').slice(0, 200) : [];
  if (ids.length === 0) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'ids', reason: 'required' });
  // F-112: the principal's device is part of the write, not merely of the read.
  const changed = ackMobileNotifications(rawDb, ids, { deviceId: principal.deviceId });
  return { status: 200, body: withEnvelope({ acknowledged: changed }, { principal }) };
}

// ── Approvals ────────────────────────────────────────────────────────────────

export async function handleApprovals({ rawDb, principal }) {
  const rows = rawDb.prepare(`
    SELECT id, subject_type, subject_id, title, detail, payload_fingerprint,
           created_at, expires_at, decided_at, decision,
           validity, precondition_ref
      FROM mobile_approvals
     WHERE decided_at IS NULL
     ORDER BY created_at ASC
     LIMIT 100
  `).all();

  const now = Date.now();
  return approvalResponse({
    status: 200,
    body: withEnvelope(rows.map(row => versioned({
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      title: row.title,
      detail: row.detail,
      // §8.4 — the fingerprint travels with the approval so the client can
      // prove it is deciding on the payload it was shown.
      payloadFingerprint: row.payload_fingerprint,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: sqlTimeToMs(row.expires_at) < now,
      // `025`: čím je approval omezený.  `window` propadá časem, `precondition`
      // platí, dokud se nezmění cíl — a obrazovka to musí říkat jinak, protože
      // odpočet u druhého případu není informace, ale mýlka.
      validity: row.validity || 'window',
      // Cesta k cíli je `S2`, stejně jako popis; jde stejnou routou za
      // `read:approvals` a do notifikace se nikdy nedostane.
      preconditionRef: row.precondition_ref || null,
    })), { principal }),
  });
}

function attemptApprovalResolution({ journal, principal, operationId, resolve }) {
  try {
    return { resolution: resolve(), response: null };
  } catch {
    // The approval decision may already be durable even though recording its
    // operation result failed.  The only truthful recovery state is UNKNOWN,
    // using the same closed reason and read-only lookup path as chat results.
    try {
      journal.markUnknown(
        principal.deviceId,
        operationId,
        UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    } catch { /* a database that is entirely unavailable cannot record recovery */ }
    return {
      resolution: null,
      response: errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      }),
    };
  }
}

export async function handleApprovalDecide(args) {
  return approvalResponse(await decideApproval(args));
}

/**
 * Terminální trojice — **co**, **kdy** a **kdo** (M1-c).
 *
 * Konfliktní větve dřív vracely buď jen `decision`, nebo vůbec nic, takže druhé
 * zařízení nemělo z čeho postavit `SS-09` („rozhodnuto jinde") — a muselo by si
 * pravdu dojít do databáze, kterou nevidí.  Dokument `MULTI-DEVICE.md` přitom
 * slibuje „co, kdy a kdo"; tohle je ta trojice, aby ten slib platil.
 *
 * `state` je vedle `decision` schválně: `invalidated` a `cancelled` nejsou
 * lidské zamítnutí a klient je musí umět rozlišit (`decisionState`).
 */
function terminalTuple(row) {
  if (!row || !row.decided_at) return null;
  return {
    decision: row.decision,
    state: decisionState(row.decision),
    decidedAt: row.decided_at,
    decidedBy: row.decided_by || null,
    ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
  };
}

async function decideApproval({ rawDb, journal, principal, params, body }) {
  const decision = body?.decision;
  const operationId = body?.operationId;
  const payloadFingerprint = body?.payloadFingerprint;

  if (decision !== 'approve' && decision !== 'reject') {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'decision', reason: 'must_be_approve_or_reject' });
  }
  // `operationId` je mobilní specifikum (`MD-19`), ne pravidlo approvalu —
  // proto se kontroluje tady a ne ve sdílené autoritě.
  if (!operationId) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'operationId', reason: 'required' });

  const row = rawDb.prepare(`
    SELECT id, payload_fingerprint, expires_at, decided_at, decision, decided_by,
           decision_reason, origin, run_id, operation_ref
      FROM mobile_approvals WHERE id = ?
  `).get(params.id);

  // Pravidla vyhodnocuje **jedna sdílená funkce** pro obě plochy (nález 5
  // z review).  Dvě sady pravidel nad jednou tabulkou znamenají, že jedna z nich
  // je mírnější — a přes tu se to obejde.  Doručení zůstává mobilní: `MD-19`
  // žurnál a obrazovky `SS-09`/`MS-14` jsou vlastnost téhle plochy, ne pravidla.
  const verdict = evaluateApprovalDecision(row, { decision, payloadFingerprint });

  if (verdict.verdict === 'refused') {
    switch (verdict.reason) {
      case 'fingerprint_required':
        return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'payloadFingerprint', reason: 'required' });
      case 'not_found':
        return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'approval' });
      case 'unbound_approval':
        // Odmítnuto **dřív, než se zabere operační klíč**, takže odmítnutí
        // zařízení nic nestojí a nezůstane po něm pokus k rozřešení.  Frontu to
        // neschovává — skrytý čekající požadavek by udělal z „nic nečeká"
        // nepravdu (`SS-02`).
        return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
          reason: 'unbound_approval',
          approvalId: params.id,
        });
      default:
        break;  // expirace a otisk se řeší až po zabrání klíče, viz níže
    }
  }

  // §8.5 — the operation key makes the *decision* idempotent, but it does not
  // make the grant reusable.  Both checks run, and the single-use check is the
  // one that cannot be satisfied by presenting a valid key.
  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'approval.decide',
    request: { approvalId: params.id, decision, payloadFingerprint },
  });

  if (claim.outcome === 'conflict') {
    return errorResponse(MOBILE_ERRORS.OPERATION_CONFLICT, { reason: claim.reason, operationId });
  }
  if (claim.outcome === 'limited') {
    return errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    );
  }
  if (claim.outcome === 'replay') {
    return approvalOperationResponse({
      approvalId: params.id, operationId, record: claim.record, principal, replayed: true,
    });
  }

  // §8.4 — the grant binds to the payload the user saw.  If the payload moved
  // underneath them, the approval no longer means what they agreed to.  The
  // fingerprint is required above, so this comparison can no longer be skipped
  // by simply not sending one.
  if (payloadFingerprint !== row.payload_fingerprint) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'approval_superseded'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.APPROVAL_SUPERSEDED, {
      expected: row.payload_fingerprint,
      operationId,
    });
  }
  if (row.decided_at) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'state_conflict'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'already_decided',
      ...terminalTuple(row),
      operationId,
    });
  }
  if (sqlTimeToMs(row.expires_at) < Date.now()) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'approval_expired'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.APPROVAL_EXPIRED, { operationId });
  }

  // Conditional UPDATE: `decided_at IS NULL` is the single-use precondition,
  // decided atomically rather than by the read above.
  const info = rawDb.prepare(`
    UPDATE mobile_approvals
       SET decided_at = CURRENT_TIMESTAMP, decision = ?, decided_by = ?, decision_operation = ?
     WHERE id = ? AND decided_at IS NULL
  `).run(decision, principal.deviceId, operationId, params.id);

  if (info.changes === 0) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'state_conflict'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    // Přečíst znovu: mezi kontrolou a zápisem odpověděl někdo jiný a jeho
    // odpověď je ta platná.  Bez tohohle čtení by druhé zařízení dostalo holé
    // „prohráls závod" a nevědělo **co** vlastně platí.
    const decided = rawDb.prepare(`
      SELECT decided_at, decision, decided_by, decision_reason
        FROM mobile_approvals WHERE id = ?
    `).get(params.id);
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'race_lost',
      ...(terminalTuple(decided) || {}),
      operationId,
    });
  }

  const result = { approvalId: params.id, decision };
  const attempt = attemptApprovalResolution({
    journal, principal, operationId,
    resolve: () => journal.confirm(principal.deviceId, operationId, result),
  });
  if (attempt.response) return attempt.response;
  const { resolution } = attempt;
  if (!resolution.resolved) {
    return approvalResolutionResponse(resolution, params.id, operationId, principal);
  }
  return { status: 200, body: withEnvelope({ ...result, state: 'CONFIRMED' }, { principal }) };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function chatOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function chatResolutionResponse(resolution, operationId, principal) {
  const current = resolution?.current;
  if (!current?.known) return missingOperationResponse(operationId);
  return chatOperationResponse({ operationId, record: current, principal });
}

function portChatResult(result) {
  if (result.ok) return { ok: true, data: result.data };
  const details = result.error?.details || {};
  return {
    ok: false,
    code: result.error?.code || 'upstream_unavailable',
    decided: details.decided === true,
    ...(Number.isInteger(details.status) ? { status: details.status } : {}),
  };
}

function approvalOperationResponse({ approvalId, operationId, record, principal, replayed = false }) {
  return {
    status: 200,
    body: withEnvelope(
      { approvalId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function approvalResolutionResponse(resolution, approvalId, operationId, principal) {
  const current = resolution?.current;
  if (!current?.known) return missingOperationResponse(operationId);
  return approvalOperationResponse({
    approvalId, operationId, record: current, principal,
  });
}

function missingOperationResponse(operationId) {
  return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
    operationId,
  });
}

function errorResponse(descriptor, details = {}) {
  const payload = mobileError(descriptor, details);
  return { status: payload.status, body: { ok: false, error: payload.error } };
}

function approvalResponse(result) {
  return { ...result, headers: APPROVAL_RESPONSE_HEADERS };
}

function clampLimit(raw, fallback = DEFAULT_PAGE_SIZE) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function safeParse(json) {
  try { return json ? JSON.parse(json) : null; } catch { return null; }
}

function sqlTimeToMs(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? 0 : ms;
}

function ensureConversationRow(rawDb, conversationId) {
  rawDb.prepare(`
    INSERT INTO conversations (id, title, state) VALUES (?, NULL, 'active')
    ON CONFLICT(id) DO NOTHING
  `).run(conversationId);
}

export const MOBILE_HANDLERS = Object.freeze({
  'GET /m1/health': handleHealth,
  'POST /m1/pair/claim': handlePairClaim,
  'GET /m1/capabilities': handleCapabilities,
  'GET /m1/conversations': handleConversations,
  'GET /m1/conversations/:id': handleConversationDetail,
  'POST /m1/chat': handleChat,
  'GET /m1/operations': handleOperationList,
  'GET /m1/operations/:operationId': handleOperationLookup,
  'POST /m1/operations/:operationId/abandon': handleOperationAbandon,
  'GET /m1/notifications': handleNotifications,
  'POST /m1/notifications/ack': handleNotificationAck,
  'GET /m1/approvals': handleApprovals,
  'POST /m1/approvals/:id/decide': handleApprovalDecide,
});

export default MOBILE_HANDLERS;

// Companion producer — the half of `F-100` that was still missing, and the
// `DR-013 A` S1-safe mirror that made the inbox reachable-but-empty.
// ==============================================================================
//
// Three findings had the same shape and the same consequence:
//
//   * `F-100` — `createMobileApproval()` exists and is correct, and **nothing
//     called it**.  The approval queue could only ever be empty.
//   * `F-111`/`DR-013 A` — `MobileChannel` is registered and fail-closed, and
//     **nothing holds the capability**.  The inbox could only ever be empty.
//   * run progress — decided, never built.  The overview could only ever be
//     quiet.
//
// An empty screen is indistinguishable from a calm one.  That is the vice, not
// the missing feature: a phone that shows "nic nečeká" when something *is*
// waiting is worse than a phone that shows nothing at all, because the first
// one is trusted.  This module is the producer side, so that "nic nečeká" is
// an observation rather than a default.
//
// ── What this module guarantees ────────────────────────────────────────────
//
//   1. **An approval is minted only through the authority.**  Every mint goes
//      through `createMobileApproval`, so `DR-011`'s window, the computed
//      fingerprint and the mandatory run/operation binding are properties of
//      every row this producer writes.  There is no path here that inserts.
//
//   2. **The mirror carries a pointer, never the content.**  `MD-08` says a
//      mobile notification is **S1** and must not carry the text of a message
//      or a diff; `MD-11`/`MD-18` say the approval's own description is **S2**
//      and belongs behind `read:approvals`.  So the notification text comes
//      from `S1_VOCABULARY` — a closed table in this file — and the caller's
//      strings can reach it through no parameter at all.  `data` carries
//      identifiers only.  S1-safety is therefore not a rule a caller has to
//      remember; it is a shape the caller cannot express.
//
//   3. **A decision is durable, so it crosses processes.**  The gateway runs as
//      its own process against the same SQLite file as the core.  A producer
//      that waited on an in-memory promise (the way the IDE's `edit_request`
//      does) could not be answered from a phone at all — the answer arrives in
//      a different process.  `awaitDecision()` therefore observes the row, not
//      a callback, and the row is the same one the phone decided on.
//
//   4. **Silence is reported as silence.**  `awaitDecision()` resolves with
//      `timeout` or `expired` rather than throwing or defaulting.  Nothing here
//      ever turns "the phone never answered" into "approved".
//
// ── What it is not ─────────────────────────────────────────────────────────
//
// It is not a route, a table or a contract change.  It writes rows the frozen
// 13-route surface already serves (`GET /m1/approvals`, `POST
// /m1/approvals/:id/decide`, `GET /m1/notifications`).  A prototype that also
// moved the contract would prove nothing about either.
//
// ==============================================================================

import {
  createMobileApproval, checkPrecondition, decisionState,
  APPROVAL_TTL_MS, APPROVAL_VALIDITY,
} from '../approvals/authority.js';
import { BOOT_ID } from '../approvals/boot-id.js';
import {
  MOBILE_PROJECTOR_CAPABILITY,
  MOBILE_NOTIFICATION_CHANNEL,
} from '../notifications/channels/mobile.js';

/**
 * The whole S1 vocabulary of the companion mirror.
 *
 * Every notification this producer can emit is one of these, verbatim.  The
 * table is what makes `DR-013 A` checkable: reviewing "does the phone leak
 * content" is reading nine strings, not auditing every call site for ever.
 *
 * Each entry deliberately says *that* something happened and *where to look* —
 * never *what* it was.  "Agent chce zapsat soubor" is S1; "Agent chce zapsat
 * src/db/migrate.js" is not, because a path is content.
 */
export const S1_VOCABULARY = Object.freeze({
  'approval.requested': {
    kind: 'approval', priority: 'high',
    title: 'Čeká rozhodnutí',
    body: 'Otevři schránku approvalů a rozhodni.',
  },
  // Původní znění bylo „Rozhodnutí propadlo / Okno vypršelo, běh pokračoval
  // bez svolení."  Obojí přestalo platit rozhodnutím `025`: approval už
  // neomezuje čas, ale **stav cíle**, a běh po propadnutí nepokračuje — nic
  // nezapíše.  Věta, která uživateli tvrdí, že se něco stalo bez jeho svolení,
  // je horší než žádná.
  'approval.expired': {
    kind: 'approval', priority: 'normal',
    title: 'Rozhodnutí už neplatí',
    body: 'Cíl se změnil. Otevři schránku approvalů.',
  },
  'run.started': {
    kind: 'run', priority: 'low',
    title: 'Běh začal',
    body: 'Průběh je vidět v přehledu.',
  },
  'run.progress': {
    kind: 'run', priority: 'low',
    title: 'Běh pokračuje',
    body: 'Průběh je vidět v přehledu.',
  },
  'run.blocked': {
    kind: 'run', priority: 'high',
    title: 'Běh čeká na tebe',
    body: 'Bez rozhodnutí nepokračuje.',
  },
  'run.ok': {
    kind: 'run', priority: 'normal',
    title: 'Běh doběhl',
    body: 'Výsledek je v konverzaci.',
  },
  'run.failed': {
    kind: 'run', priority: 'high',
    title: 'Běh selhal',
    body: 'Podrobnosti jsou v konverzaci.',
  },
  'run.cancelled': {
    kind: 'run', priority: 'normal',
    title: 'Běh byl zrušen',
    body: 'Nic dalšího se neprovedlo.',
  },
  'run.unknown': {
    kind: 'run', priority: 'high',
    title: 'Stav běhu není jistý',
    body: 'Zjisti stav v žurnálu operací.',
  },
});

export const S1_EVENTS = Object.freeze(Object.keys(S1_VOCABULARY));

/**
 * Terminal `CoreEvent` statuses → the S1 event that mirrors them.  Anything not
 * named here maps to `run.unknown`, because an unrecognised terminal state is
 * precisely the case where claiming success would be a lie.
 */
const TERMINAL_S1 = Object.freeze({
  ok: 'run.ok',
  success: 'run.ok',
  completed: 'run.ok',
  error: 'run.failed',
  failed: 'run.failed',
  failure: 'run.failed',
  cancelled: 'run.cancelled',
  canceled: 'run.cancelled',
  aborted: 'run.cancelled',
});

export class CompanionProducerError extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

/** Identifiers only.  Anything that is not a short opaque string is dropped. */
function safeRef(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 128
    ? value
    : null;
}

function sqlTimeToMs(text) {
  if (!text) return 0;
  const ms = Date.parse(`${String(text).replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * @param {Object} options
 * @param {Object} options.rawDb          better-sqlite3 handle, shared with the gateway
 * @param {Object} [options.router]       notification router; the mirror is skipped without one
 * @param {Object} [options.logger]
 * @param {Function} [options.now]        injected clock
 * @param {Function} [options.sleep]      injected wait, so tests need no real time
 */
export function createCompanionProducer({
  rawDb, router = null, logger = null, now = Date.now, sleep = null,
} = {}) {
  if (!rawDb) throw new CompanionProducerError('db_required');
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  /**
   * Emit one S1 indicator.  Never throws: a mirror that could break the run it
   * describes would be worse than a mirror that misses a beat, and the durable
   * row it points at is unaffected either way.
   *
   * The router's envelope is narrower than the channel's: it forwards
   * `messageId` but not `seq`, so the sequence a client cursors against is read
   * back from the row rather than assumed from here.
   *
   * @returns {Promise<{mirrored: boolean, reason?: string, notificationId?: string}>}
   */
  async function project(event, { deviceId = null, approvalId = null, runId = null } = {}) {
    const entry = S1_VOCABULARY[event];
    if (!entry) throw new CompanionProducerError('unknown_s1_event', { event, allowed: S1_EVENTS });
    if (!router) return { mirrored: false, reason: 'no_router' };

    try {
      const result = await router.send({
        channel: MOBILE_NOTIFICATION_CHANNEL,
        deviceId: safeRef(deviceId),
        kind: entry.kind,
        priority: entry.priority,
        title: entry.title,
        body: entry.body,
        // Pointers, not content.  The phone follows these back to the S2
        // surface, where the scope check lives; nothing readable ships here.
        data: {
          event,
          ...(safeRef(approvalId) ? { approvalId: safeRef(approvalId) } : {}),
          ...(safeRef(runId) ? { runId: safeRef(runId) } : {}),
        },
        // The one thing a JSON body cannot carry.  Holding this export is the
        // whole of the projector's authority — see `channels/mobile.js`.
        [MOBILE_PROJECTOR_CAPABILITY]: true,
      });
      if (!result?.delivered) {
        log.warn?.('CompanionProducer', `Mirror not delivered (${event}): ${result?.error || 'unknown'}`);
        return { mirrored: false, reason: result?.error || 'not_delivered' };
      }
      return { mirrored: true, notificationId: result.messageId || null };
    } catch (error) {
      log.warn?.('CompanionProducer', `Mirror failed (${event}): ${error.message}`);
      return { mirrored: false, reason: error.message };
    }
  }

  /**
   * Ask the phone for a decision.
   *
   * The approval row is minted first and the mirror second, in that order and
   * never the other way round: a notification pointing at an approval that does
   * not exist yet would send the user to an empty queue, and the queue is the
   * thing they are supposed to trust.  A failed mirror leaves a real, listable
   * approval — the phone finds it on the next pull.
   */
  async function requestApproval({
    origin, runId, operationRef, subjectType, subjectId, title,
    payload, detail = null, deviceId = null, id = undefined, precondition = null,
  } = {}) {
    const minted = createMobileApproval(rawDb, {
      origin, runId, operationRef, subjectType, subjectId, title, payload, detail,
      ...(id === undefined ? {} : { id }),
      ...(precondition ? { precondition } : {}),
      // Kdo na tuhle otázku čeká.  Bez toho by po restartu zůstala viset jako
      // `pending` a její „ano" by nemělo kdo provést.
      waiterBoot: precondition ? BOOT_ID : null,
      now: now(),
    });

    const mirror = await project('approval.requested', {
      deviceId, approvalId: minted.id, runId: minted.runId,
    });

    return { ...minted, mirrored: mirror.mirrored, mirrorReason: mirror.reason || null };
  }

  /**
   * Watch one approval until the phone answers, the window closes, or the
   * caller's own deadline passes.
   *
   * Polling, not a callback, because the answer is written by a different
   * process (`§3` above).  The interval is a floor on latency, not on
   * correctness: whatever the phone wrote is in the row when we look.
   *
   * @returns {Promise<{state:'approve'|'reject'|'expired'|'timeout'|'missing', ...}>}
   */
  async function awaitDecision(approvalId, {
    timeoutMs = null, pollMs = 500, signal = null, readTarget = null,
  } = {}) {
    const row0 = readApproval(approvalId);
    if (!row0) return { state: 'missing', approvalId };

    const boundToTarget = row0.validity === APPROVAL_VALIDITY.PRECONDITION;
    const windowEnd = sqlTimeToMs(row0.expires_at);

    // U `window` approvalu je `expires_at` pravidlo; u `precondition` je to
    // strop proti zapomenutému řádku (`025`).  Čekat déle než strop nedává
    // smysl ani v jednom případě, ale u prvního je to `expired` jako výsledek,
    // u druhého je to porucha, na kterou se čeká měsíc — a proto se u něj
    // nepoužije jako běžná odpověď, jen jako mez.
    const deadline = timeoutMs === null
      ? windowEnd
      : Math.min(now() + timeoutMs, windowEnd);

    /**
     * Ověření předpokladu **čerstvým čtením cíle**.
     *
     * Čte to volající z jádra, ne gateway.  Gateway by kvůli tomu musela umět
     * číst soubory, které dnes číst neumí — a dát mobilnímu povrchu schopnost
     * číst disk kvůli kontrole je větší díra, než jakou to zavírá.  Ověřuje se
     * proto tam, kde efekt vzniká.
     */
    async function preconditionHolds(row) {
      if (!boundToTarget) return { ok: true };
      if (typeof readTarget !== 'function') {
        // Nezjistitelné není totéž co v pořádku.  Bez čtečky cíle se approval
        // vázaný na cíl neprohlásí za platný — jinak by stačilo čtečku
        // zapomenout předat a kontrola by tiše zmizela.
        return { ok: false, reason: 'precondition_unverifiable' };
      }
      let current;
      try {
        current = await readTarget(row.precondition_ref);
      } catch (error) {
        // Nepřečtený cíl **není** „cíl neexistuje" (nález 3 z review).  Dřív se
        // sem chytalo všechno a překládalo na `null`, takže `EACCES` skončil
        // jako `absent` — a approval na vytvoření souboru pak prošel nad
        // souborem, který existoval a jen se nedal přečíst.
        return { ok: false, reason: 'precondition_unverifiable', code: error?.code || null };
      }
      return checkPrecondition(row, current);
    }

    for (;;) {
      // Zrušení se ptá **jako první**, ještě před přečtením řádku.
      //
      // Dřív se `signal.aborted` kontrolovalo až za větví „už je rozhodnuto",
      // takže když člověk odpověděl „ano" v téže chvíli, kdy volající přestal
      // čekat, vrátilo se `approve` — a zápis proběhl po zrušení.  `run.cancelled`
      // slibuje „Nic dalšího se neprovedlo"; tahle posloupnost z toho dělala lež.
      if (signal?.aborted) {
        return { state: 'cancelled', approvalId, reason: 'aborted' };
      }

      const row = readApproval(approvalId);
      if (!row) return { state: 'missing', approvalId };

      if (row.decided_at) {
        if (row.decision !== 'approve') {
          // `invalidated` a `cancelled` **nejsou** `reject`.  Splynutí by
          // tvrdilo, že to člověk zamítl — o rozhodnutí, které neudělal.
          return {
            state: decisionState(row.decision),
            approvalId,
            decidedAt: row.decided_at,
            decidedBy: row.decided_by || null,
            reason: row.decision_reason || null,
          };
        }
        // Schválení se ověřuje **znovu, teď** — mezi odpovědí a provedením
        // mohl svět stihnout cokoli.  To je celý smysl předpokladu: bez tohohle
        // kroku by „čekej libovolně dlouho" znamenalo „schvaluj naslepo".
        const fresh = await preconditionHolds(row);
        if (!fresh.ok) {
          return {
            state: 'precondition_changed',
            reason: fresh.reason,
            approvalId,
            target: row.precondition_ref,
            decidedAt: row.decided_at,
            decidedBy: row.decided_by || null,
          };
        }
        return { state: 'approve', approvalId, decidedAt: row.decided_at, decidedBy: row.decided_by || null };
      }

      const t = now();
      if (t >= windowEnd) {
        return boundToTarget
          ? { state: 'abandoned', approvalId, reason: 'pending_cap', expiresAt: row.expires_at }
          : { state: 'expired', approvalId, expiresAt: row.expires_at };
      }
      if (t >= deadline) return { state: 'timeout', approvalId, expiresAt: row.expires_at };

      // Předpoklad se kontroluje i **během čekání**: když se cíl změní dřív,
      // než člověk odpoví, nemá smysl ho nechat odpovídat na neaktuální otázku.
      if (boundToTarget) {
        const still = await preconditionHolds(row);
        if (!still.ok && still.reason === 'precondition_changed') {
          return { state: 'precondition_changed', reason: still.reason, approvalId, target: row.precondition_ref };
        }
      }

      await wait(Math.min(pollMs, Math.max(1, deadline - t)));
    }
  }

  function readApproval(approvalId) {
    return rawDb.prepare(`
      SELECT id, expires_at, decided_at, decision, decided_by, decision_reason,
             run_id, operation_ref,
             validity, precondition_kind, precondition_ref, precondition_digest
        FROM mobile_approvals WHERE id = ?
    `).get(approvalId) || null;
  }

  /**
   * Mirror one `CoreEvent` (`contracts/m1`) as an S1 run indicator.
   *
   * The connector is deliberately lossy in one direction only: many core events
   * collapse into one `run.progress`, and no core event can widen what reaches
   * the phone, because the mapping's range is `S1_VOCABULARY` and nothing else.
   * `MR-07`'s run screen stays `BLOCKED_BY_CONTRACT` — this rides the inbox the
   * frozen surface already serves rather than inventing `/m1/runs/:id/events`.
   */
  async function projectCoreEvent(event = {}, { deviceId = null } = {}) {
    const runId = safeRef(event.requestId) || safeRef(event.conversationId);
    if (event.phase === 'terminal') {
      const mapped = TERMINAL_S1[String(event.terminalStatus || '').toLowerCase()] || 'run.unknown';
      return project(mapped, { deviceId, runId });
    }
    if (event.phase !== 'progress') {
      // Neither progress nor terminal is a contract violation upstream, and the
      // honest mirror of "I do not understand this run's state" is to say so.
      return project('run.unknown', { deviceId, runId });
    }
    if (event.eventType === 'started' || event.sequence === 1) {
      return project('run.started', { deviceId, runId });
    }
    return project('run.progress', { deviceId, runId });
  }

  return {
    requestApproval,
    awaitDecision,
    projectCoreEvent,
    project,
    get ttl() { return APPROVAL_TTL_MS; },
  };
}

export default createCompanionProducer;

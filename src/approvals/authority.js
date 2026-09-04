// Approval authority — the only path that may create an approval (F-100)
// ==============================================================================
//
// **Transportně neutrální.**  Tenhle modul bydlel v `src/mobile/`, což bylo
// dvakrát nepravda: nerozhoduje o mobilu a mobil není jeho jediná plocha.
// Desktopová routa, IDE relace i `guardedWrite` sahaly do mobilního adresáře pro
// pravidla, která s mobilem nemají co dělat — a jméno adresáře pak tvrdilo, že
// telefon je autorita a ostatní jsou hosté.  Je to naopak: **autorita je jedna,
// plochy jsou adaptéry nad ní.**  Mobil, desktop a IDE se liší v transportu
// (mobil má `MD-19` žurnál operací a scope, desktop sedí u stroje), ne v tom,
// co platí.
//
// `F-100` is that an approval could exist without authority behind it: any
// writer could insert a row with any expiry and any fingerprint, and the server
// would then let a user grant it.  `R-3`/`DR-011` name the target contract —
// **local 5 minutes, remote 15 minutes, single use, no extension** — and
// `UI-DESIGN.md` §6.6 says the missing TTL authority, the missing mandatory
// fingerprint and the missing binding to run, operation and normalised content
// are all part of that one finding.
//
// This module is where those become properties of the code rather than
// conventions:
//
//   * **The window is not an argument.**  A caller states where the approval
//     came from, and the TTL follows from `DR-011`.  There is no parameter that
//     shortens or lengthens it and no function that extends one afterwards —
//     `expires_at` is written once, by this module, and never updated.  The
//     10-minute value the operator's design showed matches neither side of
//     `DR-011`, which is exactly what happens when the number lives anywhere a
//     person can type it.
//
//   * **The fingerprint is computed, never accepted.**  A producer hands over
//     the payload; the digest is taken here, over the canonical form.  A
//     supplied fingerprint is precisely how an approval ends up not bound to
//     its own content — the client would then be shown one thing and be
//     deciding about another, and every check downstream would still pass.
//
//   * **The binding is required.**  An approval names the run it belongs to and
//     the operation it authorises.  Without both, the server cannot say what a
//     grant would permit, and `decideApproval` refuses it.
//
// ── What this module is not ────────────────────────────────────────────────
//
// It is **not** a producer and **not** a route.  It mints, evaluates and closes;
// who asked and how the answer travelled is the adapter's business.  The
// producer is `src/mobile/companion-producer.js`, the desktop route is
// `src/routes/approvals.js`, the IDE surface is `src/ws-bridge/session-adapter.js`
// — three transports, one set of rules.
//
// ==============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { fingerprint } from './fingerprint.js';
import { livenessCutoff } from './process-lease.js';

/**
 * `DR-011`, as the only place these numbers exist.  Frozen so a caller cannot
 * quietly widen a window by mutating the table it reads from.
 */
export const APPROVAL_TTL_MS = Object.freeze({
  local: 5 * 60_000,
  remote: 15 * 60_000,
});

export const APPROVAL_ORIGINS = Object.freeze(Object.keys(APPROVAL_TTL_MS));

/**
 * Čím je approval omezený — rozhodnutí `025`.
 *
 *   `window`        starý `DR-011`: platí pět (lokálně) nebo patnáct minut.
 *                   Zůstává pro efekty, které si samy nesou strop.
 *   `precondition`  nový výchozí: platí, dokud se nezmění **cíl**.  Čas ho
 *                   neomezuje; omezuje ho svět.
 *
 * Rozdíl není v délce, ale v tom, na co se ptáme.  Okno se ptá „stihl jsi
 * odpovědět?", předpoklad „platí ještě to, na co jsi odpovídal?".  Druhá otázka
 * je ta, o kterou uživateli šlo.
 */
export const APPROVAL_VALIDITY = Object.freeze({
  WINDOW: 'window',
  PRECONDITION: 'precondition',
});

/**
 * Strop pro `precondition` approvaly.  **Není to okno** — je to pojistka proti
 * řádku, na který se zapomnělo: čekající „ano" bez konce je přesně to, co
 * `025` u ztraceného telefonu nechce.  Třicet dní je dost na to, aby se
 * nikoho nedotklo, a málo na to, aby to nebyla věčnost.
 */
export const PRECONDITION_CAP_MS = 30 * 24 * 60 * 60_000;

export class ApprovalAuthorityError extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

/** SQLite's `DATETIME` text form, so stored times compare as the schema expects. */
function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The digest an approval is bound to.  Canonicalisation happens inside
 * `fingerprint()`, so two payloads that differ only in key order produce the
 * same binding and a payload that differs in substance never does.
 */
export function approvalFingerprint(payload) {
  return fingerprint(payload);
}

/**
 * Otisk cíle — čím se pozná, že se svět pod approvalem změnil.
 *
 * `null` obsah znamená „cíl neexistuje" a dostane vlastní hodnotu, ne `null`
 * digest: schválit vytvoření souboru, který mezitím někdo založil, je tichý
 * přepis, a ten musí být rozeznatelný od „soubor je pořád takový, jaký byl".
 */
export function preconditionDigest(content) {
  if (content === null || content === undefined) return 'absent';
  return createHash('sha256').update(String(content)).digest('hex').slice(0, 32);
}

/**
 * Platí ještě to, na co uživatel odpovídal?
 *
 * @param {Object} row              řádek approvalu
 * @param {string|null} currentContent  jak cíl vypadá **teď**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkPrecondition(row, currentContent) {
  if (!row || row.validity !== APPROVAL_VALIDITY.PRECONDITION) return { ok: true };
  if (!row.precondition_kind) {
    // Řádek se tváří jako vázaný na cíl a žádný cíl nemá.  To není „platí" —
    // to je approval, u kterého nikdo neumí říct, co by grant povolil.
    return { ok: false, reason: 'precondition_missing' };
  }
  const now = preconditionDigest(currentContent);
  const then = row.precondition_digest || 'absent';
  return now === then ? { ok: true } : { ok: false, reason: 'precondition_changed' };
}

/**
 * Mint one approval.  The single writing path for `mobile_approvals`.
 *
 * @param {Object} rawDb
 * @param {Object} request
 * @param {'local'|'remote'} request.origin — decides the window (`DR-011`).
 *   There is no default: defaulting would silently pick a window nobody chose,
 *   and the wrong choice is the longer one.
 * @param {string} request.runId          the run this belongs to
 * @param {string} request.operationRef   the operation or effect it authorises
 * @param {string} request.subjectType
 * @param {string} request.subjectId
 * @param {string} request.title
 * @param {*}      request.payload        digested here; never supplied pre-hashed
 * @param {string} [request.detail]
 * @param {string} [request.id]
 * @param {number} [request.now]          injected clock, so a caller can mint at
 *   a stated instant; production passes nothing and gets `Date.now()`
 */
export function createMobileApproval(rawDb, {
  origin, runId, operationRef, subjectType, subjectId, title,
  payload, detail = null, id = randomUUID(), now = Date.now(),
  precondition = null, waiterBoot = null,
} = {}) {
  if (!APPROVAL_ORIGINS.includes(origin)) {
    throw new ApprovalAuthorityError('origin_required', { allowed: APPROVAL_ORIGINS });
  }
  for (const [field, value] of Object.entries({ runId, operationRef, subjectType, subjectId, title })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApprovalAuthorityError('binding_required', { field });
    }
  }
  if (payload === undefined) {
    throw new ApprovalAuthorityError('payload_required', {});
  }

  // Předpoklad se **měří**, nepřijímá — ze stejného důvodu jako otisk obsahu.
  // Kdyby ho volající mohl dodat hotový, mohl by approval navázat na stav, který
  // nikdy nenastal, a každá kontrola pod ním by pak procházela.
  let validity = APPROVAL_VALIDITY.WINDOW;
  let preconditionKind = null;
  let preconditionRef = null;
  let preconditionDigestValue = null;

  if (precondition) {
    if (precondition.kind !== 'file-digest') {
      throw new ApprovalAuthorityError('precondition_kind_unknown', { kind: precondition.kind });
    }
    if (typeof precondition.ref !== 'string' || precondition.ref.trim() === '') {
      throw new ApprovalAuthorityError('precondition_ref_required', {});
    }
    if (!('content' in precondition)) {
      // Chybějící `content` a `content: null` jsou dvě různé věci: druhé
      // znamená „cíl neexistuje", první znamená „nikdo se nedíval".
      throw new ApprovalAuthorityError('precondition_content_required', {});
    }
    validity = APPROVAL_VALIDITY.PRECONDITION;
    preconditionKind = precondition.kind;
    preconditionRef = precondition.ref;
    preconditionDigestValue = preconditionDigest(precondition.content);
  }

  const expiresAt = validity === APPROVAL_VALIDITY.PRECONDITION
    ? now + PRECONDITION_CAP_MS
    : now + APPROVAL_TTL_MS[origin];

  rawDb.prepare(`
    INSERT INTO mobile_approvals
      (id, subject_type, subject_id, title, detail, payload_fingerprint,
       created_at, expires_at, origin, run_id, operation_ref,
       validity, precondition_kind, precondition_ref, precondition_digest,
       waiter_boot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, subjectType, subjectId, title, detail,
    approvalFingerprint(payload),
    sqlTime(now), sqlTime(expiresAt),
    origin, runId, operationRef,
    validity, preconditionKind, preconditionRef, preconditionDigestValue,
    waiterBoot,
  );

  return {
    id, origin, runId, operationRef, expiresAt, validity,
    ttlMs: expiresAt - now,
    // `null` u předpokladu znamená „tenhle approval na cíl vázaný není",
    // ne „cíl neexistoval" — to je `'absent'`.
    preconditionDigest: preconditionDigestValue,
  };
}

/**
 * Is this row bound to something the server can name?  Used by the decide path,
 * which is where the answer has to be yes before anything is granted.
 */
/**
 * Konce, které approval může mít bez toho, aby na něj někdo odpověděl.
 *
 * `approve` a `reject` jsou odpovědi člověka.  Tohle jsou konce, které nastanou
 * samy — a musí být **trvalé**, jinak otázka dál visí ve frontě jako čekající
 * (nález 4 z review: „ghost approval").
 */
export const APPROVAL_TERMINAL = Object.freeze({
  INVALIDATED: 'invalidated',  // svět se změnil pod otázkou
  CANCELLED: 'cancelled',      // otázku stáhl ten, kdo se ptal
});

/**
 * Jak dopadl approval, který **už rozhodnutý je** — jedním jménem, ne dvěma.
 *
 * Dřív se všechno, co není `approve`, hlásilo volajícímu jako `reject`.  Bylo
 * to pohodlné a nepravdivé: „člověk to zamítl" a „otázka propadla, protože se
 * změnil cíl" a „běh přestal čekat" jsou tři různé věci a uživatel se podle
 * nich chová různě.  Splynutí do `reject` navíc obviňuje člověka z rozhodnutí,
 * které neudělal.
 */
export function decisionState(decision) {
  switch (decision) {
    case 'approve': return 'approve';
    case 'reject': return 'reject';
    case APPROVAL_TERMINAL.INVALIDATED: return 'invalidated';
    case APPROVAL_TERMINAL.CANCELLED: return 'cancelled';
    // Neznámá hodnota **není** zamítnutí.  Pojmenovat ji jako `reject` by
    // znamenalo tvrdit o člověku něco, co o něm nevíme.
    default: return 'unknown_decision';
  }
}

/**
 * Přežil tenhle approval restart procesu, který na něj čekal?
 *
 * Řádek restart přežije — je v databázi.  **Čekající běh ne.**  Approval vázaný
 * na cíl (`precondition`) vznikl proto, že nějaký běh stál a čekal na odpověď,
 * aby provedl efekt; po restartu ten běh neexistuje a jeho „ano" už nemá kdo
 * vykonat.  Nechat takový řádek dál viset jako `pending` znamená nabízet
 * rozhodnutí, po kterém se nic nestane — přesně ten „ghost approval", kvůli
 * kterému vznikl nález 4, jen o restart později.
 *
 * Proto se při startu uzavřou jako `cancelled`/`waiter_gone`.  Otázka tím
 * nezmizí: zůstává v databázi s pravdivým koncem, telefon ji uvidí jako
 * rozhodnutou jinde (`SS-09`) místo aby čekal na odpověď, která nic neudělá.
 * A `run.cancelled` — „Nic dalšího se neprovedlo" — je tím pádem pravda i přes
 * restart.
 *
 * `waiter_boot` je identita **procesu**, ne běhu: dva běhy v jednom procesu
 * sdílejí osud, dva procesy nad jednou databází se navzájem neuklízejí.
 *
 * @returns {{closed: number, bootId: string}}
 */
export function reapApprovalsFromPreviousBoot(rawDb, {
  bootId, now = Date.now(), ttlMs = undefined,
} = {}) {
  if (!bootId) throw new ApprovalAuthorityError('boot_id_required', {});
  // **„Cizí" není totéž co „mrtvý"** (M1-b).  Dřív se uzavřelo všechno s jiným
  // `waiter_boot`, takže druhý backend rušil **živé** otázky prvního.  Rozhoduje
  // teď tep procesu, který čeká — ne to, že je jiný než my.
  const cutoff = livenessCutoff({ now, ...(ttlMs === undefined ? {} : { ttlMs }) });
  const closed = rawDb.prepare(`
    UPDATE mobile_approvals
       SET decided_at = datetime('now'), decision = ?, decided_by = 'system',
           decision_reason = 'waiter_gone'
     WHERE decided_at IS NULL
       AND validity = ?
       AND waiter_boot IS NOT NULL
       AND waiter_boot <> ?
       AND waiter_boot NOT IN (SELECT boot_id FROM process_leases WHERE last_seen > ?)
  `).run(APPROVAL_TERMINAL.CANCELLED, APPROVAL_VALIDITY.PRECONDITION, bootId, cutoff).changes;
  return { closed, bootId };
}

/**
 * Uzavři approval bez odpovědi člověka.
 *
 * Idempotentní a **nikdy nepřepíše skutečnou odpověď**: `WHERE decided_at IS
 * NULL` znamená, že rozhodnutí, které mezitím přišlo z telefonu nebo z IDE,
 * zůstává. Ukončit otázku smí jen ten, kdo ji položil, a jen dokud nikdo
 * neodpověděl.
 */
export function closeApprovalWithoutAnswer(rawDb, approvalId, {
  outcome = APPROVAL_TERMINAL.INVALIDATED, reason = null, by = 'system',
} = {}) {
  if (!approvalId) return false;
  return rawDb.prepare(`
    UPDATE mobile_approvals
       SET decided_at = datetime('now'), decision = ?, decided_by = ?, decision_reason = ?
     WHERE id = ? AND decided_at IS NULL
  `).run(outcome, by, reason, approvalId).changes > 0;
}

/**
 * **Jediné místo, kde se approval rozhoduje** — nález 5 z review.
 *
 * Do téhle chvíle měl mobil svoje pravidla v `handlers.js` a desktop svoje
 * v `routes/approvals.js`.  Nebyla to duplicita na papíře: chovaly se
 * **asymetricky**, protože každá strana si pořadí kontrol poskládala jinak.
 * Dvě autority nad jednou tabulkou znamenají, že jedna z nich je mírnější — a
 * přes tu se to obejde.
 *
 * Transport zůstává každé ploše vlastní (mobil má `MD-19` žurnál operací,
 * desktop ne); společné je **co platí**, ne jak se to posílá.
 *
 * @returns {{outcome: 'decided'|'replay'|'refused', ...}}
 */
export function evaluateApprovalDecision(row, {
  decision, payloadFingerprint, now = Date.now(),
} = {}) {
  if (decision !== 'approve' && decision !== 'reject') {
    return { verdict: 'refused', reason: 'decision_invalid' };
  }
  // `F-100`: volitelná kontrola není kontrola.  Plocha, která ji odpustí, je ta,
  // přes kterou se to obejde.
  if (typeof payloadFingerprint !== 'string' || payloadFingerprint === '') {
    return { verdict: 'refused', reason: 'fingerprint_required' };
  }
  if (!row) return { verdict: 'refused', reason: 'not_found' };

  // Už rozhodnuto: **první odpověď vítězí** a druhá plocha se dozví, jak to
  // dopadlo — ať se ptá v jakémkoli pořadí.  Jak to která plocha doručí, je
  // její věc (mobil má na to obrazovku `SS-09`); *co platí*, je tady.
  if (row.decided_at) {
    return {
      verdict: 'already_decided',
      decision: row.decision,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
    };
  }
  if (!approvalIsBound(row)) return { verdict: 'refused', reason: 'unbound_approval' };
  if (sqlTimeToMs(row.expires_at) < now) return { verdict: 'refused', reason: 'approval_expired' };
  if (row.payload_fingerprint !== payloadFingerprint) {
    return { verdict: 'refused', reason: 'approval_superseded' };
  }
  return { verdict: 'grantable' };
}

/**
 * Vyhodnocení **a zápis** v jednom — pro plochy, které nemají vlastní žurnál
 * operací (desktop).  Mobil používá `evaluateApprovalDecision` a zapisuje sám,
 * protože kolem zápisu má `MD-19` a ten do sdílené funkce nepatří.
 */
export function resolveApprovalDecision(rawDb, {
  approvalId, decision, payloadFingerprint, decidedBy, now = Date.now(),
} = {}) {
  const row = rawDb.prepare(`
    SELECT id, payload_fingerprint, expires_at, decided_at, decision, decided_by,
           origin, run_id, operation_ref
      FROM mobile_approvals WHERE id = ?
  `).get(approvalId);

  const evaluated = evaluateApprovalDecision(row, { decision, payloadFingerprint, now });
  if (evaluated.verdict === 'refused') return { outcome: 'refused', reason: evaluated.reason };
  if (evaluated.verdict === 'already_decided') {
    return {
      outcome: 'replay',
      decision: evaluated.decision,
      decidedAt: evaluated.decidedAt,
      decidedBy: evaluated.decidedBy,
    };
  }

  const changed = rawDb.prepare(`
    UPDATE mobile_approvals
       SET decided_at = datetime('now'), decision = ?, decided_by = ?
     WHERE id = ? AND decided_at IS NULL
  `).run(decision, decidedBy, approvalId).changes;

  if (changed === 0) {
    // Závod prohraný mezi kontrolou a zápisem: odpověděl někdo jiný.  Vrací se
    // jeho odpověď, ne chyba — je to týž případ jako replay, jen o milisekundu.
    const decided = rawDb.prepare(
      'SELECT decision, decided_at, decided_by FROM mobile_approvals WHERE id = ?').get(approvalId);
    return {
      outcome: 'replay',
      decision: decided?.decision,
      decidedAt: decided?.decided_at,
      decidedBy: decided?.decided_by,
    };
  }

  return { outcome: 'decided', decision, decidedBy };
}

function sqlTimeToMs(text) {
  if (!text) return 0;
  const ms = Date.parse(`${String(text).replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function approvalIsBound(row) {
  return Boolean(row
    && typeof row.origin === 'string' && APPROVAL_ORIGINS.includes(row.origin)
    && typeof row.run_id === 'string' && row.run_id.trim() !== ''
    && typeof row.operation_ref === 'string' && row.operation_ref.trim() !== '');
}

export default {
  createMobileApproval, approvalIsBound, approvalFingerprint,
  preconditionDigest, checkPrecondition, decisionState,
  resolveApprovalDecision, evaluateApprovalDecision, closeApprovalWithoutAnswer,
  reapApprovalsFromPreviousBoot,
  APPROVAL_TTL_MS, APPROVAL_ORIGINS, APPROVAL_VALIDITY, APPROVAL_TERMINAL,
  PRECONDITION_CAP_MS,
};

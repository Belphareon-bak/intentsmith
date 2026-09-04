// Rozhodovací plocha na desktopu — P0-6, zadání operátora
// ==============================================================================
//
// > „telefon nesmí být jedinou možností k approvalům… bez spárovaného telefonu
// > neexistuje jakákoli remote možnost, rozhoduje IDE z PC"
// >   — operátor, 2026-08-18
//
// Do téhle chvíle platil opak: `mobile_approvals` uměla obsloužit jen mobilní
// cesta, takže když se běh zeptal, byl telefon **jediná** odpověď.  Kdo ho
// neměl po ruce, neměl jak.
//
// Tenhle modul to napravuje a je schválně **tenký**: nedělá vlastní pravidla,
// používá tatáž, jako mobil.  Kdyby měl vlastní, vznikly by dvě autority nad
// jednou tabulkou a jedna z nich by dřív nebo později byla mírnější.
//
//   * otisk obsahu je povinný stejně jako na mobilu (`F-100`, §8.4);
//   * vazba na běh a operaci se vyžaduje stejně (`approvalIsBound`);
//   * rozhodnutí je idempotentní stejně — druhé „ano" nic nepřepíše.
//
// ── Proč tu není nová tabulka ani nový stav ────────────────────────────────
//
// Approval je jeden objekt v BE a plochy jsou dvě.  „Rozhodnuto z desktopu" se
// proto zapisuje do týchž sloupců jako rozhodnutí z telefonu, jen `decided_by`
// říká `desktop`.  Telefon to uvidí při nejbližším pullu jako `SS-09`
// („rozhodnuto jinde"), což je obrazovka, která už existuje — a je to přesně
// ten případ, pro který vznikla.
//
// ==============================================================================

import { approvalIsBound, resolveApprovalDecision } from '../approvals/authority.js';

/** Desktop je jedna identita a nemusí se párovat — sedí u toho stroje. */
const DESKTOP_PRINCIPAL = 'desktop';

/**
 * Approval je `S2` a nese cestu i popis.  Mobilní routy mají `no-store`
 * explicitně (`handlers.js`); desktopová plocha ho neměla, takže by ta samá
 * data mohl podržet proxy nebo cache prohlížeče (nález 8 z review).  Hranice
 * transportu má být na obou plochách stejná — jinak je slabší ta, na kterou se
 * zapomnělo.
 */
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

function sqlTimeToMs(text) {
  if (!text) return 0;
  const ms = Date.parse(`${String(text).replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Odmítnutí ze sdílené autority → HTTP, na jednom místě. */
const REFUSAL_STATUS = Object.freeze({
  decision_invalid: 400,
  fingerprint_required: 400,
  not_found: 404,
  unbound_approval: 409,
  approval_expired: 409,
  approval_superseded: 409,
});

const REFUSAL_MESSAGE = Object.freeze({
  decision_invalid: 'decision must be approve or reject',
  fingerprint_required: 'payloadFingerprint is required',
  not_found: 'approval not found',
  unbound_approval: 'approval is not bound to a run and operation',
  approval_expired: 'approval expired',
  approval_superseded: 'payload changed since it was shown',
});

function applyNoStore(res) {
  // `res.setHeader` nemusí existovat v testovacím dvojníkovi; hlavička je
  // vlastnost transportu, ne rozhodnutí, takže její absence nesmí nic shodit.
  if (typeof res?.setHeader === 'function') {
    for (const [name, value] of Object.entries(NO_STORE)) res.setHeader(name, value);
  }
}

export function createApprovalRoutes({ db, sendJSON, parseBody, sendStaticFile }) {
  const rawDb = db?.db || db;

  return {
    // ── Plocha ────────────────────────────────────────────────────────────
    //
    // Routy pod tím existovaly, rozhraní ne — z desktopu se rozhodovalo
    // `curl`em.  Plocha bez rozhraní je plocha jen na papíře: „telefon nesmí
    // být jedinou možností" neplatí, když ta druhá možnost vyžaduje, aby si
    // člověk pamatoval tvar JSONu a otisk opsal z jiné odpovědi.
    'GET /approvals-ui': async (req, res) => {
      await sendStaticFile(res, 'src/approvals/approvals.html', 'text/html');
    },

    // ── Fronta ────────────────────────────────────────────────────────────
    //
    // Stejná množina jako na telefonu — nerozhodnuté, seřazené od nejstaršího.
    // Desktop dostane navíc `preconditionRef`: sedí u toho stroje, takže cesta
    // k souboru pro něj není únik, ale ta nejužitečnější věta na obrazovce.
    'GET /api/approvals': (req, res) => {
      try {
        const now = Date.now();
        const rows = rawDb.prepare(`
          SELECT id, subject_type, subject_id, title, detail, payload_fingerprint,
                 created_at, expires_at, origin, run_id, operation_ref,
                 validity, precondition_ref
            FROM mobile_approvals
           WHERE decided_at IS NULL
           ORDER BY created_at ASC
           LIMIT 200
        `).all();

        applyNoStore(res);
        sendJSON(res, 200, {
          approvals: rows.map(row => ({
            id: row.id,
            title: row.title,
            detail: row.detail,
            subjectType: row.subject_type,
            subjectId: row.subject_id,
            runId: row.run_id,
            operationRef: row.operation_ref,
            payloadFingerprint: row.payload_fingerprint,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            expired: sqlTimeToMs(row.expires_at) < now,
            validity: row.validity || 'window',
            preconditionRef: row.precondition_ref || null,
            // Nerozhodnutelný řádek se **neschovává** (`SS-02`): fronta, která
            // zamlčí čekající požadavek, dělá z „nic nečeká" nepravdu.  Říká
            // se rovnou, že rozhodnout nejde a proč.
            decidable: approvalIsBound(row),
          })),
        });
      } catch (error) {
        applyNoStore(res);
        sendJSON(res, 500, { error: `Approval queue unavailable: ${error.message}` });
      }
    },

    // ── Rozhodnutí ────────────────────────────────────────────────────────
    'POST /api/approvals/:id/decide': async (req, res, params) => {
      applyNoStore(res);
      try {
        const body = await parseBody(req);
        const result = resolveApprovalDecision(rawDb, {
          approvalId: params.id,
          decision: body?.decision,
          payloadFingerprint: body?.payloadFingerprint,
          decidedBy: DESKTOP_PRINCIPAL,
        });

        switch (result.outcome) {
          case 'decided':
            return sendJSON(res, 200, {
              id: params.id, decision: result.decision, decidedBy: result.decidedBy,
            });
          case 'replay':
            // První odpověď vítězí — a druhá plocha dostane **tu první**, ať se
            // ptá v jakémkoli pořadí.  Symetrie s mobilem je celý smysl
            // sdílené autority (nález 5).
            return sendJSON(res, 200, {
              id: params.id, decision: result.decision,
              decidedAt: result.decidedAt, decidedBy: result.decidedBy, replay: true,
            });
          default:
            return sendJSON(res, REFUSAL_STATUS[result.reason] || 409, {
              error: REFUSAL_MESSAGE[result.reason] || result.reason,
              reason: result.reason,
            });
        }
      } catch (error) {
        sendJSON(res, 500, { error: `Decide failed: ${error.message}` });
      }
    },
  };
}

export default createApprovalRoutes;

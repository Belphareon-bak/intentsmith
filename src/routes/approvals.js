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

import { approvalIsBound } from '../mobile/approval-authority.js';

/** Desktop je jedna identita a nemusí se párovat — sedí u toho stroje. */
const DESKTOP_PRINCIPAL = 'desktop';

function sqlTimeToMs(text) {
  if (!text) return 0;
  const ms = Date.parse(`${String(text).replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function createApprovalRoutes({ db, sendJSON, parseBody }) {
  const rawDb = db?.db || db;

  return {
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
        sendJSON(res, 500, { error: `Approval queue unavailable: ${error.message}` });
      }
    },

    // ── Rozhodnutí ────────────────────────────────────────────────────────
    'POST /api/approvals/:id/decide': async (req, res, params) => {
      try {
        const body = await parseBody(req);
        const { decision, payloadFingerprint } = body || {};

        if (decision !== 'approve' && decision !== 'reject') {
          return sendJSON(res, 400, { error: 'decision must be approve or reject' });
        }
        // Otisk je povinný i tady.  `F-100`: volitelná kontrola není kontrola,
        // a plocha, která ji odpustí, je ta, přes kterou se to obejde.
        if (typeof payloadFingerprint !== 'string' || payloadFingerprint === '') {
          return sendJSON(res, 400, { error: 'payloadFingerprint is required' });
        }

        const row = rawDb.prepare(`
          SELECT id, payload_fingerprint, expires_at, decided_at, decision,
                 origin, run_id, operation_ref
            FROM mobile_approvals WHERE id = ?
        `).get(params.id);

        if (!row) return sendJSON(res, 404, { error: 'approval not found' });

        // Idempotence před vším ostatním: opakované „ano" je odpověď, ne chyba,
        // a nesmí přepsat, kdo rozhodl první.
        if (row.decided_at) {
          return sendJSON(res, 200, {
            id: row.id, decision: row.decision, decidedAt: row.decided_at, replay: true,
          });
        }
        if (!approvalIsBound(row)) {
          return sendJSON(res, 409, {
            error: 'approval is not bound to a run and operation',
            reason: 'unbound_approval',
          });
        }
        if (sqlTimeToMs(row.expires_at) < Date.now()) {
          return sendJSON(res, 409, { error: 'approval expired', reason: 'approval_expired' });
        }
        if (row.payload_fingerprint !== payloadFingerprint) {
          // Obsah se změnil mezi zobrazením a rozhodnutím.  Grant by platil pro
          // něco jiného, než co člověk viděl — to je celý smysl otisku.
          return sendJSON(res, 409, {
            error: 'payload changed since it was shown',
            reason: 'approval_superseded',
          });
        }

        const changed = rawDb.prepare(`
          UPDATE mobile_approvals
             SET decided_at = datetime('now'), decision = ?, decided_by = ?
           WHERE id = ? AND decided_at IS NULL
        `).run(decision, DESKTOP_PRINCIPAL, params.id).changes;

        if (changed === 0) {
          // Mezi kontrolou a zápisem rozhodl někdo jiný — typicky telefon.
          // Vítězí první odpověď; druhá dostane tu první, ne chybu.
          const decided = rawDb.prepare(
            'SELECT decision, decided_at, decided_by FROM mobile_approvals WHERE id = ?').get(params.id);
          return sendJSON(res, 200, { id: params.id, ...decided, replay: true });
        }

        sendJSON(res, 200, { id: params.id, decision, decidedBy: DESKTOP_PRINCIPAL });
      } catch (error) {
        sendJSON(res, 500, { error: `Decide failed: ${error.message}` });
      }
    },
  };
}

export default createApprovalRoutes;

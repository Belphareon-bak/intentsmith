// Migrace 063 — approval má konec, ne jen odpověď (nález 4 z review)
// ==============================================================================
//
// `decided_at` a `decision` uměly zaznamenat, že někdo odpověděl.  Neuměly
// zaznamenat, že otázka **skončila jinak**: propadl předpoklad, běh přestal
// čekat, relace zmizela.  Řádek pak zůstal `decided_at IS NULL`, což znamená
// „čeká" — a fronta ho poctivě dál nabízela k rozhodnutí, i když efekt, kterého
// se týkal, už neměl kdo provést.  Review tomu říká „ghost approval" a je to
// přesná diagnóza: souhlas, po kterém se nic nestane.
//
//   decision_reason  proč to skončilo takhle.  Uzavřený slovník, ne prose:
//                    `precondition_changed`, `precondition_unverifiable`,
//                    `waiter_timeout`, `session_gone`, `lock_lost`,
//                    `pending_cap`.
//
// `decision` samo dostává nové hodnoty vedle `approve`/`reject`:
// `invalidated` (svět se změnil) a `cancelled` (otázku stáhl ten, kdo se ptal).
// Sloupec je `TEXT` bez omezení, takže migrace nemění tvar — mění se slovník,
// a ten drží kód a testy.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_19_063_mobile_approval_lifecycle';
export const description = 'Approval má terminální stav i bez odpovědi člověka (nález 4)';

export function up(db) {
  if (!hasTable(db, 'mobile_approvals')) return;
  if (!hasColumn(db, 'mobile_approvals', 'decision_reason')) {
    db.exec('ALTER TABLE mobile_approvals ADD COLUMN decision_reason TEXT');
  }
}

export function down(db) {
  // Sloupec zůstává: SQLite ho neumí zahodit bez přestavby tabulky.
}

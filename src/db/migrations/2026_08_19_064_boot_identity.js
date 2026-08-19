// Migrace 064 — approval i zámek vědí, který proces je drží
// ==============================================================================
//
// Řádek restart přežije; **čekající běh ne.**  Obojí, co tahle migrace přidává,
// řeší jeden problém ze dvou stran:
//
//   `mobile_approvals.waiter_boot`
//       Approval vázaný na cíl vznikl proto, že nějaký běh stál a čekal na
//       odpověď, aby provedl efekt.  Po restartu ten běh neexistuje, ale řádek
//       dál vypadá jako `pending`: fronta ho nabízí, uživatel odpoví „ano" a
//       **nic se nestane**.  Je to týž „ghost approval" jako v nálezu 4, jen o
//       restart později — a horší, protože uživatel odchází v přesvědčení, že
//       něco povolil.
//
//   `file_write_locks.boot_id`
//       Zámek expiruje po patnácti minutách, což je pojistka proti spadlému
//       běhu, ne úklid po restartu.  Po restartu není potřeba domněnka: běh,
//       který zámek držel, prokazatelně neexistuje.  Čekat na jeho expiraci
//       znamená čtvrt hodiny blokovat soubor, o kterém víme, že ho nikdo nedrží.
//
// Obojí je identita **procesu**, ne běhu: dva běhy v jednom procesu sdílejí
// osud, dva procesy nad jednou databází se navzájem uklízet nesmějí.  Prázdná
// hodnota u approvalu znamená „v procesu na tohle nikdo nečeká" a takový řádek
// se neuklízí — rozhodnutí bez efektu restart přežít má.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_19_064_boot_identity';
export const description = 'Approval i zámek vědí, který proces je drží (restart nesmí nechat ghost)';

export function up(db) {
  if (hasTable(db, 'mobile_approvals') && !hasColumn(db, 'mobile_approvals', 'waiter_boot')) {
    db.exec('ALTER TABLE mobile_approvals ADD COLUMN waiter_boot TEXT');
  }
  if (hasTable(db, 'file_write_locks') && !hasColumn(db, 'file_write_locks', 'boot_id')) {
    db.exec('ALTER TABLE file_write_locks ADD COLUMN boot_id TEXT');
  }
}

export function down(db) {
  // Sloupce zůstávají: SQLite je neumí zahodit bez přestavby tabulky.
}

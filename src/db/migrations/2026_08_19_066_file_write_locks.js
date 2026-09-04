// Migration 066 — jeden zapisovatel na soubor (rozhodnutí 027)
// ==============================================================================
//
// Dva agenti, kteří zapisují do stejného souboru ve stejné větvi, se navzájem
// přepíší a ani jeden se to nedozví.  `027` proto zavádí zámek — a tahle
// migrace je jeho úložná polovina.
//
// **Proč v databázi a ne na disku.**  Souborový zámek po pádu procesu zůstane
// ležet bez vlastníka a nikdo neví, jestli běh ještě žije.  Řádek má vlastníka,
// čas a expiraci, je vidět odjinud (i z jiného procesu, což je celý smysl) a
// přežije restart.  Je to stejná úvaha jako u approvalů: sdílená pravda patří
// tam, kam vidí všichni.
//
// **Klíč je `repozitář + větev + cesta`.**  Ne pracovní adresář: dva worktree
// nad jedním repozitářem sdílejí historii a zamykat je zvlášť by dovolilo dvě
// současné změny téhož souboru v téže větvi.  Ne celý repozitář: to by
// serializovalo práci, která si nepřekáží.
//
// **Expirace není totéž co uvolnění.**  Uvolnění je akt vlastníka; expirace je
// pojistka proti běhu, který spadl.  Obojí se zapisuje odděleně (`released_at`,
// `release_reason`), protože „vzdal se toho sám" a „umřel a nikdo to nezjistil"
// vedou k jinému chování člověka, který se na to dívá.
//
// ==============================================================================

import { hasTable } from '../migrate.js';

export const version = '2026_08_19_066_file_write_locks';
export const description = 'Jeden zapisovatel na (repozitář, větev, cesta) — rozhodnutí 027';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_write_locks (
      id             TEXT PRIMARY KEY,
      repo_id        TEXT NOT NULL,
      branch         TEXT NOT NULL,
      path           TEXT NOT NULL,
      run_id         TEXT NOT NULL,
      owner_label    TEXT,
      acquired_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at     DATETIME NOT NULL,
      released_at    DATETIME,
      release_reason TEXT
    )
  `);

  // Jediný držený zámek na klíč.  Částečný index (`WHERE released_at IS NULL`)
  // je to, co dělá pravidlo vlastností schématu, ne konvencí volajícího:
  // druhý `INSERT` na týž klíč selže v databázi, ne v `if`, který někdo
  // příště zapomene napsat.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_write_locks_held
      ON file_write_locks(repo_id, branch, path)
      WHERE released_at IS NULL
  `);

  // Dotaz "co drží tenhle běh" — potřebuje ho úklid po skončení běhu.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_write_locks_run
      ON file_write_locks(run_id, released_at)
  `);
}

export function down(db) {
  if (!hasTable(db, 'file_write_locks')) return;
  db.exec('DROP INDEX IF EXISTS idx_file_write_locks_run');
  db.exec('DROP INDEX IF EXISTS idx_file_write_locks_held');
  db.exec('DROP TABLE IF EXISTS file_write_locks');
}

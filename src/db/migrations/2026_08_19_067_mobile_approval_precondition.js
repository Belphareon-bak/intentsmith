// Migrace 067 — approval čeká na člověka, ne na hodiny (rozhodnutí 025)
// ==============================================================================
//
// `DR-011` dal approvalu okno: lokálně pět minut, vzdáleně patnáct.  Operátor
// to 2026-08-19 změnil, a měl pro to dobrý důvod: companion, který po pěti
// minutách zahodí otázku, nedoprovází.  Běh má počkat, dokud člověk neodpoví.
//
// **Časový limit se ale nedá jen sundat.**  Dokud tam byl, zakrýval, že
// approval o stavu světa nic neví: schválíš změnu `config.js`, za tři dny se
// provede, a mezitím ten soubor někdo přepsal.  Pět minut tu díru zúžilo tak,
// že se do ní málokdy někdo vešel; bez nich by byla dokořán.
//
// Proto tahle migrace přidává **předpoklad** — čím se approval váže na cíl,
// nejen na návrh:
//
//   validity            'window' (starý `DR-011`) | 'precondition' (nový výchozí)
//   precondition_kind   čím se cíl měří — dnes jediné: 'file-digest'
//   precondition_ref    co se měří (cesta)
//   precondition_digest jak to vypadalo, když approval vznikal.
//                       **NULL znamená „cíl neexistoval"** a je to plnohodnotná
//                       hodnota, ne chybějící: schválit vytvoření souboru, který
//                       mezitím někdo založil, je přesně ten tichý přepis, kvůli
//                       kterému tohle všechno je.
//
// `expires_at` zůstává `NOT NULL` a u `precondition` řádků nese **strop, ne
// pravidlo**: nekonečně žijící řádek by byl čekající „ano" bez konce a
// rozhodnutí 025 ho výslovně nechce.  Rozdíl je v tom, že strop je tam pro
// případ, kdy se na approval zapomene — kdežto okno bylo pravidlo, které se
// mělo trefit.
//
// Sloupce jsou nullable a staré řádky zůstávají `window`.  Dopsat jim
// předpoklad zpětně by znamenalo vymyslet stav světa, který nikdo neměřil.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_19_067_mobile_approval_precondition';
export const description = 'Approval se váže na stav cíle, ne na hodiny (025)';

export function up(db) {
  if (!hasTable(db, 'mobile_approvals')) return;

  for (const column of ['validity', 'precondition_kind', 'precondition_ref', 'precondition_digest']) {
    if (!hasColumn(db, 'mobile_approvals', column)) {
      db.exec(`ALTER TABLE mobile_approvals ADD COLUMN ${column} TEXT`);
    }
  }

  // Existující řádky se nepřepisují na nový režim: vznikly pod oknem a pod
  // oknem se mají dorozhodnout.  Migrace, která mění pravidla už otevřených
  // otázek, je horší než dvě pravidla vedle sebe.
  db.exec(`UPDATE mobile_approvals SET validity = 'window' WHERE validity IS NULL`);
}

export function down(db) {
  // Sloupce zůstávají: SQLite je neumí zahodit bez přestavby tabulky a
  // přestavovat tabulku s udělenými rozhodnutími kvůli čtyřem sloupcům není
  // výměna, která stojí za to.
}

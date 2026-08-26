# WP-M5-DATA — backup/restore round-trip

**Typ:** zapisující Work Package · **Stav:** `SECOND_REVIEW_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`
**Product candidate:** `816a2a4c8a95b49d46f06b94b56feb64c8a40c90`
**Remediation commit:** `c3170a12e798b41e25e675ba555ffd47b411c5ff`
**Vlastník:** M5 integrační větev; bez upstreamu a bez push

> Sekce 0–8 níže zachovávají původní plánovací kontrakt. Aktuální implementace
> už obsahuje round-trip restore, DB/WAL/SHM file-set authority a review
> remediation. Finální stav a adversariální evidence jsou v
> [`m5-second-review-remediation-closeout-20260827.md`](../execution/runs/m5-second-review-remediation-closeout-20260827.md).

---

## 0. Proč je to záložní slot, a ne položka fronty

Pravidlo jednoho worktree znamená jednoho zapisujícího vlastníka. Zařadit tenhle
WP do fronty za M1 by M1 neurychlilo — jen prodloužilo frontu.

Aktivuje se jinak: ve chvíli, kdy **M1 zaparkuje** na prerekvizitě, kterou nelze
splnit hned (volné bezpečné okno pro GPU měření, displej pro bounded soak).
V tu chvíli stojí agent a writer slot je volný. Tehdy se sáhne sem.

**Aktivační podmínka:** writer slot je volný ≥ dobu, do které se vejde bod 5
(demonstrace). Pokud ne, neaktivovat — rozdělaný restore je horší než žádný.

**Proč právě tenhle WP jako záloha:** vlastněné cesty jsou disjunktní vůči M1
(žádná se nedotýká chatu, modelu ani Studia) a nemění žádný M1 connector.

---

## 1. Uživatelský výsledek

Uživatel, kterému se poškodí databáze, obnoví stav ze zálohy a ověří, že
dostal zpět to, co měl. Dnes to nejde: `src/core/db-backup.js` umí zálohu
vytvořit, vypsat, prořezat a spočítat statistiku — slovo `restore` se v souboru
nevyskytuje ani jednou.

## 2. Povolené a zakázané cesty

**Povolené k zápisu:**
- `src/core/db-backup.js` (rozšíření o restore)
- nový modul pro restore, pokud se ukáže, že patří vedle, ne dovnitř
- `src/routes/system.js` — pouze backup/restore route
- `tests/storage-architecture.test.js` a nový focused test
- `docs/STORAGE-ARCHITECTURE.md`

**Zakázané:** `src/chat/**`, `src/llm/**`, `c3-ide/**`, `src/db/migrate.js`
a soubory migrací, `scripts/install.sh`. Migrační runner je sdílená cesta
s `WP-M5-PACKAGE`; pokud se ukáže, že restore ho musí změnit, je to eskalace
podle `§7`, ne tichý zápis.

## 3. Vlastněný connector

`POST /api/system/restore` (nový) a sémantika `POST /api/system/backup`.
Formát zálohy samotné je také connector — je to kontrakt mezi verzí, která
zálohuje, a verzí, která obnovuje. Jeho změna vyžaduje souhlas podle `§7`.

## 4. Vstupní stav — co je ověřeno (nepřeměřovat)

**Co záloha obsahuje** (hlavička `src/core/db-backup.js` a tělo funkce):

```
data/backups/c3-state-YYYY-MM-DD.backup/
  c3.db            ← WAL checkpoint(TRUNCATE) + fs.copyFileSync
  skills/*.json
  specialists/**   ← celý strom
  config/          ← c3-setup.json, design-defaults.json
  metadata.json
```

**Kdo zálohuje:** `src/server.js:192` (startup, za `backup.on_startup`),
`src/server.js:1512` (shutdown), `src/routes/system.js:715`
(`POST /api/system/backup`), `src/routes/system.js:771`
(`POST /api/system/shutdown-backup`). Výpis: `GET /api/system/backups`.

**Schema:** 47 migrací v `src/db/migrations/`, runner `runMigrations()`
v `src/db/migrate.js:78`.

### Dvě věci, které mění zadání, a musí se řešit dřív než samotný restore

**(a) Záloha se stejný den maže a přepisuje.** `db-backup.js:76-78` dělá
`fs.rmSync(backupPath, {recursive: true, force: true})` a teprve pak nový
adresář. Název je datový (`c3-state-YYYY-MM-DD.backup`). Spojeno se startup
zálohou na `server.js:192` to znamená: **uživatel s poškozenou databází, který
restartuje server, si přepíše jedinou dnešní dobrou zálohu poškozeným stavem.**
Restore, který tohle neřeší, obnovuje poškozený stav a je horší než žádný.
Tohle je první věc k rozhodnutí ve WP, ne detail k doladění.

**(b) `metadata.json` nenese verzi schématu, ale počet.** `db-backup.js` čte
`SELECT COUNT(*) as cnt FROM migrations` a ukládá to jako `schemaVersion`.
Počet neidentifikuje, **které** migrace proběhly. Kompatibilitní kontrola při
restore na tom nemůže stát; WP musí určit, co se do metadat ukládá místo toho —
a to je změna formátu zálohy, tedy connectoru z bodu 3.

## 5. Malá demonstrace

Uživatelsky viditelný round-trip, ne test existence souboru:

1. založit stav (projekt, konverzace, skill);
2. `POST /api/system/backup`;
3. poškodit `c3.db`;
4. obnovit ze zálohy;
5. ukázat, že stav z bodu 1 je zpět a server běží.

ROADMAP `§9` tenhle tvar jmenuje výslovně: *„začne skutečným
backup→poškození→restore→porovnáním round-tripem, ne dalším testem existence
backup souboru."*

## 6. Pozitivní a negativní test

**Pozitivní:** round-trip z bodu 5 s porovnáním obsahu, ne jen návratového kódu.

**Negativní** — minimálně tři, každý musí selhat čistě a srozumitelně:
- restore ze zálohy s **nekompatibilním schématem** (viz `4(b)`);
- restore z **poškozené nebo neúplné** zálohy — nesmí zničit současný stav;
- restore **za běhu serveru**, pokud se nezvolí, že to není podporované — pak
  to musí být odmítnuto, ne provedeno napůl.

## 7. Stop condition a eskalace

Zastavit a vyžádat souhlas, pokud:
- se ukáže, že restore musí sáhnout do `src/db/migrate.js` nebo do migrací;
- se změní formát zálohy tak, že starší zálohy nejdou obnovit — to je breaking
  change connectoru a potřebuje výslovné rozhodnutí o kompatibilitě;
- restore `specialists/**` narazí na otázku vlastnictví hranice z L0-8 — pak
  patří rozhodnutí do `P2`/`WP-M3-BOUNDARY`, ne sem;
- **writer slot přestane být volný** (M1 se rozparkuje) — dokončit rozdělaný
  commit, nebo se čistě vrátit; nenechávat strom v půli.

## 8. Ověřovací příkaz

```bash
node --test tests/storage-architecture.test.js
grep -c "restore" src/core/db-backup.js      # na vstupní revizi 0
```

WP je hotový, až demonstrace z bodu 5 proběhne z čerstvého klonu na pojmenovaném
commitu a všechny tři negativní testy z bodu 6 jsou `PASS`. Podle
`CONTRACT.md §5` se `BLOCKED` ani `NAPSÁNO` nepočítá.

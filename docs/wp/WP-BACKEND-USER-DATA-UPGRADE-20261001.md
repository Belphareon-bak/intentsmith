# WP — skutečná uživatelská DB: izolovaná přejímka upgrade backendu

Autorita: explicitní zadání operátora ověřit fungování IDE 2.0/backendu
na reálných datech, dokumentaci a dokončovat po milnících. Další CHAT
byl výslovně předán jinému workerovi. Vstup: přijatý backend kandidát
`4bd11302fa6c9eb4fbbad087b0e53e07cd2ed787`; jeho produktový source je
bajtově shodný s publikovaným `45caf5b5`.

Stav: **PHYSICAL_DATA_UPGRADE_PASS / REVIEW_PASS**, není to celá IDE ani release přejímka.

## Rozsah a důkaz

Použít existující vlastní checkout backend-migration-evidence, bez nového
worktree. Jediný veřejný soubor tohoto WP je tento dokument. Soukromá
příprava/běh/report vzniknou v novém vlastním 0700 adresáři pod ignored
`.intentsmith-artifacts/backend-user-data-upgrade-*`.

Zdrojovou skutečnou DB otevřít pouze `readonly / fileMustExist` a použít
kanonický `scripts/studio2-copy-user-data.cjs` pro konzistentní SQLite
online backup včetně committed WAL. Zdroj se nemigruje. Původní snímek
je baseline; souběžné cizí zápisy do živé DB nejsou naše změny a nemusí
odpovídat pozdějšímu snapshotu. Kontrolovat source a copy integritu.
Na samostatné kopii spustit pouze autoritativní `runMigrations` z přesně
zaznamenaného čistého kandidáta. Nespouštět server, model, worker ani
recovery loop, nepoužít původní cesty projektů pro žádné efekty.

Před/po: SHA snapshotu, všechny původní uživatelské tabulky a přesné
multisety původních sloupců a řádků včetně blobů; samostatně přesná
migrační historie a změna SQLite schema. Nový sloupec/tabulka je možný,
změna starého pole bez přijatého migračního kontraktu je FAIL.
Migrační historii ověřit proti exportovaným verzím, ne názvům souborů.
Úspěch vyžaduje quick_check/foreign_key_check, trvalý výsledek po
znovuotevření DB a druhý no-op migration run. Neúspěšný run zůstane
FAIL se skutečnou chybou a kontrolou rollbacku; žádná ruční SQL sanace,
vypínání triggerů ani rozšíření allowlistu kvůli získání zelené.

Změny produkční DB, služby, GPU, role bindings, deployment, CHAT,
specialisté/worker implementace, source migrace a cleanup nejsou součástí
tohoto ověření. Jestliže skutečný upgrade selže, další oprava musí mít
vlastní bounded rozsah, původ migračních identit a nezávislé review.

## Konkrétní otevřené riziko

Read-only inventura před během: živá DB má 198 uživatelských tabulek,
108 historických migration stamps a latest `2026_09_25_120_studio_scm`.
Čerstvá kandidátní DB má 183 tabulek a 108 aktuálních migrací včetně 121.
Rovnost samotného počtu tedy neprokazuje upgrade kompatibilitu.
Skutečné historické identity a jejich přijetí se musí změřit na kopii.

## Skutečný výsledek — 08:29 UTC

Čistý zdroj `e6fb6b46463e73055cc7924679e6a659ae48c93d`, Node 24.21.0
(ABI 137), jediný běh skončil exit 0 / **PASS**. Kanonický online backup
má SHA `dbb3fcd30b127ee457e62e190f5b763b8a7a29ab06155fcca15686dd62383b2c`.
Snímek obsahoval 198 tabulek a 37 417 řádků včetně 108 migračních řádků.
Autoritativní runner aplikoval přesně 118, 119 a 121, přeskočil 105
aktuálních verzí. Po upgrade má soukromá DB 200 tabulek a 111 historických
migračních řádků. Všechny původní řádky všech 197 nemigračních tabulek
jsou bajtově shodné podle multiset SHA nad původními sloupci, hodnotami
včetně 64bitových integerů a blobů. Všech 108 původních migračních řádků
včetně applied_at zůstalo shodných; přibyly právě tři očekávané verze.

Schema delta obsahuje pouze dva nové grader tables, jejich index a čtyři
append-only triggers z 118/119; změnily se právě dva atomic-create triggers
z 121. Žádný původní objekt nebyl odstraněn. Reopen integrity je
quick_check `ok` a žádné foreign_key_check chyby. Druhý migration run
aplikoval nula verzí a přeskočil všech 108 současných verzí. Importované
SCM automatic policies, neukončené M2 operace a nedořešené modelové pulls
jsou všechny nula. Backend se z kopie přesto nespouštěl.

Tři další stamps jsou přesně podporované historické identity
`2026_08_09_061_model_automation_policy`,
`2026_08_10_062_model_failover_proof_issuance` a
`2026_08_22_068_model_evaluation_history`, již doložené v
`src/core/db-backup.js`. Count 108 v M6 pinned fresh-upgrade scénáři se
nepřepisuje na 111; nevyjadřuje počet řádků každé historické uživatelské DB.

Private artifacts v autorově checkoutu:
`.intentsmith-artifacts/backend-user-data-upgrade-20261001-0832/`.
Result SHA `4ee825bd63937faae5e60f5527979a3e127d2a32d80f516a33683195661bd7bc`,
exact schema/history delta SHA
`cff96b6545b06ef9b6010b1bfaca36bce993c89abb492a68b603721297e96603`.
Běhový audit script a veškeré snapshots/logs zůstávají soukromé.
Produkční MainPID před i po je 2026, backup baseline se nezměnil,
source clean před/po. Inference ani produktový server z kopie nebyly
spuštěné. Nezávislá revize tohoto výsledku čeká; nejde o celý
uživatelský IDE průchod ani release přejímku.

## Independent receipt

Independent read-only review accepted the exact recorded source and both
physical SQLite files: **REVIEW_PASS**. Direct Counter comparison checked
SQLite value types, int64, text/blob bytes and float bits across all 197
original non-migration tables and 37,309 user rows. All 108 original history
rows remain, exactly three accepted versions were added. Seven new objects
match the SQL of 118/119; both changed triggers match the exact target hashes
of 121. Current manifest has 108 entries, supported extra stamps remain.
Both copies pass integrity; the second no-op result matches the final
reopened schema/history/data. All eight evidence hashes remained unchanged.
Source tree at `e6fb6b46` is byte-identical to published `45caf5b5`.

Private independent proof:
`.intentsmith-artifacts/backend-user-data-upgrade-review-e6fb6b46/verify.py`
and `review-result.json` in the author checkout. Reviewer did not run a
writer, server or GPU and did not open production DB. This accepts upgrade
of the actual saved user-data snapshot; IDE UI, successful generated app,
production deployment and release remain separate pending evidence.

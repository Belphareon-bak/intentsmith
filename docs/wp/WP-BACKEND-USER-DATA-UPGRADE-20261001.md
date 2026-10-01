# WP — skutečná uživatelská DB: izolovaná přejímka upgrade backendu

Autorita: explicitní zadání operátora ověřit fungování IDE 2.0/backendu
na reálných datech, dokumentaci a dokončovat po milnících. Další CHAT
byl výslovně předán jinému workerovi. Vstup: přijatý backend kandidát
`4bd11302fa6c9eb4fbbad087b0e53e07cd2ed787`; jeho produktový source je
bajtově shodný s publikovaným `45caf5b5`.

Stav: **PREPARED / NOT_RUN**, není to celá IDE ani release přejímka.

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

Read-only inventura 08:30 UTC: živá DB má 198 uživatelských tabulek,
108 historických migration stamps a latest `2026_09_25_120_studio_scm`.
Čerstvá kandidátní DB má 183 tabulek a 108 aktuálních migrací včetně 121.
Rovnost samotného počtu tedy neprokazuje upgrade kompatibilitu.
Skutečné historické identity a jejich přijetí se musí změřit na kopii.

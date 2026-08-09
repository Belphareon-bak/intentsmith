# docs/wp — zadání práce

**Adresát:** agent, který dostane konkrétní zadání · operátor při rozhodování `§14`
**Datum:** 2026-08-07 · **Vstupní revision:** `1fc8f03e` u P2–P5 a obou WP,
`13701b2a` u P6

Soubory zde jsou **zadání**, ne stav a ne evidence. Jsou to položky
`ROADMAP.md §12` — osm bodů aktivního Work Package — sepsané dřív, než se WP
aktivuje, plus zadání read-only sond.

**Tohle není board.** Stav práce je podle `CONTRACT.md §6` výhradně
v `ROADMAP.md` a v příslušné inventuře. Zde se nic neaktualizuje, neoznačuje
jako hotové ani nesleduje. Když zadání doběhne, výsledek jde tam, kam ho
posílá jeho sekce „Výstup" — ne sem.

| Soubor | Typ | Stav | Výsledek |
|---|---|---|---|
| [P2-L0-8-IMPORT-GRAPH](P2-L0-8-IMPORT-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [L0-8-BOUNDARY](../review/2026-08-07-L0-8-BOUNDARY.md) |
| [P3-OUTBOUND-CENSUS](P3-OUTBOUND-CENSUS.md) | read-only sonda | **doběhla 2026-08-07** | [OUTBOUND-CENSUS](../review/2026-08-07-OUTBOUND-CENSUS.md) |
| [P4-AUTH-MATRIX](P4-AUTH-MATRIX.md) | read-only sonda | **doběhla 2026-08-07** | [AUTH-MATRIX](../review/2026-08-07-AUTH-MATRIX.md) |
| [P5-SECRET-TYPES](P5-SECRET-TYPES.md) | read-only sonda | **doběhla 2026-08-07** | [SECRET-TYPES](../review/2026-08-07-SECRET-TYPES.md) |
| [P6-MODULE-GRAPH](P6-MODULE-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [MODULE-GRAPH](../review/2026-08-07-MODULE-GRAPH.md) + měřidlo a JSON |
| [P7-ENFORCEMENT-AUDIT](P7-ENFORCEMENT-AUDIT.md) | read-only sonda | **doběhla 2026-08-07** | [ENFORCEMENT-AUDIT](../review/2026-08-07-ENFORCEMENT-AUDIT.md) |
| [WP-M5-PACKAGE](WP-M5-PACKAGE.md) | zapisující WP | **záložní slot**, nezahájeno | — |
| [WP-M5-DATA](WP-M5-DATA.md) | zapisující WP | **záložní slot**, nezahájeno | — |
| [WP-M1-BINDING-REPOSITORY](WP-M1-BINDING-REPOSITORY.md) | zapisující WP | **dokončeno** na `515fb6f7`, evidence `eb7e78b8` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BINDING-APPLICATION](WP-M1-BINDING-APPLICATION.md) | zapisující WP | **dokončeno** na `e7d89b5e`, fresh-clone evidence `9b71c741` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-MODEL-CLEANUP-AUTHORITY](WP-M1-MODEL-CLEANUP-AUTHORITY.md) | zapisující WP | **C1 + C2a fresh-clone; C2b gateway + binding focused / PARTIAL; 4/5 live paths**, C2a source `9b4d9f79`, baseline `19d63e1b`; gateway source `7ccd8a58`; binding source je commit obsahující tento stav, exact-edge acceptance čeká | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BOUNDARY-RATCHET](WP-M1-BOUNDARY-RATCHET.md) | zapisující WP | **technicky dokončeno**; hardening integrován v `ec98803a`, baseline `b05392e1`; procesní pilot invalidován | [IMPORT-CENSUS](../review/2026-08-09-IMPORT-CENSUS.md) + [LIFECYCLE-PARITY](../review/2026-08-09-LIFECYCLE-PARITY.md) |

Zadání sondy zůstává i po doběhnutí — je v něm postup a ověřovací příkaz, kterým
si lze výsledek přeměřit. Sloupec „stav" je tady jediná výjimka z pravidla, že se
zde stav nesleduje; drží ho, aby nikdo nespustil hotovou sondu podruhé.

Ani jeden ze dvou **M5** WP není schválený k zahájení. Jsou připravené pro
okamžik, kdy zapisující slot uvolní zaparkovaná práce na M1. `WP-M5-PACKAGE` má
navíc tvrdý BLOCK na pořadí vůči dávce M1 — viz jeho `§0`.

Dvojice **M1** WP původně otevřela bránu prvního paralelního pilotu podle
[`2026-08-08-PARALLEL-PILOT.md`](../review/2026-08-08-PARALLEL-PILOT.md):
`WP-M1-BINDING-REPOSITORY` už skončil před vznikem ratchet větve, proto se jako
souběžný writer neměří. `WP-M1-BOUNDARY-RATCHET` technicky doběhl a byl
integrován merge commitem `5332d30e`; jeho exact-edge baseline je připnutý
k tomuto merge SHA. Hardening větev následně na zdrojovém merge `da898277`
přijala šest hran binding-application checkpointu a zapsala baseline 1 010
hran v `b05392e1`; aktivní větev ji po uzavření předchozího writeru integrovala
merge commitem `ec98803a`. Pilotní měření je ale invalidované porušením
pravidla jednoho writera v ratchet checkoutu a nevytváří kladný ekonomický závěr.
`WP-M1-BINDING-APPLICATION` je tímto sériovým nástupcem, ne znovuotevřením
dokončeného repository WP.

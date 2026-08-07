# docs/wp — zadání práce

**Adresát:** agent, který dostane konkrétní zadání · operátor při rozhodování `§14`
**Datum:** 2026-08-07 · **Vstupní revision:** `1fc8f03e` u P2–P5 a obou WP,
`13701b2a` u P6

Soubory zde jsou **zadání**, ne stav a ne evidence. Jsou to položky
`CONTRACT.md §12` — osm bodů aktivního Work Package — sepsané dřív, než se WP
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
| [WP-M5-PACKAGE](WP-M5-PACKAGE.md) | zapisující WP | **záložní slot**, nezahájeno | — |
| [WP-M5-DATA](WP-M5-DATA.md) | zapisující WP | **záložní slot**, nezahájeno | — |

Zadání sondy zůstává i po doběhnutí — je v něm postup a ověřovací příkaz, kterým
si lze výsledek přeměřit. Sloupec „stav" je tady jediná výjimka z pravidla, že se
zde stav nesleduje; drží ho, aby nikdo nespustil hotovou sondu podruhé.

Žádný ze dvou zapisujících WP není schválený k zahájení. Jsou připravené pro
okamžik, kdy zapisující slot uvolní zaparkovaná práce na M1. `WP-M5-PACKAGE` má
navíc tvrdý BLOCK na pořadí vůči dávce M1 — viz jeho `§0`.

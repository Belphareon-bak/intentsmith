# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 5. 10. 2026, 07:25 CEST / 05:25 UTC.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
**Release NOT_ACCEPTED. HTTP API FAIL. Fan FAIL. Mobil čeká na stabilní IDE/BE.**

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Zbývající omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → přesné M2 → oracle → commit → restart, review PASS | Malé projekty; obecná spolehlivost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi dvěma procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expertise, souběh a delší stabilita |
| AST / GPU panel / Cleanup | AST review PASS, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence worktrees zachované |
| M6 data | Full109 backup → CLI restore → restart, nezávislá přejímka PASS | n=1, pouze databáze; celý M5/M6 ani release nepřijaté |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje, nikoli DB z dalšího nového sandboxu.

## Společná integrace a publikace

Merge 56138e4f zachoval CHAT e066956b / CODE32k / D1; preservation review PASS.
Celý aktuální **offline/database profil 86dbca40: 410 PASS / 0 FAIL / BLOCKED / TIMEOUT**,
04:44:14–04:54:05 UTC, report a5a2f4a3…326d11c; nezávisle ověřené všechny výsledky/logy.
Nativní datové testy 24/24, M1 kontrakt 74/74. Historické FAIL zůstávají.
**86dbca40**, remote exact; [CI 37264792541 všech 18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37264792541).
CI zachovává CHAT7/CODE12; tento výběr ani CPU profil nepřijímá release.
CODE4096 pouze pro vydaný přesný CODE32k; generic8k/2048 a approved4k/1024 zachované.
Studio bundle 7bf62455…bfe24 a instalovaný BE c84b88cd nezměněné; žádný deploy/aktivace.
Externí c5309a0/bundle zde chybí; jeho výsledky nejsou místně přijaté důkazy.

## HTTP — nový skutečný běh uzavřen, aplikace nepřijatá

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2,
policy/SQL122/přesné approval/Studio/startup; default offline V1 zachovaný.
Retained@3: 8 CODE; approval → oracle → Git1856920f → BE restart skutečně prošly.
70 HTTP + 14 refused SQL / 14 positive / AUTOINCREMENT / 2 servers, stejná DB inode PASS.
Review895d651c…569e52: přesné bajty 26 139 / rollback4 / cleanup PASS, **API SOURCE FAIL**.
[Source-only kandidát](../examples/generated-apps/http-items-candidate/README.md) zůstává NOT_ACCEPTED.
Normal MODIFY2 @4 na42b3: 03:22:30–03:24:17 UTC, 106,974 s, cumulative **10/10 CODE**.
Oba úplné výstupy; systemPrompt + serialized user context 30 647/28 843 B pod 32 000 B,
prompt_eval8541/8068. ROOT helper chybně čekal4 preview targets místo2: selhal před approval.
A2/static import opravený; A1/slash aliases a A3/charset OWS nadále chybné.
**Žádné schválení/zápis/test/commit/restart**; Git a 233 původních PK/hash zachované,24 pending rows.
Independent abca4549…20b182: CLOSED_HELPER_FAILURE_AND_API_SOURCE_REVIEW_FAIL_NOT_ACCEPTED.
Úzká helper oprava 0dedf718…c657666: CPU6/source review PASS; všechny 4 before/protect/Git guards.
**CODE blokér je kvalita opravy, nikoli context overflow nebo neúplný výstup.**
Krok7 zadání: další inference zastavená; konkrétní otázka ke strategii/rozpočtu čeká.
Doporučení: normální anchored edits svázané s úplným before source/digest; CPU/review/freeze před live.
Alternativy: jiný kvalifikovaný CODE model, nebo odložit HTTP a uzavřít další brány.

## Fan — rozhodnutí o pokračování čeká

Frozen5f6c3fb7: 4 historical +4 nové =8/11; čtvrtý repair length2048 při validním contextu.
Oracle8 PASS/6 FAIL, rollback4/Git zachované; review839ee340…35fa813 přijímá důkazy FAIL.
Repair4 +CLI3 potřebuje cumulative15; otázka operátorovi čeká, další inference0.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## M5/M6 — přijatý celý databázový roundtrip, integrační fresh gate otevřený

Upgrade ad93: ACTUAL_UPGRADE_ACCEPTANCE_REVIEW_PASS, n=1/9,66055 s; review82b6dd0a…75ca884.
56 → forced FAIL80 → exact restore56 → current109; canary/legacy180 B/path/hash/inode PASS.
Fresh install/build0d8: nezměněný instalátor offline, 32,816 s; npm/SQLite/Yarn/Electron/4 ABI PASS.
Reviewfdcd5548…6cdb80e, clone/own PID cleanup;9 artefaktových hashů před odstraněním clone.
**Pět registered programů a celý fresh phase NOT_RUN.** Připravuje se vlastní provider/UDS/net relay,
společný GPU lease, přesný Qwen/4096 a původní runner; nejprve source review/freeze/volná GPU.
První full109@0d8,32,298 s: **PRODUCT FAIL**, native validace přidala do archivu WAL/SHM.
Core d985dcbd nyní validuje private copy mimo archiv, váže obě kopie na manifest a uklízí own sidecars.
Readonly archive podporovaný; writable dataDir a místo pro DB kopii nutné; konkrétní copy/cleanup chyby.
Druhý full109@86db,33,274 s: přesné bytes/archive/restart PASS, **HARNESS FAIL** na startup last_active.
Oba FAIL a původní modelové/oracle artefakty beze změny; žádná ruční oprava historických DB.
Úprava testu CPU12/review44cbf93b…92795: všechny API hodnoty přesné, pouze čas aktivity v měřeném startu.
**Full109@86db přijatý**, 05:18:36–05:19:09 UTC,33,1497 s/model0, stejný oracle1101617a…7b8d8.
Před reopen přesné DB/safety bytes; po restartu obsah/metadata, marker2×404,109 stamps/schema/quick/FK PASS.
Archiv 82 files/81 payload beze změny a bez sidecars; source/deps/refs zachované, vlastní procesy ukončené.
Receipt d215cd75…774e79; independent **493a5b69…bf7bdf4 FULL109_DATABASE_ROUNDTRIP_ACCEPTANCE_REVIEW_PASS**.
Jde o n=1 DB-only proof na 86db; signed acceptance, project/config/skills restore ani vydání se tím nepřijímá.
[M6 WP](wp/WP-M6-RELEASE.md): signed receipts 13/unsigned8, custody/rotation/history/privacy/demo otevřené.
Nový soak/throughput/Gate0 samostatně;193e2351 PASS pouze historický.

## Nejbližší pořadí dokončení a zbývající testy

1. Zmrazit a spustit fresh gate se všemi 5 programy; zachovat cizí GPU práci a současný oracle.
2. Po odpovědi na CODE krok7 dokončit HTTP/Fan; větší reprezentativní repo a měření kontextu jednotlivých kroků.
3. Živý classifier→D1 (CPU44+parser24/review PASS), fyzické IDE/M2; file/web/export/skills a A→B→A.
4. Kvalita expertise/specialistů, worker souběh/delší stabilita; společný finální profil/M5/M6/operátorské demo.
5. Mobil až po stabilním IDE/BE: conversation.create chybí; historical CPU47, physical 13+7 NOT_RUN;
   skutečný device/APK/VPN/pair-revoke/M2/TalkBack. Pak závěrečný bezpečný cleanup.
Hunt má cizího vlastníka; last RO01:26UTC596/1173 responses,2324/3689 criteria,107 files unchanged.
Nový progresspath nedoložen; otázka čeká, ROOT grading nepřebírá. Gemma9591ea1b NO_GO.
Holdout odpečetěn operátorem; ROOT jeho obsah nečetl. CHAT/Gemma ladí druhý worker.
Cleanup215 branches/72 worktrees: foreign/UNKNOWN/evidence HOLD; žádný nový worktree.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/86dbca4059ab7c2f04bed89dae16c154e761592e/docs/WORK-PROGRESS.md).

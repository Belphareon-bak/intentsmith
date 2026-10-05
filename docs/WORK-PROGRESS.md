# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 5. 10. 2026, 05:47 CEST / 03:47 UTC.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
**Release NOT_ACCEPTED. HTTP: nový CODE návrh API FAIL. Fan FAIL.**

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Zbývající omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → exact M2 → oracle → commit → restart, review PASS | Malé projekty; obecná spolehlivost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi dvěma procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expertise, souběh a delší stabilita |
| AST / GPU panel / Cleanup | AST review PASS, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence worktrees zachované |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje, nikoli DB z dalšího nového sandboxu.

## Společná integrace a publikace

Merge 56138e4f zachoval CHAT e066956b / CODE32k / D1; preservation review PASS.
Poslední celý profil **ad93ec63: 410 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT**,
02:33:11–02:42:47 UTC; report eeedf1e5…b0fd8. Starší FAIL zůstávají.
Poslední ověřená publikace před tímto milníkem: **42b3fcf1**, remote exact,
[CI 37258157223 všech 18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37258157223).
CI obsahuje CHAT7 a CODE12; zelené vývojové CI není release přejímka.
CODE4096 jen issued exact32k; generic8k/2048 a approved4k/1024 zachované.
Metadata source413917e2 / CPU50 / source review PASS; registry596/35, graph1510/3/28.
Studio bundle7bf62455…bfe24 a instalovaný BE c84b88cd nezměněné; žádný deploy/aktivace.
Externí c5309a0/bundle zde chybí; jeho výsledky nejsou místně přijaté důkazy.

## HTTP — nový skutečný běh uzavřen, aplikace nepřijatá

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2,
policy/SQL122/exact approval/Studio/startup; default offline V1 zachovaný.
Retained@3: 8 CODE; exact approval → oracle → Git1856920f → BE restart skutečně prošly.
70 HTTP + 14 refused SQL / 14 positive / AUTOINCREMENT / 2 servers, same DB inode PASS.
Review895d651c…569e52: přesné bajty26139 / rollback4 / cleanup PASS, **API SOURCE FAIL**.
[Source-only kandidát](../examples/generated-apps/http-items-candidate/README.md) zůstává NOT_ACCEPTED.

Normal MODIFY2 @4 na42b3: zmrazený d367fac5…edc5c; 03:22:30–03:24:17 UTC, 106,974 s.
**8 historical + 2 nové = 10/10 CODE**, D1/CLI/repair/retry0; obě odpovědi stop/complete.
Guardovaný součet systemPrompt + serialized user context30647/28843 B pod32000; prompt_eval8541/8068, výstup3053/1100 tokens.
Úplné raw JSON afterContent odpovídají preview: router10578 B, server3401 B.
ROOT helper chybně čekal4 preview targets místo2; selhal **před schválením**.
Nový server opravil A2/static import; router stále porušuje A1/slash aliases a A3/charset OWS.
**Neschváleno, soubory nezapsány, funkční test/commit/restart/supplemental NOT_RUN.**
Git1856920f, všechny4 původní zdroje a233 původních PK/hash zachované; +24 pending rows.
Own cleanup/unload/lease/proxy PASS; 58869 frozen hashů exact; 52 GPU samples/0 errors.
Independent review **abca4549…20b182: CLOSED_HELPER_FAILURE_AND_API_SOURCE_REVIEW_FAIL_NOT_ACCEPTED**.
Pending plan68bfd28b/d1fe8d17 má expiry04:24:03 UTC; známý vadný návrh se neschválí.

Úzká oprava preview helperu převzatá:0dedf718…c657666, CPU6/6 + source review PASS.
Plné4 before/protected/Git guards zachované; oprava helperu neřeší vadu modelového návrhu.
**CODE blokér: kvalita konkrétní opravy, nikoli překročení kontextu nebo neúplný výstup.**
Další inference stojí podle kroku7 zadání; žádný třetí automatický pokus/navýšení rozpočtu.
Doporučená strategie k rozhodnutí: normální editace existing file přes přesné anchored replacements,
svázané s before source/digest; znovu použít compiler, bez fakeFAILED, před live CPU/review/freeze.
Alternativy: jiný role-specific kvalifikovaný CODE model, nebo odložit HTTP a uzavřít další brány.

## Fan — konkrétní otázka čeká

Frozen5f6c3fb7: 4 historical +4 nové =8/11; čtvrtý repair length2048 při validním contextu.
Oracle8 PASS/6 FAIL, rollback4 a Git zachované; review839ee340…35fa813 přijímá důkazy FAIL.
Repair4 +CLI3 potřebuje cumulative15; otázka operátorovi čeká. Další inference0.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## M5/M6 — přijatý upgrade, první fresh install FAIL

**ACTUAL_UPGRADE_ACCEPTANCE_REVIEW_PASS**, n=1/ad93, 9,66055 s; review82b6dd0a…75ca884.
56 → forced FAIL80 → exact restore56 → current109, same DB; canary/legacy180 B/path/hash/inode PASS.
Raw before uložený, raw after samostatně ne; after literal assertions PASS. Unsigned dílčí proof.
Fresh@42b3: 03:27:52–03:28:30 UTC, 38,089 s, exit1; čistý clone i procesy odstraněné.
Offline npm/SQLite native +Yarn frozen install +Electron native rebuild PASS;
**Studio production build FAIL**, následných5 registered programů NOT_RUN.
Source diagnóza: chybí FFmpeg ZIP +SHASUMS v owned Electron cache; log má zkrácenou DNS chybu.
Review2dbac0d1…27f63a3 odlišuje skutečný log od inference příčiny; starý FAIL zůstává.
Nejmenší další oprava je nová cache se2 připnutými artefakty; existing runner kopíruje správnou cestu.
Žádný skip checksum/network fallback/product patch; jeden nový explicitně zmrazený fresh pokus.
Full109 backup/restore připravený plán1101617a…7b8d8, **NOT_RUN**.
[M6 WP](wp/WP-M6-RELEASE.md): signed receipts13 / unsigned8, key custody/rotation/history/demo otevřené.
Nový soak/throughput/Gate0 samostatně;193e2351 PASS pouze historický.

## Další dokončení a testy

Classifier→D1 CPU44 +parser24/review PASS; živý přirozený vstup není přijatý.
Hunt má cizího vlastníka; last RO01:26UTC596/1173 responses,2324/3689 criteria,107 files unchanged.
Nový progresspath nedoložen; otázka čeká, ROOT grading nepřebírá. Gemma9591ea1b NO_GO.
Holdout odpečetěn operátorem; ROOT `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json` nečetl.
Po CODE: větší repo/context, ovládání IDE/M2, file/web/export/skills, A→B→A, expertise, worker souběh.
Pak společný finální profil/M5/M6; mobil až po stabilním IDE/BE.
Mobil: conversation.create chybí; historicalCPU47, physical13+7 NOT_RUN; device/APK/VPN/pair-revoke/M2/TalkBack.
Cleanup215 branches/72 worktrees: foreign/UNKNOWN/evidence HOLD; žádný nový worktree.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/42b3fcf11352e40ac487f99becf63020692c3be2/docs/WORK-PROGRESS.md).

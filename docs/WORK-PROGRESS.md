# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 5. 10. 2026, 03:35 CEST / 01:35 UTC.
**Vlastník:** ROOT; ladění CHAT/Gemma a zbývající Hunt mají jiné workery.
**Release NOT_ACCEPTED. Fan a nová HTTP aplikace zůstávají FAIL.**

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Zbývající omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Model → přesné M2 → oracle → commit → restart, review PASS | Malé projekty; obecná spolehlivost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi dvěma procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expert-vs-general, souběh a delší stabilita |
| AST / GPU panel / Cleanup | AST review PASS, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence worktrees zachované |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite průchodu dokládá durable M2/zdroje, nikoli DB z dalšího nového sandboxu.

## Společná integrace a kandidáti

Merge 56138e4f zachoval CHAT e066956b a CODE32k/D1; preservation review PASS.
Celý profil **c412865c: 410 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT**, report 5b404646…00a2b.
[CI c412 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37244406326).
Starší eb482aca:399 PASS/11 FAIL a CI FAIL zůstávají historickým výsledkem.
Recovery **50915ffd** je pushnutý, remote SHA ověřený;
[CI 18/18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37247712264).
CODE kandidát **e3e15582**: cílený profil3/3 PASS, source review9fe85d5c…3122e60 PASS.
Nejde o nový celý profil nebo živý úspěch aplikace. M6 fixture má CPU12/12;
společné review c735179f…77f0b22 PASS. Publikovaný 0be289d5 má [CI18/18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37251247298).
Instalovaný BE c84b88cd se nezměnil; tento proud jej nenasadil.
Externí c5309a0/bundle zde chybí; hlášené výsledky nejsou místně přijaté důkazy.

## Aktivní CODE / HTTP blokér

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2,
plná policy/payload, SQL122, přesné approval, Studio a explicitní startup config.
V1 wire/078/079/106 a výchozí offline režim zachované. Registry596/35; graph1507/3cykly/28.
Skutečný Studio build PASS, bundle7bf62455…bfe24; CI zachovává CHAT7 a CODE11.
Veřejný provider, kernel negatives a cancel/timeout2/2 mají přijaté omezené fyzické důkazy.
Late-cleanup guard odmítá neukončené V2 potomky; V1 zachovaný. Podrobnosti a rozsahy jsou ve WP.
API a oracle2 0ba036cb…ca3a0 se nemění; obsahují SQL constraints, AUTOINCREMENT a strictUTF8.
Původní4 CODE výstupy/25 382 B skončily chybou helper-policy před náhledem; packet zachovaný.
Recovery00:45–00:48 UTC použila stejné úplné výstupy přes veřejné /m2-plan, bez nové initial inference.
Náhled přesných bajtů → wrongdigest409 → restart pending → exactapprove200 skutečně proběhly.
Oracle zjistil konec serveru před readiness:0 HTTP/0 checks; rollback4/4, Git baseline8051f708 beze změny.
Trusted CPU potvrdilo nedostupný charindex; původní serverstderr zachycený nebyl.
Store repair11 je úplný; router15 skončil length2048/neúplnéJSON → OUTPUT_INCOMPLETE502.
Vstup29 967 B/prompt8263 prošel limity. Nový repair plán, zápisy ani commit nevznikly.
Spotřeba6/8; server se neopravoval. Source/history a vlastní cleanup/unload/lease ověřené.
Actual review20f76f40…5563e4b a sourcee1e1bfe2…ece106 potvrzují APPLICATION_FAIL.
CPU retention proof a3917093…ce5234 zachovává actualstore a validation; zbývají router/server2.
CODE cap4096 platí jen pro vydaný exactCODE32k capture; generic8k2048 a schválený4k1024 zachované.
Vyšší cap nezaručuje správnost: partialrouter opisoval komentáře a skutečné fatal dekódování chybělo.
Původní repair fáze je vyčerpaná. ROOT podle CONTRACT §11 rozhoduje nový cyklus max2/total8;
retained helper CPU16/16 a review4aac88a2…94b37aa PASS; nový publish/CI/freeze před live. Inference neběží.

## Fan: konkrétní rozhodnutí čeká

Frozen5f6c3fb7:4 historická +4 nová =8/11, CLI/D1=0; čtvrtý repair skončil length2048.
Prompt28 629 B/8981tokens prošel; nový plán/efekt nevznikl. Původní oracle8 PASS/6 FAIL zachovaný.
Review839ee340…35fa813 potvrdilo rollback/owned cleanup a nezměněné původní důkazy.
Produkt nemá durable partial draft resume. Další repair4+CLI3 potřebuje cumulative15.
Operátor dostal konkrétní otázku; bez odpovědi další fan inference neběží.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).
CODE32k první HTTP měření:81 vzorků/56 loaded, fullVRAM17,399,734,598 B/minfree2434MiB.
Jde o periodické vzorky, nikoli souvislý důkaz. Source16384/serializer32000 a canonical GPU guard zachované.

## M5/M6: technická práce a operátor

Own offline cache220/220 a Node24 ABI137 SQLite prebuild ověřené; sdílená cache neměněná.
První actual109 upgrade FAIL po97,5s: předchozí d3d verze vyžaduje C3_* ENV, test posílal moderní názvy.
Canary/backup-restore/count109 nebyly dosaženy; nejde o přijatý upgrade nebo prokázanou produktovou vadu.
Previous-only13 aliases: CPU12/12, review/CI PASS; retry na0be trval7,918s, cleanup/zdroje beze změny.
Previous canary/count56, failed-upgrade+exactrestore56 a currentAPIcanary prošly; metadata FAIL.
Old d3d píše .c3/project.json; moderní readers jej nečtou. Finalcount109/inode NOT_REACHED.
Připravuji read-only kompatibilitu + ověření původních bajtů; žádné přejmenování dat/test-only fallback.
M5/M6 otevřené:8 unsigned podkladů,13 signed receipts; rotace/N/A, history disposition, key custody a demo.
Nové fresh install, backup/restore,24h soak a throughput jsou samostatné otevřené přejímky.
Starý24h/throughput PASS na193e2351 zůstává historický. [M6 WP](wp/WP-M6-RELEASE.md).

## D1, Hunt a CHAT

Classifier→D1:44/44 CPU +parser24 +review PASS; živý přirozený vstup není přijatý.
Hunt vlastní jiný worker. Byte audit5Oct01:26 UTC:107 canonical souborů beze změny,596/1173 odpovědí,2324/3689kritérií;
nový worker/path zatím nedoložený, cílený dotaz čeká. ROOT grading ani cizí proces nepřebírá.
Gemma candidate9591ea1b ověřen; reportd86baa27 NO_GO není holdout acceptance.
Operátor odpečetil `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`; ROOT obsah nečetl.

## Další dokončení a zkoušky

Po funkční CODE aplikaci: obecnější repo/context průchod, skutečné ovládání IDE/M2,
file/web/export/skills, projekty A→B→A, kvalitativní expertise oracle a worker souběh.
Pak společný finální profil a M5/M6 technické i podepsané přejímky.
Mobil až po stabilním IDE/BE: conversation.create chybí, historicalCPU47, physical13+7 NOT_RUN.
Device/signedAPK/VPN origin/pair-revoke/restart/exactM2/TalkBack čekají.
Závěrečný cleanup:215 branches/72 worktrees; foreign/UNKNOWN/evidence HOLD, žádný nový worktree.
[Archiv před HTTP adopcí](https://github.com/Belphareon-bak/intentsmith/blob/f530461918ce961f6ae2224f6aa062ef22e4bb51/docs/WORK-PROGRESS.md).

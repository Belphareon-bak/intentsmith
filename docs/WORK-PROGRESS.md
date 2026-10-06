# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 6. 10. 2026,14:02 CEST /12:02 UTC.
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
| M6 data | Full109 backup → CLI restore → restart, review PASS | n=1, pouze DB; celý M5/M6 ani release nepřijaté |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje, nikoli DB z dalšího nového sandboxu.

## Společná integrace a poslední úplný profil

Merge 56138e4f zachoval CHAT e066956b / CODE32k / D1; preservation review PASS.
CHAT checkout 6. 10. znovu ověřený: clean e066956b; ROOT do jeho logiky nesahal.
Poslední celý offline/database profil **86dbca40: 410 PASS / 0 FAIL / BLOCKED / TIMEOUT**,
5. 10.,04:44:14–04:54:05 UTC; report a5a2f4a3…326d11c, nezávisle ověřené všechny řádky/logy.
Data 24/24, M1 kontrakt 74/74; tento profil nepřijímá následnou cache opravu ani release.
Zveřejněný základ90c17489 měl [CI37267838658 všech18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37267838658).
CI zachovává CHAT7/CODE12. Remote SHA a CI nového balíku se ověřují po publikaci.
CODE4096 pouze pro vydaný přesný CODE32k; generic8k/2048 a approved4k/1024 zachované.
Studio bundle 7bf62455…bfe24 a instalovaný BE c84b88cd nezměněné; žádný deploy/aktivace.
Externí c5309a0/bundle zde chybí; jeho výsledky nejsou místně přijaté důkazy.

## Fresh integrační průchod — 3 PASS / 2 FAIL, nepřijatý

Na90c17489,5. 10.,06:23:03–06:28:46 UTC: offline install/build a všech5 registered programů.
**PASS:** Electron boundary, Studio M1 journey, Studio M2 composer. **FAIL:** M1 a previous upgrade.
M1: outage URL správně9; classifier zachytí PROVIDER_UNAVAILABLE a pokračuje fallbackem → status ok.
Přesný outage payload/intent před assert neuložený; zdroj/logy doložené, oprava patří CHAT workerovi.
Upgrade: vlastní kopírovaná npm cache 0775, bootstrap správně vyžaduje0700; konec před DB/upgradem.
Observer fungoval:10 dokončených odpovědí (4class/4answer/2summary),311 GPU vzorků/275 fullGPU,
min volná VRAM 5 337 MiB.178 známých lifetimes skončilo, cleanup bez signálů; model unload/lease release.
Review **d3ce667d…15354 FRESH5_3_PASS_2_FAIL_REVIEW_COMPLETE_NOT_ACCEPTED**;
1636 bytehashů +8 cookie artefaktů pouze metadata; source/deps/14links zachované.
Clone odstranil adapter před ROOT capture9 build hashů; nové install-only přijetí se netvrdí.
Původní dva observer FAIL zachované. Adapter NOT_RUN je success-only counter; report dokládá všech5 běhů.
**Nová omezená oprava:** cache helper ověří vlastní nový cíl a nastaví jen jeho kořen 0700;
zdroj/payload/execute modes zachované. CPU 23/23, registry 596 valid; review 69836bd2…350de0 PASS.
M1 pouze uloží dosavadní UTF-8 decoded body/status/roles před nezměněným oracle; nejde o arbitrary wire proof.
**Po opravě nový fyzický běh NOT_RUN.** Žádné další monitor ladění ani přijetí releasu.

## HTTP / Fan — další CODE inference čeká na krok7

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2/policy/SQL122/M2/Studio;
default offline V1 zachovaný. Retained@3 approval/oracle/Git1856920f/BE restart PASS, API SOURCE FAIL.
70 HTTP +14 refused SQL /14 positive /AUTOINCREMENT /2 servers, stejná DB inode;26 139B/rollback4 PASS.
[Source-only kandidát](../examples/generated-apps/http-items-candidate/README.md) NOT_ACCEPTED.
Normal MODIFY@4 na42b3: cumulative10/10 CODE; úplné výstupy, context30 647/28 843B pod32 000B.
A2/static import opravený; A1/slash aliases a A3/charset OWS FAIL. Helper2-vs4 CPU 6/review opravený.
Žádné další approval/zápis/test/commit/restart; původní Git/233PK/hash/24pending zachované.
Review abca4549…20b182 FAIL. CODE blokér je nyní kvalita opravy, nikoli context overflow.
Doporučená omezená strategie: normální anchored edit s úplným before source/digest; CPU/review/freeze,
max2 další CODE/cumulative12. Otázka čeká; alternativy jiný kvalifikovaný model nebo odklad HTTP.
Fan frozen5f6c3fb7:8/11 použito, oracle8 PASS / 6 FAIL, rollback4/Git zachované; review 839ee340…35fa813 FAIL.
Repair4+CLI3/cumulative15 má samostatnou otázku bez odpovědi. Další inference0.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## M5/M6 — data přijatá, release autorita otevřená

Upgrade56→forcedFAIL80→restore56→current109/ad93 review 82b6dd0a…75ca884 PASS, n=1/9,66055s.
Fresh install/build0d8 review fdcd5548…6cdb80e PASS; offline npm/SQLite/Yarn/Electron/4ABI/9hashů.
Full109@86db,5. 10.,05:18:36–05:19:09UTC/33,1497s/model0, oracle1101617a…7b8d8 beze změny:
přesné DB/safety bytes před reopen, data/metadata po restartu,2marker404/109stamps/schema/quick/FK PASS.
Archiv82files beze změny/bez sidecars, vlastní cleanup. Receipt d215cd75…774e79/review 493a5b69…bf7bdf4 PASS.
Core validuje private copy mimo archiv; readonly archive podporovaný, writable dataDir/DB-copy disk nutný.
Původní archive WAL/SHM PRODUCT FAIL i startup last_active HARNESS FAIL zachované; n=1 DB-only.
**M5 je 8/9 REVIEW_PASSED / PRIVACY_CHANGES_REQUIRED / KEY_CUSTODY_PARTIAL / ACCEPTANCE_BLOCKED.**
History **retain_and_rotate** již vybraná; chybí její signed receipt a8 category receipts (rotace/revokace
nebo podepsané historic not-applicable). Offline médiumA/operátor aB/oddělený reviewer doložené.
Chybí druhá ověřená offline operator kopie a reviewer recovery test s oddělenou dešifrovací autoritou;
online zdroje se do splnění podmínek zachovají. Signed receipts13, demo9kroků+user approval otevřené.
[M6 WP](wp/WP-M6-RELEASE.md): aktuální24h soak/5min throughput/Gate0;193e2351 pouze historický PASS.

## Nejbližší pořadí dokončení a zbývající testy

1. Publikovat cache/evidence opravu; po CHAT provider-error fixu společný freeze a fresh5 znovu.
2. Po rozhodnutí CODE krok7 dokončit HTTP/Fan; větší reprezentativní repo, měření kontextu každého kroku.
3. Živý classifier→D1 (CPU 44+parser 24/review PASS), fyzické IDE/M2; file/web/export/skills a A→B→A.
4. Kvalita expertise/specialistů, worker souběh/delší stabilita; společný profil,24h/throughput/demo/M5/M6.
5. Mobil po stabilním IDE/BE: conversation.create chybí; historicalCPU 47,physical 13+7 NOT_RUN;
   device/APK/VPN/pair-revoke/M2/TalkBack. Pak bezpečný cleanup vlastněných zastaralých refs.
Hunt má cizího vlastníka; poslední RO5.10.01:26UTC596/1173 responses,2324/3689 criteria/107files.
Nový progresspath nedoložen; ROOT grading nepřebírá. Gemma9591ea1b poslední NO_GO, není aktuální aktivace.
Holdout odpečetěn operátorem; ROOT obsah nečetl. CHAT/Gemma ladí druhý worker.
Poslední cleanup census: 215 branches / 72 worktrees: foreign/UNKNOWN/evidence HOLD; žádný nový worktree.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/90c174893c5a61ae14cf1d6897f1eaf828063391/docs/WORK-PROGRESS.md).

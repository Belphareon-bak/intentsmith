# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 5. 10. 2026, 04:24 CEST / 02:24 UTC.
**Vlastník:** ROOT; ladění CHAT/Gemma a zbývající Hunt mají jiné workery.
**Release NOT_ACCEPTED. HTTP: physical oracle PASS / source API FAIL. Fan FAIL.**

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Zbývající omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → exact M2 → oracle → commit → restart, review PASS | Malé projekty; obecná spolehlivost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi dvěma procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expert-vs-general, souběh a delší stabilita |
| AST / GPU panel / Cleanup | AST review PASS, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence worktrees zachované |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite průchodu dokládá durable M2/zdroje, nikoli DB z dalšího nového sandboxu.

## Společná integrace a publikace

Merge 56138e4f zachoval CHAT e066956b / CODE32k/D1; preservation review PASS.
Celý profil **c412865c: 410 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT**, report 5b404646…00a2b;
[CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37244406326). Starší 399 PASS / 11 FAIL zachované.
Publikovaný **65ad7c05**, remote exact; [CI 18/18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37252045791).
CODE cap4096 pouze pro vydaný exact CODE32k; generic 8k / 2048 a schválený 4k / 1024 zachované.
Source review 9fe85d5c…3122e60 + focused 3/3 PASS; není to release nebo nový celý profil.
M6 metadata source 413917e2 / source review d66e6b2c…849455c + CPU 50/50 PASS; actual109 NOT_RUN.
Registry 596/35; module graph 1510 / 3 cykly / 28 členů. Studio bundle7bf62455…bfe24 beze změny.
Instalovaný BE c84b88cd se nezměnil; žádný deploy/model activation/mobile/CHAT tuning.
Externí c5309a0/bundle zde chybí; hlášené výsledky nejsou místně přijaté důkazy.

## HTTP — fyzický milník, přejímka otevřená

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2,
policy/SQL122/exactapproval/Studio/startup; offline V1 výchozí režim zachovaný.
Provider/kernel controls a cancel/timeout mají přijaté omezené fyzické důkazy.
Original helper-policy FAIL, recovery readiness FAIL a router length 2048 zůstávají.
První retained@3 skončil ROOT selector timeout 180 s; handoff 188,624 s, 0 nových calls, rollback 4/4.
Retry se stejným budget/API/oracle/modelem předal selector za 0,090089 s po skutečném FAILED.
Freeze 0b61ce58…d029; router/server input 29887/28282 B, output 736/1150 tokens, stop/complete.
Cumulative **8/8 CODE**, D1/CLI 0. Nový preview / wrong digest 409 / pending restart / exact approval
→ oracle → Git 1856920f → BE restart / durable replay bez duplicit skutečně proběhly.
**70 HTTP + 14 refused SQL / 14 positive + AUTOINCREMENT + 2 servers / same DB inode PASS.**
GPU 49 samples / 24 loaded 32k / full VRAM 17,399,734,598 B / min free 2430 MiB; periodické, ne continuous.
Independent combined review 895d651c…569e52: raw→compiler→preview→ DB → disk → Git 4/4 exact 26139 B;
58862 zdrojových hashů, 13 vlastních PID absent, unload/lease/proxy 0, rollback 4/4 ověřené.
Verdict **PHYSICAL_ORACLE_PASS_API_SOURCE_REVIEW_FAIL_NOT_ACCEPTED**.
Source review 87a4b8a5…af184: A1 slash aliases a A2 dynamic import blokují plné přijetí;
A3 quoted charset / OWS je kvalifikovaná mezera. Konkrétní HTTP varianty NOT_RUN.
[Přesný nepřijatý kandidát](../examples/generated-apps/http-items-candidate/README.md): 4 modules / 26139 B + frozen API 4446 B.
CPU nový normal CODE MODIFY router/server: 6 controls PASS, full inputs 30614/28594 B < 32000.
Skutečný změněný router se musí přeměřit; žádná truncation/projection/fake FAILED / DB transplant.
Navrhovaný nový cyklus 2 / cumulative 10 / no repair čeká na bounded review a konkrétní rozhodnutí;
rozpočet 8 je vyčerpaný, succeeded application není revisionOf FAILED. Žádná nová inference neběží.

## Fan — konkrétní otázka čeká

Frozen 5f6c3fb7: 4 historical + 4 new = 8/11, CLI/D1=0; čtvrtý repair length 2048.
Prompt 28629 B / 8981 tokens prošel; nový plan/efekt nevznikl. Oracle 8 PASS / 6 FAIL zachovaný.
Review 839ee340…35fa813: rollback/cleanup/source PASS; durable partial draft resume chybí.
Repair 4 + CLI 3 potřebuje cumulative 15; operátor dostal konkrétní otázku. Bez odpovědi inference 0.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).
Source 16384 / serializer 32000 / canonical GPU guard platí pro všechny nové běhy.

## M5/M6 — technický upgrade a operátor

Own offline cache 220/220 + Node24 ABI137 SQLite prebuild PASS; shared cache beze změny.
První actual109 FAIL 97,5 s / previous readiness: previous d3d čte C3_* ENV, nikoli moderní názvy.
Previous-only 13 aliases CPU 12/12 / review / CI PASS; retry 0be trval 7,918 s, cleanup/source PASS.
Previous canary/count 56, failed-upgrade + exact restore 56 a current API canary prošly; metadata FAIL.
Old d3d píše .c3/project.json; moderní readers jej nečetly. Final 109/inode NOT_REACHED.
Adoptovaná read-only kompatibilita + original raw/path/hash/devino oracle; source 413917e2 / CPU 50 PASS.
Pouze skutečná absence canonical dovolí legacy; neplatná canonical se neobchází. Bez rename/write/test-only fallback.
Po current publish/remote/CI/input freeze jediný actual109 ≤ 600 s + review; nyní **NOT_RUN**.
M5/M6 otevřené:8 unsigned podkladů / 13 signed receipts, rotace / N/A / history / key custody / demo.
Fresh install / backup-restore / 24h soak / throughput samostatné; 193e2351 PASS je historický.
[M6 WP](wp/WP-M6-RELEASE.md); žádný podpis ani operátorský úkon se nevyrábí.

## D1, Hunt, CHAT

Classifier→D1:44/44 CPU + parser 24 + review PASS; živý přirozený vstup není přijatý.
Hunt vlastní jiný worker; audit 5 Oct 01:26: 107 canonical files beze změny, 596/1173 responses / 2324/3689 criteria.
Nový worker/path není doložen; cílený dotaz čeká, ROOT cizígrading nepřebírá.
Gemma 9591ea1b / report d86baa27 NO_GO; není holdout acceptance.
Operátor odpečetil `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`; ROOT obsah nečetl.

## Zbývá dokončit a otestovat

Po CODE/API opravě: obecnější repo/context, skutečné ovládání IDE/M2, file/web/export/skills,
projekty A→B→A, kvalitativní expertise oracle, worker souběh; pak společný finální profil/M5/M6.
Mobil po stabilním IDE/BE: conversation.create chybí, historical CPU 47, physical 13+7 NOT_RUN;
device / signed APK / VPN origin / pair-revoke / restart / exact M2 / TalkBack čekají.
Cleanup 215 branches / 72 worktrees; foreign/UNKNOWN/evidence HOLD, žádný nový worktree.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/65ad7c054d2edc9e9316bc77c15f6b7b2fa5a370/docs/WORK-PROGRESS.md).

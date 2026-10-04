# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 4. 10. 2026, 21:46 UTC / 23:46 CEST.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
Report po milníku/do 3 h; operátorovi stav do 2 h aktivní práce.
**Release NOT_ACCEPTED; fan aplikace FAIL.**

## Přijatý základ

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Model → exact M2 → oracle → commit → restart, review PASS | Malé projekty, ne obecná spolehlivost CODE |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS, sedm modulů / 8 965 B, přesný export | n=1; DB mezi procesy v jednom sandboxu; BE restart ověřuje durable M2/zdroje |
| Packaged IDE Ledger | Šest generací, exact approval/oracle/commit/durable DB | DOM click; fyzická dostupnost tlačítek otevřená |
| M3 /Worker | Izolace/provenance; skutečný 5min worker/restart/čistý stop | Expert-vs-general, souběh a dlouhý soak otevřené |
| Scanner | Default M2 AST, evaluator34 / service103, nezávislé review PASS | Samostatná vada; není řešení kontextu |
| GPU UI /Cleanup | V7 readonly hodnoty/pointer přijaté; tři vlastní refs odstraněny | Hunt/model acceptance a cizí/evidence worktrees zůstávají |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md),
[24 modulů čtyř přijatých snapshotů](../examples/generated-apps/README.md).
Historické FAIL/oracle/rollbacky neměním; přijaté scénáře neopakuji bez důvodu.

## Společný kandidát a kontroly

Merge `56138e4f` převzal CHAT `e066956b` i vlastní CODE 32k/D1; preservation review PASS.
Projekt44/44, registry594/35, graph1500/3cykly/28 a provenance ratchet PASS.
Publikovaný **5f6c3fb7**: [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37235659894),
18/18 kroků; skutečné7/7 CHAT +7/7 CODE z official logs, remote SHA přesné.
Celý profil **769d4930**,20:04–20:14 UTC: **408 PASS/0 FAIL/0 BLOCKED/0 TIMEOUT/0 SKIP**,
report 934d9673…e65dd; produkt/testy/registry769→5f stejné, změněny jen2 helpers+5 docs.
Není to celý profil5f. První 404/1/3 (stale census/runtime paths) zachovaný b52ac733…a9b12.
Instalovaný BE `c84b88cd` je jiný release; tento proud jej nenasadil.
Externí `c5309a0`/bundle zde chybí; jeho hlášené výsledky nejsou lokálně přijaté důkazy.

## Nejbližší funkční milník: fan-monitor

Původní `b1f7146c`: actual pending restart/exact approval,8 PASS/6 FAIL, rollback4/4,
žádný app commit. Původní4 výstupy a celý FAILED packet zachované.
Operátor schválil4 původní +4 opravné +3 CLI = max11 CODE; D1=0, další retry zakázaný.
Continuation CPU 10/review 57d6ea9b…17978, actual Studio build a CI 5f PASS.
CODE 32k capture zachovaný; CHAT/D1, serializer32 000 B a output4096/2048 nezměněné.
Context18/gateway44/service104 CPU PASS. Skutečná krátká32k alokace19:10:
17.399 GB fullVRAM, minfree2512 MiB, owned cleanup PASS; není celý workload.
Dva app readiness STOP20:55/20:57 utratily0 volání. Explicitní opt-in ve5f po
CPU7/review8835de1e…524adfe:3 lease samples/free≥22000/empty compute+ps/identity/RAM/disk;
known desktop util record-only, default util30 zachovaný. Nový freezed9a32bca…ff79879.

**Actual 5f,21:26:34–21:27:48 UTC: FAIL před novým plánem.**
Tři repair výstupy byly zkompilované jen v paměti; čtvrtý pro `test/acceptance.test.mjs`
měl prompt28 629 B /8981 tokens, prošel kontextem, ale vyčerpal2048 output tokens
(`done_reason=length`). Produkt vrátilM2_CODE_DRAFT_OUTPUT_INCOMPLETE/HTTP502, bez retry.
Použito4 historical+4 new=8/11; CLI0. Oracle nových oprav se ještě nespustil.
Nezávislá classification review 839ee340…35fa813:33 M2 tabulek a7 targetů byte exact,
Gitclean/b51881b4, old1067 packet/oracle/policy zachované,0 nových plánů/efektů/commitů.
Owned Studio/BE/model/relay/lease cleanup PASS; result 09817197…46190.
Oddělený readonly observer b67a6b32…a7485 zachytil jen2 loaded samples:
context32768/full17.399GBVRAM/free2476 MiB; není celé časové měření workloadu.

**Blokér a rozhodnutí:** produkt neumí durable partial draft resume. Nový obyčejný
repair4+CLI3 znamená celkových15 volání; do zbývajících3 se nedá poctivě vejít.
Doporučen scoped CODE 32k repair output≤4096, nové CPU/review/CI/freeze a jeden průchod
max15, CLIrepair0. Varianta partial checkpoint potřebuje více kódu a nejméně12 calls.
Operátor dostal konkrétní otázku; bez odpovědi žádná další fan inference.
[CODE evidence/scope](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md),
[projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## Přirozené plánování, Hunt a CHAT

Classifier→D1 hranice je merged: activeM2 creative/inline shortcut vyžádá existující
semantic scope; conversation odpoví, project jdeD1, status read-only, nejasnost se doptá.
Default classifier→D1 CPU44/44, původní parser24 PASS, review ff2dcbe1…97b7b0.
Živý natural entry zůstává NOT_ACCEPTED; manuální fan sD1=0 ho nedokládá.
Hunt operátor předal jinému workerovi. Metadata audit20:54 UTC:106 batches stále
596/1173 responses a2324/3689 criteria, poslední canonical zápis30.9.; receipt 55b77073…f91fa9.
Identita/path nového workeru zatím nedoložené; cílený dotaz čeká, ROOT proces nepřebírá.
ROOT draft16/64/strict-IDFAIL zachované; finální známky/role nepřijaté.
Gemma fixed 9591ea1b ověřen; poslední report d86baa27 NO_GO není holdout acceptance.
Operátor odpečetil `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`.
ROOT obsah nečetl; tři série/slepé review provede CHAT worker, aktuální výsledek nedoložený.

## HTTP a zbývající přejímka produktu

[Autorizovaný HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): explicitprivate profile,
execution/lifecycle@2 a exact policy/payload/approval; V1 offline chování zachované.
Actual CPU namespace/nativeNode24 HTTP proof PASS; host unchanged/negatives/caps0/NNP/seccomp.
Historické EPERM/ip-path/AF_UNIX FAIL zachované. PureV2 schema35/review PASS.
Provider CPU9+abort2/review ecf835b3…3373f5 PASS; omezená SQL 122 proposal CPU9+legacy27+
2 fullstartup/reopen PASS, nezávislé SQLreview běží. ROOT compiler/composer/UI10 CPU PASS;
source review běží, planner/runtime před-first-write a trusted startup connector se připravují.
To vše zatím privátní. Produktový V2/DB-reopen/UI a generovaná HTTP app NOT_RUN.

Po CODE/HTTP: actual installed pointer/M2 UI, file/web/export/skills journeys,
projekty A→B→A, kvalitativní expertise oracle (keywords/length nestačí), worker souběh.
Pak společný finální profil, fresh install/upgrade/backup-restore a nový 24h soak/throughput.
M5/M6 otevřené:8 unsigned podkladů,13 signed receipts chybí; recovery/key custody/role/9krokové demo.
Mobil až po stabilním IDE/BE: conversation.create chybí, historical CPU 47; fyzická13+7 matice NOT_RUN.
Device/signedAPK/VPN origin/pair-revoke/restart/exactM2/TalkBack čekají.
Poslední cleanup: audit 215 branches/72 worktrees, cizí/UNKNOWN/evidence HOLD; žádný novýworktree.

[Archiv reportu před tímto milníkem](https://github.com/Belphareon-bak/intentsmith/blob/5f6c3fb7400367bf25e96e47e32e1ef0a12dca43/docs/WORK-PROGRESS.md).
Raw DB/prompty/provozní data jsou privátní; zveřejňuji vlastní zdroje a přesné souhrny.

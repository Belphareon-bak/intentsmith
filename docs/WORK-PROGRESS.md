# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 5. 10. 2026, 00:58 CEST / 4. 10. 22:58 UTC.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
Report po milníku/do 3 h; operátorovi stav do 2 h aktivní práce.
**Release NOT_ACCEPTED; fan aplikace FAIL; generated HTTP NOT_RUN.**

## Přijatý základ

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Model → exact M2 → oracle → commit → restart, review PASS | Malé projekty, ne obecná spolehlivost CODE |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS, 7 modulů /8 965 B, přesný export | n=1; DB mezi procesy v jednom sandboxu; BE restart ověřuje durable M2/zdroje |
| Packaged IDE Ledger | 6 generací, exact approval/oracle/commit/durable DB | DOM click; fyzická dostupnost tlačítek otevřená |
| M3 / Worker | Izolace/provenance; skutečný 5min worker/restart/čistý stop | Expert-vs-general, souběh a dlouhý soak otevřené |
| Scanner | Default M2 AST, evaluator34/service103, nezávislé review PASS | Samostatná vada, ne řešení kontextu |
| GPU UI / Cleanup | V7 readonly hodnoty/pointer přijaté;3 vlastní refs odstraněny | Hunt/model acceptance a cizí/evidence worktrees zůstávají |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
Historické FAIL/oracle/rollbacky neměním; přijaté scénáře neopakuji bez delty.

## Společný kandidát a kontroly

Merge 56138e4f převzal CHAT e066956b a vlastní CODE 32k/D1; preservation review PASS.
Poslední celý profil **769d4930**,20:04–20:14 UTC: **408 PASS/0 FAIL/0 BLOCKED/0 TIMEOUT/0 SKIP**,
report 934d9673…e65dd. První404/1/3 (census/runtime paths) zachovaný b52ac733…a9b12.
Publikovaný **f5304619**: [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37237595610).
HTTP source **e7ac78a8** je commitnutý; provenance pin1507/3/28 připravený.
Whole profile/remote CI čekají. V2 late-cleanup guard adoptován po controlled RED/GREEN/review PASS.
Instalovaný BE c84b88cd je jiný release; tento proud jej nenasadil.
Externí c5309a0/bundle zde chybí; hlášené výsledky nejsou lokálně přijaté důkazy.

## Fan: uzavřená diagnóza, konkrétní rozhodnutí čeká

Frozen 5f6c3fb7 běžel21:26:34–21:27:48 UTC: **FAIL před novým plánem**.
Použito 4 historical+4 new=8/11; CLI/D1=0. Tři opravy zůstaly jen v paměti.
Čtvrtý repair `test/acceptance.test.mjs`: prompt28 629 B/8981tokens prošel kontextem,
ale vyčerpal2048 output tokens (`done_reason=length`), M2_CODE_DRAFT_OUTPUT_INCOMPLETE/HTTP502.
Nezávislé review 839ee340…35fa813:33 M2 tabulek/7 targetů/oracle/old1067 packet beze změny,
0 nových plánů/efektů/commitů; oldoracle8 PASS/6 FAIL a rollback4/4 se nepřepisují.
Owned Studio/BE/model/relay/lease cleanup PASS; actualresult09817197…46190.
CODE 32k krátká alokace19:10:17.399 GB fullVRAM/minfree2512 MiB; není celý workload.
Observer b67a6b32…a7485 má jen2 loaded samples, context32768/fullVRAM/free2476 MiB.
Capture/serializer 32 000 B/initial 4096+repair2048/CHAT/D1 beze změny.
GPU explicit manual opt-in/review drží3cold lease samples/free≥22000/emptycompute+ps/identity;
known desktop util record-only, default util30 beze změny. Freeze d9a32bca…ff79879.

Produkt neumí durable partial draft resume. Nový repair4+CLI3 vyžaduje cumulative15,
ne zbývající3. Doporučen scoped CODE 32k repair≤4096 a jeden nový frozen max15 běh,
CLIrepair0, stejný oracle, nové CPU/review/CI. Partialcheckpoint stojí více kódu a≥12calls.
Operátor dostal konkrétní otázku; **bez odpovědi další fan inference neběží**.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## Aktivní HTTP milník

[Autorizovaný WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): execution/lifecycle@2,
plná policy/payload/SQL122/preflight/exactapproval/Studio a explicitní startup config.
V1 wire/078/079/106/default offline zachované. Šest bounded source reviews PASS;
public adoption 20 source pins/review 5599f163…39b9. Žádná model activation/deploy.
Actual veřejný provider 22:11 UTC: bwrap/Python relay/HTTP/kernel negatives/cleanup PASS,
Landlock8/caps0/NNP1/seccomp2;19members verified, result d64900ca…254c.
Controlled fixture, nikoli generovaná app/M2 commit. Physical cancel/timeout 2/2 PASS:
1.14s/4.62s, PGID/PIDs empty, host unchanged; review b96326b7…80d34b PASS.
Namespace TERM teardown; trusted host IPC není egress, samostatný KILL nedoložen.
Private CPU: contracts35, provider9+abort2, SQL9+legacy27+startup2, runtime23,
compiler/composer11, startup6+independent bounded-read4. Původní FAIL zachované.
Public targeted 13 PASS/1 actual-model GPU BLOCKED; následně service 107/Studio 28 ve 2/2 sadách PASS.
Browser fixtures: 4 canonicalV1 version annotations, původní assertions zachované.
Registry 596/35; graph 1507/3cykly/28,7 nutných SQL/config hran připnuto ke skutečnému e7ac78a8.
Skutečný Studio production/consumer build PASS; bundle 7bf62455…bfe24.
CI zachovává CHAT 7 a rozšiřuje CODE na 11 včetně úklidu; whole profile/currentCI čekají.
Late-cleanup: oldV2 false success → typed failure; V1 zachováno, review 01a9afff…c1963.
Nová HTTP/SQLite příprava: 4 moduly, initial 4+jediný fullrepair 4/max 8 CODE,D1=0;
API/oracle CPU připraveny; model/source/baseline freeze a actual app čekají. Žádná authored app přejímka.
Následuje CODE → Studio preview → exact M2 → actual HTTP/SQLite oracle → commit → restart/review.

## D1, Hunt a CHAT

Default classifier→D1 hranice merged:44/44 CPU, parser24, review ff2dcbe1…97b7b0.
Conversation odpoví/project jdeD1/status RO/nejasnost se doptá. Live natural entry nepřijatý.
Hunt vlastní jiný worker; poslední metadata audit20:54 UTC:106batches,596/1173responses,
2324/3689criteria; poslední canonical write30.9.; receipt 55b77073…f91fa9.
Identita/path nového workeru nedoložené; cílený dotaz čeká, ROOT proces nepřebírá.
ROOT16/64/strict-IDFAIL draft není acceptedgrading. Gemmafixed 9591ea1b ověřen;
poslední report d86baa27 NO_GO neznamená holdout acceptance. Operátor odpečetil
`/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`; ROOT obsah nečetl.
Tři série a blindreview mají CHATworker; aktuální výsledek zde nedoložený.

## Zbývající dokončení a přejímka

Obecnější repo/context průchod; actualinstalledpointer/M2 UI; file/web/export/skills,
projekty A→B→A, kvalitativní expertise oracle, worker souběh a delší stabilita.
Pak final společný profil, freshinstall/upgrade/backup-restore, nový24h soak/throughput.
M5/M6 otevřené:8 unsigned podkladů,13 signed receipts chybí; recovery/key custody/role/9krokové demo.
Mobil po stabilním IDE/BE: conversation.create chybí, historicalCPU 47; physical 13+7 NOT_RUN.
Device/signedAPK/VPN origin/pair-revoke/restart/exactM2/TalkBack čekají.
Poslední cleanup:215 branches/72 worktrees, foreign/UNKNOWN/evidence HOLD; žádný nový worktree.

[Archiv před HTTP adopcí](https://github.com/Belphareon-bak/intentsmith/blob/f530461918ce961f6ae2224f6aa062ef22e4bb51/docs/WORK-PROGRESS.md).
RawDB/prompty/provozní data jsou privátní; publikuji vlastní zdroje a přesné souhrny.

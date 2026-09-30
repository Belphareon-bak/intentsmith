# WP — produkční worker: trvalý HTTP průchod

**Stav:** implementační kandidát s omezeným nezávislým `REVIEW_PASS` a
integrovaným HTTP/SQLite během **6/6**. Produktový scénář přes skutečný
`src/server.js` v produkčním autentizačním režimu má po opravě filtru
notifikací omezené nezávislé `REVIEW_PASS` a integrovaný registrovaný běh
**1/1** na `8134a613`. Širší provozní přejímka zůstává otevřená.

**Autorita:** výslovné zadání operátora z 2026-09-30 ověřit skutečné průchody
chatem, specialisty, expertizami a workery. Tento ohraničený přírůstek patří
workerům. Vychází z integrovaného commitu `f686c298aaef4bafe02db53e188dc3f6c7e083db`
ve vlastním worktree `/home/belphareon/Projects/intentsmith-chat-worker-journey-20260930`.

**Uživatelsky pozorovatelné chování:** nainstalovaný nativní Project Health
worker po zapnutí založí výchozí stav, při nezměněném projektu neposílá další
notifikaci a při změně souboru vytvoří jednu notifikaci s projektovým
původem. Druhý projekt má svůj vlastní stav a notifikace. Zakázaný worker
nespustí zdroj a chybující zdroj skončí trvalým terminálním výsledkem.
Stav po zavření a novém otevření SQLite, služeb a HTTP listeneru zůstane zachován.

**Call graph a hranice:** `createAgentPlatformRoutes` obslouží vlastněný
loopback HTTP server; volá `AgentExtensionService`, který přes
`AgentScheduler.triggerAgent` spustí `AgentRunner`. Runner ověří vazbu manifestu,
čte M2 `ProjectContext` přes jednorázovou projektově vázanou capability a
zapisuje do skutečného `AgentRepository` na soukromé SQLite DB. Test používá
originální manifest `agent-extensions/project-health/agent.json`. Kontrolovaný
provider čte jen soukromé soubory dvou projektů a odvozuje stabilní revision,
snapshot a content digest. Produkční provider, celý `src/server.js`, autentizace,
Studio UI, model a plánované časovače nejsou součástí tohoto důkazu.

**Vlastnictví:** `tests/m3-agent-http-durable-journey.test.js`, nový řádek
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md`, malá
volitelná injekce hodin v `src/agents/runner.js` a tento WP. Hodiny mají v
produkci výchozí skutečný čas. SQLite metadata `CURRENT_TIMESTAMP` zůstávají
skutečným časem; test kontroluje řízený čas v `explain`, stavu a triggerech.

**Scénáře:** HTTP discovery/preview/install; disabled bez DB běhu nebo zdroje;
enabled baseline; opakovaný unchanged bez notifikace; změna souboru a přesná
provenance; opakování beze změny; nezávislý druhý projekt; zavření a nové
otevření DB, služby a HTTP listeneru; disabled po znovuotevření; kontrolovaná chyba
providera s terminálním `ERROR_SOURCE`; zotavení a následná změna.

**Příkaz:**

```sh
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/m3-agent-http-durable-journey.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/validate-test-registry.js
```

Test vyžaduje Node 24, protože dostupný `better-sqlite3` native modul je
sestavený pro jeho ABI. Poslední lokální běh: 6/6 PASS, 2026-09-30, pod jednou
sekundou. Integrovaný commit `0939a564` byl na společném zdroji znovu ověřen:
HTTP scénáře **6/6**, runner **22/22**, Project Health **10/10**. Registry
`lastGreen` zůstává `null`: lokální běh není přejímka z čerstvého klonu.

## Navazující plný serverový kandidát

`tests/m3-agent-product-http-journey.test.js` spouští skutečný produktový
`src/server.js` nad vlastní DB, projektem, lokálním tripwire providerem a
náhodným admin tokenem s `NODE_ENV=production`. Neautentizovaný přístup ke
katalogu extension je odmítnutý; vlastněná lokální capability dovolí discovery,
preview, instalaci a ruční spuštění Project Health. Běžící `AgentScheduler`
vlastní instanci, ale dodaný manifest má rozvrh `manual`: časovaný běh tento
test netvrdí. Test ověří disabled stav, výchozí baseline, opakovaný běh bez
triggeru, potom změnu vlastního projektového souboru a `SUCCESS_TRIGGERED`
přes tentýž produktový HTTP vstup. Skutečný M2 ProjectContext provider vrátí
novou revision, digest a cestu změněného souboru; nativní M3 runner zapíše jednu
in-app notifikaci se stejnou revision a `runId`. Další nezměněný běh ji
nezdvojí. Dočasně nedostupný kořen projektu vede přes M2 bridge k typovanému
`ERROR_SOURCE`, bez druhé notifikace. Po restartu `src/server.js` přetrvají
trusted extension vazba, notifikace i oba terminální běhy. Tripwire potvrzuje
nulové modelové volání. Přímý test této navazující větve prošel **1/1**;
první nezávislé review kandidáta `eac10968` našlo nefunkční filtr
`GET /api/notifications?agent=…`: produktový HTTP adaptér parametr nepředával.
Negativní kontrola s neznámým agentem na původním zdroji skutečně selhala.
Oprava `bbef732f` předává parametr do existujícího API a stejný test prošel
přímo i registrovaně **1/1**. Přesný čistý report je
`.intentsmith-artifacts/run-suites/2026-09-30T20-59-01-528Z/report.json`
(`sourceRevision=bbef732f500fe761cac6fb02ad22e90dadcbed6d`,
`gateEvidence:false`). Opakované nezávislé review skončilo omezeným
`REVIEW_PASS`; na integrovaném `8134a613` prošel registrovaný běh **1/1**
(`.intentsmith-artifacts/run-suites/2026-09-30T21-01-42-294Z/report.json`,
`gateEvidence:false`).

Přímý i registrovaný běh na Node 24 prošel **1/1** pro původní kandidát
`b81c84d8`; jeho registrovaný report je
`.intentsmith-artifacts/run-suites/2026-09-30T20-40-12-053Z/report.json`
a výslovně není Gate 0 evidence. Nezávislé review našlo nepřesný auth assert,
nadhodnocený důkaz v artefaktu a slabší úklid při chybě; opravy v kandidátu
`fbdb2f74` následně dostaly omezený `REVIEW_PASS` a registrovaný běh **1/1**.

**Navazující plánovaný průchod:** izolovaný produktový scénář
`IS-T3-TESTS-M3-AGENT-SCHEDULED-PRODUCT-JOURNEY-TEST` po omezeném nezávislém
review ověřil automatický baseline a dohnání intervalu po restartu,
perzistentní notifikaci a odmítnutí nedůvěryhodné splatné instance.
Na integračním `9f07fe7b` prošel registrovaně společně s plánovačem a
produkčním ručním scénářem **3/3**; report je
`.intentsmith-artifacts/run-suites/2026-09-30T23-02-42-513Z/report.json`
(`gateEvidence:false`). Testovací interval vzniká posunem posledního běhu
v zastavené soukromé DB při `NODE_ENV=test`; autentizace baleného ručního
manifestu se ověřuje samostatně v `NODE_ENV=production`. Nativní manifest
zůstává ruční. Skutečné pětiminutové čekání, cron, přerušení právě
rozpracovaného běhu, fyzická Studio interakce, live model a dlouhodobý soak
nadále nejsou ověřeny tímto důkazem.

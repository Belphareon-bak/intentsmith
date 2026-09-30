# WP — produkční worker: trvalý HTTP průchod

**Stav:** implementační kandidát s omezeným nezávislým `REVIEW_PASS` a
integrovaným HTTP/SQLite během **6/6**. Nový samostatný kandidát testuje i
skutečný `src/server.js` v produkčním autentizačním režimu; jeho nezávislé
review a integrační přejímka ještě chybějí. Širší provozní přejímka zůstává otevřená.

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
`src/server.js` nad vlastní DB, projektem, lokálním providerem a náhodným
admin tokenem s `NODE_ENV=production`. Neautentizovaný přístup ke katalogu
extension je odmítnutý, vlastněná lokální capability dovolí discovery,
preview, instalaci a ruční spuštění Project Health. Test ověří disabled stav,
výchozí baseline, opakovaný běh bez triggeru a zachování baseline i trusted
extension vazby po ukončení a opětovném spuštění produktu. Tripwire provider
potvrzuje nulové modelové volání. Přímý i registrovaný běh na Node 24 prošel
**1/1** pro původní kandidát `b81c84d8`; jeho registrovaný report je
`.intentsmith-artifacts/run-suites/2026-09-30T20-40-12-053Z/report.json`
a výslovně není Gate 0 evidence. Nezávislé review našlo nepřesný auth assert,
nadhodnocený důkaz v artefaktu a slabší úklid při chybě; opravy jsou v tomto
kandidátu a čekají na opakované review.

**Další důkaz:** změna zdroje a notifikace přes plný serverový vstup se
skutečným M2 providerem, provozní interval/cron worker a restart uprostřed
rozpracovaného běhu. Současný nový test ověřuje vlastní serverový vstup, ale
zbytek těchto bodů nepovyšuje na PASS. Live model ani dlouhodobý soak tento WP
neověřuje.

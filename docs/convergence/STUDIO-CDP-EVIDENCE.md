# Studio CDP evidence contract

**Stav:** implementovaný reducer a registrovaný `BLOCKED` runtime runner;
skutečný fresh-clone běh ještě není acceptance evidence

**Scope:** `WP-M0-E`, capability `C3-001`

Tento kontrakt ověřuje pouze stabilní funkční hranici dnešního C3 Studia. UI,
které runner otevře, není finální podoba IntentSmithu. Text, layout, CSS,
selektory, screenshoty ani vizuální podobnost proto nejsou součástí verdiktu.

## Co reducer dokládá

`scripts/studio-cdp-evidence.js` zpracovává pouze události `Network.*` a ve
schématu 2 odděluje C3 backend od Theia control-plane:

- skutečné wire hlavičky z `requestWillBeSentExtraInfo`, nikoliv pouze
  rendererový pohled z `requestWillBeSent`;
- opaque-origin HTTP boundary, local capability, CORS odpověď a status;
- přesný `/c3/ws` handshake, aplikační protokol a životnost rámců;
- přesný, z validovaného `file:` targetu odvozený Theia `/socket.io/` polling
  a jediný živý WebSocket, bez uložení jeho portu, query nebo session ID;
- nulový pokus o externí nebo neočekávaný loopback cíl.

Chybějící `ExtraInfo`, duplicitní evidence, redirect, neukončený request,
neznámý backend path, odmítnutí boundary nebo překročení kapacity jsou červený
výsledek. `/api/media/history` smí mít `404` pouze v explicitním režimu bez
ComfyUI; ostatní povinné HTTP cesty musí skončit `2xx`. Theia transport přijme
jen Engine.IO 4 polling s přesnou fází query a jeden nereconnectovaný WS upgrade;
obecný `localhost` allowlist nevzniká.

## Privacy boundary

Snapshot neobsahuje request ID, URL, origin/hostname, port, query, fragment,
userinfo, hlavičky, capability hodnotu, cookies, authorization, request/response
body, WS payload, error text, renderer location, filesystem path, timestamp ani
debug port. Dynamické cesty se redukují na pevné route identifikátory a neznámé
vstupy na pevné enumy. Capability se porovnává constant-time a ven jde jen
`match`, `mismatch`, `missing`, `duplicate` nebo `invalid`.

Tento checkpoint je testován v
`tests/studio-cdp-evidence.test.js`, včetně obráceného pořadí CDP událostí,
wire/base konfliktů, negativních HTTP/WS variant, limitu záznamů a redakčních
canary hodnot.

## Runtime runner

`tests/studio-electron-boundary.e2e.js` je záměrně ne-vizuální. Přes CDP čte
jen `Network.*` a přes renderer volá existující transportní konektory `C3WS`
a `C3Bus`. Chat odesílá přes obecné `C3WS.send('chat', ...)`; nečte ani nemění
specializovaný UI helper `sendChat` ani privátní `_c3`, session model nebo stav
komponent. Readiness ověřuje tentýž obecný `C3WS.send`. Nečte DOM, selektory,
screenshoty, layout, CSS ani text ovládacích prvků. Současné UI tedy slouží
pouze jako dočasný nosič skutečného Electron transportu; test nevytváří
kontrakt pro finální UI IntentSmithu.

Runner používá privátní runtime root, nový user/network namespace s pouze
loopbackem a přesně scoped X11 přístup. Backend nedostává X11 proměnné. Chromium
si přidělí debug port samo a runner přijme jen přesný built Studio file target.
Ignorované build artefakty jsou v evidenci zachyceny čtyřmi SHA-256 otisky;
jejich vazbu ke zdroji ale musí dodat fresh-clone install/build envelope.
Identita HEAD a čistota zdrojového stromu se kontrolují před i po journey.
Z validovaného `file:` targetu se odvodí přesná, do evidence neukládaná Theia
autorita. Jen její striktní `/socket.io/` control-plane transport je oddělen od
C3 backendu; jiný loopback cíl zůstává fail-closed.

Funkční WS probe vytvoří vlastní konverzaci a požaduje korelovanou sekvenci
`turn_start -> právě jeden conversation route event -> právě jedna aritmeticky
správná assistant odpověď -> turn_end(ok) -> idle`. Legacy event pojmenovaný
`cre_decision` dnes publikuje mode detection (`conversation`), nikoli finální
CRE intent (`LOCAL`); runner z něj proto netvrdí neexistující údaj ani neparsuje
interní text `system_step` jako veřejný kontrakt. Determinismus dokládá přesný
výsledek, nulový počet skutečně přijatých requestů suite-owned model-provider
sentinel během turnu a nulové LLM/tool/edit efekty. Samotná absence `llm_*`
událostí nestačí. Další route event, tool/effect event nebo error výsledek
zneplatní. Oddělený monitor se instaluje až po transport-ready a od
tohoto bodu zůstává aktivní plných nejméně 65 sekund; boot a celková síťová
capture doba se evidují odděleně.

Jediný soubor určený pro review nebo evidence packet je sanitizovaný
`studio-electron-boundary.json`. Privátní runtime root obsahuje testovací DB,
Electron profil, `DevToolsActivePort` a surové logy; jsou pouze diagnostické,
nesmějí se commitnout ani přenášet jako review evidence a po vyhodnocení se
odstraní spolu s vlastněným artifact rootem.

Procesní cleanup potvrzuje exity a prázdnost audit-owned process group.
Netvrdí ochranu proti potomkovi, který by úmyslně unikl přes novou session
(`setsid()`); tvrdší důkaz by vyžadoval PID namespace nebo suite-owned cgroup.

## Co ještě chybí

Samotná existence runneru netvrdí `C3-001 PASS`. Je vedený jako `BLOCKED`, dokud
fresh-clone envelope před jeho aktivací nedodá instalaci a produkční build a
neproběhne tento kontrakt. Build je prerekvizitou envelope, nikoliv stavem,
který si runner smí vyrobit během měření:

1. pořídí snapshot až po minimálně 65 sekundách živého spojení;
2. doloží sedm startup route rodin, skutečný `POST /api/settings` a WS provoz;
3. provede oddělený negativní trojúhelník boundary;
4. ukončí Electron i backend s `code=0`, `signal=null`, bez `SIGKILL`;
5. uloží pouze snapshot podle tohoto kontraktu a sanitizované procesní exity.

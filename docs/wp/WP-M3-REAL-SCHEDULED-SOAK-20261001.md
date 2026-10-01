# WP — M3 worker: skutečný pětiminutový interval

**Stav 1. 10. 2026:** samostatný testovací kandidát od čistého integračního
zdroje 365ed33946c7e7aab1564b3e4a5b4a459cf34739. Skutečný pětiminutový
běh je PENDING_RUN; dokud neskončí, nelze tvrdit PASS ani uzavření této mezery.
Nezávislé review, integrace, instalovaný backend a Studio zůstávají oddělené.

**Autorita:** explicitní zadání operátora dokončit reálné chatové a worker
průchody po milnících; PRODUCT.md §3 vyžaduje jeden skutečný agent E2E s interní
notifikací. Dosavadní plánovaný HTTP/SQLite průchod posouval poslední běh o
deset minut v testovací DB a výslovně neměřil skutečné čekání. Již opravený
crash/replay scénář ověřuje jinou hranici.

## Vlastněný výstup

- Nová sada tests/m3-agent-real-scheduled-soak.test.js, její jediný přidaný
  záznam v tests/registry.json a generovaný docs/convergence/TEST-REGISTRY.md.
- Tento WP, aktuální počty v README.md, ROADMAP.md a SYSTEM-MAP.md.
- Žádná změna produktu, instalované DB, nativního Project Health manifestu,
  GPU, Ollamy ani cizího worktree.

Test má vlastní produktový child src/server.js, privátní SQLite a projekt.
Testovací kopie důvěryhodného manifestu má interval přesně 5m; produkční
manifest zůstává ruční. Tento extension root může produkt přijmout pouze v
izolovaném režimu NODE_ENV=test. Lokální loopback provider odpovídá jen na
GET /api/tags a POST /api/show pro přesný fixture model. Každou jinou
metodu/cestu odmítne a započítá; generativní volání počítá zvlášť.

Pozitivní cesta přes produktové HTTP API vytvoří projekt a instanci, zapne
scheduler a bez posunu hodin nebo DB čeká na automatický INIT_BASELINE. Ze
skutečně uloženého next_run a začátku baseline běhu ověří pětiminutový
interval s nejvýše dvousekundovou přesností SQLite timestampu. Zkontroluje
také persistovaný last_run, změní vlastní soubor a během reálného čekání kontroluje,
že před splatností není nový run ani notifikace. Do jedné 30sekundové
kontrolní periody plus 15 sekund musí vzniknout přesně jeden terminální
SUCCESS_TRIGGERED s přesnou ProjectContext revizí a SHA-256 změněného
souboru; jediná notifikace musí nést stejnou revizi a run ID. Doplňkový
ruční průchod beze změny musí být SUCCESS_NO_TRIGGER bez nové notifikace.
Restart vlastního produktu musí zachovat přesně tři známá run ID (baseline,
plánovaný trigger a ruční no-trigger), jedinou notifikaci a budoucí uložený
next_run.

Negativní hranice: předčasný běh, duplicitní run/notifikace, špatná revize,
ztráta nebo nový run po restartu, libovolný neočekávaný provider request,
mrtvý child nebo posun systémového času
vedou k selhání. Artefakt se stavem PASS vznikne až po čistém ukončení
obou produktových procesů i loopback provideru. Helper pro shutdown sám
neověřuje dříve ukončený child, proto test explicitně požaduje code 0 a žádný
signál i na této cestě. Test na začátku, před výsledkem a po shutdownu
ověřuje skutečný čistý Git HEAD; auditní source env se s ním musí shodovat.
Odděleně měří monotónní čas do uložené splatnosti, prvního zjištěného runu
a notifikace; ruční běh a restart do těchto intervalů nevstupují. Artefakt
zapisuje přesné source SHA, PID, uloženou splatnost a skutečná ID.

## Ověření

Po dokončení současného integračního offline profilu spustit fyzický běh
v tomto samostatném worktree s Node 24:

    KEEP_TEST_RUNTIME=1 /home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/m3-agent-real-scheduled-soak.test.js

Na čistém commitu zopakovat registrovaně:

    PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH /home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/nightly-audit.js --suite=IS-T5-TESTS-M3-AGENT-REAL-SCHEDULED-SOAK-TEST

Sada má profil soak, potřebuje pouze vlastní loopback a privátní DB;
ollama/gpu/server jsou false. Timeout 450 sekund zahrnuje nejvýše 30 sekund
na první scheduler tick, skutečných pět minut, další tick, kontrolu a restart.
Čistý kandidát, soukromý artefakt a případné nezávislé review jsou samostatné
od release Gate 0. Před fyzickým během jsou povolené jen syntax, registry,
artifact-validation a další krátké nečasové kontroly.

Přípravné kontroly na necommitnutém kandidátu: syntax nové sady PASS,
registry 584 programů s fingerprintem
2100d02b050872bfaa542f03cfa244bf919f7e1dac917094555dfe01e2bace3b,
artifact-validation 160/160, dosavadní řízená plánovaná produktová cesta
1/1 a scheduler 6/6. Dry-run nového registrovaného ID vybral jednu soak sadu
a nemá deklarovaný blocker. První pokus o krátké Node testy v novém worktree
selhal infrastrukturně na chybějícím better-sqlite3; po připojení ignorovaného
node_modules z integračního worktree prošly. Nový pětiminutový test stále
PENDING_RUN; přípravné kontroly jeho chování nepotvrzují.

Křížové review prvního kandidáta 0c353c81 vyžádalo přesnou množinu run ID,
budoucí plán po restartu a zachycení všech nečekaných provider requestů.
Navazující kandidát tyto aserce doplnil; samostatný krátký HTTP negativní
test tripwire prošel 1/1 bez modelu. Opakované nezávislé review a fyzický
pětiminutový běh zůstávají otevřené.

Další křížové review `fab91621` našlo neověřený dřívější exit v pomocném
shutdownu, důvěru v libovolné source env a interval zahrnující následný
ruční běh i restart. Tento follow-up doplnil explicitní exit kontrolu,
její krátký negativní test pro dřívější chybový exit a signál, clean HEAD
shodu a oddělené monotónní metriky. Tato oprava ještě nedokládá
skutečný pětiminutový výsledek.

Tento důkaz pokrývá jednu plánovanou instanci. Neměří výkon velkého počtu
instancí, 24hodinový provoz, fyzické Studio ani instalovaný produkt.

Omezené nezávislé review čistého `d5cd2018` přijalo návrh a
krátké kontrolní průchody. Tři kandidátní commity byly integrovány
do čistého `a199a5d1`, ale fyzický pětiminutový běh stále chybí.
Integrační offline/database profil na tomto SHA dal **400 PASS /
2 FAIL**: oba červené M6 kontraktní testy správně odhalily, že
novou povinnou soak sadu ještě neuvádějí mezi programy release
plánu; účetní deterministický HTTP test navíc zvýšil počet
model/server sad. Následná red-first oprava explicitních
očekávání v obou M6 testech má přímé **21/21** a **8/8 PASS**.
Úplný profil po této opravě a skutečné pětiminutové čekání jsou
samostatné zbývající brány.

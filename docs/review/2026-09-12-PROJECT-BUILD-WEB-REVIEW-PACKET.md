# Projektový blueprint a konverzační web — review 2026-09-12

Stav: `IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED / PHYSICAL_MODEL_JOURNEY_UNPROVEN / ACCEPTANCE_BLOCKED`.
Rozsah produktu určuje PRODUCT.md, existující M2 autorita a Decision 044.
Tento packet je předání implementace a důkazů, není operátorské acceptance.

## Přesné dva revizní rozsahy

Builder: `0211fde97ee5f2ab79278720f4487a50e8c35a13..877a3005f247af9a95f7c716897502a38b8088f1`.

```bash
git diff 0211fde9..877a3005 -- \
  src/lifecycle/m2-code-draft.js src/lifecycle/m2-lifecycle-application-service.js \
  src/routes/m2-lifecycle.js c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js \
  tests/m2-lifecycle-application-service.test.js tests/m2-lifecycle-studio-surface.test.js \
  tests/m2-lifecycle-routes.test.js tests/m2-lifecycle-http-e2e.test.js \
  tests/m2-effect-broker-v1.test.js tests/m2-lifecycle-authority-repository.test.js \
  docs/PROJECT-BUILD.md docs/wp/WP-PROJECT-BUILD-WEB-20260912.md
```

Povinné nezměněné okolí: `src/lifecycle/m2-proposal-compiler.js`,
`src/execution/project-change-planner.js`, `src/execution/project-change-runtime.js`,
`src/executor/project-path-authority.js`, M2 execution/lifecycle/governance kontrakty,
produkční autentizace/server a `src/chat/handlers/build-handoff.js`.

Web: **`983121eece58b8522f736d4c8bc7c7e0ea4f657a..877a3005f247af9a95f7c716897502a38b8088f1`**.
Použijte celý path filter a call graph ze
[samostatného webového packetu](2026-09-11-CONVERSATION-WEB-REVIEW-PACKET.md),
změňte koncový pin na `877a3005` a přidejte `tests/fixtures/conversation-web/`.
Samotná delta tohoto běhu neobsahuje zavedení webu; review jen posledního
commitu by znovu vynechalo síťový egress. Od `dbe6630a` se produkční webové
soubory nezměnily, nové jsou runtime testy a inertní lokální TLS fixtures.

## Co uživateli přibylo

`/m2-build <JSON>` přijme výslovný seznam souborů s jednotlivými zadáními,
závislostmi a pevným autorovým testem. Model dodává pouze `afterContent`.
Generování proběhne podle závislostí, efektový plán zůstává kanonicky seřazený.
Studio ukáže celý before/after materiál a test, uloží jediný přesný plan digest
a čeká na `/m2-approve`. Stejný M2 runtime provede změny, sandboxový test,
případný přesný Git commit a rollback. [Použitelný příklad](../PROJECT-BUILD.md).

Přímé dependencies jsou do promptu vloženy celé jako navržená data. Cyklus,
neznámá závislost, duplicita, neplatné cesty, chybějící test a nepodporovaný
parent se odmítnou před prvním modelovým voláním. Prvotní prompty mají společný
preflight, během generace se znovu měří skutečné dependency after-images.
Přetečení, cancel, neúplný výstup a stale workspace nevytvoří dílčí plán.

Maximálně existujících 32 M2 cílů; původní soubor do 1600 B, zadání do 512 B,
každé souborové zadání do 512 B, celý prompt 2200 B, afterContent do 8192 B,
modelový limit 1536 output tokenů/call a 120 s na celou operaci. Není to
záruka zvládnutí 32 souborů libovolným modelem. Cílové adresáře i M2 governance
musí existovat. Model nevybírá test, Git identity, cesty ani schválení.
Přítomnost focusedTest není důkaz dostatečných assertions, ty posuzuje autor/reviewer.

## Nálezy kontrol a jejich opravy

- Původní Studio splitter spojoval whitespace uvnitř JSON: `'a  b'` měnil na
  `'a b'`. Dispatcher nyní předává raw suffix; skutečný chat entry ve VM
  ověřuje `/m2-plan` i `/m2-build`, víceřádkový JSON a přesné testové argv.
- Nový dependency cycle původně propadl do generické HTTP 500. Reprodukce
  `routes-02.log` zůstává; explicitní typed 400 prošla routes i skutečným HTTP.
- Přijaté M2 efekty nevytvářejí adresáře. Nový preflight odmítá chybějící parent
  i parent, který je souborem, ještě před inferencí. Nebyl přidán mkdir bypass.

Read-only spolupracující kontrola našla poslední dva body; root je opravil
a ověřil. Následné dva úplné běhy odhalily opakovaný timeout při přípravě
persistentních testových schémat. Izolované měření na shodném schématu:
broker 9 338–28 928 ms bez grouping vs 47–95 ms s grouping; lifecycle authority
7 551 ms vs 82 ms. `877a3005` obaluje pouze přípravu prázdného schématu
transakcí, kterou ukončí před vlastními testovanými zápisy. Všechna dosavadní
SQL volání a assertions, režim `synchronous=FULL`, `foreign_keys=ON`,
`journal_mode=DELETE`,
reopen okna i původní 30s limity zůstávají. Read-only kontrola prověřila všech
18 přímo volaných migrací (opakující se započteny) a dva podmíněné repair
callee; migrátor produkce už používá transakce. Je to oprava přípravy testů,
ne změna produktového brokera nebo tvrzení o vyřešení hostitelského I/O.
Setup benchmarky načítaly helpery z tehdy nezměněného `d09c9998`; pro jejich
reprodukci musí cwd poskytovat právě tento testový source.

Tato spolupracující kontrola není požadované nezávislé Claude Opus `--effort max` review.

## Důkazy a jejich skutečné hranice

Runtime implementace, HTTP a Electron jsou připnuté na `d09c9998`; následný
`877a3005` mění jen setup dvou testových fixtures, WP a census. Finální celý
deterministic profil běží na `877a3005`. Přesné reporty,
počty, zachované neúspěchy a hashe viz
[run record](../execution/runs/project-build-web-20260912.md).

- Service: šest modulů evidence výdajů, pořadí generace opačné ke kanonickému
  pořadí, skutečné behavioral assertions přes entrypoint a přesný Git commit.
  Chybný první dependency modul i chybný poslední entrypoint vrátí všech šest
  cílů. Nový Node proces znovu otevře SQLite a ověří stejný terminál, jeden
  durable výsledek a žádnou novou generaci. Je to restart po dokončení,
  nikoli pád uprostřed efektu. Modelové odpovědi jsou řízená testovací data.
- Studio VM: skutečný dispatcher, přesné JSON/argv, kompletní náhled,
  žádné automatické approval a zrušení draftu. Transport/odpovědi jsou fixture.
- Skutečný server: neplatné blueprinty odmítne před inferencí; existing
  prepare/approve/test/Git/durable status projde. Kladná modelová generace
  není součástí tohoto HTTP běhu.
- Web: skutečné TLS odmítnutí nedůvěryhodného certifikátu i nesouladu hostname,
  kladné přesné bytes, přerušené tělo po přijetí dat bez retry a revokace při
  DNS před TCP. DNS a adresování socketu jsou explicitně mapované na loopback;
  nejde o veřejný HTTPS důkaz. Dva skutečné SQLite procesy soupeří o jeden
  claim, pouze vítěz jej uzavře. SQLite_BUSY poraženého je odmítnutí, ne úspěch.
- Web display testuje quoting/fence, omezený výřez a raw bytes při neplatném
  UTF-8. Není to hostile-web browser render ani zkouška modelové prompt injection.
- Build a oba Electron programy zkoušejí Studio boundary a řízenou M1
  konverzaci. Samostatné výsledky netvoří jeden Studio→server→model journey.

## Co zůstává před produkčním dokončením

Běžný free-text SPEC→BUILD stále končí na M2 authority handoff. Připravený
souborový blueprint nezavírá automatické plánování celého projektu, onboarding
nového adresářového stromu ani fyzickou kvalitu modelového výsledku.

Ještě je potřeba jeden skutečně spojený Studio/backend/durable model binding/
inference/approval/test/restart scénář a nezávislé review obou uvedených rozsahů.
GPU hunt vlastní operátor; v tomto běhu žádná inference, pull nebo aktivace modelu.

Cizí hunt checkout se během práce posunul z `fe064ee8` na `dbf1abfc` (při druhém
pozorování čistý). Není integrován. Naše migrace 111 `conversation_web` koliduje
s jeho 111 `model_hunt_provider_identity`; 112 už má `model_hunt_append_only`.
Kolidují také oba dokumenty Decision 044. Společná integrace musí přidělit
nekolidující čísla a ověřit fresh/upgrade schema obou větví, ne mechanický merge.

M5/M6 dále vyžaduje skutečné operátorské receipts, potvrzení druhého fyzického
média, podpisový řetězec, zmrazený sjednocený kandidát a acceptance. Historická
odpověď „žádné skutečné klíče“ je podklad pro N/A rotace, není podpis ani doklad
zálohy. Post-release autonomní learning, velká Project Intelligence a plní
agenti zůstávají ve svém dříve dohodnutém scope.

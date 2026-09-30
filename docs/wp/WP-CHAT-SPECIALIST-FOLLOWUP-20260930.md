# WP — specialistický chat přes M1, pokračování a izolace projektů

**Stav:** testovací kandidát; deterministický běh na vstupním SHA PASS;
nezávislé review a integrační běh `NOT RUN`. Modelové a UI sady tím nejsou
přijaty.

**Autorita a vstup:** operátor 2026-09-30 žádá reálné testy specialistů a
různých projektů. Vstupní čistý commit `0b0cabdba153b0bebfda8fc06a8a34da11766a30`
větve `work/real-chat-journeys-20260930`; vlastní izolovaná větev
`work/chat-specialist-followup-20260930`. Produkční hranice M1 a M3 se nemění.

**Výsledek:** dva soukromé projekty se stejným zapnutým `code-reviewer` mají
oddělené konverzace. Každá odešle počáteční security audit a následný dotaz
bez znovuuvedení příkazu k auditu. M1 používá nové `requestId` a `turnId` na
každý tah, ale stejné `conversationId` pro jeho pokračování. Konečná odpověď
musí být deterministický výsledek nástroje s ProjectContext původem správného
projektu, přesnou cestou souboru a bez cesty z druhého projektu. Žádný tah
nesmí volat modelový fallback.

**Vlastněné cesty:** `tests/chat-specialist-followup-http.test.js`, tento WP,
nový záznam `IS-T3-TESTS-CHAT-SPECIALIST-FOLLOWUP-HTTP-TEST` v
`tests/registry.json` a pouze jeho generovaný derivát
`docs/convergence/TEST-REGISTRY.md`. Zakázány jsou živá DB, běžící služba,
GPU, vazby modelů, jiné pracovní stromy a zdrojový kód mimo uvedený rozsah.

**Cesta:** skutečné `src/server.js` a port-file capability; produktové trasy
`POST /api/projects`, `POST /api/conversations`, `POST /api/chat/specialist`
a M1 `POST /api/chat`. M1 trasa načte `projectId` z konverzace. ChatController
vytvoří session pro `dbConversationId` a ve `process()` předá handleru toto
stabilní ID. Specialist handler předá registrovaný projekt a persistentní
uživatelský tah do `SpecialistRuntime`; ten použije jednorázovou
ProjectContext capability. Konečný payload se kontroluje přes M1 HTTP
odpověď, ne pouze přes interní pomocnou funkci.

**Korekce analýzy:** první statické čtení M1 trasy vyvolalo podezření, že
`requestId` láme cache parametrů. Úplná cesta do `ChatController.process()`
ukázala přepsání `context.sessionId` stabilním ID konverzace. Nový test se
dvěma různými request ID prošel už na nezměněném vstupním SHA. Proto tento WP
neobsahuje produktovou opravu ani netvrdí reprodukovanou chybu.

**Pozitivní a negativní orákulum:** čtyři M1 tahy vrací `status=ok`,
`mode=specialist`, nástroj `code-reviewer.security_scan`, deterministickou
prezentaci, přesné `projectContext.projectId`, vlastní cestu a provenance
nálezu. Opačná cesta nesmí být v odpovědi ani v nálezech. Testem vlastněný
loopback provider počítá `/api/chat` a `/api/generate`; očekává přesně nulu.
Sandbox HOME, DB, projekty i JSON důkaz jsou privátní; žádné podklady uživatele
ani skutečný Ollama model se nepoužívají.

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-specialist-followup-http.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

**Hranice důkazu a stop condition:** test dokládá M1 HTTP průchod, návaznost
v jedné běžící instanci, izolaci dvou projektů a nulový modelový fallback.
Cache specialisty je v paměti a záměrně nepřežívá restart; test tedy neověřuje
pokračování po restartu, Studio UI, fyzický model, modelovou kvalitu ani jiné
specialisty. Suite `IS-T3-E2E-55-CHAT-WITH-SPECIALIST` a
`IS-T3-E2E-76-SPECIALIST-DOMAIN` zůstávají `BLOCKED`, `lastGreen=null`.
Před integračním přijetím je nutné nezávislé review a opakovaný běh na
sloučeném přesném SHA. Focused PASS není release PASS.

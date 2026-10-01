# WP — veřejná hranice vybraného specialisty

**Stav:** opravený izolovaný kandidát `43130aa8` má omezené nezávislé
`REVIEW_PASS`; produktové a testové bytes jsou integrované v `1303535f`,
nenasazené. Vstupní čistý integrační commit
`1f13b936e6abddcca61a4072266ce98923e3a32c`; původní větev
`work/chat-specialist-public-boundary-20261001`.

**Autorita a uživatelský výsledek:** operátor zadal skutečné testy specialistů
a pravdivé hodnoty v chatu. `PRODUCT.md` §2 vyžaduje ověření na uživatelské
hranici, kontrolu projektových dat a srozumitelnou degradaci při nedostupné
prerekvizitě. `CONTRACT.md` §4 vyžaduje pozitivní i negativní důkaz. Tento WP
uzavírá zjištěnou odchylku vybraného deterministického specialisty od již
omezených veřejných metadat generativní expertízy.

**Rozsah a vlastněné cesty:** `src/chat/handlers/specialist.js`, nový čistý
projektor `src/chat/handlers/specialist-public.js`, existující M1 HTTP/SQLite
programy `tests/chat-specialist-followup-http.test.js` a
`tests/chat-sazeni-http-journey.test.js`, testovací transport
`tests/helpers/sazeni-http-fixture-preload.js`, bezpečné chyby v
`specialists/sazeni/engine/{values,autonomous,tickets}.js`, sousední
`tests/sazeni-integration.test.js`, přesná hrana module graph,
mechanické počty v `SYSTEM-MAP.md` a `ROADMAP.md` a tento WP. Žádný nový
testový program ani změna `tests/registry.json`.

## Skutečný call graph a červený důkaz

`POST /api/chat` → `ChatController.handle` → `specialistHandler` →
`specialistRuntime.tryToolExecution` → `ToolExecutor.execute` → prezentace
balíku → `deterministicSpecialistToolResponse` → `finalizeChatResponse` → M1
`ConversationResult.response.metadata`. Router metadata z controlleru přenáší
bez dalšího filtru. Před opravou vybraný specialista vkládal celý
`toolResult.result` do veřejných `toolResults` a celý `toolResult.evidence` do
`projectContext`. Bezpečnostní code reviewer záměrně ukládá zdrojový `snippet`
včetně detekovaného hardcoded secret; odpověď tak opakovala syntetický API klíč.
Expertizový wrapper již u většiny nástrojů zveřejňuje jen typ a používá raw
výsledek pouze v interním provider promptu.

Sázkařův `runAutonomous` vrací `BettingResult.status=PROVIDER_ERROR` jako běžný
strukturovaný výsledek. Runtime ho pokládal za úspěšné spuštění, protože
kontroluje pouze `status==='error'`; deterministický handler pak označil
veřejná metadata `executionStatus=SUCCESS`.

**Red-first:** na nezměněném produktu po rozšíření existujících M1 testů
`Node 24 --test tests/chat-specialist-followup-http.test.js
tests/chat-sazeni-http-journey.test.js` skončilo **1 PASS / 2 FAIL**.
Code reviewer zveřejnil `PRIVATE_A_KEY_9x7p2z4q` v
`toolResults[0].data.data.vulnerabilities[].snippet`; Sázkařův chybějící
`odds_io` klíč vrátil `PROVIDER_ERROR` s `executionStatus=SUCCESS`.
Další M1 aserce na selhaný vybraný účetní dokumentový nástroj byla spuštěna
i se zpětnou mutací původní chybové věty: **1 PASS / 1 FAIL**, protože odpověď
nepravdivě tvrdila „nebyl spuštěn“ a připojila syrový JSON parser error.
Po obnovení neutrální věty stejný průchod prošel.

## Oprava a ověřovací hranice

Veřejná projekce vybraného specialisty vydává u code review jen typ nástroje;
jeho `ProjectContext` je přesný seznam bezpečných identifikátorů, cest, řádků
a digestů bez libovolných připojených polí. Sázení dál vydává strukturovaný
veřejný pohled `BettingResult@3` včetně tiketů, kurzů, času pozorování a příznaků
`verifiedObservation`/`verifiedLive`. Jeho omezené `analysis` uchovává bezpečné
reference pozorování, veřejné zdrojové stránky, metodu a známá omezení;
diagnostiku modelů a další soukromá pole z interního záznamu vynechává.
U neznámého nástroje vydává metadata
jen jeho typ. Účetní VAT generativní wrapper a jeho typované parametry se
nemění; raw výsledek zůstává dostupný výhradně internímu provider promptu.

Pro `PROVIDER_ERROR`, `PERSISTENCE_ERROR`, `MODEL_UNAVAILABLE`,
`INTERNAL_ERROR`, `CANCELLED` a `INVALID_REQUEST` nese veřejná odpověď
`executionStatus=FAILED` a `fallbackSuppressed=true`. Doménové `NEEDS_INPUT`
zůstává dokončeným dotazem na upřesnění. M1 transport pro čitelnou doménovou
chybu zůstává HTTP 200 / `status=ok`, ale jeho metadata ji už neoznačují za
úspěch; modelový fallback nenastává. Přímo selhaný fail-closed nástroj nevrací
do textu syrový obsah výjimky.

**Pozitivní orákula:** vlastní produktový child na loopbacku a vlastní SQLite
vrací u code revieweru nález ve veřejném textu, správné project ID/digests a
žádnou zdrojovou canary ani syntetický klíč v celém M1 JSON. Sázení nad
kontrolovaným transportem zachovává přesně dva pozorované zápasy, kurzy,
`verifiedObservation=true`, `verifiedLive=false`, dvouminutovou platnost,
osm bezpečných zdrojových referencí a evidenci v soukromé DB; soukromá
`analysis.diagnostics` a pole mimo veřejný seznam ve výsledku chybí. Negativní
mutace přidává diagnostiku, modelové pole, vlastní credential a URL s query;
veřejný projektor je zahodí. Chybějící
`odds_io` klíč vrací `PROVIDER_ERROR` / `executionStatus=FAILED` bez síťového
fetch a bez modelu. Selhaný vybraný účetní dokumentový nástroj vrací
`executionStatus=FAILED`, `fallbackSuppressed=true`, přesně neutrální větu,
žádnou syrovou chybu a žádné modelové volání. Negativní mutace přidává soukromé `sourceText` a
`items[].content` do evidence; veřejný projektor je zahodí.

**Přímá green evidence:** oba M1 programy **4/4**, účetní a překladatelské
modelové kontrakty **5/5**, Sázení integrace **20/20** a M1 wire kontrakt
**73/73**. Starý integrační test nejdřív správně zčervenal na očekávání
syrového `analysis` ve veřejném M1 tagu; aktualizované orákulum kontroluje
veřejný výběr zdrojových referencí bez soukromé diagnostiky a její přítomnost
v trvale uloženém soukromém záznamu. Čistý předběžný commit `ccb8b9a7` měl
registrované sady **7/7 PASS**. Opravená projekce zdrojů na čistém
`50ffbab510eaded2bb4faba84ae7a60e7b584795` má také **7/7 PASS**:
`.intentsmith-artifacts/run-suites/2026-10-01T01-17-46-524Z/report.json`,
`gateEvidence=false`. První pokus o registrovaný běh na `ccb8b9a7` měl
**1 PASS / 6 FAIL** kvůli systémovému Node 22 oproti nativnímu modulu
`better-sqlite3` pro Node 24; opakování se správným `PATH` prošlo **7/7**.
Nezávislé review ještě musí následovat. Jde o kontrolované HTTP/SQLite běhy,
nikoli fyzickou kvalitu modelu, dnešní Fortunu, mobilního klienta ani release
Gate 0.

**Stop condition / příkazy:** přesná module-graph hrana je přijata bez růstu
cyklů; oba M1 programy, účetní/překladatelské sousedy, registrovaný runner,
registry validátor, artifact validace a `git diff --check` procházejí na
čistém SHA; vzdálený SHA odpovídá. Pak nezávislé review rozhodne o integraci.

```sh
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/chat-specialist-followup-http.test.js tests/chat-sazeni-http-journey.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/chat-accountant-model-contract.test.js tests/chat-translator-model-contract.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/sazeni-integration.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/m1-chat-contract.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/module-boundary-ratchet.mjs
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/validate-test-registry.js --json
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/artifact-validation.test.js
env PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH /home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/run-suites.js --suite=IS-T3-TESTS-CHAT-SPECIALIST-FOLLOWUP-HTTP-TEST,IS-T3-TESTS-CHAT-SAZENI-HTTP-JOURNEY-TEST,IS-T3-TESTS-CHAT-ACCOUNTANT-MODEL-CONTRACT-TEST,IS-T3-TESTS-CHAT-TRANSLATOR-MODEL-CONTRACT-TEST,IS-T1-TESTS-SAZENI-INTEGRATION-TEST,IS-T2-TESTS-M1-CHAT-CONTRACT-TEST,IS-T1-TESTS-ARTIFACT-VALIDATION
git diff --check
```

## Navazující review a uzavření vnořených polí

Nezávislé review `f712bb3e` vrátilo **CHANGES_REQUIRED**. Původní projekce
kopírovala `errors`, `tickets` a další vnořené objekty bez filtru. Hostem
vyvolaná výjimka tak nesla soukromý text do veřejného `errors[].message` i
deterministické prezentace. Filtr také zahazoval legitimní veřejnou stránku
Fortuny s přesným `?tab=matches`.

Nový red-first důkaz na stejném M1 HTTP/SQLite child: **1 PASS / 2 FAIL**.
První skutečný pozorovaný výsledek neměl `analysis.publicSourcePages`; při
řízeném `bettingData.get` throw se `PRIVATE_HOST_ERROR_CANARY_4bf7d0`
objevil v `errors[0].message`. Samostatná negativní projekční mutace byla
**0/1**: privátní chybový text šel do veřejných metadat. Žádný externí
provider ani instalovaná DB se při testu nepoužily.

Oprava pouští do veřejného `BettingResult@3` jen kontraktové vnořené klíče
včetně preferencí, tiketů, kurzů, omezení, důkazů a uloženého ID. Chybové
metadata používají pevné veřejné věty podle typovaného stavu; syrový host error
se zároveň vyřadí před deterministickým rendererem. Vlastní validační chyby
si mohou zachovat užitečný doménový text. `sourceRefs` přijímá jen uzavřené
veřejné zdroje hostu a stránky Fortuny jen pět přesných ligových URL s
`?tab=matches`; tokenové query a libovolné vnořené klíče se zahodí.
Pozorované dva zápasy, kurz `2.8237`, čas capture a pět kontrol tiketových
limitů zůstávají veřejně ověřitelné. Opravený kandidát `43130aa8` získal
omezené nezávislé **REVIEW_PASS**; žádná živá kvalita modelu ani release
přejímka se z těchto fixture testů neodvozuje.

**Ověření opravené revize před commitem:** přímé M1 HTTP sady **5/5**,
účetní a překladatelské HTTP sousedy **5/5**, Sázení integrace **20/20**,
M1 chat kontrakt **73/73**, artifact validace **160/160**. Registrovaný
sedmisadový běh **7/7 PASS**:
`.intentsmith-artifacts/run-suites/2026-10-01T01-42-15-399Z/report.json`;
`gateEvidence=false`. Na izolované větvi měl registr 580 validních programů a
module graph 1 463 hran, tři stávající cykly / 28 souborů. Nezávislý reviewer
na přesném `43130aa8` reprodukoval host throw s privátním markerem,
M1 HTTP/SQLite **5/5** a Sázení integraci **20/20**; v aktuální produktové
cestě nenašel veřejný únik. Integrační commit `1303535f` nese stejnou
produktovou a testovou opravu; společný registr má 583 programů. Novou
jedinou hranu modulového grafu přijal integrátor nad `1303535f`; cílená
integrační kontrola a celý vývojový profil jsou samostatné důkazy.

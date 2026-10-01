# WP — veřejná hranice vybraného specialisty

**Stav:** izolovaný kandidát, `REVIEW_PENDING`, nenasazený. Vstupní čistý
integrační commit `1f13b936e6abddcca61a4072266ce98923e3a32c`; větev
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
`tests/chat-sazeni-http-journey.test.js`, přesná hrana module graph,
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
`node --test tests/chat-specialist-followup-http.test.js
tests/chat-sazeni-http-journey.test.js` skončilo **1 PASS / 2 FAIL**.
Code reviewer zveřejnil `PRIVATE_A_KEY_9x7p2z4q` v
`toolResults[0].data.data.vulnerabilities[].snippet`; Sázkařův chybějící
`odds_io` klíč vrátil `PROVIDER_ERROR` s `executionStatus=SUCCESS`.

## Oprava a ověřovací hranice

Veřejná projekce vybraného specialisty vydává u code review jen typ nástroje;
jeho `ProjectContext` je přesný seznam bezpečných identifikátorů, cest, řádků
a digestů bez libovolných připojených polí. Sázení dál vydává strukturovaný
`BettingResult` včetně tiketů, kurzů, času pozorování a příznaků
`verifiedObservation`/`verifiedLive`, ale bez soukromého `analysis` se
zdrojovými referencemi a diagnostikou. U neznámého nástroje vydává metadata
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
`verifiedObservation=true`, `verifiedLive=false`, dvouminutovou platnost a
evidenci v soukromé DB; `analysis` ve veřejných metadatech chybí. Chybějící
`odds_io` klíč vrací `PROVIDER_ERROR` / `executionStatus=FAILED` bez síťového
fetch a bez modelu. Negativní mutace přidává soukromé `sourceText` a
`items[].content` do evidence; veřejný projektor je zahodí.

**Přímá green evidence:** oba M1 programy **4/4**, účetní a překladatelské
modelové kontrakty **5/5**. Registrovaný běh na čistém kandidátním SHA a
nezávislé review ještě musí následovat. Jde o kontrolované HTTP/SQLite běhy,
nikoli fyzickou kvalitu modelu, dnešní Fortunu, mobilního klienta ani release
Gate 0.

**Stop condition / příkazy:** přesná module-graph hrana je přijata bez růstu
cyklů; oba M1 programy, účetní/překladatelské sousedy, registrovaný runner,
registry validátor, artifact validace a `git diff --check` procházejí na
čistém SHA; vzdálený SHA odpovídá. Pak nezávislé review rozhodne o integraci.

```sh
node --test tests/chat-specialist-followup-http.test.js tests/chat-sazeni-http-journey.test.js
node --test tests/chat-accountant-model-contract.test.js tests/chat-translator-model-contract.test.js
node scripts/module-boundary-ratchet.mjs
node scripts/validate-test-registry.js --json
node tests/artifact-validation.test.js
git diff --check
```

# WP-M1-CHAT — průběžný report

- **stav:** B2 `PASS`; M1 celek zůstává `BLOCKED` rozhodnutím 009 v B3
- **base:** `86defcefd0abb1f1a521d6574f749b4e1122b453`
- **scope:** B2 podle `docs/execution/m1-batch.md`
- **produktové checkpointy:** `71769051`, `5a95e1f7`, `f62f3fc5`, `eb01abb2`

## Checkpoint 1 — fail-closed persistence hranice

`finalizeChatResponse()` už nemůže vrátit success, pokud se assistant turn
nepodařil zapsat. Selhání je typované jako `CHAT_PERSISTENCE_FAILED`, HTTP
adaptér je může bezpečně mapovat bez textu interní DB výjimky a automatický
retry se nenabízí, protože user turn už může být durable.

Nová sada připíná pořadí persist-before-return a tři záporné hranice: abort
před finalizací, abort během asynchronní práce a timeout na posledním švu před
persistencí. Ve všech případech je počet zapsaných assistant turnů nula.

První checkpoint sady byl registrovaný jako offline. Checkpoint 2 však načítá
skutečný controller a tím i izolovanou SQLite/migrace, proto je metadata pravdivě
zpřísněna na `IS-T2-TESTS-M1-CHAT-CONTRACT-TEST`, fixture `isolated-sqlite` a
profil `database`. Sada stále nevydává tvrzení o request-level nebo process
restart cestě; ty zůstávají explicitně otevřené níže.

### Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-chat-contract.test.js` | 5 passed, 0 failed | 0 |
| `node tests/deterministic-answer-latency.test.js` | 3 passed, 0 failed | 0 |
| `node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 64 passed, 0 failed | 0 |

Mutační kontrola nahradila jediný `throw new ChatPersistenceError(err)` za
`void err`. Nová sada skončila 4 passed / 1 failed, exit 1, přesně na aserci
„persistence exception ... never false-success“. Zdroj byl následně obnoven
pomocí stejného cíleného patchu; žádný reset ani checkout nebyl použit.

### Commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 361 programů, 8 exclusions, fingerprint `dffe42f2dd7c32c5e20c7e7b3a86782b704c5e1f499d11eef2e2b0a9c367218b` | 0 |
| `node tests/repository-hygiene.test.js` | 1453 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

První běh artifact validation skončil 150 passed / 1 failed, exit 1: záporný
README drift test ještě mutoval předchozí počet `263 ACTIVE`. Jeho fixture byla
aktualizována na nový registr (`264` → `263`); následující běh je zelený výše.

## Rozhodnutí

- `docs/decisions/003-m1-persist-before-response.md`
- `docs/decisions/004-m1-http-cancel-target.md` — blokuje jen explicitní HTTP
  cancel command; ostatní B2 pokračuje.

## Checkpoint 2 — conversation-owned state a handler failures

`ChatController.handle()` nyní klíčuje controller i persistentní
`SessionState` stejným `conversationId`, který vlastní durable turny. Sdílený
transportní `sessionId` proto nemůže přenést preference nebo pokračovací kontext
mezi dvěma chaty. `conversationId` je také explicitně v handler contextu.

Kanonický timeout z handleru se znovu vyhazuje beze změny zdroje. Obyčejná
handlerová výjimka se mění na sanitizovaný `CHAT_PROCESSING_FAILED`, ne na
assistant text. `SessionState.fromJSON()` znovu načítá všechna tři pole, která
už `toJSON()` zapisovalo: `lastIntent`, `lastDecision`, `lastUserInput`.

Focused sada po této změně: M1 chat 9/0, deterministic latency 3/0,
confirmation ownership 5/0, routes smoke 109/0, chat persistence 35/0 a WS
bridge 64/0; všechny exit 0. Registry zůstává na 361 programech, ale pravdivá
reklasifikace M1 chat sady z offline/T1 na database/T2 změnila fingerprint na
`e01df433134ae227497e1e881f892424710d2bc988c61baf3964b7b4cb5c5d32`.

### Mutační evidence checkpointu 2

- Návrat ke klíčování controlleru/stavu pomocí transportního `sessionId`
  skončil 8 passed / 1 failed, exit 1. Selhala pouze izolace: konverzace B
  pozorovala `owner: conversation-A`.
- Návrat k převodu handlerových výjimek na assistant error response skončil
  7 passed / 2 failed, exit 1. Selhal typed timeout i generic terminal failure.
- Testy během negativní mutace nahrazují `fetch` lokálním stubem a současně
  vyžadují nula model calls; ani mutační kontrola proto nevyžaduje Ollamu nebo
  externí síť.

Obě mutace byly po běhu obnoveny cílenými patchi. Původní první běh error
mutace, který před doplněním stubu sáhl na lokální modelový endpoint, není
akceptační evidence; byl zachycen jako chyba testovací izolace a opraven před
commitem.

### Commit battery checkpointu 2

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 361 programů, 8 exclusions, fingerprint `e01df433134ae227497e1e881f892424710d2bc988c61baf3964b7b4cb5c5d32` | 0 |
| `node tests/repository-hygiene.test.js` | 1456 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

## Checkpoint 3 — HTTP adapter přijatého connectoru v1

`POST /api/chat` rozlišuje exact `ConversationCommand` pomocí discriminatoru a
validuje ho kanonickým B1 validátorem. `send` předává původní trojici identity
do controlleru a vrací pouze znovu validovaný `ConversationResult`. Success
obsahuje jen finální content a sanitizovaná metadata `mode`/`confidence`;
provider, persistence, generic failure, timeout a user abort nemají `response`.

Legacy `{conversation_id, message}` větev ani její response shape se nemění.
V tomto historickém checkpointu byl platný HTTP `action: cancel` do rozhodnutí
004 terminální `error` s HTTP 409; adaptér tím pravdivě přiznal neprovedenou
operaci a nepředstíral cancelled turn.
Disconnect používá `IncomingMessage.aborted`/neukončený response close, nikoli
obecný request `close`; odpojenému peeru se terminál fyzicky neposílá.

### Evidence checkpointu 3

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-chat-contract.test.js` | 15 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 361 programů, 8 exclusions, fingerprint `e01df433134ae227497e1e881f892424710d2bc988c61baf3964b7b4cb5c5d32` | 0 |
| `node tests/repository-hygiene.test.js` | 1457 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

Focused adapter sada připíná exact validaci příkazu a výsledku, nezměněnou
trojici identity, persist-before-send pořadí, sanitizované provider/persistence/
generic terminály, deadline, typed user abort a fail-closed prázdný output.

## Otevřeno po checkpointu 3 — historický stav

- explicitní HTTP scoped cancel zůstává jedinou zastavenou větví podle
  rozhodnutí 004; provider error a timeout jsou již připnuté na request adaptéru;
- provést modelový request v odděleném GPU okně nebo jej pravdivě evidovat jako
  neprovedený.

## Checkpoint 4 — skutečný process restart a durable SQLite

Původní test „restartu“ znovu četl stejný in-memory `ConversationStore`. Nyní
test spustí backend jako vlastněný child proces, odešle dvě exact M1 konverzace,
ověří jejich izolaci, server řízeně ukončí a spustí nový OS proces nad stejnou
privátní SQLite. Oba kompletní message seznamy se po restartu porovnají
byte-for-byte; PID druhého procesu musí být jiný.

Deterministický `17 * 23` request doběhl bez modelu za **78,4 ms**, tedy pod
přijatým limitem 100 ms. Child start, každý HTTP request i graceful stop mají
samostatný limit. Selhání startu uklidí child ještě uvnitř helperu a synchronní
exit backstop brání osiření serveru při explicitním `process.exit()` testu.

Sada proto už není pravdivě T1/offline. Je registrována jako
`IS-T3-TESTS-CHAT-PERSISTENCE-TEST`, profil `server`, fixture
`owned-isolated-local-server`, s požadavky loopback + privátní database;
nevyžaduje předem běžící server, Ollamu ani GPU.

### Červené diagnostické běhy

- První rozpracovaný pokus neawaitoval asynchronní `it()` a vypsal 34/0,
  přestože restart nedoběhl. Tento výsledek je neplatná evidence; suite byla
  změněna tak, aby všechny async testy skutečně awaitovala.
- První poctivý běh skončil 34 passed / 1 failed, exit 1. Server odmítl krátký
  `INTENTSMITH_TEST_SERVER_NONCE` a nevytvořil port file. Nonce byl opraven na
  povolených 32+ bezpečných znaků a start helper nyní uklízí i předčasné
  readiness selhání.

### Evidence checkpointu 4

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/chat-persistence.test.js` | syntax valid | 0 |
| `timeout --signal=TERM --kill-after=10s 180s node tests/chat-persistence.test.js` | 35 passed, 0 failed; HTTP 78,4 ms | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 361 programů; doc regenerated | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 361 programů, 8 exclusions, fingerprint `f7e71f1aafb2089efd6aa3e6aa024e7c42b5035834d48905cd27b24d86df9a36` | 0 |
| `node scripts/nightly-audit.js --dry-run --suite=IS-T3-TESTS-CHAT-PERSISTENCE-TEST` | 1 server suite; blockers `{}` | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1457 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

## Checkpoint 5 — conversation-scoped HTTP cancel podle rozhodnutí 004/C

Jedna instance `createChatRoutes()` drží privátní registr nejvýše jednoho
aktivního M1 turnu na `conversationId`. Dva současné HTTP sendy jedné
konverzace přes tuto instanci proto nemohou vytvořit nejednoznačný cíl; druhý
končí validním `ConversationResult` s `M1_CONVERSATION_BUSY` dřív, než vstoupí
do controlleru. Nejde o produktový mutex napříč HTTP a WS nebo více WS
sessions; tento reziduál je pravdivě veden ve
`docs/findings/005-http-ws-conversation-mutex-is-local.md` pro B4 a budoucí
sdílenou concurrency authority.

Cancel bez aktivního cíle končí `M1_HTTP_CANCEL_NOT_ACTIVE`. Platný cancel
pošle původnímu turnu typed user abort a čeká na jeho pravdivý terminál. HTTP
200 s terminálem `cancelled` vrátí až po potvrzeném `cancelled` cíli; timeout,
error ani success cíle se nepřeznačí a skončí
`M1_HTTP_CANCEL_NOT_CONFIRMED`. Post-await guard navíc odmítne success, pokud by
controller signál ignoroval. Registr se uklízí v `finally` a maže jen záznam,
který stále vlastní daný turn.

Cancel operace zachovává vlastní `requestId` a `turnId`; cílení používá pouze
společný `conversationId`, jak operátor schválil. Negativní test drží současně
aktivní A a B, odmítne druhý send A, odmítne identitní kolizi bez abortu,
zruší A dvěma souběžnými idempotentními cancel příkazy a prokáže, že B zůstala
neabortovaná a skončila `ok`. Další negativní případy připínají bounded čekání
na nespolupracující handler, zákaz pozdního successu, timeout-before-cancel,
nový send po unwind a cancel po dokončení. Connector v1 ani legacy HTTP větev
se nezměnily.

### Focused evidence checkpointu 5

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/routes/chat.js` | syntax valid | 0 |
| `node --check tests/m1-chat-contract.test.js` | syntax valid | 0 |
| `node tests/deterministic-answer-latency.test.js` | 3 passed, 0 failed | 0 |
| `node tests/confirmation-ownership.test.js` | 5 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `timeout --signal=TERM --kill-after=10s 180s node tests/chat-persistence.test.js` | 35 passed, 0 failed; HTTP 69,7 ms | 0 |
| `node tests/m1-chat-contract.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |

## B2 exit stav

B2 implementační scope je vyčerpaný bez změny connectoru. Povinné deterministic,
confirmation, route, durable restart a M1 chat sady jsou zelené. Rozhodnutí 004
je implementačně uzavřené pro factory-local HTTP adaptér a B4 může konzumovat
conversation-scoped cancel bez tvrzení o globálním mutexu.
M1 jako celek se pravdivě nehlásí jako PASS, protože referenční GPU konfigurace
B3 nesplnila post-load headroom a čeká v `docs/decisions/009-m1-gpu-headroom.md`.

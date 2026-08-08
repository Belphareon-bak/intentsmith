# WP-M1-CHAT — průběžný report

- **stav:** IN PROGRESS
- **base:** `86defcefd0abb1f1a521d6574f749b4e1122b453`
- **scope:** B2 podle `docs/execution/m1-batch.md`

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

## Zbývá před uzavřením WP

- připojit přijatý `ConversationCommand/Result` v1 na HTTP request boundary;
- změřit deterministický HTTP request pod 100 ms bez LLM;
- nahradit simulovaný restart v `tests/chat-persistence.test.js` skutečným
  stop/start backendu nad stejnou SQLite;
- připnout provider error, request timeout, scoped cancel a izolaci dvou
  konverzací na request-level výsledku;
- provést modelový request v odděleném GPU okně nebo jej pravdivě evidovat jako
  neprovedený.

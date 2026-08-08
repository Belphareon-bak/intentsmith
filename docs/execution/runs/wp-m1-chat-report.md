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

Sada je registrovaná jako `IS-T1-TESTS-M1-CHAT-CONTRACT-TEST` v profilu
`offline`; nevyžaduje server, SQLite ani model a nemůže tedy vydávat tvrzení o
request-level nebo restartové cestě. Ty zůstávají explicitně otevřené níže.

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

## Zbývá před uzavřením WP

- připojit přijatý `ConversationCommand/Result` v1 na HTTP request boundary;
- změřit deterministický HTTP request pod 100 ms bez LLM;
- nahradit simulovaný restart v `tests/chat-persistence.test.js` skutečným
  stop/start backendu nad stejnou SQLite;
- připnout provider error, request timeout, scoped cancel a izolaci dvou
  konverzací na request-level výsledku;
- provést modelový request v odděleném GPU okně nebo jej pravdivě evidovat jako
  neprovedený.

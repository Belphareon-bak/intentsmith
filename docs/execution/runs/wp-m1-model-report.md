# WP-M1-MODEL — průběžný report

- **stav WP:** IN_PROGRESS
- **base SHA:** `55c913d6f3cb2354b6447d10ff304e9d0323b1c3`
- **zapisující větev:** `claude/gate1-mobile-app-progress-5sywlt`
- **GPU/Ollama v tomto checkpointu:** NOT RUN
- **push:** neproveden podle dávkového kontraktu

## Checkpoint 1 — pravdivý fake-provider gateway

Implementována oddělená policy cesta `callWithPolicy()` pro connector v1.
Vynucuje jeden provider pokus, validní auth/capability a přesnou korelaci
`requestId/conversationId/turnId/callerRole/modelRole/purpose`. Caller role se
odvozuje z auth tokenu; podvržená nebo objektová korelace skončí před provider
effectem. Empty/whitespace, malformed JSON/payload, HTTP 404/500/503, refused
socket a queue timeout mají rozdílné bezpečné typy. Prompt, system prompt,
messages, token, raw provider body ani stack se do auditu tohoto boundary
nezapisují.

Semafor nyní odebere přesně zrušeného waitera; jeho timer/listener se uklidí a
slot nepřejde na již settled entry. Upstream timeout čekající ve frontě se
eviduje jako timeout, ne jako user cancel. Úspěch i runtime evidence nesou
sanitizovanou korelaci.

## Ověření checkpointu

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/llm/gateway.js` | syntax valid | 0 |
| `node --check tests/m1-model-contract.test.js` | syntax valid | 0 |
| `node tests/m1-model-contract.test.js` | 11 passed, 0 failed, 0 skipped | 0 |
| `node tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/capability-02-cre-behaviours.test.js` | 10 passed, 0 failed | 0 |
| `node tests/model-ctx.test.js` | 6 passed, 0 failed, 0 skipped | 0 |
| `node tests/model-universe-store.test.js` | 18 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | 362 programů, 8 exclusions, fingerprint `e3036487a71d3be0d0e9c463b17c0233b0d28ff4be6f8436ab49322df4ac5f15` | 0 |
| `node tests/repository-hygiene.test.js` | 1457 tracked paths | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

První běh `node tests/artifact-validation.test.js` skončil 150 passed / 1 failed,
exit 1, protože README po přidání sady uvádělo správný celkový počet 362, ale
stale dílčí počet `264 ACTIVE`. Po opravě na registry-odvozených `265 ACTIVE`
odhalil druhý běh jinou 150/1 chybu: negativní drift test sám natvrdo nahrazoval
starou hodnotu `264`, takže už žádnou mutaci neprovedl. Test nyní odvozuje
ACTIVE počet z registru a mění jej o jedna; konečný běh je 151/0, exit 0.

### Negativní mutační kontrola

Dočasná jediná mutace změnila striktní výběr neprázdného výstupu na prosté
`candidates[0]`. `node tests/m1-model-contract.test.js` pak skončil
**10 passed / 1 failed, exit 1** přesně v aserci empty/whitespace fail-closed.
Mutace byla vrácena přesným patchem, zachovaný failure artifact byl přesunut do
koše a čistý běh se vrátil na 11/11, exit 0.

## Rozhodnutí a findingy

- `docs/decisions/005-m1-model-retry-policy.md` — DECIDE, default jeden pokus
  pouze pro connector v1;
- `docs/decisions/006-m1-model-auto-rebind-l0.md` — BLOCK pouze pro automatický
  rebind, gateway práce pokračuje;
- `docs/findings/002-m1-vision-bypasses-model-connector.md` — vision direct
  fetch je PENDING-OWNER, protože B1 connector nenese image schema.

## Zbývá v WP

1. čistě offline `fitsVram()` s explicitním `fit/nonfit/unknown` a preflightem
   známého non-fit před provider efektem;
2. adaptér `ModelRequest/Result` v `src/llm/cre-bridge.js` bez změny schématu;
3. sériový GPU run na skutečné Ollamě včetně cold/warm a mid-generation cancel;
4. konečná focused baterie a uzavření WP. GPU část se nesmí spustit, dokud
   bezpečný snapshot neprokáže, že není nutný pull/delete/rebind ani zásah do
   sdílené Ollamy.

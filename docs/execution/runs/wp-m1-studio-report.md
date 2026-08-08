# WP-M1-STUDIO — průběžný report

- **stav WP:** `IN_PROGRESS`; checkpoint 1 READY
- **base SHA:** `b7d0dbf61370b52061e6a736517ecdcb53118209`
- **scope:** B4 podle `docs/execution/m1-batch.md`
- **UI baseline:** výslovně mimo scope; spuštěné Studio není finální UI
- **GPU/Ollama/externí síť:** NOT RUN
- **push:** neproveden podle dávkového kontraktu

## Vstup z M0-E

Commitnutý `c3-chat-panel/lib/**` je autoritativní runtime; stale TypeScript je
archivovaný a package `build`/`clean` nemůže runtime přepsat nebo smazat.
Existující capability shim spolu s Electron Origin normalizerem prokazatelně
prošel dvěma fresh-clone CDP journey na `7236d221`. Google Fonts egress je ze
trackovaného Studia odstraněn. Tyto M0-E výsledky se zde nepřepisují a nejsou
vydávány za důkaz M1 multi-panel chování.

## Checkpoint 1 — stabilní routing identity a scoped cancel

První odeslání z nového panelu vytvoří platný stabilní `conversationId`, uloží
jej do session, publikuje `session:identity` pro durable panel state a pošle jej
na WS wire. Další WS zprávy stejného panelu identitu zachovají. Neprázdná
neplatná identita zastaví WS send a nepřegeneruje se potichu; dnešní HTTP
fallback ale stav `false` nerozlišuje od nedostupného transportu a zůstává
otevřený pro následující fail-closed checkpoint.

`_cancelExecution(idx)` nyní předává vybranou session. Veřejný Studio klient
pošle cancel jen s platným `conversationId`; chybějící či malformed cíl skončí
bez wire effectu a nemůže spadnout do backendového cancel-all fallbacku.
Backendový A/B test připíná, že cancel A ukončí jen A, zatímco B zůstane aktivní
a doběhne s `ok`.

Turn-bound legacy agent eventy a finální status nyní nesou stejné
`conversationId`, takže progress konkrétního požadavku nemusí používat globální
`_lastSendSessionIdx`. Změna ponechává legacy transport kompatibilní.

### Co checkpoint negarantuje

- Nejde o hotovou B4 ani M1 connector integraci. Studio ještě neposílá
  `requestId`/`turnId` a nemá přesný `CoreEvent` terminal ledger.
- Assistant se zatím renderuje před kanonickým terminálem; late/duplicate/out of
  order eventy nejsou tímto checkpointem uzavřené.
- HTTP fallback, spinner ve všech terminal větvích, reconnect/rehydrate a nový
  fresh-clone journey zůstávají otevřené.
- HTTP a WS mutexy jsou lokální adaptéru podle
  `docs/findings/005-http-ws-conversation-mutex-is-local.md`; checkpoint netvrdí
  globální request authority.

### Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js` | syntax valid | 0 |
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` | syntax valid | 0 |
| `node --check src/ws-bridge/session-adapter.js` | syntax valid | 0 |
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 4 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 65 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |

První rozpracovaný běh nové Studio sady skončil 2 passed / 2 failed, exit 1.
Jedna vada byla v testu (`deepEqual` nad objektem z jiného VM realm). Druhý
failure správně odhalil, že klávesa Escape stále volala unscoped cancel; původní
příliš široká aserce byla nejprve chybně zúžena. Nezávislý review tento
false-green odhalil, Escape nyní předává aktivní session a globální negativní
aserce znovu zakazuje každý `sendCancel()` bez cíle.

Stejný review živou offline reprodukcí zjistil ztrátu `conversationId` u stale
timeout terminálu: cleanup smazal `activeTurns` dřív, než scan našel routing.
Identita eventu nyní přichází přímo z immutable closure konkrétního turnu a T10c
pinuje `turn_end` i `error` na `studio-stale-A`.

### Commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1469 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

## Otevřené nálezy pro další checkpointy

1. Commitnutý `@c3/protocol/lib/index.js` je stale stub; B4 allowlist nepovoluje
   bez rozhodnutí měnit protocol build delivery. Přesná consumer integrace je
   proto zastavená; nezávislé client-state a fail-closed opravy mohou pokračovat,
   dokud nebude delivery šev rozhodnutý v
   `docs/decisions/010-m1-studio-protocol-runtime-delivery.md`.
2. Tři HTTP fallbacky nekontrolují `response.ok` a mohou renderovat error JSON
   jako assistant.
3. Rehydrate nepotvrzuje existenci ID, ignoruje ack a nemá reconnect epoch.
4. Existující Electron runner obchází veřejný `sendChat()` a připíná legacy
   pořadí assistant-before-turn-end; pro B4 acceptance se musí změnit.
5. Terminal STOP neruší backendový proces. To je M2 finding mimo B4 chat scope,
   nikoli důvod rozšířit tento checkpoint.

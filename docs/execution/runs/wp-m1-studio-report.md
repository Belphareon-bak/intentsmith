# WP-M1-STUDIO — průběžný report

- **stav WP:** `IN_PROGRESS`; checkpointy 1–4 READY
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

## Checkpoint 2 — serverem ověřený rehydrate acknowledgement

Legacy WS bridge už nepotvrzuje libovolný seznam dodaný klientem. Rehydrate
vstup je omezen na prvních 32 položek, přijímá jen kanonický M1 tvar identity,
odstraňuje duplicity a každé ID ověří proti aktivnímu durable
`ConversationStore`. Chybějící nebo malformed ID se do `validIds` nedostane.
Jakákoli store výjimka zruší celý výsledek: server nevydá partial autoritativní
ACK a zavře socket kódem 1011, aby transientní DB chyba nemohla vést ke smazání
lokálního snapshotu. Log obsahuje pouze počty, nikoli identifikátory konverzací.

Živý loopback test vytvoří jednu skutečnou in-memory konverzaci, provede hello a
rehydrate přes produkční `attachWebSocketServer()` a požaduje směs existujícího,
chybějícího, duplicitního a malformed ID. Wire acknowledgement obsahuje přesně
jedinou existující identitu.
Stejný wire test pak vyvolá store chybu a připíná close 1011 bez dalšího ACK.

Registrovaná serverová E2E sada 80 dříve používala `rehydrate` jako obecné echo
libovolného tokenu. To by se pravdivou validací rozbilo a zároveň by testovalo
neplatný kontrakt. Její tři ordering bariéry nyní předem vytvoří skutečné
conversation fixtures a všechny čtyři konverzace po testu přesně smažou.

### Co checkpoint negarantuje

- Studio client zatím `rehydrate_ack` nespotřebovává a neplatné panely tedy
  lokálně neodstraní.
- Fetch historie zatím nemá reconnect epoch; opožděný starý request může
  přepsat novější stav a prázdná validní konverzace nevyčistí stale zprávy.
- `ws:reconnected` se zatím emituje před dokončením rehydrate fetchů a retry
  exhaustion zůstává tichý. To je následující nezávislý checkpoint.
- `ConversationStore.exists()` považuje za existující i archivovaný řádek.
  B4 jej konzervativně zachovává; produktová policy obnovit versus orphanovat
  archivovanou konverzaci není v M1 stanovena.

### Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/ws-bridge/ws-server.js` | syntax valid | 0 |
| `node --check tests/ws-bridge.test.js` | syntax valid | 0 |
| `node --check tests/e2e/80-ws-semantic-events.e2e.js` | syntax valid | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |

Plná `tests/e2e/80-ws-semantic-events.e2e.js` zde spuštěna nebyla: je
registrovaná jako T3/server a tento offline checkpoint nestartoval produktový
server ani model. Syntax a nový skutečný loopback rehydrate wire kontrakt jsou
zelené; serverová E2E zůstává povinnou součástí pozdější B4 journey.

### Commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1473 cest | 0 |
| `git diff --check` | bez chyb | 0 |

## Checkpoint 3 — ACK-bound a race-safe client rehydrate

Studio už po `hello_ack` nenačítá historii naslepo. Nejdřív odešle bounded
seznam kanonických identit a čeká nejvýše 5 sekund na serverem ověřený
`rehydrate_ack`. Chybějící, malformed, duplicitní nebo nevyžádané ACK identity
nemají autoritu načítat ani mazat lokální stav. Mapy identit mají null prototype,
takže i kontraktně platné ID `constructor` se nechová jako zděděný klíč.

Každé spojení a každý rehydrate běh má vlastní epochu. Stará socket zpráva ani
close handler nemohou routovat assistant event, shodit aktivní `_wsReady` nebo
naplánovat reconnect. History fetch smí commitnout data jen při shodě socket
epochy, conversation identity a lokálního chat snapshotu zachyceného ještě před
rehydrate requestem. Tím opožděná historie nepřepíše zprávu ani thinking stav
přidaný před ACK nebo po něm. Non-2xx, malformed payload, timeout a lokální
aktivita zachovají snapshot a vrátí `degraded`; raw chyba ani identita se do
completion payloadu nepřenáší.

Serverem odmítnutá identita vyčistí conversation-scoped ID, agent binding,
label, zprávy a thinking pouze tehdy, když se panel od requestu nezměnil.
Projektové spojení zůstává zachováno. Panel reset persistuje a znovu vyrenderuje.
`ws:reconnected` vznikne až po settle všech povolených history requestů a nese
jen počty `restored`, `invalid` a `failed`.

Prázdný history výsledek není vydáván za autoritativní důkaz prázdné
konverzace. Dnešní route vrací `200 []` také po hard-delete, takže neprázdný
lokální snapshot zůstane zachován a výsledek je `degraded`. Chybějící atomický
serverový kontrakt je samostatný `BLOCK` v
`docs/decisions/012-m1-rehydrate-empty-history-authority.md`.

### Co checkpoint negarantuje

- Retry counter se stále resetuje už v `onopen`, constructor failure nemá
  scheduler a vyčerpání 12 pokusů je tiché. To je následující D-7 checkpoint.
- Autoritativní obnova skutečně prázdné durable konverzace čeká na rozhodnutí
  012; bezpečný klientský fallback raději zachová data.
- Přesný M1 `CoreEvent` consumer zůstává blokovaný stale protocol delivery
  rozhodnutím 010 a HTTP send fallback effect authority rozhodnutím 011.
- Plná Electron journey, bounded soak ani finální UI nebyly v tomto offline
  checkpointu spuštěny. Non-visual runner kontrakt byl ověřen, nikoli produktový
  běh se skutečným displejem.

### Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js` | syntax valid | 0 |
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` | syntax valid | 0 |
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/event-bus.js` | syntax valid | 0 |
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 15 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |

Read-only P1/P2 review nejprve našel dva nepokryté závody: history fetch mohl
přepsat aktivitu v téže epoše a starý socket guard nebyl testem připnutý. Oba
mají explicitní negativní test. Review dále našel ACK/empty-history TOCTOU;
klientská destruktivní větev byla odstraněna a serverový zbytek je BLOCK 012,
nikoli skrytý PASS.

### Commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1474 cest | 0 |
| `git diff --check` | bez chyb | 0 |

## Checkpoint 4 — bounded reconnect a viditelné vyčerpání

Všechny automatické reconnect pokusy nyní vznikají v jediném
`_scheduleReconnect()` švu. Po initial spojení může vzniknout nejvýše 12
opakování s prodlevami `1/2/4/8/16/30×7 s`; třináctý timer nevznikne. Retry
counter a exhaustion latch se resetují pouze po current `hello_ack`, nikoli po
samotném otevření socketu.

Pětisekundový handshake timer začíná už po úspěšné konstrukci WebSocketu, takže
je bounded i socket uvázlý ve `CONNECTING`, nejen otevřené spojení bez ACK.
Synchronous constructor failure, handshake send failure, timeout a current
close používají stejný scheduler. Per-connection handshake latch označí timeout,
reject nebo send failure jako `FAILED` ještě před asynchronním close; pozdní ACK
proto nemůže krátce vytvořit false-ready ani resetovat backoff. Vyčerpání emituje právě jeden sanitizovaný
`ws:reconnect_exhausted {attempts,maxAttempts}`; panel nastaví health na offline,
zapíše operátorskou zprávu a obnoví health indikátor. Nejde o schválení vzhledu
finálního UI, pouze o funkční viditelnost terminal stavu.

`wsDestroy()` je permanentní shutdown dané client instance: zruší handshake,
rehydrate i retry timer, zachová disconnect resolution pending editů a žádný
již zařazený callback nemůže vytvořit socket nebo exhaustion event. Stará socket
epocha nadále nemůže ovlivnit aktivní spojení. Přijatý vratný default a cena
přepnutí jsou v `docs/decisions/013-m1-studio-reconnect-backoff.md`.

### Co checkpoint negarantuje

- Studio nemá ruční tlačítko Retry; po exhaustion je dnešní operátorská cesta
  kontrola backendu a restart Studia. Varianta s ručním obnovením budgetu je
  oddělená v rozhodnutí 013.
- Nejde o přesný M1 terminal consumer ani HTTP fallback opravu; rozhodnutí 010
  a 011 zůstávají beze změny.
- Empty-history autorita zůstává BLOCK 012. Reconnect ji nezakrývá a degraded
  snapshot není vydáván za restored.
- Skutečná Electron journey, bounded renderer soak a finální UI nebyly spuštěny.

### Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js` | syntax valid | 0 |
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` | syntax valid | 0 |
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 25 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |

Read-only P1/P2 review odhalil, že původní první návrh timeoutoval až od
`onopen` a neuměl tedy ukončit socket uvázlý v `CONNECTING`. Timer byl přesunut
na okamžik úspěšné konstrukce a dostal vlastní negativní test. Review také
vyžádal test druhého outage po obnově, takže odstranění resetu exhaustion latch
už nemůže zůstat zelené. Poslední async-close probe odhalil, že late ACK po
timeoutu mohl před `onclose` vytvořit false-ready a resetovat budget; explicitní
handshake latch a negativní test tuto větev zavřely. Kontrola shutdownu navíc připnula zachování
`edit:resolved(disconnect)` pro pending approval.

### Commit battery

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1475 cest | 0 |
| `git diff --check` | bez chyb | 0 |

## Blokovaná explorace — HTTP fallback effect authority

Po checkpointu 1 vznikl dependency-free fail-closed parser pro tři legacy
`POST /chat` fallbacky. Experimentální focused sada měla 14 passed / 0 failed,
exit 0 a dokazovala odmítnutí non-2xx, malformed JSON, prázdných odpovědí a
úniku raw error textu. Call-graph audit ale prokázal, že parser zachovává
závažnější vadu: fallback posílá `editMode:'ask'` do route, která jej ignoruje,
a effect-capable turn může dojít až k přímému filesystem zápisu bez approvalu.

Experimentální produktový a testový diff byl proto cíleně odstraněn před
commitem. Výsledek 14/14 není acceptance evidence a není uváděn jako oprava.
Bezpečnostní volba je zachycena v
`docs/decisions/011-m1-studio-http-fallback-effect-authority.md`; její obecný
call-graph dopad je `P1-FX-018` v M2 ledgeru. Dotčená HTTP část je `BLOCKED`,
zatímco reconnect/rehydrate a terminální korelace zůstávají nezávislým
pokračováním B4.

Tím zůstává false-success chování dnešního fallbacku otevřené. Nesmí se opravit
jen parserem, protože bezpečný výsledek vyžaduje buď fallback vypnout, nebo
serverem vynutit read-only/effect authority.

### Evidence dokumentačního checkpointu

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 4 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 65 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1472 cest | 0 |
| `git diff --check` | bez chyb | 0 |

## Otevřené nálezy pro další checkpointy

1. Commitnutý `@c3/protocol/lib/index.js` je stale stub; B4 allowlist nepovoluje
   bez rozhodnutí měnit protocol build delivery. Přesná consumer integrace je
   proto zastavená; nezávislé client-state a fail-closed opravy mohou pokračovat,
   dokud nebude delivery šev rozhodnutý v
   `docs/decisions/010-m1-studio-protocol-runtime-delivery.md`.
2. Tři HTTP fallbacky nekontrolují `response.ok` a mohou renderovat error JSON
   jako assistant; jejich izolovaná parser oprava je blokovaná rozhodnutím 011,
   protože stávající route zároveň obchází effect approval.
3. Serverem ověřený ACK, race-safe klient i bounded reconnect jsou hotové.
   Atomické rozlišení prázdné versus mezitím smazané historie dál blokuje
   rozhodnutí 012.
4. Existující Electron runner obchází veřejný `sendChat()` a připíná legacy
   pořadí assistant-before-turn-end; pro B4 acceptance se musí změnit.
5. Terminal STOP neruší backendový proces. To je M2 finding mimo B4 chat scope,
   nikoli důvod rozšířit tento checkpoint.

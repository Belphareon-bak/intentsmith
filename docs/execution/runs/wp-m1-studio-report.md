# WP-M1-STUDIO — průběžný report

- **stav WP:** `PARTIAL / BLOCKED` po REVIEW GATE 1; stable-ID/scoped-cancel,
  reconnect a rehydrate epoch/race/snapshot guardy jsou použitelné, ale
  identity-cleanup acceptance rehydrate checkpointu blokuje 014
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

## Checkpoint 2 — historický bounded lookup; identity authority BLOCKED

Tento checkpoint omezil lookup na prvních 32 položek, přijímal kanonický M1
tvar identity, odstraňoval duplicity a volal `ConversationStore.exists()`.
Původní report jej označil jako durable, ale live loopback test ve skutečnosti
injektuje **in-memory** store. Chybějící nebo malformed ID se do `validIds`
nedostane.
Jakákoli store výjimka zruší celý výsledek: server nevydá partial autoritativní
ACK a zavře socket kódem 1011, aby transientní DB chyba nemohla vést ke smazání
lokálního snapshotu. Log obsahuje pouze počty, nikoli identifikátory konverzací.

Živý loopback test vytvoří jednu in-memory konverzaci, provede hello a
rehydrate přes produkční `attachWebSocketServer()` a požaduje směs existujícího,
chybějícího, duplicitního a malformed ID. Wire acknowledgement obsahuje přesně
jedinou existující identitu.
Stejný wire test pak vyvolá store chybu a připíná close 1011 bez dalšího ACK.

### Post-review korekce checkpointu 2 — BLOCK 014

Tvrzení výše platí jen pro request do 32 položek a explicitní store exception.
Server request delší než 32 položek tiše usekne a vrátí
`validationFailed:false`; chybějící store nebo metoda `exists` vrátí prázdný
ACK se stejnou autoritou. Klient přitom komplement `validIds` čistí. Checkpoint
tedy **neprokazuje úplnou ACK autoritu** a jeho T25g test přímo připíná vadný
partial výsledek. Samostatné rozhodnutí
`docs/decisions/014-m1-rehydrate-ack-authority.md` vyžaduje úplný
`validIds/invalidIds` partition nebo reject bez ACK. Do implementace a live
DB-backed wire testu je tato část B4 `BLOCKED`, nikoli „PASS s omezením“.

Běžný UI stav drží 1–3 panely; nad 32 se dnes dostane jen poškozeným či ručně
editovaným persisted stavem nebo budoucím klientem. To omezuje současnou
reachability, neproměňuje však neúplný ACK na autoritativní.

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

Následující popis zachycuje stav checkpointu v době vzniku. Epoch/race/snapshot
guardy zůstávají použitelné, ale implicit-complement identity cleanup se po
nalezení 014 nesmí vydat za přijatý kontrakt.

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

Post-review 014 navíc prokázalo, že dnešní klient nečistí jen serverem explicitně
odmítnutou identitu: za invalidní bere i komplement částečného `validIds` ACK.
Tato větev se nesmí považovat za přijatou. Po 014 smí syntakticky platnou
durable identitu zrušit jen explicitní `invalidIds` z úplného ACK nad
DB-backed storem; in-memory store žádnou takovou autoritu nemá. Matching
`rehydrate_reject` degraduje bez čekání a lokálně malformed identita zachová
snapshot v quarantined stavu. Po 012/B typované history `404` pouze degraduje
a `_convId` zachová.

### Co checkpoint negarantuje

- Retry counter se stále resetuje už v `onopen`, constructor failure nemá
  scheduler a vyčerpání 12 pokusů je tiché. To je následující D-7 checkpoint.
- Autoritativní obnova skutečně prázdné durable konverzace čeká na implementaci
  schváleného 012/B; bezpečný klientský fallback zatím raději zachová data.
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
klientská destruktivní empty-history větev byla odstraněna, ale serverový
zbytek je BLOCK 012. Následný review navíc odhalil samostatný partial-ACK
BLOCK 014. Ani jeden není skrytý PASS.

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
- Nejde o přesný M1 terminal consumer ani HTTP fallback opravu. Operátor později
  schválil 010/A+ a 011/A; jejich implementace zůstává otevřená.
- Empty-history a ACK autorita zůstávají implementačně blokované v 012/B a
  014/A. Reconnect je nezakrývá a degraded snapshot není vydáván za restored.
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
handshake latch a negativní test tuto větev zavřely. Kontrola shutdownu navíc
připnula zachování `edit:resolved(disconnect)` pro pending approval.

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

Operátor následně schválil variantu A pro M1: všechny tři HTTP send fallbacky
se sjednotí do lokální fail-closed `NOT_SENT` větve s nulovým `/chat` requestem
a nulovým efektem. Transportní parita se vrátí až jako C nad M2 authority.
Původní B4 claim „WS/HTTP parity“ se tím vědomě mění na „WS send + fail-closed
offline stav“; implementace a negativní důkaz ještě chybí.

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

1. Commitnutý `@c3/protocol/lib/index.js` je stale stub. Operátor schválil
   010/A+: odstranit protocol `lib/**` z trackingu, vždy jej vytvořit root
   prebuildem a po něm dodat feature-negotiated M1 wire a terminal ledger.
   Implementace, clean build matrix a built journey ještě chybí.
2. Tři HTTP fallbacky nekontrolují `response.ok` a mohou renderovat error JSON
   jako assistant a zároveň obcházejí effect approval. 011/A je schválené;
   fallback se musí vypnout a lokální unsent stav zachovat.
3. Race-safe klient a bounded reconnect checkpointy jsou hotové. Rehydrate
   zůstává blokovaný dvěma nezávislými kontrakty: 012/B rozliší existující
   prázdnou historii od 404 a 014/A zakáže partial ACK autoritu.
4. Existující Electron runner obchází veřejný `sendChat()` a připíná legacy
   pořadí assistant-before-turn-end; pro B4 acceptance se musí změnit.
5. Terminal STOP neruší backendový proces. To je M2 finding mimo B4 chat scope,
   nikoli důvod rozšířit tento checkpoint.

## B4 exit stav pro REVIEW GATE 1

| Povinné chování briefu | Stav | Evidence / důvod |
|---|---|---|
| stabilní panel identity a cancel A bez zásahu do B | PASS | client 25/25; WS bridge 67/67 včetně scoped cancel |
| serverem ověřený rehydrate a invalid ID cleanup | BLOCKED | 012/B není implementováno; 014 prokázalo partial ACK a implicitní komplement cleanup, který dnešní green test připíná |
| bounded reconnect a řízený shutdown | PASS na client contract vrstvě | přesný cap, handshake timeout, async-close race a destroy testy |
| přesný M1 terminal consumer, late assistant a spinner terminal větve | BLOCKED | 010/A+ je schválené, ale protocol delivery, negotiated wire, ledger a built journey chybí |
| HTTP fallback: non-2xx nikdy jako assistant a žádný effect bypass | BLOCKED | 011/A je schválené, ale fail-closed `NOT_SENT` implementace a nulový-effect test chybí |
| built Theia multi-panel/cancel/restart journey | NOT RUN | závisí na terminal consumeru; dnešní UI není finální baseline |
| fresh-clone build parity | NOT RUN pro tento B4 tip | M0-E disposition zůstává platná, ale nový B4 runtime nebyl z clean clone spuštěn |
| bounded renderer soak na skutečném displeji | NOT RUN / INCONCLUSIVE | prostředí nebylo v B4 použito jako produktový displej; žádný formální PARK zatím nevznikl a M1 exit se netvrdí |

B4 tedy nekončí jako PASS. Věta o vyčerpaném nezávislém scope platila před
operátorským rozhodnutím; dnešní další povolený scope tvoří přesně follow-upy
010/A+, 011/A, 014/A a 012/B v pořadí z rozhodnutí 014. Implementační commity
B4 jsou `50280fcd`, `d145e95e`,
`446d197f`, `8e68a92e` a `a4067cd6`; výchozí dependency je `b7d0dbf6`.
Rozhodovací fronta B4 010–014 je operátorsky uzavřená. B4 je přesto `BLOCKED`,
dokud se 010/A+, 011/A, 012/B a 014/A neimplementují a neprojdou skutečnou
built journey. 013/A je potvrzený client-contract checkpoint. Souhrnný balík je
v `docs/execution/review-gate-1.md`.

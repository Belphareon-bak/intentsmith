# WP-M1-STUDIO — průběžný report

- **stav WP:** `PARTIAL / BLOCKED` po REVIEW GATE 1; stable-ID/scoped-cancel,
  reconnect, rehydrate epoch/race/snapshot guardy, 011/A fail-closed send a
  serverová i klientská polovina 014/A i 012/B a společný DB-backed live wire
  jsou implementované; 010/A+, built journey, fresh-clone parity a soak
  zůstávají otevřené
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

V tomto dřívějším checkpointu nebyl prázdný history výsledek vydáván za
autoritativní důkaz prázdné konverzace. Tehdejší route vracela `200 []` také po hard-delete, takže neprázdný
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
- Autoritativní obnova skutečně prázdné durable konverzace v tomto checkpointu
  ještě čekala na později schválené a nyní focused implementované 012/B.
- Přesný M1 `CoreEvent` consumer v tomto checkpointu zůstával blokovaný stale
  protocol delivery rozhodnutím 010 a HTTP send fallback effect authority
  rozhodnutím 011.
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
  schválil 010/A+ a 011/A; jejich implementace v tomto bodě zůstávala otevřená.
- Empty-history a ACK autorita byly v tomto checkpointu implementačně blokované
  v 012/B a 014/A. Reconnect je nezakrýval a degraded snapshot nebyl vydáván za
  restored; pozdější focused checkpointy obě rozhodnutí implementovaly.
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
offline stav“. Následující checkpoint tuto schválenou variantu implementuje;
historický experimentální parser zůstává pouze vysvětlením, proč samotná
kontrola `response.ok` nebyla acceptance.

### Evidence dokumentačního checkpointu

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 4 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 65 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 364 programů, 8 exclusions, fingerprint `b45e4da20315bf8c5edd3e08f74c5c8a6f9925aa0026211c1f047ffbd27691ff` | 0 |
| `node tests/repository-hygiene.test.js` | 1472 cest | 0 |
| `git diff --check` | bez chyb | 0 |

## Checkpoint 5 — 011/A WebSocket-only send a `NOT_SENT`

- **implementační SHA:** `2ead4662e00d0b2e39bc03b9b2eb389e07be87e8`
- **stav dílčího kontraktu:** `PASS`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Commit odstranil tři effect-capable legacy `POST /chat` fallbacky z
autoritativního Studio runtime. Normální send, edit resend i obě gap volby
používají jeden `_chatTryWsSend()` šev. `unavailable`, explicitní `false` i
synchronní transportní výjimka končí sanitizovaným `NOT_SENT`/retryable
stavem bez assistant zprávy, context pollu nebo automatického resend. Draft,
attachments, editovaná timeline a gap tlačítka zůstávají vratné. Funkční
banner se nepovažuje za finální UI.

Review při tom odhalil first-send ready-to-closed race: původní WS klient
publikoval nové conversation ID ještě před lokálním enqueue. Neúspěšný send
tak mohl vytvořit phantom ID, které pozdější rehydrate smazal spolu s lokální
timeline. Identity nyní používá `prepare → socket queue → publish` commit
point; false ani throw ji neuloží a nevydá `session:identity`.

Behaviorální matice vykonává skutečné funkce z commitnutého `lib` bundle.
Promptové větve pokrývají `FILE_WRITE`, `SHELL` i generic-tool vstupy;
gap API je testované oběma skutečnými fixními volbami. Každý pokus modeluje
legacy endpoint jako provider/filesystem/shell/tool-capable a pinuje přesně
nulový HTTP i downstream efekt. Nejde o skutečný provider nebo filesystem
běh. Browserové přečtení uživatelem zvoleného attachmentu je povolená lokální
příprava, ne backendový efekt.

### Mutační kontroly

| Mutace | Očekávaný červený výsledek | Exit |
|---|---:|---:|
| `sendChat() === false` chybně změněno na `QUEUED_WS` | 27 passed, 2 failed | 1 |
| identity publish přesunut před `wsSend()` | 31 passed, 2 failed | 1 |

Po každé mutaci byl zdroj obnoven přesnou opačnou záplatou a focused sada
znovu zezelenala. Žádná aserce nebyla oslabena.

### Validace na implementačním SHA

Před během byl `HEAD` přesně `2ead4662e00d0b2e39bc03b9b2eb389e07be87e8`
a path-scoped diff pro `src/`, `scripts/`, `tests/`, `c3-ide/` a decision 011
byl prázdný (`PATH_SCOPED_EXIT=0`). Celý checkout nebyl vydáván za čistý:
obsahoval disjunktní chráněnou governance práci v dokumentaci.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 33 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 373 programů, 8 exclusions, fingerprint `72417b86ac74930fd35e2f3916e88fd5d483e8e7ee56ded3909f49fe489a4690` | 0 |
| `node tests/repository-hygiene.test.js` | 1502 tracked paths | 0 |

Fresh-clone Theia build, skutečná Electron journey a renderer soak nebyly
součástí tohoto checkpointu a zůstávají otevřenými B4 podmínkami.

## Checkpoint 6 — korelace async attachment sendu

- **stav dílčího kontraktu:** `PASS`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Read-only review checkpointu 011 odhalilo, že callback po asynchronním
`FileReader` nebyl svázaný s původní session. Reset, close, replace, panel
shrink, relay target nebo změna identity/edit mode před dokončením čtení mohly
nechat starý prompt odejít do nového kontextu. Oprava zachytí přesný
session/chat/timeline/user-turn stav, aktivní slot, routing hodnoty a oddělené
session/turn tokeny. Každý destructive session přechod vlastnictví před změnou
stavu invaliduje. Druhý send je single-flight odmítnut bez ztráty draftu;
pre-wire cancel je lokální a nemůže zrušit starší remote turn.

Behaviorální test vykonává skutečný commitnutý send/reset/count slice s
řízeným `FileReader`. Reset, výměna session, hidden slot, route drift a
pre-wire cancel vedou k nule WS i fallback efektů; pouhý switch panelu odešle
správný původní turn. Odstranění active-slot a single-flight guardu i návrat
chybné exact-length recovery podmínky v oddělených mutacích vždy zčervenaly
(`37 passed, 1 failed`, exit `1`). Obnovený zdroj prošel `38 passed, 0 failed`,
exit `0`. Podrobnost a zbývající hranice jsou ve
[`Findingu 009`](../../findings/009-studio-stale-attachment-send.md).

### Validace checkpointu 6

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 38 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed, 0 skipped | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 373 programů, 8 exclusions, fingerprint `72417b86…a4690` | 0 |
| `node tests/repository-hygiene.test.js` | 1507 tracked paths | 0 |
| `git diff --cached --check` | bez chyb | 0 |

Tento checkpoint nepřidává automatický resend ani durable retry a netvrdí
globální conversation mutex. Built journey a ostatní B4 rozhodnutí zůstávají
otevřené.

## Checkpoint 7 — serverová autorita rehydrate 014/A

- **stav serverového dílčího kontraktu:** `PASS focused`
- **celý 014/A, B4 a Gate 1:** nadále `BLOCKED`

Legacy server už netvoří autoritativní ACK z prvních 32 položek ani z pouhé
přítomnosti `exists()`. Nejprve bez DB effectu ověří syntakticky platný
`rehydrateRequestId`, array shape, limit 32, každé ID a duplicity. Platný
request ID s vadným setem dostane request-bound `rehydrate_reject`; neplatný
request ID zavře socket `1008` bez echo hodnoty.

Teprve úplný validní set smí vstoupit do durable lookupu. Nový explicitní
`ConversationStore.isDurableReady()` připouští pouze otevřenou file-backed
SQLite a připravený conversation lookup. In-memory store, zavřená nebo neúplná
DB, lookup exception a jakýkoli návrat `exists()` jiný než přesné `true/false`
končí socketem `1011` bez ACK/reject autority. Úspěch nese `complete:true` a
ordered disjunktní partition, jehož sjednocení je celý request.

Focused wire test už nepředstírá durable autoritu přes
`getConversationStore(null)`: používá vlastní file-backed SQLite, prokazuje
validní/missing partition, over-limit reject před lookupem, malformed request
ID, transientní lookup chybu i in-memory close. Unit matice navíc pinuje přesně
32 a 40 ID, duplicate/malformed/non-array set, partial lookup exception a
async/non-boolean authority mismatch.

V tomto serverovém mezikroku klient nové ACK/reject schéma ještě nekonzumoval.
LocalStorage clamp, slot/object ownership, quarantine a 012 route/client
ordering byly následující checkpointy;
proto tento serverový PASS není celý 014 ani B4 acceptance. Starý klient v
tomto mezistavu fail-closed dostane `1008`; serverový commit se nesmí samostatně
integračně přijmout jako funkční reconnect delivery.

### Validace checkpointu 7

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 38 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `node --check tests/e2e/80-ws-semantic-events.e2e.js` | syntax valid | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 373 programů, 8 exclusions, fingerprint `72417b86…a4690` | 0 |
| `node tests/repository-hygiene.test.js` | 1507 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

Tři oddělené mutace byly po běhu přesnou opačnou záplatou obnoveny. Vynechání
durable readiness guardu skončilo `65 passed, 2 failed`, exit `1`; přijetí
truthy místo přesného boolean lookupu `66/1`, exit `1`; změna limitu z `>32`
na `>=32` rovněž `66/1`, exit `1`. Finální obnovený zdroj je výše uvedených
`67/0`; aserce nebyly kvůli zelené měněné.

## Checkpoint 8 — klientská autorita rehydrate 014/A

- **stav klientského dílčího kontraktu:** `PASS focused`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Každý rehydrate běh nese unikátní request ID a klient přijme jen matching
exact ACK s úplným `validIds/invalidIds` partition. Foreign nebo missing ID
neukončí timer. Matching malformed ACK degraduje bez history/cleanup effectu;
exact matching typed reject degraduje okamžitě, zatímco foreign či malformed
reject aktuální běh neukončí. ACK/reject jsou dispatchované před generic
conversation routingem, takže cizí control payload nemůže přiřadit identitu
prázdnému panelu.

Explicitní invalidita se uplatní jen na původní živý slot se stejným session,
chat a messages objektem, conversation ID a nezměněnou timeline signaturou.
Transport mutaci provede jednou a UI pouze persistuje přesně korelovaný
`session:invalidated`; legacy `session_invalid` je neautoritativní warning.
Malformed lokální identita zůstává se všemi daty quarantined/read-only a chat
effect fail-closes. Restore normalizuje celočíselný count na `1..3`, active na
platný index, invalidní typy na defaulty a iteraci ořízne na bounded počet.
Degraded reconnect už není v UI hlášen zeleným success logem.

### Focused evidence a mutace

| Příkaz / mutace | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 46 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 67 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| foreign ACK correlation guard odstraněn | 45 passed, 1 failed | 1 |
| exact live-slot owner guard odstraněn | 45 passed, 1 failed | 1 |
| legacy warning propuštěn do generic routeru | 45 passed, 1 failed | 1 |
| horní `sessionCount` bound odstraněn | 45 passed, 1 failed | 1 |

Po každé mutaci byla aplikována přesná opačná záplata; obnovený zdroj znovu
prošel `46/46` a `git diff --check`. Tento checkpoint ještě nemění history
route. Do 012/B se proto `200 []` záměrně nepovažuje za autoritativní prázdnou
historii. DB-backed server+client live wire, production build a Electron
journey nebyly spuštěny a nejsou tímto focused výsledkem nahrazeny.
Status bar v tomto checkpointu nadále vyjadřuje transport/backend health, ne
úspěšnost rehydrate; degraded restore je viditelný warning v agent logu, nikoli
nový amber health stav.

## Checkpoint 9 — existence-aware history route 012/B

- **stav route kontraktu:** `PASS focused`
- **celý B4 / Gate 1:** nadále `BLOCKED`

`GET /api/conversations/:id/messages` nyní čte existenci konverzace a
její zprávy v jedné synchronní SQLite transakci. Existující prázdná konverzace
vrací `200 {messages: []}`, existující neprázdná přesnou historii a chybějící
identita přesný `404 CONVERSATION_NOT_FOUND` bez čtení případných orphan
messages. Chybějící transakční API, DB výjimka a malformed successful snapshot
fail-closed vracejí sanitizovaný `500`.

Focused `node tests/m1-chat-contract.test.js` prošel `21/21`. Obejít transakci
přímým voláním callbacku skončilo `18/3`, falešně označit chybějící konverzaci
za existující `20/1` a odstranit array-validaci snapshotu `20/1`; všechny tři
mutace měly exit `1` a byly přesně obnovené. Klientská interpretace `200 []`,
typed `404`, same-ID slot reuse a společný DB-backed wire journey jsou další
checkpointy, nikoli implicitní součást tohoto route PASS.

## Checkpoint 10 — klientská empty-history autorita 012/B

- **stav klientského kontraktu:** `PASS focused`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Po úplném matching ACK nyní `200 {messages: []}` nahradí nezměněný lokální
snapshot a odstraní thinking pouze tehdy, když stále sedí socket epocha,
pozice, session, chat a messages objekt, conversation ID i timeline signatura.
Typovaný `404 CONVERSATION_NOT_FOUND`, ostatní non-2xx, timeout a malformed
payload nemají identity ani content cleanup autoritu a skončí `degraded` se
zachovaným `_convId` a lokálními daty. Pozdní history výsledek se neuplatní ani
na slot znovupoužitý po ACK se stejným ID.

Focused `node tests/m1-studio-client.test.js` prošel `48/48`. Opětovné zavedení
ambiguous-empty guardu skončilo `47/1`; destruktivní cleanup ve failure větvi
`45/3`; odstranění exact live-slot guardu `46/2`. Každá mutace měla exit `1`,
byla přesně obnovena a finální zdroj znovu prošel `48/48`.

Tento PASS je stále VM klientský kontrakt, ne společný DB-backed wire ani built
Theia journey. B4 a Gate 1 proto zůstávají `BLOCKED`.

## Checkpoint 11 — post-review hardening klienta 012/B

- **stav opraveného klientského důkazu:** `PASS focused`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Nezávislý review správně odmítl původní `48/48` jako neúplný důkaz. Klient nyní
vyžaduje přesný HTTP `200`, takže `201/206` nemohou získat content authority.
Kompozitní test provede ACK, reuse stejného slotu se stejným ID a teprve potom
typed `404`; nový i původní snapshot zůstanou beze změny. Další negativy přímo
pokrývají rejected/timeout fetch, post-ACK výměnu chat/messages referencí a
změnu connection epochy bez pomocné změny signature.

Finální `node tests/m1-studio-client.test.js` prošel `53/53`. Mutace status
guardu a epoch guardu skončily každá `52/1`, live-slot guard `51/2` a přidání
cleanup effectu do failure větve `48/5`; vše exit `1`, přesně obnoveno. Tím je
klientský focused důkaz opraven, nikoli nahrazen společný live wire.

## Checkpoint 12 — společný DB-backed rehydrate live wire

- **stav společného 012/014 wire kontraktu:** `PASS focused`
- **celý B4 / Gate 1:** nadále `BLOCKED`

T25h používá file-backed SQLite ve vlastněném artifact rootu, skutečný
`attachWebSocketServer`, produkční `GET /api/conversations/:id/messages`,
commitnutý Studio `ws-client.js` vykonaný ve VM, reálný `ws.WebSocket` a Node
`fetch`. Nejde tedy o spojení dvou fake harnessů ani in-memory autoritu.

V jednom běhu durable empty panel projde úplným ACK a živým HTTP `200 []`,
missing panel je vyčištěn jen přes explicitní `invalidIds` a třetí durable ID se
smaže až po ACK. Fetch wrapper před jeho skutečným GET znovu použije slot se
stejným ID; produkční route vrátí `404` a původní i replacement snapshot
zůstanou nedotčené. Completion přesně hlásí `restored=1`, `invalid=1`,
`failed=1`, tedy `degraded`.

`node tests/ws-bridge.test.js` prošel `68/68`. Návrat starého empty-history
guardu shodil T25h na `67/1`; změna produkční missing route z `404` na `200`
také `67/1`. Obě mutace skončily exit `1`, byly přesně obnovené a finální sada
znovu prošla `68/68`.

## Checkpoint 13 — generated protocol prebuild candidate

- **stav generated delivery vrstvy 010/A+:** `IMPLEMENTED / focused contract green`
- **clean-clone build / negotiated wire / celý B4:** nadále `BLOCKED`

Stale trackovaný `c3-protocol/lib/index.js` byl odstraněn. Celý protocol
`lib/**` je nyní ignorovaný generated output a root Studio build jej vždy před
Electron buildem odstraní, zkompiluje z přijatého TypeScript mirroru a
fail-closed ověří verzi i povinné M1 runtime validátory. Root clean odstraňuje
jen generated protocol output a Electron output; preserve kontrakt
autoritativního `c3-chat-panel/lib/**` se nemění.

Registrovaná Studio sada prošla `57/57`. Odstranění post-compile runtime verify
kroku dalo `56/1`; odstranění Git ignore policy rovněž `56/1`. Obě mutace měly
exit `1` a byly přesně obnovené.

První fresh-clone build na `1478cb20` skončil exit `1` před Electron bundlingem,
protože verifier požadoval pojmenované command/result exporty, které přijatý
TypeScript mirror nemá. Oprava verifier svázala s reálným veřejným mirror API:
generický validator, stream/terminal validaci, codec/round-trip a type guard.
Nezměnila M1 schéma ani mirror a nesnížila command/result validaci — tu provádí
`validateM1Contract()`.

Druhý fresh-clone build na `48267f5e` rovněž skončil exit `1` před Electron
bundlingem: `clean` odstranil `lib`, ale zachovaný `tsconfig.tsbuildinfo`
způsobil no-op `tsc -b` a následný verifier odmítl chybějící package main.
Prebuild nyní vynucuje `tsc -b --force`, takže timestamp cache nemůže zabránit
obnovení generated outputu.

Třetí fresh-clone běh na
`aee0f6646409b2a539df04c157e029808cdf6bf5` prošel: frozen Yarn install,
root `clean`, forced protocol prebuild, runtime export verify i celý Electron
production build skončily exit `0`. Compiled mirror prošel kanonickou pozitivní
i negativní maticí `27/27`; samostatný export probe hlásil
`PROTOCOL_RUNTIME_EXPORTS_PASS`. Tracked/untracked porcelain po buildu zůstal
prázdný a protocol/Electron output byl pouze ignored.

Webpack vydal jen známé performance/dependency warnings. Search ve výsledném
Electron outputu nenašel M1 runtime symboly: Studio zatím nemá negotiated M1
consumer import, takže tento běh nedokládá product-bundle consumption. Tato
podmínka zůstává otevřená spolu s wire/ledger journey.

Tento checkpoint neběžel v dirty checkoutu jako produktový build a netvrdí
fresh-clone parity. Následuje samostatný evidenční běh z commitnutého SHA:
frozen Yarn install, `clean + build`, compiled negative matrix, kontrola bundle
a čistého tracked stromu. Až potom smí začít negotiated M1 wire a terminal
ledger.

## Checkpoint 14 — společný build/watch protocol bootstrap candidate

- **stav bootstrap kontraktu:** `IMPLEMENTED / focused contract green`
- **fresh-clone prewatch důkaz:** čeká na commitnutý SHA
- **negotiated wire / celý B4:** nadále `BLOCKED`

Root build a watch nyní delegují na jediný `prepare:protocol`, který v přesném
pořadí odstraní generated output, vynutí TypeScript compile a ověří veřejný M1
runtime export. Kanonický root `watch` proto po prvním budoucím importu
`@c3/protocol` nezačne nad stale nebo chybějícím package main.

Checkpoint záměrně nepřidává souběžný protocol watcher ani process-manager
závislost. Neprokazuje live rebuild po změně protocol source a nechrání přímé
spuštění `applications/electron` skriptů mimo kořenový kontrakt. Fresh-clone
`clean → prewatch → export/contract matrix → clean porcelain` se zaznamená až
nad commitnutým kandidátem.

Focused Studio sada prošla `57/57`. Nahrazení `prewatch` přímým Electron watch
i odstranění `--force` z jediného preparation seamu ji nezávisle shodily na
`56/1`, exit `1`. Obě přesné mutace byly obnovené.

## Otevřené nálezy pro další checkpointy

1. Generated protocol prebuild část 010/A+ je clean-clone ověřená. Zbývá dodat
   feature-negotiated M1 wire, skutečný product-bundle consumer a terminal
   ledger. Call-graph trasování po clean-clone běhu ukázalo tři dosud
   neurčené veřejné významy: vlastnictví feature tokenu, exact transportní
   wrapper pro legacy context a ordering cílového/cancel terminálu. Jsou
   shromážděné v
   [`rozhodnutí 017`](../../decisions/017-m1-negotiated-wire-shape.md); do jeho
   přijetí se wire neimplementuje skrytým defaultem.
2. Async attachment callback je focused uzavřený Findingem 009: reset,
   close, replace a identity/timeline drift starý callback fail-closed zruší.
   Durable retry a globální conversation mutex tím nejsou vyřešené.
3. Race-safe klient, bounded reconnect, obě poloviny 014/A i 012/B a společný
   DB-backed live wire jsou focused hotové.
4. Existující Electron runner obchází veřejný `sendChat()` a připíná legacy
   pořadí assistant-before-turn-end; pro B4 acceptance se musí změnit.
5. Terminal STOP neruší backendový proces. To je M2 finding mimo B4 chat scope,
   nikoli důvod rozšířit tento checkpoint.

## B4 exit stav pro REVIEW GATE 1

| Povinné chování briefu | Stav | Evidence / důvod |
|---|---|---|
| stabilní panel identity a cancel A bez zásahu do B | PASS | client 46/46; WS bridge 67/67 včetně scoped cancel a phantom-ID negativu |
| serverem ověřený rehydrate a invalid ID cleanup | PASS focused | server i klient 014/A i 012/B a společný DB-backed live wire T25h jsou hotové; built Theia journey zůstává samostatnou B4 podmínkou |
| bounded reconnect a řízený shutdown | PASS na client contract vrstvě | přesný cap, handshake timeout, async-close race a destroy testy |
| přesný M1 terminal consumer, late assistant a spinner terminal větve | BLOCKED | generated prebuild část 010/A+ je clean-clone ověřená; product-bundle consumer, negotiated wire, ledger a built journey chybí |
| HTTP fallback: non-2xx nikdy jako assistant a žádný effect bypass | PASS focused | 011/A na `2ead4662`: tři WS-only větve, `NOT_SENT`, nulový HTTP/simulovaný downstream efekt; built journey stále chybí |
| built Theia multi-panel/cancel/restart journey | NOT RUN | závisí na terminal consumeru; dnešní UI není finální baseline |
| fresh-clone build parity | NOT RUN pro tento B4 tip | M0-E disposition zůstává platná, ale nový B4 runtime nebyl z clean clone spuštěn |
| bounded renderer soak na skutečném displeji | NOT RUN / INCONCLUSIVE | prostředí nebylo v B4 použito jako produktový displej; žádný formální PARK zatím nevznikl a M1 exit se netvrdí |

B4 tedy nekončí jako PASS. Věta o vyčerpaném nezávislém scope platila před
operátorským rozhodnutím; dnešní další povolený scope tvoří přesně follow-upy
010/A+, 011/A, 014/A a 012/B v pořadí z rozhodnutí 014. Implementační commity
B4 jsou `50280fcd`, `d145e95e`,
`446d197f`, `8e68a92e`, `a4067cd6` a `2ead4662`; výchozí dependency je
`b7d0dbf6`.
Rozhodovací fronta B4 010–014 je operátorsky uzavřená; nový wire balík 017
čeká na operátora. B4 je přesto `BLOCKED`, dokud se 010/A+ negotiated consumer
a built journey nedokončí. Server i klient 014/A i 012/B,
společný DB-backed live wire a 011/A jsou focused PASS, nikoli celé B4. 013/A je potvrzený
client-contract checkpoint. Souhrnný balík je v
`docs/execution/review-gate-1.md`.

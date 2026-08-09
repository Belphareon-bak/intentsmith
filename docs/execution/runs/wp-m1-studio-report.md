# WP-M1-STUDIO — průběžný report

- **stav WP:** `PARTIAL / BLOCKED` po REVIEW GATE 1; stable-ID/scoped-cancel,
  reconnect, rehydrate epoch/race/snapshot guardy, 011/A fail-closed send a
  serverová i klientská polovina 014/A i 012/B a společný DB-backed live wire
  jsou implementované; 010/A+ je clean-clone ověřené a 022/A má focused
  operation-bound implementaci. Produkční ACK, built negotiated journey a
  celý B4 zůstávají otevřené
- **base SHA:** `b7d0dbf61370b52061e6a736517ecdcb53118209`
- **scope:** B4 podle `docs/execution/m1-batch.md`
- **UI baseline:** výslovně mimo scope; spuštěné Studio není finální UI
- **GPU/Ollama/externí síť:** NOT RUN
- **publikace:** průběžné checkpointy mají vlastní commit/push evidenci; stav
  právě rozpracovaného checkpointu se odvozuje z jeho závěrečného záznamu

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
- **fresh-clone prewatch důkaz:** `PASS` na `809346e7`
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

Nový lokální clone přesně na
`809346e7d29930c8a113a7d8c1b9b155c941b0a5` provedl:

| Příkaz | Výsledek | Exit |
|---|---|---:|
| `corepack yarn install --frozen-lockfile --non-interactive` | frozen install; pouze peer/engine warnings | 0 |
| `corepack yarn clean` | protocol output odstraněn, chat-panel runtime zachován | 0 |
| `corepack yarn run prewatch` | clean, forced compile a runtime export verify | 0 |
| `node tests/m1-contract.test.js --typescript-runtime=<clone>/c3-ide/extensions/c3-protocol/lib/m1.js` | 27 passed, 0 failed | 0 |
| runtime export probe | `PROTOCOL_RUNTIME_EXPORTS_PASS` | 0 |
| `git status --porcelain=v1 --untracked-files=all` | prázdný | 0 |

Node při source-mirror testu vydal pouze známé upozornění na chybějící
`type:module` u TS package. Prewatch claim nezahrnuje dlouho běžící Electron
watcher ani live rebuild protocol zdroje; tyto silnější výsledky se z tohoto
běhu neodvozují.

## Checkpoint 15 — current-HEAD legacy Studio build a bounded runtime

- **testovaný SHA:** `9464dacf9b14249965ae79f31518ff1512b7543b`
- **current legacy Studio runtime:** `PASS`
- **negotiated M1 wire / B4:** nadále `BLOCKED`

Nový disposable clone v `/tmp` ověřil, že dnešní checkpoint lze bez sítě
nainstalovat, produkčně sestavit a spustit přes commitnutý Electron boundary
runner. Tento běh není vizuální akceptace současného UI a není náhradou za
multi-panel/cancel/restart journey. Prokazuje ale, že build, X11, izolovaný
loopback namespace a současná legacy deterministic-chat cesta jsou na stejném
SHA funkční; prostředí už proto není skrytým blockerem navazující B4 práce.

| Příkaz | Výsledek | Exit |
|---|---|---:|
| `git clone --no-local /home/belphareon/Projects/intentsmith <clone>` | exact HEAD `9464dacf…7543b` | 0 |
| `npm ci --offline` | 233 balíčků; audit 234; 0 vulnerabilities | 0 |
| `corepack yarn install --frozen-lockfile --non-interactive --offline` | Yarn 1.22.22 frozen install; jen známé peer/engine warnings | 0 |
| `corepack yarn build` | forced protocol prebuild + production Theia/Electron build; jen webpack size/dynamic-import warnings | 0 |
| `node tests/m1-studio-client.test.js` | 57 passed, 0 failed | 0 |
| `node tests/studio-cdp-evidence.test.js` | 59 passed, 0 failed | 0 |
| `node tests/studio-electron-runner-contract.test.js` | 16 passed, 0 failed | 0 |
| registrovaný `tests/studio-electron-boundary.e2e.js` s exact SHA, privátním artifact rootem a scoped X11 | `STUDIO_ELECTRON_BOUNDARY_PASS` | 0 |
| `git status --porcelain=v1 -uall` po build/testu | prázdný | 0 |
| `git diff --check` po build/testu | bez chyb | 0 |

Runner pozoroval 65 862 ms live-ready a 66 736 ms síťového provozu. Zachytil
654 CDP událostí, 27 chráněných HTTP requestů, jeden backend WS, pět Theia
control-plane HTTP requestů a jeden Theia WS; external, other-loopback,
unsupported, malformed, ambiguous i orphaned počty byly nula. Bez capability
byl opaque request odmítnut `403`, cross-site request bez Origin byl odmítnut
`403` a exact opaque capability cesta vrátila `200`. Deterministický turn měl
právě jeden start, routing decision, assistant a `ok` terminal, nula provider
requestů i zakázaných efektů. Electron i backend skončily čistě, port file byl
odstraněn a process groups nezůstaly živé.

Sanitizovaný mode-0600 artifact zůstal lokálně mimo Git; jeho SHA-256 je
`b331a4fc3a8b835116ce72abeab7bc662fd043dd46e089a2003e138a061b1c23`.
`uiEvaluation` zůstává pravdivě `excluded-non-final-ui`. Runner stále posílá
legacy frame přes nízkoúrovňové `C3WS.send('chat', ...)`; neprokazuje
product-bundle M1 consumer ani rozhodnutí 017.

## Otevřené nálezy pro další checkpointy

1. Generated protocol prebuild část 010/A+ je clean-clone ověřená. Zbývá dodat
   feature-negotiated M1 wire, skutečný product-bundle consumer a terminal
   ledger. Call-graph trasování po clean-clone běhu ukázalo tři dosud
   neurčené veřejné významy: vlastnictví feature tokenu a exact transportní
   wrapper pro legacy context. Původně uvažovaná třetí otázka — ordering
   cílového a cancel terminálu — už závazně plyne z 004/C a znovu se
   neotevírá. Dva skutečné BLOCKy jsou shromážděné v
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
| stabilní panel identity a cancel A bez zásahu do B | PASS focused + owned-loopback | source VM i actual Node WebSocket vedou tři panely odděleně; target cancel terminal předchází cancel command terminalu a success/provider panel zůstává nezávislý |
| serverem ověřený rehydrate a invalid ID cleanup | PASS focused | server i klient 014/A i 012/B a společný DB-backed live wire T25h jsou hotové; built Theia journey zůstává samostatnou B4 podmínkou |
| bounded reconnect a řízený shutdown | PASS na client contract vrstvě | přesný cap, handshake timeout, async-close race a destroy testy |
| přesný M1 terminal consumer, late assistant a spinner terminal větve | PASS source/build integrity + owned-loopback | generated prebuild, autoritativní consumer, production bundle, exact ledger a skutečný test-owned negotiated WS jsou ověřené; produkční ACK a Electron journey zůstávají blokované |
| HTTP fallback: non-2xx nikdy jako assistant a žádný effect bypass | PASS focused | 011/A na `2ead4662`: tři WS-only větve, `NOT_SENT`, nulový HTTP/simulovaný downstream efekt; built journey stále chybí |
| built Theia multi-panel/cancel/restart journey | NOT RUN | source-level a owned-loopback Node journey už existují; Electron runtime čeká na 021 a samostatný čistý build envelope; dnešní UI není finální baseline |
| fresh-clone build parity | PASS pro compiled M1 consumer na `7b887e88`; B4 stále NOT RUN | offline install, production build a automatický postbuild ověřily generated protocol, consumer i bundle; behavioral Electron wire se nespustil |
| bounded renderer soak na skutečném displeji | PASS pro non-visual legacy boundary; B4 stále NOT RUN | 65 862 ms na scoped X11 s čistým shutdownem a nulovým egresssem; UI nebylo hodnocené a M1 multi-panel/cancel/restart scénář se nespustil |

B4 tedy nekončí jako PASS. Dřívější follow-upy 010/A+, 011/A, 014/A a 012/B
jsou implementované; required-offer, exact adapter/ledger, compiled consumer,
postbuild guard a test-owned live wire přidaly navazující checkpointy 16–22.
Rozhodovací fronta B4 010–014 je operátorsky uzavřená a operátor přijal také
wire balík `017-Q1:A` + `017-Q2:A`. B4 je přesto `BLOCKED`: produkční ACK
zůstává záměrně vypnutý do rozhodnutí 021 a následné built Electron journey.
Server i klient 014/A i 012/B, společný DB-backed live wire, 011/A a
nový negotiated owned-loopback wire jsou focused PASS, nikoli celé B4. 013/A
je potvrzený client-contract checkpoint. Souhrnný balík je v
`docs/execution/review-gate-1.md`.

## Read-only uzavření decision evidence 017

Audit na `a82015a5` potvrdil `017-Q1:A` a `017-Q2:A`, ale zároveň prokázal, že
aktivní wire nelze bezpečně implementovat implicitním defaultem. Dnešní
`buildHelloAck([])` vrací všechny server features, takže nový token musí mít
required-offer sémantiku; requested a negotiated set nejsou totéž. Server dnes
negotiated set neuchovává a Studio ACK nekontroluje proti přesné nabídce.

Legacy session adapter navíc vlastní `turnId`, socket-global sequence a dvojí
legacy assistant/terminal egress. M1 proto potřebuje oddělený exact ingress a
jediný kanonický egress. Context wrapper musí kromě exact keys určit
`editMode=auto|ask`, nullable identity pole a ohraničený attachment kontrakt;
path podvětev bez existující FS autority zůstane PARK.

Audit nespouštěl build ani UI a nic neměnil. Přijetí A/A otevírá required-offer
negotiation checkpoint; aktivní wire, terminal ledger napojený na transport a
built M1 journey zůstávají `BLOCKED`, dokud nevznikne runtime evidence.

## Checkpoint 16 — fail-closed required-offer negotiation candidate

- **vstupní HEAD:** `f43793bfd2e5fe618634dd0dbf3c22bc026e125f`
- **017/Q1 required-offer:** `IMPLEMENTED / FOCUSED PASS`
- **aktivní M1 ingress/egress a celý B4:** nadále `BLOCKED`

Studio nyní nabízí `m1-wire-v1` spolu s pěti legacy features, ale používá pro
něj samostatný ACK-bound latch. Nabídka sama nestačí: latch vyžaduje
`protocolVersion: 1`, token v nabídce konkrétního connection epochu i token v
server ACK. Connect, close a destroy smažou server features i latch; nový
socket proto nemůže zdědit M1 autoritu ze starého.

Server odvozuje jediný negotiated set a stejný set používá pro ACK i routing.
Současný server token záměrně neACKuje, protože exact `{command, context}`
adapter ještě není hotový. Úplný i částečný M1-shaped chat wrapper bez
negotiated tokenu se zachytí před legacy `processChat()` a ukončí session
close `1008`. Tím se nepovoluje implicitní downgrade jednoho turnu do legacy
cesty ani false capability claim.

| Příkaz | Výsledek | Exit |
|---|---|---:|
| `node --check src/ws-bridge/protocol.js && node --check src/ws-bridge/ws-server.js && node --check src/ws-bridge/index.js && node --check c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js` | syntax valid | 0 |
| `node tests/ws-bridge.test.js` | 74 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 61 passed, 0 failed | 0 |

Negativní live test token výslovně nabídne, ověří jeho absenci v ACK, pošle
exact M1 wrapper a prokáže nula controller efektů. Klientská sada připíná
legacy ACK, pozitivní ACK, chybějící/chybnou protocol verzi, malformed feature
list i reset při reconnectu.

Checkpoint neimplementuje Q2 exact context validaci, M1 command adapter,
kanonický event stream, cancel ordering, product-bundle consumer ani built
Electron journey. Server proto M1 stále neinzeruje a B4/Gate 1 není PASS.

### Clean-clone focused reprodukce a ratchet provenance

Nový `git clone --no-local` přesného source SHA
`7551b907d6600fe36d0624c6b9b897fc4cce7143` provedl `npm ci --offline`, WS
74/74 a Studio 61/61; všechny tři příkazy skončily exit `0`. Ratchet před
writerem pravdivě hlásil 1 020/1 020 hran a provenance šest commitů za HEAD.
Autoritativní `--write-baseline` nepřijal žádnou novou hranu ani cyklus, pouze
připnul stejných 1 020 hran k source tree `852dde2c…ac11`; následný checker
hlásil `commitsBehind=0`, exit `0`.

Jde o clean-clone focused reprodukci, ne production Theia build. Build a
Electron journey zůstávají až u exact ingress/egress a product consumeru.

## Checkpoint 17 — dormantní exact M1 server adapter

- **vstupní HEAD:** `fbb8a5872d97f3240a00e76800d9f237c614345a`
- **017/Q2 server ingress/egress:** `IMPLEMENTED / FOCUSED PASS`
- **produkční ACK / celý B4:** nadále `BLOCKED`

`session-adapter.js` nyní přijímá exact `{command, context}`, zachovává tři
command identity, validuje každý `ConversationResult` i `CoreEvent` a vede
monotónní sequence zvlášť pro každý command. Negotiated turn nevydá legacy
assistant, agent event ani legacy `turn_end`. Provider error, timeout, busy,
missing cancel target a edit conflict končí jedním kanonickým terminálem.

Cancel implementuje přijaté 004/C. Cílový send nejprve vydá vlastní
`cancelled`; teprve potom každý samostatně identifikovaný cancel command vydá
svůj `cancelled`. Více souběžných cancelů sdílí immutable completion cíle a
každý dostane vlastní validní stream. Identity-kolidující cancel žádný event
nevydá, protože by kontaminoval cílový stream; transport jej místo toho
fail-closed zavře. Target timeout se odlišuje od confirmation timeoutu.

Attachment context je do rozhodnutí 021 exact empty-only. Path se nedostane do
controlleru a neprázdná kolekce skončí před efektem. Legacy shell auto-exec se
na M1 větvi nespouští. Protože dnešní controller může přesto vrátit shell
metadata jako chat success, produkční aktivace čeká na honest no-effect
terminal policy z [021](../../decisions/021-m1-wire-activation-residuals.md).

`attachWebSocketServer()` má explicitní `m1WireSupported=false`. Test jej smí
zapnout injekcí, ale `src/server.js` jej nepředává; živý produkt token stále
neACKuje. Po testově zapnutém ACK se každý chat frame validuje před controllerem
a legacy chat i legacy control cancel zavřou socket kódem 1008.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check src/ws-bridge/session-adapter.js` | syntax valid | 0 |
| `node --check src/ws-bridge/ws-server.js` | syntax valid | 0 |
| `node --check tests/ws-bridge.test.js` | syntax valid | 0 |
| `node tests/ws-bridge.test.js` | 85 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-chat-contract.test.js` | 21 passed, 0 failed, 0 skipped | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, 0 added, 0 removed; baseline source `7551b907`, one commit behind pre-commit HEAD | 0 |

Read-only re-review původně našel tři mezery: jediného cancel waitera, legacy
agent leak u edit conflictu a příliš úzkou failure aserci. Všechny tři byly
opravené. Follow-up navíc požadoval negativní WS větve a validaci každého
concurrent cancel streamu; focused sada je nyní obsahuje. T23eb stále dokládá
jen adapterovou edit cestu, ne všechny produkční approval call sites; residual
`P1-FX-018` tím není uzavřen.

Tento checkpoint není built Studio důkaz a neaktivuje M1 v produktu. Studio
producer/ledger je samostatný navazující commit; clean-clone build a skutečný
Electron journey proběhnou až nad oběma commitnutými částmi.

## Checkpoint 18 — dormantní exact M1 Studio producer a terminal ledger

- **vstupní HEAD:** `bed0a9e87857a3cc272073eb826cf7ac7f2684d3`
- **017/Q2 Studio producer/consumer:** `IMPLEMENTED / FOCUSED PASS`
- **produkční ACK / built journey / celý B4:** nadále `BLOCKED`

Autoritativní commitnutý Studio runtime nyní při negotiated M1 vytváří exact
`ConversationCommand` a context, vede bounded request ledger a přijímá pouze
validní monotónní `CoreEvent` stream. Aktivní send je vlastněný stabilním
`conversationId`, nikoli objektem nebo indexem panelu. Dva panely se stejnou
identitou proto nemohou vytvořit dva provider effecty; cancel z druhého panelu
se váže zpět na session skutečného cílového turnu.

Agent `executing` stav má pro M1 conversation-scoped autoritu a explicitní
false tombstone. Přesun panelu nemůže nechat STOP na starém indexu a pozdní
legacy status za negotiated transportu jej znovu nezapne. Protože panel
registruje terminal listener před agent klientem, agent po skutečném vyčištění
emituje samostatný render-only `agent:state` signál.

Přerušení spojení po lokálním sendu se nevydává za bezpečně opakovatelný
`NOT_SENT`. Panel drží `DELIVERY_UNKNOWN`, `retryable:false`; tento sideband
přežije i autoritativní nahrazení messages historií a další effect se
automaticky nespustí. Limit streamu je 256 eventů a 1 MiB skutečných
serializovaných UTF-8 bajtů. Terminál zahodí event payload, socket i panel
reference a ponechá jen bounded identity/order tombstone.

Gap volba se označí resolved až po conversation/preparation guardech. Busy
nebo připravovaný send ponechá volbu dostupnou, ukáže typovaný lokální BUSY
stav a nevytvoří user message, timer, wire frame ani jiný efekt.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check` nad třemi Studio runtime soubory a testem | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 85 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/m1-chat-contract.test.js` | 21 passed, 0 failed, 0 skipped | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 531 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | valid, 377 programů, fingerprint `1370be04573099588225b124a47cfdcb6e75c8fda2dcce6795d11ced767a75a6` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, 0 added, 0 removed; baseline `7551b907`, current committed source před tímto checkpointem `bed0a9e8` | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed, 0 skipped | 0 |

Focused test stále injektuje source contract do VM. Neprokazuje existenci
vygenerovaného `c3-protocol/lib`, production bundlu ani skutečný Electron wire.
Build se podle WP nespouští v dirty checkoutu; následuje až z čistého klonu
tohoto commitu. Produkční `src/server.js` dál M1 token neaktivuje. Attachment a
effect-authority volby z [021](../../decisions/021-m1-wire-activation-residuals.md)
zůstávají `DECISION_REQUIRED`, nikoli skrytý default.

### Clean-clone build evidence checkpointu 18

Disposable clone `/tmp/intentsmith-m1-build-x9mx4n` byl vytvořen přes
`git clone --no-local`, detached na přesném source SHA
`f2d9055c62e33a41b60025e467cca06ef28820d0` a před instalací měl prázdný
`git status --porcelain=v1 --untracked-files=all`.

| Příkaz | Výsledek | Exit |
|---|---|---:|
| `corepack yarn install --frozen-lockfile --offline --non-interactive` v `c3-ide/` | Yarn 1.22.22, offline install dokončen | 0 |
| `corepack yarn build` v `c3-ide/` | forced protocol prebuild, runtime export validation a Theia production build dokončeny; pouze webpack performance/dynamic-require warnings | 0 |
| skutečný `require('./extensions/c3-protocol')` + validace exact CoreEvent fixture | protocol v1, `validateM1Contract`, `validateCoreEventStream` a `classifyTerminal` jsou funkce; fixture valid | 0 |
| skutečný `require('./extensions/c3-chat-panel/lib/browser/ws-client.js')` bez testového protocol stubu | consumer loaded, `wsSendChat` a negotiation export jsou funkce | 0 |
| marker probe production `applications/electron/lib/frontend/bundle.js` | obsahuje hard protocol error, `m1-wire-v1`, UTF-8 stream limit, `DELIVERY_UNKNOWN`, `CONVERSATION_BUSY` a connection-replaced větev | 0 |
| `node tests/m1-studio-client.test.js` v klonu | 78 passed, 0 failed, 0 skipped | 0 |
| Google Fonts scan production bundlu | `NO_GOOGLE_FONTS_EGRESS` | 0 |
| finální `git status --porcelain=v1 --untracked-files=all` a `git diff --check` | tracked strom čistý; generated/install/build výstupy zůstaly ignored | 0 |

Build běžel na Node `v22.21.1`. Bundle má 11 751 013 B a SHA-256
`746f3671d9e7a5fed240791cb0dafb45f9369b750f64a1a5faaed9bb54b0a19a`;
generated protocol `lib/index.js` má SHA-256
`cdad67d9d818f845be3e6b6963b9befbecd4664b5ed1733af40df4883ad18f92`.
Jde o důkaz skutečného compiled consumeru, nikoli o negotiated Electron
journey: aplikace, backend, Ollama ani GPU nebyly spuštěny. Produkční ACK a
celý B4 proto zůstávají `BLOCKED`.

## Checkpoint 19 — fail-closed postbuild consumer guard

- **automatický build guard:** `IMPLEMENTED / FOCUSED PASS`
- **clean-clone build tohoto guardu:** `PASS` na `7b887e88`
- **produkční ACK / Electron journey / celý B4:** nadále `BLOCKED`

Root Studio `build` nově pokračuje přes `postbuild`, který čte skutečný
generated protocol runtime, autoritativní commitnutý Studio consumer a
production Electron bundle. Build skončí chybou, pokud protocol není verze 1,
chybí kterýkoli veřejný runtime validator/codec, exact `CoreEvent` fixture,
terminal stream nebo klasifikace je odmítnuta, consumer nemá send, cancel,
active-turn či negotiation export, bundle neobsahuje přijaté M1
větve nebo znovu obsahuje Google Fonts egress. Úspěch vydá byte-level SHA-256
a velikost všech tří ověřených artefaktů.

Consumer se načítá v samostatném child procesu. Top-level `fetch`, `WebSocket`
nebo `setTimeout` proto končí fail-closed a nemůže během offline postbuildu
provést skutečný efekt; známý top-level maintenance interval je inertní.
Focused sada drží nezávislé kanonické seznamy a pokrývá pozitivní kontrakt i
každý jednotlivě chybějící nebo nefunkční protocol export, consumer export a
bundle marker, chybnou protocol verzi, odmítnutou fixture, oba zakázané Fonts
hosty, missing/empty/symlink artefakt, izolaci effectu, CLI exit i byte-level
evidence:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check c3-ide/scripts/verify-m1-consumer-build.js` | syntax valid | 0 |
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 87 passed, 0 failed, 0 skipped | 0 |

Disposable lokální clone `/tmp/intentsmith-m1-postbuild-final-BZefSROl` byl
detached na přesném SHA `7b887e885b5df75bae112310954984c21b91bc7a`
a provedl:

| Příkaz | Výsledek | Exit |
|---|---|---:|
| `corepack yarn install --frozen-lockfile --offline --non-interactive` v `c3-ide/` | Yarn 1.22.22 frozen offline install; pouze peer/engine warnings | 0 |
| `corepack yarn build` v `c3-ide/` | forced protocol compile, Theia production build a automatický `STUDIO_M1_BUILD_CONSUMER_PASS` | 0 |
| `node tests/m1-studio-client.test.js` v clone | 87 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` v clone | 1 532 tracked paths | 0 |
| `git status --porcelain=v1 --untracked-files=all` a `git diff --check` | prázdné; install/build output zůstal ignored | 0 |

Automatický PASS na Node `v22.21.1` zaznamenal production bundle
11 751 013 B / SHA-256
`746f3671d9e7a5fed240791cb0dafb45f9369b750f64a1a5faaed9bb54b0a19a`,
autoritativní consumer 44 722 B / SHA-256
`feafc54a231981da5442e7ceb426d42796c3783b0e5001f9cff59e1a2061d999`
a generated protocol 1 161 B / SHA-256
`cdad67d9d818f845be3e6b6963b9befbecd4664b5ed1733af40df4883ad18f92`.
Webpack vydal pouze známé performance/dynamic-require warnings.

První source commit odhalil integrační kolizi: repository-hygiene správně
odmítl doslovné font hosty uvnitř samotného denylistu. Scanner se neoslabil.
Guard nyní skládá stejné dvě kanonické hodnoty z přesných segmentů, focused
test drží jejich nezávislé plné řetězce a finální clean clone prokázal současně
postbuild i hygiene PASS.

Marker guard je přítomnostní build integrita, nikoli behavioral journey ani
důkaz produkčně negotiated spojení. Backend, Electron runtime, Ollama, GPU ani
externí síť nebyly spuštěny; B4 a Gate 1 proto zůstávají `BLOCKED`.

## Checkpoint 20 — actual server adapter → Studio ledger offline seam

- **společný source-level seam:** `PASS focused`
- **produkční ACK / Electron journey / celý B4:** nadále `BLOCKED`

Studio VM už nepřijímá ručně sestavené serverové fixture jako jediný důkaz.
Test nyní nechá autoritativní `ws-client.js` vytvořit exact command/context,
předá jej skutečnému `createSessionAdapter()` se stubovaným controllerem a
každý skutečně vydaný `CoreEvent` vrátí do téhož Studio ledgeru. Success
zároveň pinuje projekci message, request/turn/conversation identity,
edit mode, agent/project identity a prázdných attachments až na controller
boundary. Sériově projde success se skutečným `system_step`, typovaná
`LLMProviderUnavailableError` a cancel. Cancel
ověří oddělené identity i pořadí target terminal → cancel terminal; všechny
streamy znovu validuje sdílený M1 kontrakt. Žádný scénář nesmí vydat legacy
agent, assistant, `turn_end` ani klientský `chat:message` envelope.

Jde o offline fake transport, nikoli fake protocol nebo fake obě strany.
Telemetry je pro tuto jednu sériovou zkoušku explicitně vypnuta a v `finally`
obnovena, aby registrovaná offline Studio sada nemohla tiše inicializovat DB.
Stale sweep používá inertní injektovaný clock. První paralelní prototyp sice
prošel 90/90, ale odhalil právě tuto nežádoucí SQLite inicializaci; nebyl
použit jako evidence. Finální běh byl bez DB migrací:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 88 passed, 0 failed, 0 skipped | 0 |
| mutace: odpojit adapter output od skutečného Studio ledgeru | 87 passed, 1 failed | 1 |
| `node tests/ws-bridge.test.js` | 85 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 532 tracked paths checked | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, no added/removed edge | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js` | 377 programs, fingerprint `1370be04…75a6` | 0 |

Mutační běh zachoval wire zprávy na serverové straně, ale odstranil jedinou
kompoziční hranu do klienta. Nový test zčervenal v pojmenované cross-boundary
sadě; po okamžitém vrácení jedné řádky opět prošel 88/88. Důkaz proto není
splnitelný pouhou existencí obou oddělených harnessů.

Ratchet baseline zůstává autoritativně připnutá na `7551b907`; validátor
explicitně reprodukoval 1 020 hran z tohoto SHA a před commitem hlásil aktuální
reviewed revision `b6cb50d4` sedm commitů za baseline. Tento checkpoint mění
jen test a jeho report, nikoli skenované runtime roots.

Tento test zmenšuje mezeru mezi dvěma dosud oddělenými source harnessy. Stále
neprokazuje produkčně ACKnutý socket, Electron render, reconnect přes skutečný
listener ani rozhodnutí attachment/effect authority z 021.

## Checkpoint 21 — explicitně připnutá produkční dormance

- **source/build M1 consumer:** `PASS` podle checkpointů 19–20
- **produkční M1 ACK:** záměrně `DISABLED / TEST-PINNED`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Nový T40 čte skutečný produkční call site v `src/server.js`, ohraničí options
objekt `attachWebSocketServer()` a vyžaduje dnešní legacy origin/capability
autoritu. Zároveň odmítne přítomnost `m1WireSupported` v produkčním callu.
Server proto nemůže začít ACKovat `m1-wire-v1` jako vedlejší efekt source/build
checkpointů; aktivace musí být samostatná review jednotka až po přijetí 021 a
negativních acceptance sadách.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/ws-bridge.test.js` | syntax valid | 0 |
| `node tests/ws-bridge.test.js` | 86 passed, 0 failed | 0 |
| mutace: produkční call doplnit o `m1WireSupported: true` | 85 passed, 1 failed (`T40`) | 1 |

Po mutačním běhu byla jediná produktová řádka okamžitě vrácena, zachovaný
izolovaný failure runtime přesunut do koše a finální sada znovu skončila exit
`0`. `git diff --exit-code -- src/server.js` potvrdil nulovou runtime změnu.

`SYSTEM-MAP.md` už netvrdí, že product-bundle consumer teprve chybí. Rozlišuje
nyní tři samostatné skutečnosti: compiled consumer je clean-clone ověřený,
source producer/adapter/ledger kompozice je focused ověřená a produkční
negotiated Electron journey stále neproběhla.

## Checkpoint 22 — skutečný owned-loopback M1 wire bez produkční aktivace

- **test-owned negotiated WebSocket:** `PASS`
- **produkční `src/server.js` ACK:** nadále `DISABLED / TEST-PINNED`
- **Electron runtime / celý B4 / Gate 1:** nadále `BLOCKED`

Stejná registrovaná Studio sada nyní kromě VM fake transportu otevře privátní
HTTP server na `127.0.0.1:0`, připojí skutečný klient z balíčku `ws` se
správnou per-process capability a explicitně povolí M1 pouze na tomto
test-owned `attachWebSocketServer()`. Autoritativní commitnutý `ws-client.js`
projde reálným hello/ACK a JSON wire. V jednom spojení drží A pending turn,
zatímco B a C jej postupně překryjí vlastními terminály; tři panely tak doloží:

- A drží rozpracovaný turn a scoped cancel doručí target `cancelled` před
  vlastním cancel terminalem;
- B dostane `system_step` jako M1 `agent:event` a jediný renderovatelný `ok`;
- C dostane typovaný `LLM_PROVIDER_UNAVAILABLE`, nikdy assistant;
- controller dostane přesně tři požadavky a klient nevydá žádný legacy
  `chat:message`.

Každý ze čtyř terminálů navíc pinuje přesný `sessionIdx`, action,
conversation/status a unikátní request/turn identitu. Všechny klientské
`agent:event` musí nést transport `m1`; legacy `chat:system` je zakázaný.
Cleanup je all-attempted: client, WSS i HTTP close mají vlastní limit, po
graceful failure následuje pouze test-owned forced close a první body/cleanup
chyba se neztratí.

Test nepoužívá produktový server, Ollamu, GPU, externí síť ani Electron. Jeho
registry záznam byl proto pravdivě změněn z `network:none` na
`network:loopback` a fixture na
`isolated-home-and-owned-loopback-server`; profil zůstává deterministický
`offline`. Vypnutí M1 pouze v test-owned serveru je cílená negativní mutace:
sada skončila 88/1 a přesně live-wire scénář odmítl falešnou negotiation.
Po vrácení jedné řádky prošla 89/89.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 89 passed, 0 failed, 0 skipped | 0 |
| pět souběžných opakování stejné sady | 5 × 89 passed, bez flake/hangu | 5 × 0 |
| mutace: test-owned `m1WireSupported: false` | 88 passed, 1 failed | 1 |
| mutace: všechny remote terminaly směrovat do panelu 0 | 88 passed, 1 failed (`0 !== 2`) | 1 |
| `node scripts/validate-test-registry.js --write-doc` | 377 programů, fingerprint `2d5cf073…63ccd` | 0 |
| `node tests/ws-bridge.test.js` | 86 passed, 0 failed | 0 |
| `node tests/m1-contract.test.js` | 26 passed, 0 failed, 0 skipped | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 532 tracked paths checked | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, baseline `7551b907`, current `11ae1feb` | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed, 0 skipped | 0 |

Tento krok uzavírá source klient → skutečný loopback WS server → skutečný
adapter → source klientský ledger. Stále neinjektuje generated protocol ani
production Electron bundle do běžícího rendereru, netestuje reconnect/restart
na živém socketu a vědomě neposílá přílohu ani SHELL; tyto dvě policy patří
výhradně rozhodnutí 021.

### Clean-clone reprodukce checkpointu 22

Disposable `git clone --no-local` byl detached na přesném source SHA
`1f1a148976153d978b781cbe93049b7e24a58b0f`. Před instalací byl tracked i
untracked porcelain prázdný. Následně proběhlo:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `npm ci --offline` | 233 balíčků, 0 vulnerabilities | 0 |
| `node tests/m1-studio-client.test.js` | 89 passed, 0 failed, 0 skipped | 0 |
| `node tests/ws-bridge.test.js` | 86 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed, 0 skipped | 0 |
| `node tests/repository-hygiene.test.js` | 1 532 tracked paths checked | 0 |
| `node scripts/validate-test-registry.js` | 377 programů, fingerprint `2d5cf073…63ccd` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, baseline reprodukovaná, current přesně `1f1a1489` | 0 |
| finální porcelain + `git diff --check` | tracked/untracked strom prázdný | 0 |

Dočasný clone byl po úspěšném ověření přesného HEAD odstraněn. Instalace ani
testy neotevřely externí síť, produktový server, Electron, Ollamu nebo GPU.

## Checkpoint 23 — audit autority akčního verification rollbacku

- **současné textové varování:** bezpečné, bez mutation effectu
- **role-only rollback tlačítko:** `REJECTED AS UNSAFE CANDIDATE`
- **přesný recovery kontrakt:** čeká na rozhodnutí
  [022](../../decisions/022-m1-studio-operation-bound-rollback.md)

Call graph potvrdil, že `upgrade_verify_failed` není stale při emitování, ale
může zestárnout před kliknutím. Same-target reverify se při úspěchu nepropíše
clear eventem; novější different-target apply se oznamuje jen best-effort WS
zprávou bez replaye. Dnešní `{role}` rollback proto při kliknutí vybere
aktuální operaci a může pravdivě rollbacknout jiný binding než ten, o kterém
uživatel rozhodoval. Repository CAS chrání konzistenci DB, ne původní intent
starého promptu.

Rozpracovaný role-only UI kandidát byl po tomto zjištění celý odstraněn;
`git diff --quiet` nad Studio runtime i jeho testem skončil exit `0`. Nebyl
commitnutý ani vydaný za evidence. Doporučená varianta 022/A váže event,
request i repository transakci na operation ID, committed binding revision a
nejnovější failed verification attempt; stale akce musí skončit před efektem.
Jde o změnu veřejného event/HTTP kontraktu, takže implementace správně čeká na
operátorské potvrzení a B4/Gate 1 zůstávají `BLOCKED`.

## Checkpoint 24 — kandidát skutečného reconnectu nad owned loopback wire

Owned-loopback journey nyní po prvních čtyřech terminálech ukončí první
serverovou WebSocket connection. Klient musí zrušit starý M1 negotiation
latch a přes bounded reconnect scheduler založit druhý socket, který znovu
nabídne a vyjedná `m1-wire-v1`; server autoritativně
ověří všechny tři identity proti test-owned durable SQLite a klient přes
skutečné loopback HTTP obnoví přesně jejich tři historie. Teprve potom stejný
panel odešle další M1 turn a dostane jediný korelovaný success terminál.
Test pinuje i přesně tři `findById` lookupy se stejnými identitami, takže
mutace, která by bez konzultace durable store autoritativně ACKovala vše,
nemůže projít jen díky pozitivním fixture datům.

Tento checkpoint nemění produkční ACK, veřejný kontrakt ani Electron runtime.
Ověřuje transportní reconnect, durable identity partition a post-reconnect
směrování na skutečných socketech; server restart a finální built Electron
journey zůstávají samostatně `NOT RUN`.

Registry zůstává pravdivě `offline`, `network:loopback`, `database:false`:
SQLite soubor je vytvořený, vlastněný a uzavřený samotnou sadou v izolovaném
runtime rootu, takže nejde o databázovou prerekvizitu. Je to stejná
self-contained konvence, kterou používají durable WS testy T25f/T25h; změna
profilu ani fingerprintu registry proto není součástí tohoto checkpointu.

| Příkaz / kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-studio-client.test.js` | 89 passed, 0 failed, 0 skipped | 0 |
| pět dalších po sobě jdoucích běhů stejné sady | 5 × 89/0, bez flake/hangu | 5 × 0 |
| mutace: nevyčistit M1 latch při skutečném disconnectu | 88/1, přesný reconnect scénář | 1 |
| mutace: nahradit skutečný loopback history fetch VM stubem | 88/1, nulové HTTP requesty | 1 |
| mutace: jedna ze tří identit chybí v durable SQLite | 88/1, přesně 2 restored / 1 invalid | 1 |
| mutace: durable `findById` bez zaznamenaného lookupu | 88/1, přesná autoritativní aserce | 1 |
| `node tests/ws-bridge.test.js` | 86/0 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 533 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 377 programů, fingerprint `2d5cf073…63ccd` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 020/1 020, provenance replay 1 020 | 0 |

První kandidátní běh skončil 88/1 pouze kvůli testové aserci, která porovnávala
VM objekt referenční sémantikou; převod přes existující `hostClone()` opravil
harness bez změny produktu nebo očekávaného payloadu. První tři mutace byly
provedené po jedné, po každé vrácené a následovalo pět zelených běhů. Čtvrtá
mutace durable lookupu pak samostatně zčervenala 88/1; po jejím vrácení prošel
finální focused běh 89/0. Nejde ještě o server restart ani production Electron
behavioral evidence a B4/Gate 1 proto zůstávají `BLOCKED`.

## Checkpoint 25 — operation-bound verification recovery

- **022/A source kontrakt:** `FRESH_CLONE_VERIFIED` na `81dff196c223b4e207ddd4ec4644c98838b6c950`
- **built Electron journey:** `NOT RUN`
- **celý B4 / Gate 1:** nadále `BLOCKED`

Původní `POST /api/system/upgrades/rollback {role}` zůstává zachovaný pro
obecný non-retryable incident podle 018/Q4. Studio používá pouze nový aditivní
`POST /api/system/upgrades/recovery/rollback` s exact role, operation ID,
committed binding revision a failed attempt revision; žádný role-only fallback
neexistuje.

Repository v jedné `IMMEDIATE` transakci ověří aktuální `USER_APPLY`, úplný
desired tuple i nejnovější přesný `FAILED` verification attempt a teprve potom
zapíše append-only rollback. Verification writer ve své transakci CASuje stejný
desired tuple. Test se dvěma SQLite spojeními pokrývá obě serializovaná pořadí
vítěze: po rollback commitu pozdní verify skončí
`MODEL_BINDING_VERIFICATION_STALE`; po verify commitu skončí starý rollback
`MODEL_BINDING_RECOVERY_STALE`. Oba výsledky jsou bez druhého authority zápisu;
nejde o wall-clock concurrency benchmark.

Failure event i bounded clear nesou stejnou přesnou identitu. Autoritativní
commitnutý Studio `lib` drží per-role ledger a watermark, dvoukrokové potvrzení,
single-flight i post-`await` token. Exact own-key kontrola rolí odmítá i
prototypová jména. Starý či neúplný event zůstává warn-only,
stejně jako failure nad `USER_ROLLBACK`, pro který neexistuje schválený další
reversal. Role-only `model_changed` recovery nečistí. HTTP úspěch vyžaduje `response.ok`,
`body.ok` a přesný echo tuple; neshodná `2xx` odpověď je `UNKNOWN` bez retry.
Bounded clear porovnává model, operaci i obě původní revize; cizí model se
stejným operation/revision tuple akci nezruší.

| Příkaz / kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-binding-repository.test.js` | 46 passed, 0 failed | 0 |
| `node tests/m1-model-binding-application.test.js` | 104 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 95 passed, 0 failed | 0 |
| syntax check obou změněných Studio souborů | valid | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 86 passed, 0 failed | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 534 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 377 programů, fingerprint `2d5cf073…63ccd` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 021/1 021, žádná změna hrany | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed | 0 |

Šest izolovaných negativních mutací zčervenalo přesně chráněnou větev a po každé
bylo vráceno: odstranění failed-attempt CAS dalo repository `45/1`; ignorování
`response.ok` dalo Studio `94/1`; odstranění post-`await` tokenu dalo Studio
`94/1`; zpřístupnění identity i pro `USER_ROLLBACK` dalo application `103/1`;
návrat k prototypově děděnému role lookupu vytvořil akční `constructor` záznam
a Studio sada skončila exit `1`; odebrání modelu z exact clear klíče dalo
Studio `94/1`. Finální focused běhy výše jsou až po vrácení všech mutací.

Tento checkpoint nespustil GPU, Ollamu, externí síť ani Electron. Je to
source/repository/VM důkaz; built B4 a Gate 1 proto zůstávají `BLOCKED`.

### Clean-clone attestation 022/A

Oddělený `git clone --no-local` v `/tmp/intentsmith-022-792yiE/repo` byl
detached na přesný source SHA
`81dff196c223b4e207ddd4ec4644c98838b6c950`. Porcelain byl prázdný před
instalací i po testech. V klonu proběhlo `npm ci --offline` (233 balíčků,
0 vulnerabilities) a následující baterie:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-binding-repository.test.js` | 46/0 | 0 |
| `node tests/m1-model-binding-application.test.js` | 104/0 | 0 |
| `node tests/m1-studio-client.test.js` | 95/0 | 0 |
| `node tests/routes-smoke.test.js` | 109/0 | 0 |
| `node tests/ws-bridge.test.js` | 86/0 | 0 |
| `node tests/upgrade-ux-v125.test.js` | 78/0 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 534 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 377 programů, 8 exclusions, fingerprint `2d5cf073…63ccd` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 021/1 021, source replay přesně `81dff196` | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13/0 | 0 |
| finální `git diff --check` + porcelain | čistý tracked/untracked strom | 0 |

Toto povyšuje pouze 022/A source kontrakt. Produkční ACK, negotiated Electron
journey, GPU a Ollama zůstaly nespouštěné.

## Checkpoint 26 — 020/E versioned settings recovery source consumer

Autoritativní commitnutý `c3-chat-panel/lib/browser/chat-panel-module.js`
přešel z generic whole-document backup/import/reset na explicitní backend
adaptér. Export vyžaduje exact schema v1, sám odmítne oba známé secret keys,
vytvoří jediný JSON download a vždy revokuje object URL. Import a reset přijmou
pouze non-malformed HTTP success s `ok:true`, `success:true` a plain
`generalSettings`; lokální `_bCfg` se nikdy neodvozuje z importního souboru.

Mutation cesty jsou single-flight a před efektem čekají na případný rozběhnutý
generic save. Druhý import/reset ani stale debounced save proto nemohou přepsat
novější recovery stav. `runtimeApplied:false` zůstává pravdivý durable success s požadavkem na
restart. Tokenovaný success timer nemůže odstranit novější failure status.
Legacy holý JSON se převede na schema v1 s `modelAutomationPolicy:null`; backend
jeho secret values ignoruje a vrátí destination snapshot, který následující
generic Studio save zachová.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node --check c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` | syntax valid | 0 |
| `node --check tests/m1-studio-client.test.js` | syntax valid | 0 |
| `node tests/m1-studio-client.test.js` | 106/0 | 0 |
| `node tests/m1-model-policy.test.js` | 35/0 | 0 |
| `node tests/routes-smoke.test.js` | 109/0 | 0 |
| `node tests/schema-migrations.test.js` | 38/0 | 0 |
| `node tests/artifact-validation.test.js` | 151/0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 546 trackovaných cest | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programů, 8 exclusions, fingerprint `cb1259ca…d06e15` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 023/1 023 hran, 3 cykly, 28 souborů | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13/0 | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Test používá přímo runtime slice ze sledovaného `lib` a VM intrinsics; připíná
exact URL, method, JSON header, timeout, versioned/legacy dokumenty, secret
canaries, 4xx/5xx, rejected fetch, malformed 2xx, exact runtime metadata,
generic-save/recovery ordering, single-flight a timer race. Tento source checkpoint ještě nemá samostatný
read-only review ani fresh-clone attestation. Electron, GPU, Ollama, externí
síť a finální UI nebyly spuštěné; built B4 i Gate 1 zůstávají `BLOCKED`.

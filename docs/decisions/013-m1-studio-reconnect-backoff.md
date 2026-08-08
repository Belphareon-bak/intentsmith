# 013 — Studio reconnect má pevný strop a viditelné vyčerpání

- **typ:** DECIDE
- **WP:** WP-M1-STUDIO
- **rail:** R1, R3, R5, R7
- **vzniklo při:** B4 reconnect/exhaustion checkpoint, předvyplněné D-7

## Evidence na stole

Původní klient resetoval retry counter už při `WebSocket.onopen`, tedy před
`hello_ack`. Server, který spojení opakovaně otevřel a zavřel bez platného
handshake, mohl limit obcházet. Synchronní chyba konstruktoru WebSocketu
nenaplánovala žádný další pokus a po dosažení limitu klient skončil potichu.
Řízený `wsDestroy()` naopak spoléhal na nevratné přepsání `_wsMaxRetry=0`.

Jediný scheduler nyní počítá nejvýše 12 opakování s prodlevami
`1/2/4/8/16/30×7 s`. Counter se resetuje pouze po `hello_ack`. Konstrukční
chyba, close před ACK a pětisekundový handshake timeout používají stejný šev.
Po vyčerpání vznikne právě jeden sanitizovaný `ws:reconnect_exhausted` event a
Studio zůstane viditelně offline. Řízený shutdown zruší pending timery a už
nikdy automaticky ani explicitně v téže instanci nereconnectuje.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — pevný strop + viditelný stav | 12 bounded retries, poté offline stav a operátorský zásah | Předvídatelné zdroje a konečný stav; dočasný delší výpadek vyžaduje restart Studia | Implementace v `_scheduleReconnect`, panel event a 10 deterministických testů |
| B — nekonečný capped backoff | Pokusy pokračují po 30 s bez konce | Vyšší šance na samoobnovu, ale žádný konečný stav a trvalá background aktivita | Změna jedné scheduler větve + cap/exhaustion testů |
| C — pevný strop + ruční Retry akce | A, navíc explicitní operátorské obnovení budgetu | Lepší obsluha dlouhého výpadku; přidává finální UI/UX kontrakt, který dnes není schválený | Scheduler reset API, panel command a browser journey |

## Vzatý default a proč

Použita je A, jak předepisuje D-7. Tvrdí méně než automatika bez konce, má
jednoznačný terminal stav a nejlevněji se mění. Nezakládá finální UI baseline:
viditelnost je dnes funkční offline health stav a log, nikoli schválený vzhled.

## Šev

Jediný rozhodovací šev je
`c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js:_scheduleReconnect()`.
Panel pouze spotřebovává typovaný interní event a nesmí si zavést vlastní retry
counter nebo timer.

## Cena přepnutí, když operátor rozhodne jinak

Přechod A → B mění `_scheduleReconnect()` a tři testy limitu, exhaustion a
destroy; panelový offline handler lze zachovat pro jiné terminal chyby nebo
odstranit s jeho source testem. Přechod A → C přidá jednu reset/start funkci do
`ws-client.js`, jednu panelovou command větev a nejméně dva client/journey testy.
Accepted M1 connector ani server se nemění.

# 012 — Prázdná Studio historie nemá autoritu smazat lokální snapshot

- **typ:** BLOCK
- **WP:** WP-M1-STUDIO (jen atomická obnova prázdné historie)
- **rail:** R1, R4, R5
- **vzniklo při:** B4 client rehydrate race review

## Evidence na stole

Server nejprve ověří durable existenci identity a pošle `rehydrate_ack`.
Studio potom samostatně volá `GET /api/conversations/:id/messages`. Dnešní route
v `src/routes/chat.js` vrací `200 { messages: [] }` i pro neexistující
konverzaci, protože čte pouze tabulku zpráv a existenci konverzace nekontroluje.

Hard-delete mezi ACK a GET proto vypadá stejně jako platná prázdná konverzace.
Kdyby klient považoval každé prázdné pole za autoritativní, mohl by vymazat
lokální zprávy, ponechat již neplatné `_convId` a výsledek označit jako úspěšně
obnovený. To je nejednoznačnost vlastnictví dat, kterou dávkový protokol řadí
do `BLOCK`.

Klientský checkpoint zavádí bezpečný mezistav: prázdná historie nesmí přepsat
neprázdný lokální snapshot ani aktivní thinking stav. Lokální data zůstanou a
completion je `degraded`. Neplatná identita přímo v serverovém ACK se dál čistí,
pokud se lokální snapshot od odeslání rehydrate požadavku nezměnil.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — konzervativní klient | Prázdný GET zachová existující lokální stav a vrátí `degraded` | Žádná ztráta lokálních dat; prázdná durable konverzace se neumí autoritativně odlišit | Hotovo v `ws-client.js` + 1 negativní test; pozdější změna zůstává v jediném commit švu |
| B — existence-aware history route | Neexistující konverzace vrátí 404, existující prázdná 200 | Umožní pravdivě rozlišit orphan a prázdnou historii; route je mimo B4 allowlist | `src/routes/chat.js`, DB transakční čtení a route/client negativní testy |
| C — atomický rehydrate snapshot | Jeden bounded serverový výsledek nese identity a jejich historie nebo revize | Nejsilnější konzistence, ale mění wire kontrakt a velikost ACK | WS server, klient, bounded payload schema a integrační testy |

## Vzatý default a proč

Pro aktivní B4 klientský checkpoint platí A, protože pouze odmítá destruktivní
závěr, který dnešní evidence neumí dokázat. Není vydán za finální řešení.
Autoritativní obnova skutečně prázdné historie zůstává `BLOCKED`, dokud operátor
neschválí B nebo C a nepovolí odpovídající serverový scope.

## Šev a cena přepnutí

Klientský šev je
`c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js:_handleRehydrateAck()`.
Přechod na B vyžaduje změnit `src/routes/chat.js`, přidat route test pro
existující prázdnou a neexistující konverzaci a změnit dvě Studio aserce
(`empty -> restored`, `404 -> invalid/degraded`). C navíc mění WS rehydrate
payload a server/client wire testy.

Do té doby se nesmí `200 []` popsat jako důkaz existence ani použít k mazání
uživatelského snapshotu.

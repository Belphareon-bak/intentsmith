# 012 — Prázdná Studio historie nemá autoritu smazat lokální snapshot

- **typ:** BLOCK
- **stav rozhodnutí:** B SCHVÁLENO; ROUTE IMPLEMENTOVÁNA; KLIENT A SPOLEČNÝ
  LIVE WIRE DŮKAZ OTEVŘENÉ
- **WP:** WP-M1-STUDIO (jen atomická obnova prázdné historie)
- **rail:** R1, R4, R5
- **vzniklo při:** B4 client rehydrate race review

## Evidence na stole

Server nejprve ověří durable existenci identity a pošle `rehydrate_ack`.
Studio potom samostatně volá `GET /api/conversations/:id/messages`. Před route
checkpointem vracel `src/routes/chat.js` `200 { messages: [] }` i pro
neexistující konverzaci, protože četl pouze tabulku zpráv a existenci
konverzace nekontroloval.

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

## Původní bezpečný mezistav

Před operátorským rozhodnutím platila na klientu varianta A, protože pouze
odmítala destruktivní závěr, který tehdejší route neuměla dokázat. Nebyla vydána
za finální řešení. Operátor následně schválil B a povolil přesně ohraničený
serverový scope níže.

## Šev a cena přepnutí

Klientský šev je
`c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js:_handleRehydrateAck()`.
Přechod na B vyžaduje změnit `src/routes/chat.js`, přidat route test pro
existující prázdnou a neexistující konverzaci a změnit dvě Studio aserce
(`empty -> restored`, `404 -> invalid/degraded`). C navíc mění WS rehydrate
payload a server/client wire testy.

Do té doby se nesmí `200 []` popsat jako důkaz existence ani použít k mazání
uživatelského snapshotu.

## Rozhodnutí operátora — 2026-08-08: B

Operátor schválil existence-aware history route. Existence konverzace a její
zprávy se přečtou v jednom synchronním SQLite snapshotu/transakci:

- existující prázdná konverzace → `200 {messages: []}`;
- existující neprázdná → `200` s přesnou historií;
- neexistující nebo hard-deleted → typované
  `404 CONVERSATION_NOT_FOUND`;
- DB chyba → `500`, nikdy domyšlené `404` ani `200 []`.

Klient smí přijmout `200 []` jako autoritativně prázdnou historii jen při shodě
socket epochy, conversation identity a nezměněného lokálního snapshotu.
`5xx`, timeout, malformed payload i `404` skončí `degraded` a zachovají data.

### Autorita identity a ordering s rozhodnutím 014

Syntakticky platnou durable conversation identitu smí zrušit **pouze explicitní
`invalidIds` z úplného a validního rehydrate ACK**. Typované `404` z následného
history GET `_convId` neruší, ani když se lokální snapshot nezměnil; zachová
identitu do dalšího rehydrate. Tím hard-delete mezi ACK a GET nemůže provést
druhé zrušení nad pozicí panelu, která už mohla být znovu použita. Lokálně
malformed identita se neposílá na server ani nemaže: panel se označí jako
`degraded`/quarantined a zachová uživatelský snapshot k ruční obnově.

Implementace B proto uzavírá autoritu obsahu historie, nikoli autoritu ACK.
Úplnost a přesné identity-rušící pořadí ACK vlastní samostatné rozhodnutí 014.

### Stav route checkpointu

Route nyní čte existenci konverzace a její zprávy v jedné synchronní SQLite
transakci. Neexistující identita vrací přesný typovaný `404`; DB chyba,
chybějící transakční API nebo vadný snapshot skončí sanitizovaným `500`.
Focused sada `tests/m1-chat-contract.test.js` prošla `21/21`. Tři oddělené
mutace — obejití transakce, falešná existence chybějící konverzace a odstranění
validace snapshotu — skončily vždy `20/1` nebo `18/3`, exit `1`, a po přesném
obnovení zdroj znovu prošel `21/21`.

Klientská autorita `200 []`, typovaného `404` a same-ID slot reuse ani společný
DB-backed wire důkaz tím hotové nejsou. Celé B4 a Gate 1 zůstávají `BLOCKED`.

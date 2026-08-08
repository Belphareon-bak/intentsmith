# Finding 009 — starý attachment callback mohl odeslat turn do nové session

- **stav:** `MITIGATED / FOCUSED PASS`
- **závažnost před opravou:** vysoká na Studio transportní hranici
- **vlastník:** `WP-M1-STUDIO / B4`
- **dotčený runtime:** commitnutý
  `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`

## Pozorovaný stav

Normální Studio send nejdřív asynchronně načte attachment přes `FileReader` a
teprve v callbacku pošle WebSocket frame. Původní callback nebyl svázaný se
session, timeline ani identitou, ze které vznikl. Reset, zavření, nahrazení
panelu nebo změna project/conversation identity během čtení proto mohly nechat
starý effect-capable prompt odejít v novém kontextu. Při nedostupném transportu
mohl tentýž callback zapsat starý `NOT_SENT` stav do novější session.

Nejde o HTTP fallback: rozhodnutí 011 jej už vypnulo. Jde o korelaci lokálně
připraveného WS sendu přes asynchronní hranici.

## Náprava

Příprava sendu nyní zachytí přesné reference na session, chat, timeline,
optimistický user turn a thinking stav, aktivní session slot,
conversation/agent/project identity, `editMode` a oddělené session/turn tokeny.
Callback smí pokračovat jen pokud všechny hodnoty stále patří stejnému
kontextu a slot je viditelný. Na jednu session smí současně existovat jediný
prepared send; druhý send i gap choice nechají nový vstup beze změny.

Reset, close, explicitní nahrazení session, serverové `session:invalid`, shrink
panelů a potvrzení relay targetu vlastnictví zruší před první změnou cílového
stavu. Přesouvaný poslední panel se před swapem ukončí jako `NOT_SENT`.
Pre-wire Escape/STOP spotřebuje cancel lokálně, obnoví původní draft a
attachments bez přepsání novějšího vstupu a neposílá remote cancel, který by
mohl zasáhnout starší serverový turn. Pozdní `onload` i `onerror` jsou inertní.

Novější text napsaný do stejného textarea se záměrně nepovažuje za změnu
identity: při transportním selhání se obnoví původní odesílaný draft a novější
rozepsaný text zůstane zachovaný samostatně. Autorita dvou skutečně souběžných
turnů v jedné konverzaci je širší finding 005 a tímto checkpointem se
neprohlašuje za uzavřenou.

## Důkaz

Behaviorální test vykonává skutečný commitnutý send/reset/count slice ve VM s
řízeným `FileReader`. Pokrývá reset, nahrazení session, dvě attachment čtení,
single-flight, gap choice, pre-wire cancel pro `onload` i `onerror`, skrytí a
znovurozšíření panelu, změnu identity/edit mode/timeline a přepnutí aktivního
focus panelu. Statické piny drží cancel, close-swap, relay a
`session:invalid` wiring. Ve fail-closed větvích je počet WS i fallback efektů
nula a nový stav zůstane nedotčený.

Tři samostatné mutační kontroly odstranily aktivní-slot podmínku a single-flight
guard a znovu zavedly chybný požadavek na přesnou délku timeline při recovery.
Každá správně zčervenala přesně příslušný kontrakt:

- bez aktivního slotu `37 passed, 1 failed`, exit `1`;
- bez single-flight `37 passed, 1 failed`, exit `1`.
- s exact-length recovery po appendu `37 passed, 1 failed`, exit `1`.

Po přesném obnovení obou guardů focused sada prošla `38 passed, 0 failed`,
exit `0`.

Celý B4 ani Gate 1 tím nejsou `PASS`; dál chybí 010/A+, 014/A, 012/B, built
journey, fresh-clone parity a bounded renderer soak.

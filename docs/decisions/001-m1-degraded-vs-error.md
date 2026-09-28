# 001 — Částečný tool výsledek následovaný selháním není `degraded`

- **typ:** DECIDE
- **WP:** WP-M1-CONTRACT
- **rail:** R3, R5, R6
- **vzniklo při:** návrh terminálního unionu v `contracts/m1/terminal.js:classifyTerminal()`

## Evidence na stole

Roadmapa popisuje dnešní implicitní fallback po úspěšných tool datech jako
nepravdivou terminální větev. Schválený M1 union obsahuje pouze `ok`,
`cancelled`, `timeout` a `error`. Runtime validátor nyní odmítá pátý stav,
zakazuje assistant response na každém ne-`ok` výsledku a dovoluje u `error`
jen sanitizované `partial.toolResults` bez plného tool outputu.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — `error` + partial | Tool souhrny lze persistovat; assistant se nevyrenderuje ani nepersistuje. | R3 pravdivý terminal, R5 jeden union, R6 jednoznačný replay. | Aktuální implementace. |
| B — nový `degraded` | Částečný obsah se stane pátým terminálem a UI jej musí explicitně odlišit od úspěchu. | Rozšíří R5 connector a přidá nový UX/recovery stav v R3/R6. | Viz konkrétní cena přepnutí níže. |

## Vzatý default a proč

Varianta A. Tvrdí méně: selhání providera zůstává selháním a částečná tool data
nejsou sama vydávána za assistant odpověď. Nezavádí pátý veřejný stav před
měřením chování konzumentů.

## Šev

`contracts/m1/terminal.js:classifyTerminal()`; spotřebitelská větev renderu
vznikne až ve `WP-M1-STUDIO` a musí se řídit jeho výstupem.

## Cena přepnutí, když operátor rozhodne jinak

Před B2/B4: změna čtyř contract souborů
(`contracts/m1/{shared,terminal,index}.js`,
`c3-ide/extensions/c3-protocol/src/m1.ts`) a nejméně šesti očekávání v
`tests/m1-contract.test.js`.

Po integraci konzumentů navíc dvě produktové větve
(`src/routes/chat.js` a
`c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`) a dvě
registrované sady (`tests/m1-chat-contract.test.js`,
`tests/m1-studio-client.test.js`). Celkem tedy šest produkčních/contract
souborů a tři testovací sady.

## Rozhodnutí operátora — 2026-08-08

**Potvrzena varianta A.** Provider failure po úspěšných tool efektech zůstává
terminální `error`. Částečný tool výsledek se nesmí vykreslit ani persistovat
jako assistant odpověď a M1 nezavádí pátý terminální stav `degraded`.

Toto rozhodnutí nepovyšuje dnešní contract permission na produkční funkci:
`persistPartialToolResults` nemá v produkčním call graphu konzumenta. M1 proto
smí tvrdit jen to, že sanitizovaný partial je ve schématu povolený; nesmí
tvrdit, že jej dnešní runtime skutečně ukládá nebo uživateli zpřístupňuje.

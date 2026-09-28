# 002 — Pozdní assistant po terminálním cancelu se odmítne

- **typ:** DECIDE
- **WP:** WP-M1-CONTRACT
- **rail:** R3, R5, R6
- **vzniklo při:** sekvenční kontrola v `contracts/m1/terminal.js:classifyTerminal()`

## Evidence na stole

Jedna request identity smí mít právě jeden terminál. `classifyTerminal()` nyní
přijímá předchozí terminální stav; každý další kandidát odmítne jako
`terminal:already-final` a kombinaci `cancelled → ok` navíc pojmenuje
`terminal:late-assistant-after-cancel`. Stream validator současně odmítá druhý
terminál i událost za terminálem.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — odmítnout | Cancel zůstane definitivní; pozdní odpověď se nepersistuje ani nerenderuje. | R3 a R6 mají jediný pravdivý konec; R5 je shodný přes transporty. | Aktuální implementace. |
| B — přijmout pozdní odpověď | Cancel by se mohl přepsat pozdějším `ok`, nebo by vznikl druhý terminál. | Oslabuje R3/R6 a vyžaduje novou konfliktovou sémantiku R5. | Viz konkrétní cena přepnutí níže. |

## Vzatý default a proč

Varianta A. Je nejvratnější a nevytváří žádnou dodatečnou persistenci ani UI
stav. Přijetí pozdní odpovědi by naopak vyžadovalo určit, který z dvojice
terminálů je autoritativní.

## Šev

`contracts/m1/terminal.js:classifyTerminal()` s parametrem `priorStatus`.

## Cena přepnutí, když operátor rozhodne jinak

Před B2/B4: jedna funkce v `contracts/m1/terminal.js`, její TS mirror v
`c3-ide/extensions/c3-protocol/src/m1.ts` a tři očekávání ve
`tests/m1-contract.test.js`.

Po integraci navíc terminální guard v chat adaptéru a Studio klientovi a dvě
negativní sady (`tests/m1-chat-contract.test.js`,
`tests/m1-studio-client.test.js`). Celkem tři implementační soubory a tři
testovací sady.

## Rozhodnutí operátora — 2026-08-08

**Potvrzena varianta A.** Cancel je definitivní terminál. Pozdní assistant se
odmítne, nepersistuje ani nevyrenderuje; jedna request identity nikdy nedostane
druhý autoritativní konec.

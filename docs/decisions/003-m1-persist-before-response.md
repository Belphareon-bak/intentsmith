# 003 — Assistant odpověď se vrací až po durable zápisu

- **typ:** DECIDE
- **WP:** WP-M1-CHAT
- **rail:** R1, R2, R4
- **vzniklo při:** `src/chat/response-finalizer.js:finalizeChatResponse()`

## Evidence na stole

Finalizer dosud zachytil výjimku z `persistAssistantTurn()`, pouze ji zalogoval
a vrátil úspěšnou odpověď. Uživatel tak mohl vidět assistant turn, který v
autoritativní SQLite nikdy nevznikl. `ConversationStore` přitom deklaruje DB
jako jediný zdroj pravdy a jeho zápis selhává nahlas.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — persist-then-respond | Úspěch vznikne jen po durable zápisu; chyba zápisu je terminální `CHAT_PERSISTENCE_FAILED` | Posiluje R1/R2/R4; může přidat latenci zápisu | finalizer, chat error typ, request-level test |
| B — respond-then-persist | Odpověď může odejít dřív, ale pozdější zápis může selhat | Porušuje pravdivost a restartovou kontinuitu | vyžaduje nový pending/outbox protokol a recovery |

## Vzatý default a proč

Varianta A podle zadání B2. Nevyžaduje nový protokol ani background recovery a
je nejlevněji vratná. Pokud SQLite zápis shodí deterministické p95 nad 100 ms,
zůstane pořadí stejné a evidence pouze zaznamená naměřenou latenci.

## Šev

`src/chat/response-finalizer.js:finalizeChatResponse()` — jediná synchronní
hranice bez `await` mezi poslední kontrolou abortu a zápisem assistant turnu.

## Cena přepnutí, když operátor rozhodne jinak

Minimálně nový durable outbox/recovery modul, změna `response-finalizer.js`,
startup recovery v serveru, migrace SQLite a nové crash/restart testy. Není to
lokální změna jednoho renderu, proto varianta B není součástí M1 dávky.

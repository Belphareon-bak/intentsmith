# 004 — HTTP cancel nemá ve v1 oddělenou cílovou identitu

- **typ:** BLOCK
- **WP:** WP-M1-CHAT (pouze explicitní `action: cancel` přes HTTP)
- **rail:** R1, R2, R4
- **vzniklo při:** adaptace `ConversationCommand` na `POST /api/chat`

## Evidence na stole

`ConversationCommand` v1 nese jednu trojici `requestId`, `conversationId`,
`turnId`. U `action: cancel` ale nemá zvláštní `targetRequestId` ani explicitní
pravidlo, zda vlastní `requestId` identifikuje cancel příkaz, nebo původní send.
WS dnes ruší podle `conversationId`, což při více turnech není request-level
identita. Domyšlený in-flight registr by proto měnil connectorovou sémantiku,
kterou B2 nevlastní.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — stejná trojice jako send | Cancel zopakuje identitu původního commandu | Jednoduché, ale request ID cancel operace se ztratí | route registry + concurrency testy |
| B — přidat `targetRequestId` | Cancel má vlastní identitu i jednoznačný cíl | Nejpřesnější, ale mění v1 connector | B1 schema JS+TS, codec, HTTP/WS/Studio testy |
| C — cílit jen `conversationId` | Zruší právě aktivní turn konverzace | Kompatibilní s legacy WS, ne request-scoped | route registry + zákaz paralelních turnů |

## Vzatý default a proč

Žádný. Dotčená explicitní HTTP cancel větev je zastavena, protože výběr mění
význam connectoru. B2 pokračuje nezávisle s pravdivým mapováním již vzniklého
typed user abortu/timeoutu a s disconnect cancellation; guard se neoslabuje.

## Šev

Po rozhodnutí jediný adapter v `src/routes/chat.js` a případně
`contracts/m1/index.js:validateConversationCommand()` pro variantu B.

## Cena přepnutí, když operátor rozhodne jinak

A/C: `src/routes/chat.js`, request-level test a později B4 WS/Studio adapter,
odhad 2–3 test files. B: navíc `contracts/m1/**`, TS mirror, `m1-contract`, B3/B4
consumer testy a nové major/minor rozhodnutí pro provisional v1.

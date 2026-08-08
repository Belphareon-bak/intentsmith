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

---

## Rozhodnutí operátora — 2026-08-08

**Přijata varianta C.** `action: cancel` cílí `conversationId` a ruší právě
aktivní turn konverzace. BLOCK je tím uzavřený; B4 smí implementovat Studio
scoped cancel podle svého briefu beze změny.

Varianta B (`targetRequestId`) se **neodmítá, jen odkládá** — vrátí se jako
kandidát na v2 poté, co C prokazatelně funguje. Do té doby se v1 connector
nerozmrazuje.

**Podklad, který C podpírá:**

- „Zákaz paralelních turnů", kterým je C podmíněná, už fakticky platí:
  `activeTurns` v `src/ws-bridge/session-adapter.js` je mapa klíčovaná
  `conversationId`, takže dvě souběžné odpovědi v jedné konverzaci dnes
  neexistují. C nezavádí nové omezení, jen zapisuje současné chování.
- Brief B4 v `docs/execution/m1-batch.md` § B4 bod 4 je už napsaný podle C —
  klient doplní `conversationId` a scoped backend větev se zachová.

**Co z toho plyne pro implementaci:**

1. `src/routes/chat.js` — nahradit dnešní pravdivé odmítnutí
   (`HTTP cancel target semantics are unresolved for M1 v1`) adaptérem, který
   zruší aktivní turn dané konverzace.
2. `conversationId` je u `action: cancel` **povinný**. Absence se odmítne;
   `cancel all` fallback z WS se do HTTP nepřenáší.
3. Vlastní `requestId` cancel příkazu zůstává identitou té cancel operace, ne
   rušeného turnu — v auditu se tím dvojice rozliší.
4. Request-scoped cílení zůstává otevřené pro v2; do té doby se nesmí tvrdit,
   že cancel je request-level.

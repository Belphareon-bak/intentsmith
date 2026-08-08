# 005 — HTTP a WS conversation mutexy nejsou sdílená authority

- **vlastník:** `WP-M1-STUDIO`, následně společný concurrency/effect authority WP
- **nalezeno v:** `WP-M1-CHAT`, implementace rozhodnutí 004/C
- **stav:** PENDING-OWNER

## Evidence

M1 HTTP adaptér drží `activeM1Turns` uvnitř jedné factory
`createChatRoutes()`. WS bridge drží obdobnou mapu `activeTurns` uvnitř jedné
instance `createSessionAdapter()`. Tyto registry nesdílejí stav ani
vlastnictví. Dvě různé WS sessions nebo HTTP a WS proto mohou současně spustit
turn nad týmž `conversationId`, přestože každý jednotlivý adaptér odmítá druhý
lokální turn téže konverzace.

Rozhodnutí 004/C je v B2 implementováno pravdivě jen pro M1 HTTP provoz přes
jednu instanci `createChatRoutes()`. Není to důkaz produktového invariantu
„právě jeden aktivní turn na konverzaci" napříč transporty.

## Dopad

Conversation-scoped cancel má uvnitř jedné HTTP factory jednoznačný cíl.
Současný produkt ale nemá sdílenou concurrency authority, která by zabránila
konkurenčním efektům nebo nejednoznačnému pořadí persistence při souběhu HTTP a
WS nebo více WS sessions. B4 proto nesmí svůj scoped Studio cancel vydávat za
uzavření globálního souběhu.

## Minimální reprodukce

```bash
rg -n "activeM1Turns|activeTurns|createChatRoutes|createSessionAdapter" \
  src/routes/chat.js src/ws-bridge/session-adapter.js
```

## Co se v tomto WP neopravuje

B2 nesmí měnit `src/ws-bridge/**` ani connector v1. B4 má zachovat scoped WS
cancel a negativně ověřit jeho lokální chování. Sdílená autorita napříč
transporty vyžaduje samostatný návrh vlastnictví, životního cyklu a recovery;
nesmí vzniknout jako skrytý globální singleton v tomto adaptéru.

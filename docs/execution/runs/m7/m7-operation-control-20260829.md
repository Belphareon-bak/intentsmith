# M7 operation control — 2026-08-29

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

## Vazba

- vstupní evidence HEAD: `5729566777c56e1becc0daaffa5604f00f651710`;
- exact product candidate: `4d279e3c62b7d2816e700f9cc5b470b116a32542`;
- product tree: `98b09e2954244a979c7e817e84a555b6a8b0dade`;
- implementační commit: `d9808920`;
- module-boundary commit: `4d279e3c`;
- branch: `codex/m7-mobile-contract-integration-20260829`, bez upstreamu;
- registry: 491 runnable, 397 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `917ccb7ea3fc358d221304c19417f97fbb0f98ceb9588acb00ce07629208d3bc`.

## Implementovaná hranice

`operation.list` a `operation.get` projektují durable M7 journal pouze pro
důvěryhodný `deviceId + subjectId`. Stav, result reference a revision jsou
odvozené ze skutečného intent/outcome/abandonment řetězu. List cursor je
HMAC-bound k device, subjectu, state filtru, úplnému snapshotu a offsetu.

`operation.abandon` je mutation vedená stejným durable journalem jako jiné M7
mutace. Vyžaduje vlastní exact intent, fresh revision cílového pending/unknown
záznamu a zapisuje canonical BLOB do append-only migrace 103. Nevolá cancel,
retry ani původní core handler, nemění cílový event a terminal/foreign/stale
cíl odmítne.

Control-plane descriptor není součástí inzerovaných sedmi remote capabilities.
Provider jej umí zavolat jen s exact manifestem, handlerem a mutation journalem.
Listener, session, pairing, transport a produkční activation tento řez nepřidal.

## Spuštěná evidence

| Hranice | Výsledek |
|---|---|
| operation-control adapter | `6/6 PASS` |
| provider + durable journal | `11/11 + 12/12 PASS` |
| conversation + settings compatibility | `8/8 + 10/10 PASS` |
| mobile contract/provider | `11/11 + 14/14 PASS` |
| mobile gate | `26/26 PASS` |
| schema migrations | `55/55 PASS`; 90 migrací |
| M1 exact schema oracle | `20/20 PASS` |
| M6 runtime + technical evidence | `8/8 + 8/8 PASS` |
| module ratchet | `13/13 PASS`; 1 223 hran / 3 cykly / 28 souborů |
| artifact boundary | `158/158 PASS` |
| registry | valid; 491 runnable; exact fingerprint výše |
| souvislý offline+database gate | `331/331 PASS`; žádný non-PASS |

Zelený běh začal `2026-08-29T04:16:11.473Z`, skončil
`2026-08-29T04:19:55.521Z`, vrátil exit 0 a zůstal vázaný na exact source
`4d279e3c62b7d2816e700f9cc5b470b116a32542`.

Raw artefakty:

- report:
  `.intentsmith-artifacts/m7-operation-control-offline-database-final2-20260829/2026-08-29T04-16-11-438Z/report.json`;
- report SHA-256:
  `7017b4de3d248ca94980372a3b8a3e5e1504d71d2538e11fd4e38c013fb8ad0b`;
- inventory SHA-256:
  `928ae3bb029289472242079aa06259f7cd0722c9a17441befaef860a1ae0e533`;
- inventory fingerprint:
  `d11eb3d63d681ab7c49ae26c9ff114453ed3a6a34cf1061ab87a84b1d96dadab`;
- options fingerprint:
  `9b0f5493445525ad6af6160e8903e9fb9a7cc39d9424cab67ddba788405ae59b`.

Běh použil existující izolovaný PDF runtime přes exact absolutní
`INTENTSMITH_PDF_PYTHON` a deklarované lokální toolchain allowlisty. Nepoužil
model, inference Ollamy, GPU, listener ani mobilní zařízení.

## Červená mezievidence

První souvislý běh na stejném candidate skončil `323 PASS / 8 BLOCKED`, verdict
`BLOCKED`, exit 2. Spouštěcí příkaz neobsahoval schválené lokální toolchain
allowlisty. Report SHA-256:
`065deb002281b07bf00db2f0b4628111a6f99a833745b91e4d39fc88bff4b2e9`.

Druhý běh přidal allowlist, ale nepředal exact PDF interpreter. Preflight proto
správně odmítl dvě PDF sady jako
`toolchain:python-pdf-runtime:invalid-executable-authority`; výsledek byl
`329 PASS / 2 BLOCKED`, verdict `BLOCKED`, exit 2. Report SHA-256:
`04d09261997af60245752a79b1375fa94122e4d641c76cdf2d3a996462f66514`.

Oba výsledky zůstávají zachované. Zelený běh není přebarvení, ale nový úplný
run s přesným dříve existujícím PDF runtime pinem.

## Limity a review hranice

Abandon znamená „už tuto vzdálenou operation evidence nebudu řešit“, nikoliv
„efekt byl zrušen“. U unknown záznamu může underlying efekt existovat; UI proto
nesmí z abandoned samotného odvodit čistý workspace nebo bezpečný retry.

Jednotná approval projekce není součástí řezu. Produkční approval zdroje nemají
homogenní expiry: lifecycle autoritu má, standalone pre-approval efekt ji vždy
nemá. Normalizace potřebuje operátorské rozhodnutí a nebyla vymyšlena z
mobilního kandidáta.

Žádný live LLM/chat-quality, Ollama inference, fyzický GPU, pairing, device,
listener, signature, rotace, history rewrite, push, tag ani publish neproběhl.
Samostatný M6 24h soak běžel dál nad starším exact kandidátem a jeho výsledek
nebude přenesen na tento SHA.

Nezávislé review je povinné. Tento report není M7 acceptance ani runtime
activation.

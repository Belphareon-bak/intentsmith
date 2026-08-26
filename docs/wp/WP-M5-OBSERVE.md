# WP-M5-OBSERVE — production correlation and diagnostics

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

## Rozsah

Tento řez sjednocuje pozorování produkční HTTP hranice bez změny veřejné
sémantiky M2 connectorů. Každý request dostane serverovou identitu, odpověď ji
vrací v `X-Request-ID` a známá durable identita běhu se vrací v
`X-IntentSmith-Run-ID`. Log a diagnostika korelují pouze kanonické identity;
libovolné request/response payloady ani credential hodnoty nepřebírají.

## Kontrakt

- `intentsmith.production-diagnostics@1`;
- deterministická failure taxonomy rozlišuje authentication, authorization,
  input, not-found, conflict, rate-limit, cancellation, timeout, dependency,
  resource, storage, recovery a internal failures;
- bounded in-memory ledger drží nejvýše 32 posledních chyb a agregované HTTP
  počty/latence;
- veřejný health obsahuje pouze readiness boolean pro DB a úplnost M2 startup
  recovery;
- plná diagnostika je jen na globálně autentizovaném
  `GET /api/system/diagnostics`;
- všechny tři produkční health aliasy používají jednu handler authority.

## Negativní hranice

- neplatný klientský request ID ani error string nesmí vstoupit do
  strukturovaného logu;
- přerušené spojení se započte právě jednou jako `cancelled` bez podvrženého
  HTTP statusu;
- diagnostika nikdy neukládá body odpovědi, token ani tajemství;
- neúplná startup recovery nesmí vracet `ready: true`.

## Důkaz a limity

Product commit je `44e74ae1`, exact-edge baseline `08d5a23a`. Focused důkaz je
v [`m5-observe-20260826.md`](../execution/runs/m5-observe-20260826.md).

Jde o procesní diagnostiku jednoho serverového procesu, ne o dlouhodobé
metrické úložiště ani distribuovaný trace backend. Samostatné WebSocket zprávy
mají vlastní přijaté M1 identity a sekvence; tento řez nepřidává druhou WS
protokolovou identitu.

Tento dokument není nezávislé review ani M5 acceptance. M3 oddíl 7 a další M5
bloky zůstávají otevřené.

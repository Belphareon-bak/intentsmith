# WP-M7-OPERATION-CONTROL

**Typ:** zapisující M7 capability blok

**Vstupní revision:** `5729566777c56e1becc0daaffa5604f00f651710`

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_PENDING / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Companion může bezpečně vypsat a načíst vlastní durable operation evidence a
vědomě opustit pending nebo unknown záznam. Opuštění uzavírá pouze vzdálený
evidence record; neruší, neopakuje ani nepřeznačuje původní efekt.

## 2. Povolené a zakázané cesty

Povolené jsou `src/remote/m7-operation-*`, aditivní migrace 103, provider
composition pro transport-free control plane a přesné test/registry/census
změny. Zakázané jsou server/listener/routes, session a pairing, Android signing,
produkční transport, modelová aktivace a jakýkoli cancel/retry původního efektu.

## 3. Connector

Řez implementuje existující kandidátní operace `operation.list@1`,
`operation.get@1` a `operation.abandon@1` z odděleného
`m7-control-plane-prerequisite@1`. Veřejný capability set se tím nerozšiřuje a
provider control-plane descriptor neinzeruje jako aktivní remote capability.

## 4. Závislosti

Vstupem je durable mutation journal z migrace 101, exact mobilní payload
kontrakty a HMAC cursor primitive. Nová migrace 103 uchovává pouze canonical
BLOB receipt a cizí nebo terminal operation nelze opustit.

## 5. Demonstrace

Izolovaná SQLite cesta vytvoří unknown efekt, načte jej přes provider, provede
journalovaný abandon se správnou revision a po restartu vrátí `abandoned` bez
druhého core/effect callu. Stale revision, terminal target, cizí subject,
změněný cursor a SQL tamper selžou typovaně nebo na DB triggeru.

## 6. Focused ověření

`node tests/m7-operation-control-adapters.test.js` prochází `6/6`; související
journal, provider, schema, M1 upgrade a mobilní contract programy jsou zelené.
Úplný offline+database gate se spustí až nad čistým kandidátem.

## 7. Stop condition

Řez se zastaví před změnou approval expirace, cancel/retry sémantiky,
session/pairing identity, veřejného listeneru nebo produkční aktivace. Approval
projekce je samostatné operátorské rozhodnutí, protože standalone pre-approval
efekty nemají vždy autoritativní expiry.

## 8. Ověřovací příkazy

```bash
node tests/m7-operation-control-adapters.test.js
node tests/m7-operation-journal.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

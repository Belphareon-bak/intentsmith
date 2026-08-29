# WP-M7-SESSION-AUTHORITY

**Typ:** zapisující M7 security prerequisite

**Vstupní revision:** `e75cd2e161928524543b67213f945ae14390c468`

**Stav:** `IMPLEMENTATION_IN_PROGRESS / REVIEW_REQUIRED / NOT_ACTIVE /
TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Budoucí Remote Companion dostane durable, restart-safe device pairing a krátce
žijící session autoritu. Jednorázový pairing kód se v databázi nikdy neukládá,
device prokazuje vlastnictví Ed25519 privátního klíče a scope, expiry, counter,
nonce i revokace se kontrolují před předáním identity core provideru.

## 2. Povolené a zakázané cesty

Povolené jsou nový `src/remote/m7-session-*` modul, aditivní migrace 105,
focused test, registry a přesné schema/module ratchet oracles. Zakázané jsou
`src/server.js`, routes, veřejný listener, bind mimo loopback, TLS aktivace,
produkční klíče, Android signing a změna M2 approval autority.

## 3. Connector

Blok implementuje transport-free `M7SessionAuthority@1`. Produkční kód
neimportuje mobilní kandidátní kontrakt. Focused test porovná Ed25519 signing
bytes s kandidátní hranicí; její veřejné přijetí a wire challenge exchange
zůstávají samostatným review/operátorským gate.

## 4. Závislosti

Požadavek vychází z `ROADMAP.md` M7: pairing, device scope, expiry, revokace a
audit každé remote authority akce. Migrace 105 je první volný slot po union
censu všech lokálních větví; žádná jiná větev číslo 105 nepoužívá.

## 5. Demonstrace

Izolovaná SQLite cesta vydá jednorázový claim přes injektovanou user authority,
spáruje testovací Ed25519 zařízení, otevře session po device proofu, přijme
monotónní invocation a po restartu odmítne replay. Revokace zařízení okamžitě
zneplatní všechny session; souběžný claim má právě jednoho vítěze.

## 6. Focused ověření

Pozitivní test pokryje issue → claim → challenge → open → authorize → refresh →
revoke. Negativní testy pokryjí slabý scope, raw code persistence, cizí klíč,
tamper, expired challenge/session, duplicate nonce/counter, restart a race.

## 7. Stop condition

Blok se zastaví před otevřením listeneru a před změnou veřejného invocation
envelope. Kandidátní session kontrakt zatím nepopisuje wire cestu pro získání
server challenge ani per-invocation device signature/channel binding; to je
bezpečnostní rozhodnutí pro operátora po review tohoto transport-free řezu.

## 8. Ověřovací příkazy

```bash
node tests/m7-session-authority.test.js
node tests/mobile-remote-session-contract.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

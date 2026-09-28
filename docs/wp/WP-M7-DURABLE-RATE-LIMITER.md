# WP-M7-DURABLE-RATE-LIMITER

**Typ:** bezpečnostní M7 storage authority bez listeneru

**Vstupní revision:** `4d6823a8`

**Stav:** `IMPLEMENTATION_GREEN / FOCUSED_GREEN / REVIEW_REQUIRED / LISTENER_ABSENT /
PRODUCTION_KEY_CUSTODY_ABSENT`

## 1. Uživatelský výsledek

Budoucí LAN/VPN listener nebude spoléhat na restartem ztracený in-memory
counter. Genuine admission plan se spotřebuje v jedné SQLite `IMMEDIATE`
transakci, všechny pairing buckety buď projdou společně, nebo se nezmění nic.

## 2. Povolené a zakázané cesty

Povolené jsou samostatný limiter modul, aditivní migrace 108, genuine plan
brand na admission policy, focused test, schema/module/registry ratchet a
dokumentace. Zakázané jsou server, route, listener, session/provider wiring,
produkční HMAC klíč, certifikát, network request, Android signing a UI.

## 3. Invarianty

- plan i limiter jsou closure-genuine, strukturální klon neprojde;
- countery jsou per opaque HMAC identity, raw IP ani claim se neukládají;
- multi-bucket spotřeba je atomická a restart-safe;
- clock regression, active-window config drift, storage chyba a kapacitní strop
  selžou zavřeně;
- každý bucket drží jediný current-window řádek, expired řádky mají time-bound
  cleanup a absolutní počet řádků má fail-closed strop;
- denied pokus neinkrementuje žádný sibling bucket;
- listener a session authority zůstávají bez konzumenta.

## 4. Stop condition

Zastavit před runtime wiring. Produkční HMAC key custody, durable store policy,
exact interface/origin/certifikát a pairing issuance jsou operátorské vstupy.
Tento WP smí pro test použít jen zřetelně fixture key.

## 5. Ověření

```bash
node tests/m7-durable-rate-limiter.test.js
node tests/m7-transport-admission-policy.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-candidate-plan.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

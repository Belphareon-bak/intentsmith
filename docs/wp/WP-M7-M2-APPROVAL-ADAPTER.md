# WP-M7-M2-APPROVAL-ADAPTER

**Typ:** zapisující M7 transport-free authority adapter

**Stav:** `IMPLEMENTATION_GREEN / REVIEW_REQUIRED / NOT_ACTIVE /
TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Mobilní companion může bezpečně zobrazit a rozhodnout čekající projektovou
změnu, ale nevzniká žádná druhá approval ani effect autorita. Vzdálená cesta
smí pouze projektovat a volat přijatou M2 lifecycle application service.

## 2. Autorita

`createM2LifecycleApprovalPort()` vydává closure-brandovaný port jen skutečné
instanci `createM2LifecycleApplicationService()`. M7 adaptér odmítne
strukturální klon. Subject pochází z trusted session contextu; původní transport
origin se znovu načte z immutable M2 plánu a remote request jej nemůže dodat
ani změnit.

Schválení vyžaduje exact `planDigest`, `approvalViewDigest` a revision.
Teprve potom se volá `approveSmallProjectChange()`, která znovu ověří ownera,
workspace revision, governance vstupy, expiry a přijatou M2 effect cestu.
Reject používá stejnou službu a durable cancel intent. Mutation replay vlastní
existující M7 operation journal.

## 3. Read model a soukromí

Owner-scoped list je omezený na 2 000 záznamů a používá fingerprintovaný index
z migrace 106. Projekce nese cesty měněných souborů, počet změn, risk class,
čas, stav a content-addressed identity; nenese before/after bytes, focused-test
environment ani hostový root. HMAC cursor váže device, subject, filtry a celý
snapshot.

## 4. Demonstrace

Focused test vytváří skutečný Git projekt a reálnou M2 application service.
Dokazuje stale odmítnutí bez zápisu, validní approve až do projektu, právě jeden
durable M2 approval intent, restart-safe M7 replay, terminální reject a prázdný
výsledek pro cizí subject. `EXPLAIN QUERY PLAN` běží nad produkčním SQL a
vyžaduje index migrace 106.

## 5. Stop condition

Tento blok nepřipojuje session autoritu, listener ani síťový transport. O-01 a
O-02 musí nejdřív projít samostatným review; podmíněný session verdict zakazuje
activation před tímto checkpointem. Events, notifications, produkční mobilní
signing, distribuce a device test zůstávají mimo rozsah.

## 6. Ověření

```bash
node tests/m7-m2-approval-core-adapters.test.js
node tests/m7-core-composition.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

# WP-M7-REMOTE-HEALTH

**Typ:** zapisující M7 control-plane blok

**Vstupní revision:** `acebfc79`

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_PENDING / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Companion může přes existující `remote-health.read@1` získat časově ukotvený,
seřazený a typovaný obraz připnutých core komponent. Selhání jedné sondy
nezfalšuje ostatní jako zdravé a nevynese interní detail chyby.

## 2. Povolené a zakázané cesty

Povolený je transport-free health adapter, provider composition a přesná
test/registry/census evidence. Zakázané jsou server, route, listener, session,
pairing, síťové sondy, DB singleton, Android signing a aktivace remote runtime.

## 3. Connector

Používá beze změny kandidátní `m7-control-plane-prerequisite@1` operaci
`remote-health.read` s `RemoteHealthQuery@1` a `RemoteHealthSnapshot@1`.
Control plane se neinzeruje jako aktivní capability.

## 4. Závislosti

Composition musí dodat explicitní core version, hodiny a 1–32 pevně
pojmenovaných probe funkcí. Adapter nemá allow-all default ani vlastní přístup
k runtime singletonům.

## 5. Demonstrace

Dvě sondy vrátí seřazený contract-valid snapshot. Throw a malformed výsledek
se změní na explicitní `unavailable/PROBE_*` bez úniku zprávy. Neplatný čas
vrátí typed error dříve, než se jakákoli sonda zavolá.

## 6. Focused test

`node tests/m7-remote-health-adapter.test.js` prochází `5/5`.

## 7. Stop condition

Zastavit před určením produkční session/listener authority, přidáním síťové
sondy, zveřejněním interních chyb nebo tvrzením, že fixture probe je live
produkční health důkaz.

## 8. Ověření

```bash
node tests/m7-remote-health-adapter.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

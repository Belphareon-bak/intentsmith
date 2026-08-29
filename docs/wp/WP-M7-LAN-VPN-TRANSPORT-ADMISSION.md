# WP-M7-LAN-VPN-TRANSPORT-ADMISSION

**Typ:** bezpečnostní M7 transport policy bez listeneru

**Vstupní revision:** `6d050aa8`

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_REQUIRED / LISTENER_ABSENT / SESSION_AUTHORITY_NOT_CONNECTED`

## 1. Uživatelský výsledek

Budoucí mobilní companion má jednu fail-closed vstupní politiku pro přímý
TLS provoz doma nebo přes VPN. Politika nepovolí veřejný bind, wildcard,
reverse proxy identitu, legacy route ani bearer credential. Neotevírá ale
socket a sama ještě není transportem.

## 2. Autorita a invariants

- bind je konkrétní IPv4 private/CGNAT nebo IPv6 ULA adresa; loopback,
  link-local bind, wildcard a public IP jsou odmítnuté;
- peer identity pochází výhradně ze socketem pozorované adresy; IPv4-mapped
  IPv6 se kanonizuje na stejnou identitu;
- spojení je TLS 1.3 + HTTP/1.1, Host musí sedět na exact HTTPS server origin a
  server identity je připnutá SHA-256 SPKI hodnotou;
- povolené jsou jen přesné metody a sedm cest mobilního session kontraktu;
- query, fragment, `/api/*`, `/m1/*`, `/c3/ws`, redirect/proxy hlavičky,
  Authorization, cookies, transfer encoding, duplicitní hlavičky a nekanonická
  či nadlimitní délka těla selžou před session/provider hranicí;
- raw peer IP se nevydává: HMAC-SHA-256 s oddělenou doménou tvoří opaque
  identity pro rate-limit consumer;
- pairing plán má samostatný global, peer a peer+claim-digest bucket; invoke
  vyžaduje trusted `read|mutation` klasifikaci a limity 60/min a 10/min.

## 3. Záměrně chybějící authority

Policy pouze vytváří immutable plán s autoritou
`DURABLE_RATE_LIMIT_CONSUMER_REQUIRED`. Neimplementuje durable spotřebu bucketu,
produkční HMAC key custody, certifikát/private key, parsing body, HTTP response,
socket, listener lifecycle ani startup wiring. Strukturální klon policy nebo
admission objektu není genuine.

Podmíněný session review zůstává nedotčen: `m7-session-authority.js` nemá
nového konzumenta a composition ani server transport policy neimportují.

## 4. Stop condition

Zastavit před vytvořením nebo otevřením serveru a před předáním
`M7SessionAuthority` jakékoli route. Aktivace vyžaduje nejdřív review PASS O-01,
O-02 a tohoto WP, pak operátorsky dodaný produkční certifikát/SPKI pin, stabilní
rate-limit HMAC klíč a reviewed durable limiter.

## 5. Ověření

```bash
node tests/m7-transport-admission-policy.test.js
node tests/mobile-remote-session-contract.test.js
node tests/m7-session-authority.test.js
node tests/m6-candidate-plan.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Souvislý profilový gate nad exact kandidátem
`bba4bbf3b9f1864863d53f6323caf455ecb5fc3f` skončil `338/338 PASS`, bez
jediného non-PASS. Raw report je
`.intentsmith-artifacts/m7-transport-admission-offline-database-20260830/2026-08-29T22-53-46-348Z/report.json`
a jeho SHA-256 je
`df1fa20522afc04c55c06bd9fe95bee95e834b2c824c91f961c67b9f82801356`.
To dokazuje současnou deterministic `offline + database` množinu, nikoli
listener, zařízení, síť, live LLM/GPU nebo produkční key custody.

# WP-M7-DISCONNECTED-REQUEST-PIPELINE

**Typ:** zapisující M7 integrační security blok bez listeneru

**Vstupní revision:** `f562bbe9`

## 1. Uživatelský výsledek

Budoucí Remote Companion dostane jednu odpojenou request hranici, která skládá
již review-passed admission policy a durable limiter se session autoritou a
transport-free core providerem. Blok neotevře socket, nečte TLS private key a
není produkčním transportem.

## 2. Povolené cesty

- `src/remote/m7-disconnected-request-pipeline.js`;
- úzké genuine-brand a health request-id doplnění v existujících M7 admission
  a session modulech;
- `tests/m7-disconnected-request-pipeline.test.js` a focused kompatibilita;
- test registry, exact module-boundary ratchet a dokumentační evidence.

Zakázané jsou `src/server.js`, `src/routes/**`, `src/ws-bridge/**`, socket,
listener, bind, systemd credential, produkční klíč/certifikát, síťový request,
Android signing, GPU/Ollama a změna M2 approval/effect autority.

## 3. Invarianty

- vstupem jsou raw transport metadata a exact raw body bytes; UTF-8, JSON,
  content-length a canonical wire bytes selžou zavřeně před autoritou;
- pořadí je admission → trusted operation classification → durable limiter →
  session authority → provider; rate-limit denial nesmí zavolat session ani
  core handler;
- pairing claim digest vzniká pouze z raw claim kódu a raw hodnota se v pipeline
  ani limiteru nepersistuje;
- invocation `read|mutation` klasifikace pochází z připnutého operation
  registru, nikdy z requestu;
- provider scope rozhodnutí vzniká až po validaci payloadu a znovu váže exact
  capability, verzi, operation a payload podepsaného envelope;
- veřejný health má explicitní klientský request ID v exact hlavičce, žádný
  body/query a vrací pouze existující S0 health projekci;
- structural clone admission policy, limiteru nebo session authority není
  přijatelná závislost;
- modul neexportuje core provider ani jinou cestu, která by obešla limiter nebo
  session authority.

## 4. Stop condition

Zastavit před listenerem, route registrací, skutečným bindem, key custody,
produkčním pairing issuance UI a fyzickým device testem. Doporučené varianty
M7-TLS-01, M7-RATE-01, M7-NET-01 a M7-PAIR-01 nejsou tímto WP považované za
operátorsky podepsané rozhodnutí.

## 5. Acceptance

- všech sedm admission routes má přesný disconnected dispatch;
- public health je jediná session-free cesta;
- šest POST cest odmítne nekanonické/duplicitní/trailing JSON bytes;
- invocation bez platného per-request Ed25519 proofu nebo s jiným payloadem,
  scope, capability či operation nedosáhne core handleru;
- limiter denial, invalidní admission a invalidní body mají nulové downstream
  efekty;
- focused suite, session/admission/limiter/core kompatibilita, registry,
  module-boundary, schema a artifact testy projdou na čistém kandidátu.

## 6. Ověření

```bash
node tests/m7-disconnected-request-pipeline.test.js
node tests/m7-session-authority.test.js
node tests/m7-transport-admission-policy.test.js
node tests/m7-durable-rate-limiter.test.js
node tests/m7-core-composition.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

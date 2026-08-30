# M7 disconnected request-authority pipeline — review packet

## Požadované verdikty

```text
M7_DISCONNECTED_REQUEST_PIPELINE = REVIEW_PENDING
M7_TRANSPORT_ADMISSION_CURRENT   = REVIEW_PENDING
M7_DURABLE_RATE_LIMITER_CURRENT  = REVIEW_PENDING
M7_SESSION_AUTHORITY_CURRENT     = REVIEW_PENDING
M6_CURRENT_REGISTRY_RATCHET      = REVIEW_PENDING
M7_OVERALL                       = NOT_ACCEPTED
M7_LISTENER                      = ABSENT
```

Review má ověřit současné bytes, ne přenést starší verdikty. Pipeline poprvé
skládá admission, limiter, session authority a provider; současně mění bucket
config identity a closure brand session autority.

## Identita a rozsah

```text
baseEvidenceHead = f562bbe95c06ca62694ddbb24e100239f783714c
productCandidate = 5c185b0f88d05eac5f6c7d71d04b54c2eac6d67f
candidateTree    = 234d29ff31cfb0c428e1c661fe165c3472e7b567
reviewRange      = f562bbe9..5c185b0f
branch           = codex/m7-mobile-contract-integration-20260829
upstream         = absent
push             = not performed
```

Pozdější report/packet commit smí měnit jen evidence-only cesty. Jakýkoli
pozdější product nebo test commit ruší verdict nad `5c185b0f`.

## A — přesné transportní bajty a pořadí hranic

Trace `dispatch()` od raw `bodyBytes` a `transport` až po výsledek. Ověř:

1. admission proběhne před body parsingem a exact Content-Length před
   limiterem;
2. každý request kromě framing mismatch spotřebuje genuine durable rate plan,
   včetně invalid UTF-8/JSON a neznámé invocation;
3. fatal UTF-8 plus exact canonical JSON odmítne duplicate keys, trailing bytes,
   nekanonická čísla/pořadí a normalizační nejednoznačnost;
4. GET health má nulové tělo a exact request ID z jediné povolené hlavičky,
   zatímco POST ji nemůže použít jako druhou identitu;
5. raw IP, claim, payload ani key bytes se neobjeví v limiter rows nebo errors.

Zkuste malformed Content-Length, oversized body, invalid UTF-8, duplicate JSON
key, unknown operation a structural clones všech tří vstupních autorit.

## B — signed invocation a closure-private provider

Ověřte skutečný call graph `provider.invoke -> authorityResolver ->
authorizeInvocation -> adapter`:

1. provider schema validation musí proběhnout před spotřebou nonce/counteru;
2. resolver musí přijmout pouze factory-issued invocation state a exact
   canonical envelope;
3. capability ID/version, operation ID, payload a required scopes musí sedět
   současně mezi trusted catalogem, provider requestem a podepsaným envelope;
4. Ed25519 proof, session/device/subject identity, expiry/revocation, counter a
   nonce musí ověřit durable session authority před core handlerem;
5. structural clone contextu, payload tamper, scope substitution a unknown
   operation nesmí volat core;
6. provider nesmí být exportovaný ani dosažitelný jinou cestou.

Test explicitně dokazuje, že invalid provider payload nespotřebuje counter a
stejný vědomý pokus lze po opravě provést, zatímco validně podepsaný payload
tamper selže před project authority.

## C — concurrency, terminalita a response kontrakt

Jedna pipeline instance drží jeden aktivní provider handler na session
revision. Druhý souběžný request projde signature/replay autoritou, spotřebuje
svůj counter a vrátí signed-request-bound error envelope
`REMOTE_SESSION_IN_FLIGHT_LIMIT`; core handler se podruhé nespustí. Ověřte,
že `finally` fence vždy uvolní a že response envelope přesně váže request,
session revision, accepted counter, payload digest a čas.

Zvlášť rozhodněte, zda je pro odpojený `NOT_ACTIVE` řez přijatelné, že fence je
per pipeline instance. Aktivace listeneru musí buď prokázat singleton
composition, nebo zavést shared/durable in-flight authority. Packet netvrdí
cross-process fence.

U mutation failure ověřte, že unknown journal outcome se nikdy nepřepíše na
retryable success. U read failure zkontrolujte sanitizovanou retryability a že
interní error text/payload neunikne.

## D — sdílený session-control bucket

Toto je nejdůležitější integrační změna proti předchozímu limiter review.
`session/challenge`, `open`, `refresh` a `revoke` sdílejí bucket a parametry,
ale mají různá request routeId. Ověřte:

1. genuine bucket nese stabilní `configurationId=session-control`;
2. SQLite řádek porovnává configurationId, maximum a window, ne request route;
3. decision stále nese skutečný routeId kvůli auditu;
4. čtyři cesty sdílejí jediný counter bez false config drift;
5. skutečná změna limitu/window/configurationId v aktivním okně dál
   fail-closed selže;
6. multi-bucket denial stále nezvýší žádný sibling counter.

## E — disconnection a aktivace

Prokažte strukturálně, že nový modul nevytváří/importuje HTTP, HTTPS, TLS,
socket, route, WS, server ani `fetch`; nevolá `listen()` a není importovaný ze
startup/server cesty. `describe()` musí pravdivě vracet `listener: absent`,
`transport: disconnected`, `IMPLEMENTED_NOT_ACTIVE`.

Testovací konfigurace používá syntetické klíče a in-memory/temp SQLite. Nesmí
existovat produkční certifikát, HMAC key, systemd credential, listener, port,
network request nebo pairing UI. Dřívější podmínka „session authority nesmí k
listeneru před invocation signing“ zůstává splněná: invocation signing je
implementované, ale listener stále neexistuje.

## F — current registry a module ratchet

Přepočítejte, neopisujte:

```text
total programs       = 500
ACTIVE               = 406
HISTORICAL           = 15
BLOCKED              = 79
ACTIVE + required    = 401
offline required     = 270
database required    = 70
profile gate total   = 340
registry fingerprint = a7bbe1f71db2989bc32da23f9b30c3fd216fa3a175b02d15c311691fc8f0ff5e
module edges         = 1247
cycles / files       = 3 / 28
```

Pipeline program musí být ACTIVE, required, database a člen exact
deterministické fáze. Odeberte ho z klonu plánu a vyžadujte
`plan:required-program-uncovered`. Ověřte společný posun registry,
nightly-orchestrator fingerprintu, README/TEST-REGISTRY a harness DB census
`123 -> 124` s funkčním mutation sentinel testem.

## Reprodukce evidence

```text
node tests/m7-disconnected-request-pipeline.test.js       # 7/7
node tests/m7-transport-admission-policy.test.js          # 9/9
node tests/m7-durable-rate-limiter.test.js                # 11/11
node tests/m7-session-authority.test.js                   # 11/11
node tests/m7-core-composition.test.js                    # 8/8
node tests/mobile-remote-session-contract.test.js         # 13/13
node tests/mobile-remote-capability-provider-contract.test.js # 14/14
node tests/schema-migrations.test.js                      # 55/55
node tests/m1-model-failover-schema.test.js               # 20/20
node tests/m6-candidate-plan.test.js                      # 19/19
node tests/module-boundary-ratchet.test.js                # 13/13
node tests/artifact-validation.test.js                    # 158/158
node tests/harness-exit-code.test.js                      # PASS
node tests/nightly-orchestrator-self-test.js              # PASS
node scripts/validate-test-registry.js --json             # valid / 500
git diff --check                                          # PASS
```

### Souvislý gate

```text
sourceRevision       = 5c185b0f88d05eac5f6c7d71d04b54c2eac6d67f
runId                = 2026-08-30T18-07-59-345Z
result               = 340 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = a7bbe1f71db2989bc32da23f9b30c3fd216fa3a175b02d15c311691fc8f0ff5e
inventoryFingerprint = 012de803d77c85193cd5627a6479c9895a6fac31c49b6e5bdd087c990c43af61
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = b6e4f44ae141ca6af1218cba0f5e64a9541bec80ef3c9822e327706eb1de4a08
```

Raw report:

`.intentsmith-artifacts/m7-disconnected-request-pipeline-offline-database-final-20260830/2026-08-30T18-07-59-345Z/report.json`

Žádný live LLM/chat-quality, Ollama, GPU, server, network listener ani fyzický
device run se netvrdí.

## Výstup review

Vraťte pět oddělených verdictů z úvodu a všechny surviving nálezy se severity.
Explicitně uveďte, zda:

- všech sedm rout prochází jedním pořadím authority;
- payload validation skutečně předchází session replay consumption;
- sdílený session-control bucket nezpůsobuje config drift ani undercount;
- in-flight tvrzení je přesně omezené na jednu pipeline instance;
- disconnection/listener absence je strukturální;
- plný gate patří exact `5c185b0f` a nevznikl pozdější product/test commit.

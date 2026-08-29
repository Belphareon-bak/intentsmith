# M7 mobile contract integration — 2026-08-29

## Outcome

```text
base M6 candidate             = 0f9e2c645a9e26578521916d2f783068e9d5202d
source mobile candidate       = ab1940aac6694b6a6ac616b833967fe47ba9ed26
M7 product candidate          = 54a10fd0bb6134c9437c99a103dcb23e7ed639f8
M7 product tree               = 3a7758900f3444e640c0a5eaf77014bfe5106c68
contract integration          = IMPLEMENTATION_GREEN
independent review            = REQUIRED
production provider           = ABSENT
listener / transport          = ABSENT
Android runtime integration   = NOT_PERFORMED
live LLM / Ollama / GPU       = NOT_RUN
push / tag / publish          = NOT_PERFORMED
```

The integrated product candidate adds a transport-free consumer pin, executable
candidate payload/capability/session contracts, sanitised fixtures, a
provider-conformance harness and a test-only simulator. The eleven files copied
from the mobile preparation branch are byte-identical to their blobs at
`ab1940aa`; the current-core integration test is new and imports the actual M2
descriptor and M5 adapter exports.

No route, listener, database migration, credential, pairing authority, Android
runtime or release artifact was added. The candidate therefore remains
`CANDIDATE_NOT_ACCEPTED`; implementation green is not provider or transport
availability.

## Contract identities

| Boundary | Exact digest |
|---|---|
| M2 `RemoteCorePort@1` descriptor | `sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52` |
| M5 adapter manifest | `sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52` |
| M7 mobile requirements | `sha256:e076d2f17484772474bb9c4c806d156c369645fd4af395bfb19a58beee4a0654` |
| Test registry | `e0fb9ec59e860128fbb9b16664604b349fbfe9f515ada52b0b2ed22fe5047a63` |

## Focused verification

```text
mobile RemoteCore consumer                 7/7 PASS
mobile capability contract                11/11 PASS
mobile provider contract                  14/14 PASS
mobile session contract                   12/12 PASS
mobile test-only simulator                15/15 PASS
current M2/M5 pin integration              4/4 PASS
focused M7 total                          63/63 PASS
M2 RemoteCore contract                    17/17 PASS
M2 RemoteCore physical boundary           10/10 PASS
M5 in-process adapter                     12/12 PASS
M6 candidate plan                         16/16 PASS
artifact validation                      158/158 PASS
module boundary ratchet                   13/13 PASS
nightly orchestrator self-test              1/1 PASS
git diff --check                              PASS
```

The M6 plan originally held a stale literal count of 366 ACTIVE+required
programs. It now compares the exact selected set to the registry-derived set
and separately rejects duplicate IDs. Adding six required offline programs also
triggered the intentional nightly registry fingerprint ratchet; candidate
`54a10fd0` updates the reviewed fingerprint and the profile census from
`246 + 59` to `252 + 59` with the self-test staying green.

## Continuous offline and database gate

The accepted run used a private hash-locked CPython 3.12 PDF runtime in this
worktree and exact `/usr/bin` Git, bwrap and prlimit authorities. Dependencies
were installed with `npm ci --offline`. No external-network, model, Ollama or
GPU program was selected.

```text
runId                   = 2026-08-29T00-50-48-959Z
sourceRevision          = 54a10fd0bb6134c9437c99a103dcb23e7ed639f8
resultCount             = 311
statusCounts            = 311 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict / exit          = PASS / 0
required non-PASS       = 0
distinct result SHAs    = [54a10fd0bb6134c9437c99a103dcb23e7ed639f8]
registryHash            = e0fb9ec59e860128fbb9b16664604b349fbfe9f515ada52b0b2ed22fe5047a63
inventoryFingerprint    = 272358dfe55864be2f4a39765ee654131735e02f609085ce99f3d901450cf174
optionsFingerprint      = 164ed3a984fd44fae819dc72af495b92a2e7c7cc7fc3c2465f0d787a0d820155
report SHA-256          = f6d071530c90526f91dcf020e16db568101fe1f87403bf7c8ab789978aec81c1
inventory SHA-256       = 1f93cad9d816bb37ba6e32e3466c1a299325c4ae33f0f86281985c9206187d0d
```

Evidence is retained under
`.intentsmith-artifacts/m7-offline-database-valid-20260829/2026-08-29T00-50-48-959Z/`.

## Invalid environment run retained as failure evidence

An earlier attempt at pre-gate candidate `4b11654e` started before this reused
checkout had a local dependency installation. Database consumers failed on
`ERR_MODULE_NOT_FOUND: better-sqlite3`. The run was interrupted once the common
environment cause was proven and remains truthfully red:

```text
runId            = 2026-08-29T00-48-45-228Z
statusCounts     = 83 PASS / 56 FAIL / 0 TIMEOUT / 0 BLOCKED / 172 SKIPPED
verdict / exit   = FAIL / 1
signal           = SIGINT
report SHA-256   = 632a2b4981864ea757c01d01a5c63ad08371884092f610eeebf98b6aacc5e901
classification   = INVALID_ENVIRONMENT_MISSING_DEPENDENCIES
```

It is not baseline or candidate PASS evidence and was not deleted or relabelled.

## Review boundary

Review the product range `0f9e2c645a9e26578521916d2f783068e9d5202d..54a10fd0bb6134c9437c99a103dcb23e7ed639f8`.
Acceptance must verify the actual contract and consumer/provider call graph,
not infer production availability from simulator success. A green review may
authorize the next in-process provider block; it does not authorize a listener,
pairing policy, public exposure, Android signing or distribution.

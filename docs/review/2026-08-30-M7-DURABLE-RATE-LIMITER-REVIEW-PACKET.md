# M7 durable rate limiter and current ratchet — review packet

## Requested verdicts

```text
M7_DURABLE_RATE_LIMITER      = REVIEW_PENDING
M6_CURRENT_REGISTRY_RATCHET  = REVIEW_PENDING
M7_OVERALL                   = NOT_ACCEPTED
M7_PROVIDER                  = NOT_ACTIVE
M7_LISTENER                  = ABSENT
```

This packet requests adversarial review of the disconnected durable limiter
and the registry/schema/module ratchets changed by that slice. The earlier
transport-admission packet retains its own verdict identity. This packet does
not request listener activation, production key handling, pairing issuance,
device release, M6 Gate 0, receipts, tag, publish or push.

## Identity and range

```text
baseEvidenceHead = 4d6823a8d54b6be93d60b70e253a83d98371af2f
implementation   = 2fbd13fb4f987e4ed848641906eef0f1c2bd38d7
productCandidate = b23f63d6832dbe5e315be17b63a8496fdf55bdf0
candidateTree    = 78cf9700657c0a3f3c09d765b1b903065d979272
reviewRange      = 4d6823a8..b23f63d6
branch           = codex/m7-mobile-contract-integration-20260829
upstream         = absent
push             = not performed
```

The later documentation-only evidence commit is outside this range and is not
an allowed M6 release-evidence commit. Any later product or test commit
invalidates a verdict bound to `b23f63d6`.

## Area A — genuine plan and receiver authority

Trace both closure WeakSets rather than accepting shape checks:

1. Can a structural clone, deserialized object or caller-built bucket plan pass
   `requirePlan()`?
2. Can a copied/unbound `consume` method or a structural limiter clone mutate
   state?
3. Does every genuine plan originate after exact transport admission and carry
   only one to three valid, distinct opaque identities?
4. Can raw peer IP, canonical peer bytes, pairing claim/digest or HMAC key reach
   SQLite, the decision object, error details or logs?

## Area B — transaction and concurrency truth

Review the actual `better-sqlite3` transaction boundary and reproduce the
file-backed two-process race.

1. Is the whole multi-bucket precheck plus write inside one `BEGIN IMMEDIATE`
   transaction?
2. Can capacity, config, clock or storage failure leave a partial sibling
   increment?
3. Can two processes admit more than the exact maximum or lose an increment?
4. Does a denied plan leave all request bucket counters unchanged?
5. Does state survive close/reopen and a second independent SQLite connection?

Expected race result for one mutation bucket with limit 10:

```text
allowed total = 10
denied total  = 10
stored count  = 10
```

## Area C — time, drift, retention and capacity

Exercise exact boundary values rather than only happy-path windows:

1. Does a clock value below the last durable observation fail closed?
2. Can a changed bucket, route, maximum or window duration reset an active
   row, or must it wait until the old window expires?
3. Can an expired, mismatched row recover only from a genuine canonical plan?
4. Does the absolute row cap fail before inserting any member of a multi-bucket
   request?
5. Can retention delete an active/recent row or let an unbounded number of live
   identities bypass capacity?
6. Do missing schema, prepare failures and runtime SQLite errors surface only as
   typed `M7_RATE_LIMIT_STORAGE_FAILURE`, never allow/pass?

## Area D — schema and local tamper boundary

Recompute migration 108's exact fingerprint and inspect constraints, primary
key, `WITHOUT ROWID` and expiry index. Confirm it stores no raw identity. State
explicitly whether same-host direct SQL tampering is inside or outside the
accepted remote threat model; the current implementation detects active-window
configuration drift but does not claim cryptographic integrity for ordinary
SQLite counter bytes.

Verify the complete migration chain is now 95 with tip 108, and that fresh
schema, second run and previous-version upgrade oracles agree.

## Area E — disconnection

Prove structurally that neither limiter nor admission policy creates a server,
calls `listen()`, imports session/provider/server/route/WS runtime, owns a
production key or is consumed by startup composition. The conditional session
review remains binding. Any listener connection before a later review must
invalidate this slice.

## Area F — module and M6 registry ratchets

Recompute rather than copying this packet:

```text
total programs       = 499
ACTIVE               = 405
HISTORICAL           = 15
BLOCKED              = 79
ACTIVE + required    = 400
offline required     = 270
database required    = 69
profile gate total   = 339
registry fingerprint = f2b34a8765fe5ec759586ea04d606e2166eeb022cb7b6d1936ba532bca3e750b
module graph         = 1242 edges / 3 cycles / 28 files in cycles
```

The limiter test must be ACTIVE, required, database-profile and a member of the
deterministic phase. Removing it from a cloned plan must yield
`plan:required-program-uncovered`. Confirm nightly policy, profile counts and
registry fingerprint move together. Confirm the module baseline added exactly
one named edge and did not increase cycles or cyclic membership.

## Evidence to reproduce

```text
node tests/m7-durable-rate-limiter.test.js        # 10/10
node tests/m7-transport-admission-policy.test.js  # 8/8
node tests/schema-migrations.test.js              # 55/55
node tests/m1-model-failover-schema.test.js       # 20/20
node tests/m6-runtime-evidence.test.js             # 8/8
node tests/m6-technical-evidence.test.js           # 8/8
node tests/m6-candidate-plan.test.js               # 19/19
node tests/module-boundary-ratchet.test.js         # 13/13
node tests/artifact-validation.test.js             # 158/158
node tests/nightly-orchestrator-self-test.js       # PASS
npm run test:registry                             # valid / 499
git diff --check                                  # PASS
```

### Full offline + database gate

```text
sourceRevision       = b23f63d6832dbe5e315be17b63a8496fdf55bdf0
runId                = 2026-08-29T23-21-36-593Z
result               = 339 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = f2b34a8765fe5ec759586ea04d606e2166eeb022cb7b6d1936ba532bca3e750b
inventoryFingerprint = b152a242179f4061dcddb37b09276b73f9c5be9d2e3ad17df6283eef095d64ef
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = 1e19ab678f96e312379822e2596437e01b2b5b54c38b780ebdf2eaeee5700d80
```

Raw report:

`.intentsmith-artifacts/m7-durable-rate-limiter-offline-database-20260830/2026-08-29T23-21-36-593Z/report.json`

No live LLM/chat-quality, Ollama, GPU, listener/network or physical-device run
is claimed.

## Operator inputs deliberately left open

- `M7-TLS-01`: exact origin, bind IP/port and certificate/private-key/SPKI
  custody;
- `M7-RATE-01`: production HMAC key custody and confirmation of retention and
  capacity parameters; the SQLite counter store now exists;
- `M7-NET-01`: exact LAN/VPN interface/firewall and proof of no public
  NAT/port-forward/reverse proxy;
- `M7-PAIR-01`: local authenticated one-time pairing-claim issuance UX.

Until these are decided and a later connected slice receives its own review,
activation remains forbidden.

## Requested review output

Return separate verdicts and list every surviving finding by severity:

```text
M7_DURABLE_RATE_LIMITER
M6_CURRENT_REGISTRY_RATCHET
```

Also state explicitly whether the cross-process proof is real, whether the
SQLite tamper boundary is truthfully scoped, whether the listener disconnection
holds, whether the full gate binds exact `b23f63d6`, and whether any later
product/test commit appeared.

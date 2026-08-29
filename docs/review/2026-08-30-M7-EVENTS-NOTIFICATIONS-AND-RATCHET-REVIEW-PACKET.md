# M7 events, notifications and current M6 ratchet — review packet

## Requested verdicts

```text
M7_RUN_EVENT_CORE_ADAPTER       = REVIEW_PENDING
M7_NOTIFICATION_CORE_ADAPTERS   = REVIEW_PENDING
M7_SEVEN_CAPABILITY_COMPOSITION = REVIEW_PENDING
M6_CURRENT_REGISTRY_RATCHET     = REVIEW_PENDING
M7_OVERALL                      = NOT_ACCEPTED
M7_PROVIDER                     = NOT_ACTIVE
M7_TRANSPORT                    = ABSENT
```

This packet asks for review of the new transport-free event and notification
slice plus the registry ratchet it necessarily changes. It does not ask for
listener activation, LAN/VPN transport, production signing, device release,
M6 Gate 0, operator receipts, tag, publish or push.

## Identity and ranges

```text
baseEvidenceHead        = 6688b8fd1fa47c05c923b657dfd1732745b9a83f
implementationCommit   = 1231b27a46d31f9814083bba04b9522a57d6a064
moduleRatchetCommit     = f1b93dd675ff7eb0fa2ce8ab55b0dca3c106b342
compositionProofCommit  = e18d7df6aaeb4bc2a1e045be21b1e2fd09a065c9
gateCandidate           = 277c7ee9d87c7507c56b4e4c15a30d0710a01eae
candidateTree           = a0a4b9ac128a9f421f23746b83f1252442d35303
reviewRange             = 6688b8fd..277c7ee9
branch                  = codex/m7-mobile-contract-integration-20260829
upstream                = absent
push                    = not performed
```

The later documentation/evidence commit is outside the product range and must
not be mistaken for a new reviewed product candidate. Any product or test
commit after `277c7ee9` invalidates the requested verdicts.

## Area A — M1 run-event projection

Trace the actual call graph from the M1 session adapter observer into
`m7-run-event-core-adapter.js`.

Required questions:

1. Is an event accepted only after `CoreEvent@1` validation, and can the M7
   adapter manufacture a session event or alter the primary send outcome?
2. Is subject/run partition taken from trusted injection rather than a remote
   payload, with no cross-subject list or wakeup?
3. Are free-form payload/detail bytes absent from storage and output?
4. Are sequence conflicts isolated to one run, and is retention loss explicit
   as `REMOTE_EVENT_WINDOW_GONE` rather than a silent partial history?
5. Can long-poll timers complete twice, leak a waiter or fail when an injected
   timer fires synchronously?

## Area B — M3 notification projection

Trace `AgentRepository` to its closure-branded M3 read port and then through
`m7-notification-core-adapters.js`.

Required questions:

1. Can a structural clone, legacy HTTP handler or arbitrary repository-like
   object become the notification authority?
2. Are `body` and free-form `data` impossible to emit, and are titles excluded
   from authority requests?
3. Is project/run visibility checked before and after reading each row?
4. Does keyset paging remain complete when a denied row lies between two
   allowed rows, without leaking or skipping authorized data?
5. Are list bounds enforced by the production SQL path rather than only by
   response slicing?

## Area C — notification ACK authority and durability

Review migration 107, operation-journal binding and restart behavior together.

Required questions:

1. Can ACK exceed the exact per-device observed frontier, target a missing or
   foreign notification, or use another subject's operation?
2. Do both authority checks happen before the first durable effect so a lost
   second authorization cannot leave a receipt behind?
3. Is the receipt exact canonical BLOB evidence tied to a STARTED
   `notification.ack` intent, and do direct INSERT, UPDATE and DELETE fail?
4. Does replay return the original durable result without re-running the
   effect, and is read state isolated per device?
5. After a file-backed SQLite restart, is the connection-local UDF restored
   before safe writes, with the SQL boundary still fail-closed?

## Area D — truthful seven-capability composition

Default composition must still advertise only four capabilities. A genuine M2
approval port may add approvals, and genuine M1/M3 ports may add events and
notifications. Review must prove that all seven handler sets can be complete
without activating the provider and that no server, listener or network module
consumes the session/composition authority.

The prior conditional session verdict remains binding: no listener may consume
the authority until O-01 per-invocation signatures and O-02 challenge flow have
their own review pass. This packet does not silently expand that verdict.

## Area E — M6 registry and schema ratchets

Current census:

```text
total programs          497
ACTIVE                  403
HISTORICAL               15
BLOCKED                  79
ACTIVE + required       398
offline required        269
database required        68
profile gate total      337
registry fingerprint    7adffb2446dca9a292c6b635a345f8591923893e8a45a76e13ec05b96d51b2ee
migration count          94
fresh DB table count    168
module graph           1241 edges / 3 cycles / 28 files in cycles
```

Both new adapter programs must be ACTIVE, required, in the deterministic phase
and protected by omission negatives that fail with
`plan:required-program-uncovered`. Recompute counts and fingerprint rather than
copying this packet. Confirm migration 107's fingerprint and the updated
94-migration M6 upgrade oracle.

## Evidence to reproduce

```text
node tests/m7-run-event-core-adapter.test.js          # 7/7
node tests/m7-notification-core-adapters.test.js      # 8/8
node tests/m7-core-composition.test.js                # 8/8
node tests/ws-bridge.test.js                          # 88/88
node tests/schema-migrations.test.js                  # 55/55
node tests/m1-model-failover-schema.test.js           # 20/20
node tests/m6-runtime-evidence.test.js                # 8/8
node tests/m6-technical-evidence.test.js              # 8/8
node tests/m6-candidate-plan.test.js                  # 19/19
node tests/module-boundary-ratchet.test.js            # 13/13
node tests/artifact-validation.test.js                # 158/158
node tests/nightly-orchestrator-self-test.js          # PASS
node tests/harness-exit-code.test.js                  # PASS
node scripts/validate-test-registry.js --json         # valid / 497
git diff --check                                      # PASS
```

### Full offline + database gate

```text
sourceRevision = 277c7ee9d87c7507c56b4e4c15a30d0710a01eae
runId          = 2026-08-29T22-29-25-473Z
result         = 337 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict        = PASS / exit 0
registryHash   = 7adffb2446dca9a292c6b635a345f8591923893e8a45a76e13ec05b96d51b2ee
reportSha256   = 9f2b66269ed2f1cd296694271e6cb6c144dd6447082b7cb1a1d8892b591e5a4f
```

The two earlier reports are retained and remain truthfully BLOCKED:

```text
2026-08-29T22-21-07-181Z = 329 PASS / 8 BLOCKED / exit 2
reportSha256 = a3a17c498519a1046e41a41c1204b6b3f050a587b51ba64d62b31304275ef768

2026-08-29T22-25-04-826Z = 335 PASS / 2 BLOCKED / exit 2
reportSha256 = 85a27a78853d4b29d7b9c3cf44c4173129130bf13dd4fdf6ba7446adc9d2d46a
```

The first is the host-toolchain control. The second proves every non-PDF
toolchain program passed before the exact local PDF interpreter was supplied.
No LLM/chat-quality, Ollama, GPU, listener, network or physical-device run is
claimed.

## Requested review output

Return four separate verdicts and list every surviving finding by severity:

```text
M7_RUN_EVENT_CORE_ADAPTER
M7_NOTIFICATION_CORE_ADAPTERS
M7_SEVEN_CAPABILITY_COMPOSITION
M6_CURRENT_REGISTRY_RATCHET
```

Also state explicitly whether the conditional session activation gate remains
unviolated and whether any product/test commit appeared after `277c7ee9`.

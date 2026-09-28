# M7 session authority / review follow-ups / M6 current registry ratchet — result

## Verdicts

```text
M7_SESSION_AUTHORITY        = REVIEW_PASSED  (conditional — see activation gate)
M7_REVIEW_FOLLOWUPS         = REVIEW_PASSED
M6_CURRENT_REGISTRY_RATCHET = REVIEW_PASSED
```

These close the three named areas. They do not accept M6 or M7. M7 stays
`REVIEW_PENDING / NOT_ACTIVE / TRANSPORT_ABSENT`.

## Identity

```text
productCandidate = 12e1adfc13c8544e40d244308ca6c1b0dd7ed412
productTree      = 283032f3538527543eaf179422459945513eb076
evidenceHead     = b1dba7826f38757a4e39e02c0f85d1950352a2e9
range            = e75cd2e1..12e1adfc
```

Confirmed independently: the tree hash matches, `e75cd2e1` resolves and is an
ancestor, `12e1adfc..HEAD` is two linear evidence-only commits adding two
`docs/review/` documents, `git diff --check` is clean over the range, the
worktree is clean and the branch has no upstream.

Registry recomputed: 494 suites, 400 ACTIVE, 395 `ACTIVE + required`, 334 on the
`offline`+`database` profiles, fingerprint
`bf26d0a5585fb202120bf49175129e090c8de393aa4a74e85ca7cb0d344effb5` — every
figure identical to the claim. The green gate binds `sourceRevision`
`12e1adfc`, 334 rows, no non-PASS entry, verdict PASS, exit 0. The earlier red
gate is preserved at source `10dbf61a` with 325 PASS / 1 FAIL / 8 BLOCKED, the
single FAIL being `tests/mobile-remote-core-simulator.test.js` — the stale
mobile digest it was supposed to catch. The eight BLOCKED rows are host
toolchain gaps (`bwrap`, `python-pdf-runtime`, `git`, `prlimit`), not defects.

## M7 session authority — REVIEW_PASSED, conditional

The construction is sound and the adversarial properties are real rather than
asserted.

Pairing claims are 128-bit random tokens. Only `sha256(claimCode)` is persisted
— the insert has no column for the code itself — and the code is returned once.
Consumption is a compare-and-swap inside an `IMMEDIATE` transaction
(`UPDATE … WHERE claim_id = ? AND consumed_at_ms IS NULL AND revoked_at_ms IS
NULL` followed by `changes !== 1` rejection), so two concurrent claims cannot
both succeed. Revoked, consumed and expired claims fail on distinct error codes.

Challenge nonces are likewise stored only as digests and consumed against
`nonce_digest AND purpose AND device_id AND pairing_revision`, so a challenge is
bound to its purpose and device and cannot be transplanted.

Replay protection is durable rather than in-process: `last_client_counter` lives
in `m7_remote_sessions` and accepted nonces in `m7_remote_invocation_nonces`, so
it survives restart. The counter update is itself a guarded CAS
(`WHERE … AND state = 'ACTIVE' AND last_client_counter < ?`), and revocation
carries its own race check.

Denied attempts are audited, not only successes: every entry point is wrapped in
`withDeniedAudit(...)`, and the state and audit tables reject mutation, deletion
and mismatched evidence.

`tests/m7-session-authority.test.js` is `9/9`, covering claim issuance without
persistence, single-use across repository instances, a tampered Ed25519 proof
that fails without burning its challenge, expiry, terminal revocation,
append-only enforcement and fail-closed defaults.

Inactivity is real: `M7SessionAuthority` has no consumer anywhere in `src/`
outside its own module — only migration 105 registers its validation functions.
No route, no listener. `M7_SESSION_AUTHORITY_STAGE` is `IMPLEMENTED_NOT_ACTIVE`.

### Activation gate

Signature coverage is deliberate but partial:

| Flow | Proof |
|---|---|
| `openSession` | Ed25519 `RemoteSessionOpenRequest@1` |
| `refreshSession` | Ed25519 `RemoteSessionRefreshRequest@1` |
| `revokeSession` | Ed25519 `RemoteSessionRevokeRequest@1` |
| `authorizeInvocation` | **none** |

`authorizeInvocation()` takes `sessionId`, `sessionRevision`, `deviceId`,
`subjectId`, `clientCounter` and `nonce`, and verifies session state, identity
match, scope, counter monotonicity and nonce uniqueness. It performs no
signature check. The counter and nonce defeat replay of a captured message, but
not forgery by anyone holding the session identifiers. On the hot path the
session is therefore a bearer credential, and a leaked session means full
impersonation until revocation.

Nothing is exposed today, so this is not a shipped hole, and the implementer
independently identified it as O-01. `REVIEW_PASSED` is granted on that basis
and is bound to this condition:

> The session authority must not be reachable from any listener, route or
> transport until per-invocation signing lands and is reviewed. Wiring it before
> that voids this verdict.

## M7 review follow-ups — REVIEW_PASSED

| Follow-up | Result |
|---|---|
| query plan analyses the production CTE | fully closed |
| M6 plan guards the M7 session test | closed, real ratchet |
| mobile derived descriptor digests rebound | closed, red gate proves it |
| manifest points at retained artifacts | code closed, unexercised |

The query-plan follow-up is closed better than requested. `EXPLAIN QUERY PLAN`
now runs the real `productionStatement` with real bindings and asserts three
access paths: `idx_m7_remote_operation_list` for the driving scan,
`sqlite_autoindex_m7_remote_operation_events_2` on
`device_id, subject_id, operation_id, sequence` for the outcome join, and
`sqlite_autoindex_m7_remote_operation_abandonments_2` on
`device_id, subject_id, target_operation_id` for the abandonment join. What was
previously safe by schema reasoning is now proven empirically for both joins.

`scripts/mobile-release-evidence.mjs` now copies both archives to retained
names, records `retainedPath` beside `path`, and digests the retained copy
rather than the build output. That is the right fix. Two caveats, neither
blocking: the regression asserts the generator's **source text** rather than the
produced manifest, and no mobile-release evidence has been regenerated since, so
all four existing manifests still carry only the volatile Gradle path and the
newest (`2c499637`, which predates the fix) retains no archives at all. The next
mobile evidence run must be checked to actually contain `retainedPath` with
digests matching the retained bytes.

## M6 current registry ratchet — REVIEW_PASSED

`IS-T1-TESTS-M7-SESSION-AUTHORITY-TEST` is guarded the same way as the two
authority proofs: asserted `ACTIVE`, `required`, `profile === 'database'` and a
member of the deterministic phase, then removed from a cloned plan with the
validation required to fail. `tests/m6-candidate-plan.test.js` is `18/18`,
`nightly-orchestrator-self-test` exits 0 against the current fingerprint, and
`scripts/validate-test-registry.js` exits 0. The 395-program complete plan and
the 334-program profile gate are kept distinct; both were derived independently
from the registry here and match.

## Carried observation, not closed

The two branches still ship different `tests/harness-exit-code.test.js`
(`daa1b95b` here, `b3051cc2` on `codex/m6-release-20260827`). This branch treats
`.intentsmith-artifacts/direct-tests/` as an ignored root; the other fails
whenever any sandbox is present. The green gate here is sound, but the gate
result depends on which version is checked out. Reconcile before the branches
meet.

## Boundary

No M6 or M7 acceptance, no Gate 0, no operator demo, no listener, no transport,
no production signing, no rotation, no history disposition, no promotion, tag,
publish or push. Live LLM and GPU work remains deferred. Any product commit
after `12e1adfc` invalidates these verdicts.

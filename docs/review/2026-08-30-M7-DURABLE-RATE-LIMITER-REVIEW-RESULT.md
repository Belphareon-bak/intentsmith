# M7 durable rate limiter / M6 current registry ratchet — result

## Verdicts

```text
M7_DURABLE_RATE_LIMITER     = REVIEW_PASSED
M6_CURRENT_REGISTRY_RATCHET = REVIEW_PASSED
```

Neither accepts M6 or M7. M7 stays `NOT_ACTIVE / TRANSPORT_ABSENT`.

## Identity

```text
productCandidate = b23f63d6832dbe5e315be17b63a8496fdf55bdf0
productTree      = 78cf9700657c0a3f3c09d765b1b903065d979272
evidenceHead     = f8f15204745c26e75b812f0aec20ff6c47d433b9
```

Confirmed independently: tree hash matches, the chain
`4d6823a8 → 2fbd13fb → b23f63d6 → f8f15204` is linear, the worktree is clean and
the branch has no upstream. Registry recomputed at 499 suites, 405 ACTIVE,
400 `ACTIVE + required`, 339 on `offline`+`database`, fingerprint
`f2b34a8765fe5ec759586ea04d606e2166eeb022cb7b6d1936ba532bca3e750b` — every
figure identical to the claim. Module graph 1242 edges / 3 cycles / 28 files in
cycles, and 95 migration files, both as claimed.

The gate report hashes to
`1e19ab678f96e312379822e2596437e01b2b5b54c38b780ebdf2eaeee5700d80`, binds
`sourceRevision = b23f63d6`, and carries 339 rows with no FAIL, BLOCKED or
TIMEOUT.

## M7 durable rate limiter — REVIEW_PASSED

The decision structure is correct, and it is correct for the reason that matters
rather than by accident. `consume()` runs entirely inside one `IMMEDIATE`
transaction and is split into phases that never write before the outcome is
known:

1. observe every bucket, computing the count each *would* reach, writing nothing;
2. check total rows plus new rows against the capacity ceiling;
3. if any bucket would exceed its maximum, return denied and write nothing at all;
4. only when every bucket allows, persist all of them.

That ordering is what makes the multi-bucket claim true rather than approximate.
A naive implementation that incremented bucket by bucket would leak an increment
onto the earlier buckets of a request the later bucket denies. This one cannot,
because no write happens until the whole plan is known to pass.

Durability and cross-process safety are real. State lives in
`m7_remote_rate_limit_buckets`, so it survives restart, and the `IMMEDIATE`
transaction takes its write lock at `BEGIN`, so two processes serialize rather
than interleave read-then-write. The suite proves this with actual
`node:child_process` spawns, not simulated concurrency.

Fail-closed paths are typed and distinct: clock regression is caught both on
wall-clock (`nowMs < row.lastObservedAtMs`) and on window number
(`window.windowNumber < row.windowNumber`); configuration drift inside an active
window is refused rather than silently re-based; missing schema, storage failure
and the capacity ceiling each raise their own error. The limiter object itself is
validated against a closure-private `WeakSet`, so a forged receiver cannot
consume.

`tests/m7-durable-rate-limiter.test.js` is `10/10`, and its final case asserts
that the limiter stays disconnected from listener, session and provider runtime.
That is independently true: `createM7DurableRateLimiter` has no consumer anywhere
in `src/` outside its own module.

The session authority remains unwired as well — only migration 105 references it,
to register validation functions. The conditional `M7_SESSION_AUTHORITY` verdict
of 2026-08-29 therefore still holds.

## M6 current registry ratchet — REVIEW_PASSED

`IS-T1-TESTS-M7-DURABLE-RATE-LIMITER-TEST` joins the sentinel list with the same
shape as its predecessors: asserted `ACTIVE`, `required`, an allowed profile and
membership in the deterministic phase, with removal from a cloned plan required
to fail validation. `tests/m6-candidate-plan.test.js` is `19/19`,
`nightly-orchestrator-self-test` exits 0 against the current fingerprint,
`scripts/validate-test-registry.js` exits 0, and `tests/schema-migrations.test.js`
is `55/55`. The 400-program complete plan and the 339-program profile gate were
both derived independently here and match.

## Observation — handoff commits have drifted off evidence-only paths

Not blocking, and it does not affect either verdict.

`EVIDENCE_ONLY_EXACT_PATHS` is `ROADMAP.md`, `SYSTEM-MAP.md`,
`docs/wp/WP-M6-RELEASE.md`, and `EVIDENCE_ONLY_PREFIXES` is
`docs/execution/runs/` and `docs/review/`. The last two handoff commits step
outside that set:

```text
f8f15204  docs/mobile/CORE-M7-CAPABILITY-HANDOFF.md
4d6823a8  docs/mobile/CORE-M7-CAPABILITY-HANDOFF.md
          docs/wp/WP-M7-LAN-VPN-TRANSPORT-ADMISSION.md
```

The two before them (`cd8632d5`, `b1dba782`) were strictly `docs/review/`, so
this is recent drift rather than established practice. "Documentation-only" is
accurate English but is not the same predicate as evidence-only, and an M6
evidence chain validated across such a range would fail on
`boundary:product-path`. The fix is to keep handoff commits inside the
evidence-only set — not to widen the set, which would weaken the boundary that
makes candidate pinning meaningful.

## Boundary

No M6 or M7 acceptance, no listener, no transport, no pairing wiring, no
production signing, no rotation, no history disposition, no promotion, tag,
publish or push. Live LLM and GPU work remains deferred. Any product commit
after `b23f63d6` invalidates these verdicts.

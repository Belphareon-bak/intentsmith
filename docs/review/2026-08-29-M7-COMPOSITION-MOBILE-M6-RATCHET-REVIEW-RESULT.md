# M7 composition / mobile binding / M6 registry ratchet — review result

## Verdicts

```text
M6_REGISTRY_RATCHET    = REVIEW_PASSED
CORE_COMPOSITION       = REVIEW_PASSED
MOBILE_RELEASE_BINDING = REVIEW_PASSED
```

All seven closures verify: the five M7 findings and both operator-added M6
findings. No critical, high or medium defect survived verification.

These verdicts close the three named areas only. They do not accept M6 or M7.
M7 remains `NOT_ACCEPTED / PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`, and no
production signing, transport, pairing, device test or release is authorized.

## Identity

```text
productCandidate = caaa14ca0fa586ab4a85cd7ccaed47836005a72f
productTree      = aefab7d0447f2722a84ff3137464c4a8a804a6c6
evidenceHead     = 0826d0b89c97b347299331d5867d9f2b2057d44d
branch           = codex/m7-mobile-contract-integration-20260829
```

Independently confirmed: the tree hash matches, `caaa14ca..HEAD` is a single
evidence-only commit touching two documents, both `d43e7ada` and `1d04bd42`
resolve and are ancestors of the candidate, `git diff --check` is clean on both
ranges, the worktree is clean, there is no upstream, and the repository carries
no replace refs or grafts.

## A. M6 registry ratchet — REVIEW_PASSED

| Question | Result |
|---|---|
| 493 runnable / 399 ACTIVE / 394 ACTIVE+required | confirmed |
| fingerprint `a316db7c…f96479` | recomputed identical |
| both authority suites ACTIVE+required offline | confirmed |
| plan derives the exact 394 set with sentinels | confirmed |
| negative regression on removal | confirmed |
| nightly self-test on the current fingerprint | exit 0 |
| 394 plan vs 333 profile kept distinct | confirmed |

The sentinel is a real ratchet rather than a list. For each authority program
the test asserts `ACTIVE`, `required`, `profile === 'offline'` and membership in
the deterministic phase, then clones the plan, removes the program and requires
`validateM6CandidateExecutionPlan` to fail with
`plan:required-program-uncovered:<id>`. A smaller green release run is therefore
not expressible.

`tests/m6-candidate-plan.test.js` is `17/17` where it was `15/1`, and
`nightly-orchestrator-self-test` exits 0 where it previously raised
`registry hash differs from the reviewed Gate 0 policy`. The 333-program figure
was derived independently from the registry and equals exactly the
`ACTIVE + required` set on the `offline` and `database` profiles, so the two
counts are not conflated.

## B. Bounded operation recovery — REVIEW_PASSED

`pageSize` is rejected outside 1–100 by `requireListLimit()` and the statement
binds `rowLimit = pageLimit + 1`. Paging is genuine keyset, not offset: the
driving predicate is `revision > @afterRevision AND revision <= @eventRevision`
under a fixed snapshot bound, ordered by `intentRevision`.

The result set is produced by one statement. Outcome and abandonment are
resolved by `LEFT JOIN`, not by a query per operation, and both joins land on
exact unique-index lookups rather than scans:

```text
m7_remote_operation_events       UNIQUE (device_id, subject_id, operation_id, sequence)
m7_remote_operation_abandonments UNIQUE (device_id, subject_id, target_operation_id)
```

That is the point I checked hardest, because a `LEFT JOIN` that scans per row
would reintroduce the N+1 cost inside a single statement. It does not: each join
predicate matches a unique constraint exactly. Migration 104 adds
`idx_m7_remote_operation_list(device_id, subject_id, sequence, revision)`, whose
column order matches the driving predicate, and the shipped
`EXPLAIN QUERY PLAN` assertion requires that index with all four columns.

The cursor is an HMAC-SHA-256 over a domain-separated encoding compared with
`timingSafeEqual`, binding `capabilityId`, `capabilityVersion`, `contract`,
`deviceId`, `filterDigest`, `offset`, `operationId`, `snapshotRevision`,
`subjectId` and `version`. Filters are bound through `filterDigest`, so a cursor
cannot be replayed under different filters. The 240-operation adversarial test
is present. `m7-operation-control-adapters` is `7/7`, `m7-core-composition`
`5/5`.

## C. APK/AAB source binding — REVIEW_PASSED

Both archives are independently observed. The evidence directory retains
separate `apksigner.txt`, `aab-jarsigner.txt`, `aab-keytool-signer.txt`,
`aapt-badging.txt`, `aapt-manifest.txt`, `aab-manifest.xml` and a network-security
extract per archive, plus an SBOM and a source manifest.

Each archive carries its own parsed `applicationId`, `versionCode`,
`versionName`, `minSdk`, `targetSdk`, `sourceRevision` and `signerSha256`
compared against its own `expectedSignerSha256`. The strongest signal that the
two observations are genuinely independent is that the network-security
resource resolves to different paths — `res/8G.xml` in the APK after resource
optimization, `res/xml/network_security_config.xml` in the AAB — while both
yield the identical `networkSecurityTreeSha256`
`30d476e0…891aa2`. Two different extraction routes converge on the same content
rather than one being copied from the other.

Digests were recomputed independently from the retained bytes and match:

```text
APK 67149b00a115e32a929aa43c5700a9de5d36e3479aa54afc12395bb47720d39d
AAB 0eb63056d95d2ac49feac4e7b60c4e9963da9268ee19b4afb2f198705820129c
```

`classification` is `THROWAWAY_DEBUG_SIGNED`, `releaseTransportReady` is
`false` and `transportMode` is `legacy-m1-dev`, so the artifacts do not
misrepresent themselves as a release. `mobile-android-release` is `15/15`,
including "a production signer cannot promote the legacy development
transport", the mobile gate is `28/28`, and the runtime audit reports zero
vulnerabilities across 98 dependencies.

## D. Evidence and documentation truth — confirmed

The final gate report hashes to
`d7f2e540470bf5ec143c09d136260e574e4d30d81fb436733f99a77cf17395c3`, exactly as
claimed, binds `sourceRevision = caaa14ca`, and contains 333 rows with no
non-PASS entry, verdict PASS, exit 0.

Five deterministic reports are preserved with their real verdicts rather than
pruned to the green one:

| Run | Verdict |
|---|---|
| `c27a62da-final` | FAIL — 87 PASS / 51 FAIL / 195 SKIPPED |
| `c27a62da-retry-01` | FAIL — 332 / 1 |
| `b243c7d1-final` | FAIL — 332 / 1 |
| `57ac2a4d-final` | PASS — 333 (superseded) |
| `caaa14ca-final` | PASS — 333 (final) |

`ROADMAP.md` preserves `CORE_COMPOSITION_CHANGES_REQUIRED /
MOBILE_RELEASE_BINDING_CHANGES_REQUIRED / REMEDIATION_IMPLEMENTED /
RE_REVIEW_REQUIRED / PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT` and records M6 as
`REGISTRY_RATCHET_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`. Neither
document claims a pass ahead of this verdict. No live LLM, GPU, production
signing, device or transport evidence is claimed, and the older running M6 soak
is not transferred to this candidate.

## Non-blocking observations

1. `manifest.json` records `artifacts[].path` as the volatile Gradle output
   (`mobile-app/android/app/build/outputs/…`) rather than the retained evidence
   filename. Those build-directory files have since been rebuilt and now hash to
   `72fcb352…` and `01d459b8…`, so a reviewer following the manifest path meets
   a false mismatch before finding the pinned copies, which are exact. Record
   the retained filename in the manifest, or both paths.
2. The `EXPLAIN QUERY PLAN` assertion runs against a simplified single-table
   query, not the production CTE with its two `LEFT JOIN`s. The joins are safe
   by schema, but the shipped proof does not cover them; extend the assertion to
   the real statement so a later index or predicate change cannot regress
   silently.
3. `.intentsmith-artifacts/direct-tests/` holds 40 sandboxes. This branch's
   `harness-exit-code.test.js` treats that root as ignored, so the green gate is
   sound here, but the `codex/m6-release-20260827` version of the same test
   fails whenever any sandbox is present. Reconcile the two before the branches
   meet, otherwise the gate result depends on which version is checked out.

## Boundary

No M6 or M7 acceptance, no Gate 0, no operator demo, no promotion, tag, publish
or push. Production signing, transport, pairing and device testing were not
performed and are not authorized by this document. Any product commit after
`caaa14ca` invalidates these verdicts.

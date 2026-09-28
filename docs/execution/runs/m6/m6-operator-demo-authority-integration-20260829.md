# M6 signed operator-demo authority integration — 2026-08-29

## Outcome

```text
product candidate             = d71ac77a44545792860d5ab8dea9c747359577e7
product tree                  = ffd0eaf965eeeb12f693423ff9ddd600d623fb5f
demo authority integration    = IMPLEMENTATION_GREEN
actual operator demo          = NOT_RUN
operator approval receipt     = NOT_ISSUED
focused boundary              = 301 PASS / 0 FAIL
offline + database gate       = 304 PASS / 0 non-PASS
registry                      = 464 programs
registry fingerprint          = 79e9864f495d6af23c9817cff9a74fc329a8643ecba8fff14b2a82b31c8d7797
independent review            = REQUIRED
M5 acceptance                 = BLOCKED
M6 acceptance                 = BLOCKED
push / tag / publish          = not performed
```

The M6 operator demonstration now has a fail-closed observation authority and
a separate signed approval boundary. The product can prepare a locked plan,
record raw observations and validate their exact bytes, but it cannot approve
its own demo. Approval remains an offline `SignedAuthorityReceipt@1` from the
`m6-release-operator` role and is revalidated by the standalone release bundle
verifier.

## Product range and authority flow

The product range is `8eb56a168fd5af612c3a121dc47ecc7225263cdb..d71ac77a`:

- `2a90c997` integrates the signed observation/approval contract, runner and
  final verifier consumer;
- `36402da0` pins the new verifier dependency in the exact module graph;
- `a6dbdbe0` reconciles the measured graph census;
- `d71ac77a` rebinds the reviewed nightly registry policy to the intentionally
  added required operator-demo program.

The authoritative flow is:

1. `M6OperatorDemoPlan@1` emits the immutable nine-step plan.
2. `run-m6-operator-demo.js` may only plan, record and validate observations.
3. A complete observation still projects
   `DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL`, never approval.
4. The signed receipt must use domain `intentsmith.m6.operator-demo.v1` and
   authority `m6-release-operator`, and bind the exact candidate, tree,
   registry, release index, artifact manifest, observation and raw evidence.
5. `signed-authority-bundle-verifier.js` reloads the observation from the
   signed evidence HEAD and revalidates canonical UTF-8 bytes and every bound
   artifact before it can promote the demo row.

The plan-only CLI returned digest
`a3b4a5ccf25e99ab8844ff6ffa76a7f2640c7539c5840cfd26c217fba87de5c0`
and outcome `PLAN_ONLY_NOT_DEMO`.

## Negative boundary

The implementation rejects wrong candidate/tree/registry identity, a linked or
dirty checkout, reordered or missing steps, incomplete/failed observations,
unexpected egress, empty/symlinked/path-escaping artifacts, changed bytes,
invalid or noncanonical UTF-8 JSON, wrong receipt role/domain, duplicate or
missing observation bindings and a caller-forged approval projection. The
runner has no approval command and never reads an offline private key.

## Focused verification on the exact candidate

| Program | Result |
|---|---:|
| `tests/m6-operator-demo.test.js` | 7/7 PASS |
| `tests/signed-authority-bundle.test.js` | 12/12 PASS |
| `tests/signed-authority-receipt.test.js` | 5/5 PASS |
| `tests/m6-acceptance-authority.test.js` | 5/5 PASS |
| `tests/m6-release-validation.test.js` | 13/13 PASS |
| `tests/m6-candidate-plan.test.js` | 16/16 PASS |
| `tests/m6-runtime-evidence.test.js` | 8/8 PASS |
| `tests/m6-technical-evidence.test.js` | 8/8 PASS |
| `tests/artifact-validation.test.js` | 158/158 PASS |
| `tests/schema-migrations.test.js` | 55/55 PASS |
| `tests/module-boundary-ratchet.test.js` | 13/13 PASS |
| `tests/nightly-orchestrator-self-test.js` | 1/1 PASS |
| **Total** | **301/301 PASS** |

The registry is valid with 464 programs and the fingerprint above. The module
graph is exactly 1,211 edges, 3 cycles and 28 files in cycles. `git diff
--check` passed and the worktree was clean after every accepted run.

## Continuous deterministic gate and correction

The first exact-candidate diagnostic run on `a6dbdbe0` finished
`303 PASS / 1 FAIL`. The sole failure was
`tests/nightly-orchestrator-self-test.js`: the newly registered required demo
program changed the registry to 464 programs and the offline profile to 245,
while `nightly-orchestrator.js` still pinned the preceding 463-program
fingerprint and `244 + 59` profile counts. The report remains evidence of the
failure, not a PASS:

```text
runId          = 2026-08-28T23-13-21-726Z
sourceRevision = a6dbdbe075cdb26b83ee621a8aa10b187728f5dd
statusCounts    = 303 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict / exit  = FAIL / 1
report SHA-256  = 7a5cde4aeb0f88297213082e45db7aeddb65eb60748c5e7d13d98568a8ff5fd8
```

Commit `d71ac77a` updated the exact fingerprint, profile counts and adversarial
self-test oracle. A new uninterrupted run then executed the full offline and
database registry set with the repository's hash-locked PDF runtime and exact
local Git/bwrap/prlimit authorities:

```text
runId                    = 2026-08-28T23-17-57-727Z
sourceRevision           = d71ac77a44545792860d5ab8dea9c747359577e7
results array length     = 304
distinct result SHAs     = [d71ac77a44545792860d5ab8dea9c747359577e7]
statusCounts             = 304 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
required non-PASS        = 0
verdict / exit           = PASS / 0
registryHash             = 79e9864f495d6af23c9817cff9a74fc329a8643ecba8fff14b2a82b31c8d7797
report SHA-256           = 791ad73603d7c34d6156c81721ee15cbe058657cb2a61b6e6ff9c48919872f9f
inventory SHA-256        = f9cec26c9329bb489eadf2397ac24fc3e1fd408644d2e403f864ce1169d998d1
```

The private PDF runtime is confined to this worktree's artifact root and uses
the already pinned lock. No system package, model binding, Ollama process or
GPU workload was changed.

## Explicit non-claims and remaining gates

This checkpoint proves implementation and deterministic integration, not the
human demonstration. It does not claim that Studio was opened by the operator,
that the nine real steps were observed, or that an approval receipt exists.
Live model chat and physical GPU evidence remain
`DEFERRED_MODEL_OPTIMIZATION`.

M5 privacy rotations/history/acceptance, genuine offline key custody, the real
operator demo, 24-hour soak, full throughput/resource receipt, independent M6
review, Gate 0, promotion, tag and publish remain open. No receipt, rotation,
history rewrite, model activation, push, tag or publish was performed.

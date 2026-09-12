# Core + committed hunt integration — 2026-09-12

State: `IMPLEMENTATION_CANDIDATE / VALIDATION_IN_PROGRESS / REVIEW_PENDING`.
Authority and ownership: [WP](../../wp/WP-CORE-HUNT-INTEGRATION-20260912.md).
Inputs: owned `ab0565bc7a8f47e452c4f41a3f65b3d8564ad5fe` and committed hunt
`3f3a22203b51905a6bf834cb39f5e7f76b2306f2`. The foreign checkout subsequently
advanced to `1b6f7e08`; that later retention delta is excluded from this pin.
The running hunt, live DB, model bindings and services remain untouched.

The merge preserves the reviewed web transport and local approval boundary,
Studio's explicit builder form, CODE grading runtime provenance, response-bound
provider identity, provider-specific evaluation history and append-only hunt
ledger. Pairwise failures retain the actual failing model/artifact identity;
an incumbent timeout is not attributed to the candidate.

## Integration decisions

- Web moves from numeric slot 111 to canonical 113; hunt retains 111 and 112.
  The web body is byte-identical after substituting the exported version.
  The existing exact-stamp adoption mechanism preserves `applied_at` and skips
  the already applied body. Unknown 111 owners remain errors before mutation.
- Provider Decision 044 becomes canonical 048. The old path remains a labelled
  historical alias; web Decision 044 and all authorizations are unchanged.
- CODE helper/lock/Node pins from the core are retained alongside hunt's
  effective inference options in every role contract. A prior run remains
  historical when its exact contract/provider differs; nothing is deleted or
  promoted to current by this integration.
- The current migration count is 100. Fresh schema has 177 tables including
  `sqlite_sequence` (176 without it), zero FK violations. Registry remains
  516 programs, fingerprint `162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`.

## Validation before the merge pin

The initial source was dirty/uncommitted over `fb2953c1`; these results are
development evidence, not tests of that clean commit. Schema tests: **61/61**.
Four real migration histories (fresh, common base, old web branch, hunt branch)
converge to identical schema and retain raw web BLOB/approval/audit and model/
hunt rows across close/reopen. A second pass applies zero migrations. Provider
changes cannot reuse old scores; protected writes and REPLACE remain denied.
Missing canonical target and unknown slot 111 both leave the DB byte-identical.
Fixture construction alone batches the original migration bodies; tested
upgrades use the production runner and its per-migration disk transactions.

Registered focused run `2026-09-12T10-08-10-443Z`: **16 PASS / 1 FAIL**. The
failure was the merged SYSTEM-MAP source/test LOC census, still describing
the core-only input. It is preserved, and the census was remeasured rather
than changing its assertion. Other programs include schema, provider/history,
pairwise, web, M2 lifecycle, M5 outbound and M6 runtime evidence. Registry
reconciliation/validation passed; database bootstrap census remains 129 with
no unprotected root. No model inference was invoked.

## Explicit graph integration

The retained pre-merge baseline is `226bc96e`; it is not an automatically
merged edge list with false provenance. The measured graph has **1323 edges,
3 cycles / 28 members**, versus baseline 1321: nine added, seven removed.
The baseline is updated in a separate commit after pinning clean source.

Nine reviewed additions, all from the bounded integration:

```text
src/db/migrations/2026_09_11_113_conversation_web.js -> src/network/conversation-web-repository.js
src/eval/model-evaluation-runner.js -> src/upgrade/model-use-authority.js
src/upgrade/candidate-trial.js -> src/upgrade/model-use-authority.js
src/upgrade/model-evaluation-history.js -> src/eval/model-evaluation-runner.js
src/upgrade/model-hunt-state.js -> src/upgrade/model-identity.js
src/upgrade/ollama-update-check.js -> src/network/outbound-policy.js
src/upgrade/ollama-update-check.js -> src/upgrade/model-provider-origin.js
src/upgrade/upgrade-manager.js -> src/upgrade/ollama-update-check.js
src/upgrade/vram-measurement.js -> src/upgrade/model-use-authority.js
```

These preserve respectively the renamed typed writer, shared inference lease,
effective-options contract identity, canonical catalog identity and bounded
update-check policy/provider origin. The old web filename edge disappears;
the other six removed edges are the already completed denial of unproven
legacy CODE panel imports. Cycle limits do not grow.

Raw evidence lives in `.intentsmith-artifacts/core-hunt-integration-20260912/`,
including conflict list, local identity census, history supplement, source/
schema census, graph/delta and logs. Previous core/hunt runs remain separate
historical evidence. This integration is not physical Studio→HTTP→model→
approval→execution→restart proof, M5 key custody, independent acceptance or
deployment. Full validation and a pinned reviewer handoff follow below.

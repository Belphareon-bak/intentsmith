# Decision 041 third re-review result

## Verdict

```text
Decision 041 = REVIEW_PASSED

M5 = 8/9 REVIEW_PASSED
     PRIVACY CHANGES_REQUIRED
     ACCEPTANCE_BLOCKED

M6 = SIGNED_AUTHORITY_CHANGES_REQUIRED
     TECHNICAL_REVIEW_CHANGES_REQUESTED
     ACCEPTANCE_BLOCKED

offline key ceremony = READY (separately authorized)
```

`REVIEW_PASSED` covers the Decision 041 byte-identity and Git-history
implementation only. It does not accept M5, does not accept M6, and does not
authorize rotation, history disposition, promotion, tag, publish or push.

## Reviewed identity

```text
productCandidate = 37edf30d738f780594af98a7a1076e3200038478
candidateTree    = 76b67e054d04ce61765f4ca9b6a56843083ade6e
evidenceHead     = 0fcdf52563671fb339c7046d923881162b7941a4
implementation   = 8632c49000fa1fd81c92f769d569ecf5a87cf6e4
reviewRange      = 32887531..37edf30d
```

Independently confirmed: candidate tree matches, `32887531..0fcdf525` is a
single-parent linear chain, `37edf30d..0fcdf525` touches one `docs/review/`
file only, the worktree is clean, the branch has no upstream, nothing was
pushed, and the repository carries no replace refs, grafts or index flags.

## Blocker disposition

| Prior blocker | Disposition | Basis |
|---|---|---|
| SQLite `TEXT` round-trip lost exact byte identity | CLOSED | `m5_signed_privacy_receipts` has exactly one read path and it selects `CAST(record_json AS BLOB)`; `verifyRaw()` accepts the Buffer under fatal UTF-8 decoding plus canonical byte equality |
| Terminal `candidate..HEAD` diff hid mutate-then-revert | CLOSED | `validateM6EvidenceCommitHistory()` walks every commit, binds every parent diff, anchors a single-parent chain at the candidate, terminates it at the evidence HEAD and forbids merges; both production CLIs are rewired |
| Receipt evidence HEAD relied on final-range inference | CLOSED | Per-receipt history is validated and fails closed on a missing entry (`history:commits`) |
| Git reads honored local replacement metadata | CLOSED | `assertM6GitMetadataSafe()` is a repository-wide precondition on the verification path; replace refs, grafts, `assume-unchanged` and `skip-worktree` all abort the verdict |
| Cleanliness hidden by index flags | CLOSED | `git ls-files -v -z` is inspected before porcelain state is trusted |
| Source/test LOC drifted manually | CLOSED | Census is derived from current bytes and drift in either total fails |

The negative evidence is genuine rather than tautological. The byte test
asserts that the SQLite `TEXT` round-trip differs from the stored bytes while
the BLOB read matches them exactly, which demonstrates the original defect. The
real temp-Git fixture commits the product mutation, signs the receipts at the
mutated evidence HEAD, then reverts, so the terminal diff is clean by
construction and the previous implementation would have passed it.

## Independently reproduced evidence

```text
focused + structural = 382/382 PASS  (5+19+5+12+13+38+13+158+119)
registry             = 471 suites
fingerprint          = ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999
module graph         = 1199 internal edges / 3 cycles / 28 files in cycles
source census        = 202574 lines / 537 files
test census          = 222711 lines / 475 files
git diff --check     = PASS
standalone verifier  = BLOCKED / exit 2 / M6_RELEASE_EVIDENCE_NOT_FOUND
```

All thirteen production receipt paths are absent and the trust store is empty,
so the empty-state result is truthful.

## Non-blocking observations

1. The packet sentence "Every Git subprocess uses `--no-replace-objects`" is
   overbroad. Hardening covers `scripts/m6-git-evidence.js` and both Decision
   041 CLIs. `validate-gate0-attestation.js`, `validate-final-disposition.js`,
   `promote-gate0-review.js`, `generate-gate0-evidence.js`,
   `capture-m6-release-artifact.js`, the `run-*-evidence.js` scripts and
   `scan-m5-privacy.js` still spawn raw Git. This does not weaken the verdict,
   because `assertM6GitMetadataSafe()` aborts verification repository-wide, so
   evidence produced under replacement metadata can never be blessed. Scope the
   claim to the verification path. Gate 0's `readChangedEntries()` uses
   single-commit `diff-tree` rather than a range diff and therefore does not
   share the mutate-then-revert defect class.
2. `src/release/signed-authority-bundle-verifier.js` hardcodes
   `worktreeClean: true` and passes one fingerprint as both candidate and
   evidence value in the per-receipt history call, making `history:dirty` and
   `history:registry-drift` structurally unreachable there. Correct in effect,
   since the outer boundary owns both against real values, but a comment would
   stop a later reader assuming they are checked per receipt.
3. `scripts/validate-m6-release.js` calls `assertM6GitMetadataSafe()` inside a
   try/catch and then calls `m6WorktreeClean()`, which calls it again outside
   that catch. Cosmetic only; a throw there would exit non-zero with a stack
   trace instead of the structured FAIL envelope.

## Boundary

The full deterministic gate, live LLM, Ollama, GPU, model-quality chat,
five-minute resource evidence and the 24-hour soak were not run. M5 and M6 still
require real operator receipts and the remaining release and runtime evidence.
Any product commit after `37edf30d` invalidates this verdict.

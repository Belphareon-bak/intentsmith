# IntentSmith Convergence Status

> **This file must be generated, not edited.** Per `D-020` it is produced from
> the verdict commit together with `EVIDENCE-INDEX.json`, and generation refuses
> to run on a dirty worktree. Hand-editing it is how it drifted away from the
> tree it describes during Gate 0 work. The block below is therefore a
> transitional hand-maintained snapshot and is explicitly *not* a verdict.

Last updated: 2026-07-30
Describes: pre-attestation source state on `codex/intentsmith-1.0` —
**not a verdict**

## Current gate

Gate 0 — trustworthy baseline recovery. Definition: `GATE-CRITERIA.md`.

## Current verdict

**FAIL / IN PROGRESS.** Not a release candidate.

Against `GATE-CRITERIA.md` § Gate 0:

| Clause | State | Note |
|---|---|---|
| G0-C1 worktree clean | ? | must be proved by the evidence generator from the final candidate |
| G0-C2 disposition valid | ✓ | 225 records, `validate-final-disposition.js` exits 0 |
| G0-C3 registry valid | ✓ | 350 runnable programs + 8 explicit support exclusions, `validate-test-registry.js` exits 0 |
| G0-C4 clean install reproduces | ~ | verified twice at `0b82592`, not re-run at the current tree |
| G0-C5 required deterministic suites pass | ? | the previously known blocker is cleared — `tests/pilot-c1c2c3.test.js` now reports 44 passed, 0 failed, exit 0 at `f38f5e8`. The full 199-suite T1/T2 scope must be re-run at the final candidate |
| G0-C6 no defective suite counted green | ✓ | 25 `KNOWN_DEFECTIVE` rows are excluded by state |
| G0-C7 blocked suites name a prerequisite | ✓ | all 54 `BLOCKED` rows name server, external network, Ollama, or GPU in structured requirements |
| G0-C8 docs derive from verdict commit | ✗ | this file is still hand-maintained; see `D-020` |

The transitional verdict remains FAIL because G0-C4, G0-C5, and G0-C8 are not
yet proved for one exact final candidate. It is **not** FAIL for a known
deterministic failure any more — that blocker was cleared at `f38f5e8`.

## Frozen refs

| Input | Ref | Local state |
|---|---|---|
| C3 product input | `ffd21cf119865259ea1847af989acb24916bebe3` | checked out |
| C3 comparison parent | `a7b90e36aa80310305703f54f2332e1c0e7f9e8f` | available |
| IntentSmith donor | `6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4` | available as `origin/main` in donor checkout |
| Local Validation candidate | `b0d28bbfd9d4ed55e19a72719ad5e9b776b96c12` | not present in the local donor object database |

## Integration workspace

- Target repository: `git@github-intentsmith:Belphareon-bak/intentsmith.git`
- Worktree: `/home/belphareon/Projects/intentsmith-1.0`
- Branch: `codex/intentsmith-1.0`
- Clean branch base: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`
- Disputed `ffd21cf` commit is not an ancestor of the integration branch
- Original C3 `master` worktree and its local Gate 0 audit checkpoint are preserved and will not be pushed to C3

## Disposition

225 records classified; `validate-final-disposition.js` exits 0.

| Disposition | Records |
|---|---:|
| `EXCLUDE` | 91 |
| `KEEP` | 42 |
| `REBUILD` | 92 |
| `UNRESOLVED / USER_DECISION` | 0 |

`REBUILD` records still need to reach one of the three terminal states in
`FINAL-COMMIT-DISPOSITION.md` (`ACCEPTED` / `DEFERRED(<prerequisite>)` /
`REPAIRED`). Bare `REBUILD/REPAIR` counts as unfinished classification.

## Test registry

350 runnable programs, registry-derived without filename predicates, plus eight
explicitly reasoned support/aggregate exclusions (`G0-R013` mitigated).

| State | Suites |
|---|---:|
| `ACTIVE` | 256 |
| `BLOCKED` | 54 |
| `KNOWN_DEFECTIVE` | 25 |
| `HISTORICAL` | 15 |

G0-C5 scope — required `offline` + `database` profiles: **199 suites**
(`173 + 26`). Derived from the registry per `D-015`, not hand-selected.

## Last completed action

Closed the filename-discovery gap: the validator inventories every supported
program file regardless of name, `_helpers.self-check.js` is now a required
suite, and eight support/aggregate entries carry explicit reasons.

## Next action

1. Re-run the clean install and the full G0-C5 scope from one exact clean
   candidate.
2. Run the evidence generator required by `D-020`, then regenerate this file
   and `EVIDENCE-INDEX.json` from that commit.
3. Prepare the bounded evidence packet for independent read-only review.

## Blockers

- ~~`tests/pilot-c1c2c3.test.js` A9~~ — **cleared at `f38f5e8`**; the quality
  engine now discriminates and the suite reports 44 passed, 0 failed, exit 0.
- The full G0-C5 scope (199 suites) has not been executed at the final candidate. Until it
  is, G0-C5 is unproven rather than met.
- No blocker for local, non-destructive Gate 0 work.
- Fetch is required later if Gate 0 needs the Local Validation candidate ref.
- Repository visibility changes, credential rotation, history remediation,
  force-push, merge, tag, release, publication, and deletion of user data
  require explicit operator approval.
- Pushing verified commits to `codex/intentsmith-1.0` in the IntentSmith
  repository is explicitly authorized; force-push, `main` changes, merge, tag,
  release, and publication are not.

## Open incident

The confirmed privacy exposure (`G0-R001`, `G0-R002`, `G0-R010`) is **not** part
of any prerequisite list and is not absorbed by CONDITIONAL PASS. It carries its
own verdict and depends on operator decisions `P-001`..`P-003`, all still open.
See `GATE-CRITERIA.md` § CONDITIONAL PASS.

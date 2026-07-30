# Gate 0 G0-R014 custom filesystem writer evidence

## Result

- Evidence state: **PARTIAL**
- Risk state: **OPEN**
- Branch: `codex/g0-r014-custom-writers`
- Base SHA: `8b058076991b67af6eaed7dad7a68a35e40d3b32`
- Code and test SHA: `1e9e696db114f7d98e5ce9a432876cef5017b83f`
- Tested SHA: `1e9e696db114f7d98e5ce9a432876cef5017b83f`
- Scope: four custom filesystem writer suites and their registered isolation
  regression in `tests/harness-exit-code.test.js`

This commit does not claim to close `G0-R014` or Gate 0. It removes the shared
`/tmp` dependency from the following four root suites:

- `tests/chat-export-budget.test.js`;
- `tests/export-pdf-docx.test.js`;
- `tests/lifecycle-e2e.test.js`; and
- `tests/lifecycle-human-friction.test.js`.

The remaining R014 consumers are handled by separate bounded branches and must
be reconciled by a fresh integrated inventory before the risk state changes.

## Implemented boundary

All four programs statically import
`tests/helpers/isolated-test-db.js` before any product dependency.

| Program | Owned root | Allocation and cleanup |
| --- | --- | --- |
| `chat-export-budget.test.js` | `isolatedTestRuntime.artifacts` | Every export case receives an atomic `mkdtempSync` directory. Missing and empty conversation cases also stay inside the owned artifact namespace. |
| `export-pdf-docx.test.js` | `isolatedTestRuntime.artifacts` | One atomic `mkdtemp` suite root contains all PDF/DOCX fixtures. It is removed only after an exit-zero assertion state; cleanup errors are no longer swallowed. |
| `lifecycle-e2e.test.js` | `isolatedTestRuntime.projects` | The disposable Git project is atomically allocated. Successful direct runs remove the common runtime; failed runs preserve it. DB cleanup failure now increments the suite failure count. |
| `lifecycle-human-friction.test.js` | `isolatedTestRuntime.projects` | Each of the three Git projects is atomically allocated. Cleanup is transactional and bound to the exact owned conversation ID, project ID, project path, and lifecycle IDs found under that project. |

The friction cleanup keeps the original lifecycle/conversation/project cleanup
semantics without a broad path or name prefix. It explicitly removes the
`quality_scores` rows whose `NO ACTION` foreign key prevents lifecycle
deletion, then verifies that each exact lifecycle and project row was removed.
There is no `LIKE '/tmp/…'` cleanup and no ignored SQL exception.

The common helper contract remains authoritative:

- an exit-zero direct run removes its exact owned runtime;
- a non-zero direct run preserves its runtime for diagnosis;
- cleanup target replacement, symlink traversal, permissive existing roots,
  and runner-owned path violations fail closed.

## Registered regression

`tests/harness-exit-code.test.js` now verifies for all four programs that:

1. no source contains the shared `/tmp` namespace;
2. export programs allocate below `isolatedTestRuntime.artifacts`;
3. lifecycle programs allocate below `isolatedTestRuntime.projects`;
4. the isolation bootstrap precedes product dependencies; and
5. friction project deletion binds exact `id` and `path` parameters instead of
   a broad path prefix.

The same registered meta-test still exercises positive cleanup, non-zero
preservation, cleanup-target symlink substitution, unsafe existing root mode,
audit-root symlinks, and an npm cache outside the owned artifact root.

Mutation proof temporarily changed only the chat export allocation from
`isolatedTestRuntime.artifacts` to `isolatedTestRuntime.temp`. The registered
meta-test failed with:

```text
AssertionError: chat-export-budget.test.js must allocate below the owned artifacts root
```

The mutation run exited 1. Restoring the exact production line returned the
meta-test to exit 0.

## Test environment

Commands ran with:

```text
cwd=/home/belphareon/Projects/coworker/intentsmith-g0-r014-custom-writers
SHA=1e9e696db114f7d98e5ce9a432876cef5017b83f
```

The focused run reused the already installed Node dependency tree from
`/home/belphareon/Projects/intentsmith-gate0-repro/node_modules` through an
untracked temporary symlink. The symlink was removed after testing. PDF tests
used the existing pinned isolated runtime at:

```text
/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python
```

This is focused code evidence, not a clean-clone or clean-install claim. No
external network, model, Ollama, or GPU was used.

## Commands and results

| Command | Result | Exit |
| --- | --- | ---: |
| `git rev-parse HEAD` | `1e9e696db114f7d98e5ce9a432876cef5017b83f` | 0 |
| `git diff --exit-code -- tests/chat-export-budget.test.js tests/export-pdf-docx.test.js tests/harness-exit-code.test.js tests/lifecycle-e2e.test.js tests/lifecycle-human-friction.test.js` | tracked code/test tree equals the tested commit | 0 |
| `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node tests/chat-export-budget.test.js` | 67 passed, 0 failed | 0 |
| `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node tests/export-pdf-docx.test.js` | 28 passed, 0 failed; pinned PDF packages `charset-normalizer 3.4.4`, `pillow 12.3.0`, `reportlab 5.0.0` | 0 |
| `node tests/lifecycle-e2e.test.js` with approved local child-process execution | 138 passed, 0 failed | 0 |
| `node tests/lifecycle-human-friction.test.js` with approved local child-process execution | 23 passed, 0 failed | 0 |
| `node tests/harness-exit-code.test.js` with approved local child-process execution | `Temp bootstrap coverage: 49 root tests covered`; meta-test passed | 0 |
| Same meta-test with the bounded chat writer-root mutation | named owned-artifacts assertion failed | 1 |
| Meta-test after restoring the production root | coverage 49; meta-test passed | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; registry SHA-256 `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5` | 0 |
| `node scripts/validate-final-disposition.js` | 225 records; manifest SHA-256 `aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e`; 60 repaired, 32 deferred | 0 |
| `node tests/artifact-validation.test.js` | 64 passed, 0 failed, 0 skipped | 0 |
| `git diff --check` | no whitespace errors | 0 |

The first sandboxed `node tests/lifecycle-e2e.test.js` attempt exited 1 because
the process sandbox denied `/bin/sh` child creation with `EPERM`. Its isolated
runtime was preserved as designed. The approved local-process rerun is the
authoritative exit-zero product result above; no assertion was changed.

The first friction cleanup implementation also exited 1 with a real
`FOREIGN KEY constraint failed`. Read-only schema inspection identified the
`quality_scores.lifecycle_id -> project_lifecycles.id` `NO ACTION` edge. The
final transactional cleanup explicitly removes those exact owned rows and the
full suite then exits 0. The failure was not hidden or converted into a skip.

After the final successful focused runs, only the three expected diagnostic
roots from the two development failures and the mutation remained below the
ignored `.intentsmith-artifacts/direct-tests/` directory. The successful run
roots were absent. None of these generated roots is tracked.

## Registry and disposition

No test command, test ID, tier, fixture, requirement, or registry state changed.
The four existing registered suites remain:

- `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST`;
- `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST`;
- `IS-T2-TESTS-LIFECYCLE-E2E-TEST`; and
- `IS-T2-TESTS-LIFECYCLE-HUMAN-FRICTION-TEST`.

The disposition manifest remains complete and unchanged. The validator reports
32 `EXACT`, 3 `MAPPED_REPAIR`, 99 `MODIFIED`, and 91 `ABSENT` resolutions.

## Remaining boundary

Integration must still:

1. cherry-pick this two-commit range after the common R014 bootstrap;
2. integrate the other consumer batches without overwriting their work;
3. regenerate the current R014 writer/database inventory from the integrated
   SHA;
4. run the full 199-suite deterministic registry from the final candidate; and
5. update generated Gate 0 status through the evidence generator rather than
   editing `STATUS.md`.

This branch does not change `STATUS.md`, the registry, the disposition
manifest, or `data/c3.db`. The latter was neither opened nor modified.

# G0-R012 database import boundary

## Repaired contract

- `src/db/database.js` requires a non-empty `C3_DB_PATH` before resolving a
  path, creating a directory, opening SQLite, or running migrations.
- `src/config.js` no longer invents `./data/c3.db` for library imports.
- `src/runtime-environment.js` loads `.env` and establishes the existing
  project-local default for the product server entrypoint.
- The registered audit runner continues to provide one isolated database path
  per suite.
- The operator-owned ignored `data/c3.db` is not read, modified, or removed.

## Deterministic regression

`tests/nightly-audit-runner-self-test.js` exercises three boundaries:

1. missing and blank configuration are rejected by the pure path policy;
2. a child-process import without `C3_DB_PATH` exits nonzero with the canonical
   error before database initialization;
3. the product bootstrap derives the project-local default, while an explicitly
   configured disposable database imports, migrates, closes, and is cleaned up.

The same self-test retains its 2,000-line Python flush fixture, but gives that
bounded program one second rather than 250 milliseconds. Its five-second hang
and SIGTERM-resistant fixtures must still time out. This prevents scheduler
load from misclassifying successful output flushing without weakening the
timeout assertions.

Exact command, result, exit code, candidate SHA, and captured-output hash are
recorded in the Gate 0 candidate evidence after this repair is committed.

## Pre-commit verification

These runs validate the repair worktree; they are not a Gate verdict and will
be repeated at the committed candidate:

| Command | Result | Exit |
|---|---|---:|
| `node tests/nightly-audit-runner-self-test.js` | two consecutive final runs ended `nightly audit runner self-test: PASS`; the internal fail, timeout, cleanup and blocked fixtures retained their expected non-green states | 0, 0 |
| same command after temporarily replacing the database guard call with the raw nullable config value | rejected the changed error contract before filesystem access | 1 |
| `node tests/modules.test.js` with an isolated `C3_DB_PATH` | 23 passed, 0 failed, 0 skipped | 0 |
| `node tests/lifecycle-db.test.js` with an isolated `C3_DB_PATH` | 71 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; fingerprint `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a` | 0 |
| `node scripts/validate-final-disposition.js` | 225 valid records | 0 |

One intermediate self-test run exposed that the pre-existing 250 ms child
budget could classify the bounded Python flush fixture as `TIMEOUT` under host
load. The one-second budget repair above was applied before the two consecutive
green runs. A separate focused route run exposed a different false-green
contract, tracked independently as `G0-R026`; it is not counted as positive
evidence here.

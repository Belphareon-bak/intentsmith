# Phase 1.1 Verification Results

Date: 2026-07-27

Base commit: `ed21dd87407666fc43bfab350b81d6025ca34fdd`

Branch: `phase-1-1-contract-stabilization`

## Audit Verdict for Phase 1

**FAIL** (subsequently remediated in this branch).

Phase 1 passed every gate it defined, but four defects broke guarantees the
Phase 1 documentation and ADR 0006 explicitly claim. Each was reproduced with a
throwaway probe before any code was changed, and each now has a regression test.

### Findings

| # | Severity | Class | Finding | Status |
|---|---|---|---|---|
| 1 | Critical | correctness, durability | Overlapping transactions failed with a raw SQLite `cannot start a transaction within a transaction` error. Any two concurrent lifecycle operations could hit it. | Fixed |
| 2 | Critical | contract, correctness | `resumeTask` on a `pending` task succeeded and set `running` with no TaskRun and no worker, stranding the task. Contradicted ADR 0006. | Fixed |
| 3 | Critical | correctness | A worker completing while the task was `paused` had its outcome silently dropped; the task stayed `paused` forever and leaked its active-run entry. | Fixed |
| 4 | High | test gap, maintainability | Worker timeouts used the global `setTimeout`, so results depended on machine speed. | Fixed |
| 5 | Medium | contract | A repeated `cancel` surfaced a raw SQLite error instead of a domain error (a symptom of finding 1). | Fixed |
| 6 | Medium | contract | Unknown routes returned Fastify's default body instead of the standard error envelope. | Fixed |
| 7 | Medium | contract | CLI transport failures (server down, timeout, non-JSON response) all collapsed into `INTERNAL_ERROR`. | Fixed |
| 8 | Medium | correctness | Worker events after a terminal event, and second terminal events, were accepted; the last one silently won. | Fixed |
| 9 | Medium | durability | Lifecycle transitions committed before the related `TaskRun` update, which ran outside the transaction. | Fixed |
| 10 | Medium | durability | No recovery policy existed for a `running` run found after a restart. | Fixed (ADR 0007) |
| 11 | Medium | durability | A database carrying unknown schema migrations was opened and read anyway. | Fixed |
| 12 | Low | maintainability | `defaultDbPath()` created `.intentsmith/` in the working directory even when `INTENTSMITH_DB_PATH` was set. | Fixed |
| 13 | Low | maintainability | `FakeWorker` shared a module with the store-opening test harness, so a worker adapter transitively imported persistence. | Fixed (module split) |
| 14 | Low | maintainability | No automated dependency boundary enforcement existed. | Fixed (Step 2) |

### Audit checks that passed unchanged

- `Task` and `TaskRun` have no conflicting source of truth; results are per-run.
- `cancelled` is terminal; no transition leaves it.
- A worker claim alone never yields `pass`; deterministic evidence is required.
- The audit repository exposes only `append` and `listByTask`; there is no
  update or delete path, and `audit_events` is ordered by an autoincrement
  sequence.
- Fastify binds `127.0.0.1` by default.
- API payloads are validated by TypeBox schemas before reaching core.
- No runtime path calls a cloud or inference endpoint.
- No test writes into a real project; all use temporary workspaces and
  temporary or in-memory databases.
- C3 was never used as a writable workspace.

## Quality Gates

Node.js 22.21.1, pnpm 11.17.0.

```text
pnpm install --frozen-lockfile  PASS (exit 0)
pnpm typecheck                  PASS (exit 0)
pnpm lint                       PASS (exit 0)
pnpm test                       PASS (exit 0)
pnpm test:coverage              PASS (exit 0)
pnpm build                      PASS (exit 0)
pnpm verify                     PASS (exit 0)
```

No test was skipped, marked flaky, or weakened. The four reproduced defects were
fixed at the cause; none was papered over with an added timeout.

## Test Counts

| | Test files | Tests |
|---|---|---|
| Phase 1 (`ed21dd8`) | 7 | 54 |
| Phase 1.1 | 17 | 196 |

The suite also got faster, from 5.25s to about 0.7s, because worker timeouts no
longer wait on wall-clock time.

## Determinism

The adversarial and worker-contract suites were run five times in a row with
identical results. Determinism is structural, not incidental:

- the fake worker settles synchronously or waits for an explicit signal, so no
  assertion depends on task-queue ordering;
- timeouts run on an injected virtual timer;
- lifecycle commands are serialized per task and awaited, so no path relies on a
  fire-and-forget promise;
- `waitForTask` and `shutdown` await recorded completion.

## Coverage

Measured, not aspirational. Gates sit just below these values so a regression
fails the build without rewarding filler tests.

```text
Statements   93.71% (924/986)
Branches     85.45% (370/433)
Functions    92.04% (243/264)
Lines        95.27% (847/889)
```

Critical domain modules:

| Module | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `core/src/core.ts` | 93.91% | 85.71% | 93.61% | 100% |
| `core/src/lifecycle.ts` | 100% | 80% | 100% | 100% |
| `core/src/verdict.ts` | 90.90% | 90.90% | 100% | 90.32% |
| `core/src/path-policy.ts` | 100% | 100% | 100% | 100% |
| `core/src/inference.ts` | 100% | 100% | 100% | 100% |
| `persistence/src/database.ts` | 97.97% | 87.50% | 100% | 100% |

Coverage artefacts are not committed.

## Recovery Policy

See ADR 0007. An interrupted run is closed as `failed` with a `blocked` result
recording the interruption, its task moves to `failed`, its audit and evidence
are preserved, and it is never restarted without an explicit user action. A
found `running` row is never presented as a live process.

## Known Limits

- The only worker remains the deterministic in-process fake.
- The InferenceProvider port has no real implementation and is not wired into
  the task lifecycle; that is Phase 2 work.
- Retry orchestration is still deferred. Multi-run history is proven at the
  persistence layer rather than through a retry API.
- `recoverInterruptedRuns()` is available but not invoked automatically at
  server startup; wiring it needs a product decision about who is told.
- Concurrency is serialized on one SQLite connection, which is correct for a
  local single-process control plane but is not multi-process safe.
- `apps/server` still depends on `packages/testing` for the fake worker runtime.
  This is the documented Phase 1 exception and should end when a real worker
  lands.

## Environment Confirmations

- Ollama was not installed, started, or contacted.
- No cloud or external API was called; the CI workflow uses no secrets.
- The C3 reference at `a7b90e36aa80310305703f54f2332e1c0e7f9e8f` was read-only
  and is byte-for-byte unchanged, verified before and after this work.

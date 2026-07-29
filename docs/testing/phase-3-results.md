# Phase 3 Verification Results

Date: 2026-07-29

Branch: `phase-3-opencode-worker`

Baseline: `ec87dd0f52d010726b2ca9409ec6fbceefa778fe` (Phase 2 merge into `main`,
tagged `phase-2`)

Source commit tested: `bfc6c5794600107603ebe757e5941de1c0abc7db`

Phase 3 implementation and measured 2F evidence were produced against
`bfc6c5794600107603ebe757e5941de1c0abc7db`. `d2f3f88` added the closure
documents and `9251c91` corrected their push-state claims. Run 2G then merged
current `main` into the candidate as `64eabbd`; main's changes were documentation
only, and the merge changed no production boundary. The local and CI
verification of `64eabbd` below are separate post-integration observations; no
historical 2F result is relabelled as a measurement of a later commit.

Phase 3 is a **closure candidate**. The branch was pushed to `origin` at
`d2f3f88`, integrated with current `main` in `64eabbd`, and opened as PR #4. It
is not merged and not tagged. Required CI is green on the integrated code tree.

## Result

```text
pnpm install --frozen-lockfile  PASS
pnpm typecheck                  PASS
pnpm lint                       PASS
pnpm test                       PASS (55 files, 869 tests) x5, identical
pnpm test:coverage              PASS (gates met)
pnpm build                      PASS
pnpm verify                     PASS (clean clone, exit 0)
```

The deterministic tests and build do not require OpenCode, Ollama, a GPU, a
model or another external runtime: the worker is a real child process, but the
ACP agent it speaks to is a deterministic fixture, and every transport and
probe is injected. The measured installation used an already populated pnpm
store; network isolation and a cold-network installation were not proven. The
opt-in real-binary and real-Ollama suites are excluded from it by
`vitest.config.ts` and must stay excluded.

## Runs

| Run | Commits | Subject |
|---|---|---|
| 2A | `07d917c`, `0ea01e3`, `978dc40`, `f515819` | fail-closed OpenCode configuration, evidence-bounded protocol retries, Git-backed evidence required for code verdicts, permission-pending lifecycle cleanup |
| 2B | `cc70710`, `9b56f9d`, `cff4838`, `fd71811`, `39c0e65`, `6d66432`, `3e61c18` | executable authority stack, run-scoped approval decision surface, structured lifecycle and protocol evidence, trusted verdict provenance |
| 2C | `259473e` | pinned real `opencode-ai@1.18.8` and real local `qwen3:14b` on an RTX 3090: approved edit plus four terminal paths |
| 2D | `15aa023` | authenticated remote access for a single operator over a private VPN (ADR 0020) |
| 2E | `09c3a95` | security closure audit, ADR 0020, process-level refusal proof, acceptance matrix |
| 2F | `bfc6c57` | restart recovery on the OpenCode composition, focused real-binary regression, two wording corrections, closure documents and gates |

## Environment

| | |
|---|---|
| Node.js | v22.21.1 |
| pnpm | 11.17.0 |
| Platform | Linux 6.17.0-35-generic, x64 |
| OpenCode (opt-in suite only) | `opencode-ai@1.18.8`, installed outside this repository |
| Ollama (opt-in suite only) | 0.17.7, `http://127.0.0.1:11434` |
| Model (opt-in suite only) | `qwen3:14b` |
| GPU (opt-in suite only) | NVIDIA GeForce RTX 3090, driver 590.48.01 |

The lockfile was not modified. The clean-clone install resolved all 204 packages
from the local pnpm store with nothing downloaded, which proves the lockfile is
consistent and complete; it is not a claim that a network-cold install was
exercised here. CI performs that one on every pull request.

## Test Counts

| | Test files | Tests |
|---|---|---|
| Phase 2 (`ec87dd0`) | 25 | 410 |
| Phase 3B | 44 | 694 |
| End of run 2E (`09c3a95`) | 54 | 866 |
| Closure candidate (`bfc6c57`) | 55 | 869 |

The three added tests are the restart-recovery regression.

## Deterministic Stability

`pnpm test` was run five consecutive times at `bfc6c57`. No run was discarded,
repeated or re-ordered, and no failure was observed at any point.

| Run | Command | Exit | Duration | Files | Tests | Leaked temp dirs | Orphan workers |
|---|---|---|---|---|---|---|---|
| 1 | `pnpm test` | 0 | 7.33 s | 55 | 869 | 0 | 0 |
| 2 | `pnpm test` | 0 | 7.35 s | 55 | 869 | 0 | 0 |
| 3 | `pnpm test` | 0 | 7.40 s | 55 | 869 | 0 | 0 |
| 4 | `pnpm test` | 0 | 7.34 s | 55 | 869 | 0 | 0 |
| 5 | `pnpm test` | 0 | 7.31 s | 55 | 869 | 0 | 0 |

Durations are vitest's own totals. Leak checks were made between runs against
`/tmp/intentsmith-*` and against any surviving fake-agent process; both were
empty every time.

An earlier five-run sequence, taken before the last change to the closure
candidate, is not reported as a result. It exposed a real leak — three isolated
worker runtime directories per run, left behind because a Core killed with
SIGKILL cannot remove them — which was fixed by confining the killed child's
temporary directory to one the test owns. The five runs above are the sequence
that describes the tree being offered.

## Coverage

Measured in the clean clone at `bfc6c57`:

```text
Statements   92.84% (3607/3885)
Branches     84.42% (2266/2684)
Functions    93.45% ( 771/825)
Lines        94.57% (3311/3501)
```

Gates are 90 / 82 / 88 / 92 and are unchanged since Phase 1.1. No threshold was
lowered, added or removed.

One exclusion glob changed: the list of test-only modules matches `**/*fixtures.ts`
rather than `**/fixtures.ts`. The restart regression's fixture is a
child-process entry point — executed for real, but in a process where
in-process coverage cannot see it — and it sits beside the existing
`fixtures.ts` files it shares wiring with. No production file is excluded by
this list.

## Clean-Clone Verification

```text
git clone --branch phase-3-opencode-worker <repo> /tmp/intentsmith-cleanclone-2f
cd /tmp/intentsmith-cleanclone-2f && pnpm verify
```

| | |
|---|---|
| Commit | `bfc6c5794600107603ebe757e5941de1c0abc7db` |
| Pre-existing state | none: no `node_modules`, no `dist`, no `.intentsmith`, no coverage directory |
| `pnpm verify` exit code | 0 |
| Tests | 55 files, 869 tests |
| Coverage | 92.84 / 84.42 / 93.45 / 94.57 |
| `git status --porcelain` afterwards | empty |

Nothing generated or untracked is required. This matters more than usual at this
commit: the new restart regression spawns the composition root through `tsx`,
and the workspace packages resolve to their `dist` output, which `pnpm verify`
produces in its own `typecheck` step before the tests run. The clean clone is
what proves that ordering actually holds rather than depending on a build
somebody happened to have done.

The empty `git status --porcelain` is the same assertion CI makes, so verifying
does not modify a tracked file or leave an artefact behind.

## Restart Recovery

`apps/server/src/opencode/restart-recovery.process.test.ts` (3 tests, offline).

This closes the only functional gap Phase 3 had. A worker killed *during* a run
was already proven to settle cleanly, both offline and against the real binary;
recovery across a Core death was proven only with the in-process fake worker,
whose crash is a runtime object that is simply never awaited.

The interruption is now real. A child process runs the product's own composition
root — `createRuntime` with `INTENTSMITH_WORKER=opencode`, no approval decider,
a file-backed database — reaches a pending approval, and is killed with SIGKILL,
which it cannot catch. What it leaves behind is genuine wreckage: a `running`
TaskRun row with no live worker, an unanswered approval, an orphaned OpenCode
process, and a gateway token that existed only in the dead process's memory.

A second Core on the same database is then required to reconcile it:

- exactly one run recovered, naming the interrupted task;
- run and task both `failed`, `endedAt` set;
- result `blocked`, with an unresolved risk naming the interruption, and no diff;
- `approval.revoked` present, `approval.granted` and `approval.consumed` absent
  — a restart is not consent;
- the `task.verdict` written **before** the approval is released, so the run is
  already terminal by the time anything it held is let go;
- exactly one `task.verdict`;
- zero suspended waiters, zero pending decidable approvals, zero gateway tokens;
- a late approval decision for the dead run answered `404`;
- the workspace file unchanged;
- a third startup recovering nothing, so recovery is idempotent.

And then the part that makes "recoverable" mean something: a fresh task in the
same workspace, through the same composition, on the same database, asks its own
permission, is approved over the real HTTP surface, and reaches `passed` on a
Git-derived digest with its own single approval. The interrupted run's rows and
audit trail are byte-identical before and after that later run.

**No production defect was found.** The regression passes against the
composition exactly as run 2E left it; no production file was changed to make it
pass.

Two boundaries are asserted rather than worked around:

- **A recovered task cannot start a new run of its own.** ADR 0007 closes the
  interrupted run as `failed` and moves its task to `failed`; ADR 0008 makes
  terminal statuses accept no lifecycle command; retry orchestration is deferred
  by decision. The test asserts the `INVALID_TASK_TRANSITION` refusal. A new
  attempt is a new task, and that is proven to work. Carried as H9.
- **The orphaned worker is not killed by recovery.** A Core killed with SIGKILL
  runs no cleanup, so its worker survives — that is the operating system, not a
  defect. Recovery does not kill the pid it finds in the audit trail, because a
  pid recorded before a restart may belong to something else by now. The system
  offers identification, not action. Carried as H10.

## Focused Real-Binary Regression

Run 2D moved the loopback peer check out of `approval-routes.ts` and composed it
with `isOperatorAuthenticated`. On the loopback path the composed guard is
behaviour-identical, and that is proven in process by `approval-surface.test.ts`
— but 2C's product-level evidence was collected before that change, and the
decision route is the boundary that evidence runs through. Two of 2C's five
scenarios were therefore re-run at the closure candidate against the pinned real
binary. The other three were not repeated: 2C recorded them once with cleanup
evidence, and the change under re-examination does not touch them.

```text
INTENTSMITH_RUN_REAL_OPENCODE=1 \
INTENTSMITH_OPENCODE_BIN=<pinned opencode-ai@1.18.8> \
INTENTSMITH_2C_EVIDENCE=<log> \
npx vitest run --config vitest.opencode.config.ts \
  tools/opencode/real-product-lifecycle.test.ts \
  -t "passes on Git-derived evidence|deny prevents the protected side effect"
```

2 passed, 3 skipped, exit 0, 51.45 s.

| Scenario | Result | Evidence |
|---|---|---|
| `approved-edit` | PASS | `finalTaskStatus: passed`, `coreVerdict: pass`, Git digest `2d2a874…`, `changedPaths: ["src/answer.js"]`, gate evidence `intentsmith://gate/answer`, one approval decided over HTTP |
| `deny-while-pending` | PASS | `finalTaskStatus: failed`, `targetUnchanged: true`, audit shows `approval.denied` and never `approval.granted` |

Both scenarios ended with `processGroupMembersAfterTerminal: []`,
`gatewayTokensAfterTerminal: 0` and `pendingWaitersAfterTerminal: 0`. GPU
sampling during the approved edit showed `qwen3:14b` resident at 100 % GPU with
a live Ollama compute process throughout, so the run really was local model
execution and not a stub.

The approved path still works and the denied path still blocks with no side
effect, through the authenticated composition 2D introduced.

Five runs of this suite were **not** performed and are not required. The
five-run convention has only ever applied to the deterministic offline suite,
where identical results are a meaningful claim. This suite drives a 14B model
whose output is not reproducible; five runs would produce five different
transcripts and could not support the claim the convention exists to make.

## Security and Cleanup Evidence

Carried from run 2E's audit and re-checked here:

- **Refusal is a process-level property.** `startup-refusal.process.test.ts`
  spawns the real entry point as a child: eight unsafe remote configurations
  each exit non-zero, never print the listen confirmation, create no database,
  and are refused by a TCP probe on the port they would have bound. A positive
  control in the same file observes a genuinely open port, so the negative
  results are measured with an instrument shown to work.
- **Credentials are never echoed.** No refusal message contains the supplied
  token; the operator credential is never generated, persisted, logged, audited
  or returned.
- **Run-scoped authority dies with its run.** The gateway grant is revoked on
  every terminal path — success, worker failure, spawn failure, protocol
  failure, cancel, timeout, shutdown and now restart recovery — because
  revocation is structural in `withGrant`'s `finally` rather than something each
  branch remembers.
- **Nothing sensitive is persisted.** No raw prompt, model response, ACP wire
  payload, gateway token, environment secret or GPU UUID reaches the database,
  an audit record or an artifact.
- **Nothing is left running.** Across all five deterministic runs: no orphan
  fake-agent process and no leftover temporary directory. In the real-binary
  regression: empty process groups after every terminal path.

## CI Status

Read from GitHub Actions through the authenticated GitHub CLI. No workflow was
changed.

| | |
|---|---|
| Entry gate (`ec87dd0`, Phase 2 merge into `main`) | workflow run **30337726989**, conclusion **success**, 2026-07-28T07:15:31Z — **PASS** |
| Integrated closure candidate (`64eabbd`, PR #4) | workflow run [**30481867726**](https://github.com/Belphareon-bak/intentsmith/actions/runs/30481867726), `verify (node 22)` completed **successfully** at 2026-07-29T18:53:20Z — **PASS** |

The initial branch push triggered no workflow because `.github/workflows/ci.yml`
runs on pull requests and pushes to `main`. PR #4 supplied the missing
observation: its required workflow checked out
`64eabbd57a82a3c54c97a70be5ecb77e2e923a77`, installed from the frozen lockfile,
ran verification and asserted a clean working tree.

Before the PR, the same integrated commit passed local `pnpm verify`: 55 test
files, 869 tests, coverage 92.84% statements / 84.42% branches / 93.45%
functions / 94.57% lines, and an empty `git status --porcelain`.

## Acceptance Matrix Totals

From `docs/testing/phase-3-acceptance-matrix.md`, 53 requirements:

| Verdict | End of 2E | Closure candidate |
|---|---|---|
| PASS | 30 | 38 |
| PARTIAL | 6 | 5 |
| NOT PROVEN | 11 | 10 |
| FAIL | 3 | 0 |

No required Phase 3 gate is FAIL.

### Remaining PARTIAL

| # | What is proven | What is not, and why that is acceptable |
|---|---|---|
| C3 | The adapter negotiates, records and refuses on the ACP protocol version and the agent's capabilities | It does not ask the executable its own version. That is operator-declared and harness-verified, the specification now says so, and the row stays PARTIAL rather than being promoted on a wording change |
| D2 | Process health as liveness and failure handling, through the handshake and process state | There is no separate health *probe*. Handshake-derived health is the design, not an omission |
| D4 | `edit` and `write` require a single-use, payload-bound approval | `bash` is denied outright rather than approval-gated. This is stricter than the row was, because an approval for a command string cannot be bound to a workspace scope. Deliberately not going to change |
| D5 | Restart recovery on the OpenCode composition, end to end, plus a correct later run | The recovered task cannot start a new run of its own — a contract (ADR 0007, ADR 0008), asserted by the test, not a gap |
| F8 | A wildcard bind and a hostname are refused | A port forward in front of a correctly bound VPN interface is outside anything the process can observe. Documented as unsupported, never described as prevented |

### Remaining NOT PROVEN

| # | Item | Why it is acceptable |
|---|---|---|
| H1 | Strict-offline execution | Requires observed network isolation. "No cloud traffic seen" is not "cloud traffic impossible", and the distinction is not going to be blurred. Belongs to Local Validation |
| H2 | Sandboxed (`preferSandbox`) execution | The path is attested but was disabled in every run so far. Local Validation |
| H3 | Concurrent runs sharing one Git working tree | Out of Phase 3 scope; the composition serializes one workspace per run |
| H4 | `skill`, `task`, `todowrite`, `webfetch` payload shapes | All four are denied, so there is no exposure to close |
| H5 | Parallel tool calls | Refused, not supported |
| H6 | Degraded-sandbox runs on a real project | Disposable fixtures only. Local Validation |
| H7 | Model defaults | Choosing one needs more evidence than the robustness run provides |
| H8 | Real-hardware single-GPU model switching | Proven against a fake daemon; the real-hardware suite stays opt-in. Local Validation |
| H9 | A recovered task starting a new run of its own | Not supported by contract; a new attempt is a new task, which is proven |
| H10 | Cleaning up a worker orphaned by SIGKILL | Not possible after an uncatchable signal, and killing a remembered pid would be unsafe |

None of these is a defect. Each is a claim the project has declined to make.

## Deferred, and Not Attempted in Phase 3

- Retry orchestration. Represented in contracts; the lifecycle offers no command
  to start a second run of a task, by decision.
- MCP, Serena, Studio, desktop distribution.
- Shell execution: not merely absent, `bash` is a denied capability.
- Accounts, roles, sessions, credential rotation and rate limiting. Run 2D
  implemented exactly one shape of authentication and ADR 0020 records why each
  omission is acceptable and on what premise.
- Multi-worker orchestration and anything coordinating two OS processes against
  one database file beyond SQLite's own locking.
- Phase 3.1, mobile access, the nightly runner, Expertises, Skills, Specialists.

## What This Does Not Claim

- **Not strict-offline.** The deterministic tests and build need no external
  runtime, and no cloud traffic was observed in any run. The measured
  installation used an already populated pnpm store; network isolation and a
  cold-network installation were not proven, so no strict-offline claim is made.
- **Not merged or tagged.** The branch is published for review and nothing more.
- **Not a soak test.** Every guarantee here is proven once, or five times for
  the deterministic suite. Whether they hold overnight, repeatedly, and under a
  real model's variability is the Local Validation and Soak Testing stage, which
  runs after Phase 3 closes and before Phase 3.1 begins.

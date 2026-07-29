# Phase 3 Acceptance Matrix

Date: 2026-07-29

Branch: `phase-3-opencode-worker`

Audited commit: `15aa0234db4e79484736326d70dacb360f8ed4f7` (end of run 2D)

Re-audited at run 2F, the closure candidate. Rows changed by 2F evidence are
marked **(2F)** and say what the new evidence was. Nothing was promoted on the
strength of a wording correction alone.

Scope: every requirement of the original Phase 3 specification
(`docs/ROADMAP.md` "Phase 3 - OpenCode Worker POC" and the Phase 3 rows of
`docs/test-matrix-phase-1-to-4.md`), the Phase 3B insertion, the run 2D
decisions recorded in ADR 0020, and the phase-closure convention this repository
has applied to Phase 1.1, Phase 2 and Phase 3B.

## Runs audited

| Run | Commits | Subject |
|---|---|---|
| 2A | `07d917c`, `0ea01e3`, `978dc40`, `f515819` | fail-closed OpenCode configuration, evidence-bounded protocol retries, Git-backed evidence required for code verdicts, permission-pending lifecycle cleanup |
| 2B | `cc70710`, `9b56f9d`, `cff4838`, `fd71811`, `39c0e65`, `6d66432`, `3e61c18` | executable authority stack composition, run-scoped approval decision surface, structured lifecycle/protocol evidence, trusted verdict provenance |
| 2C | `259473e` | pinned real `opencode-ai@1.18.8`, real local `qwen3:14b` on an RTX 3090, product-level approved edit and four terminal paths |
| 2D | `15aa023` | authenticated remote access for a single operator over a private VPN |
| 2E | `09c3a95` | security closure audit, ADR 0020, process-level refusal proof, this matrix |
| 2F | closure candidate | restart-recovery regression on the OpenCode composition, focused real-binary regression, two wording corrections, closure documents, five-run and clean-clone gates, CI status |

## How to read a verdict

- **PASS** — implemented, and proven by a named test or artifact that would fail
  if the property broke.
- **PARTIAL** — implemented and proven for part of the stated scope. The
  unproven remainder is named exactly.
- **NOT PROVEN** — implemented or claimed, but no evidence exists at the level
  the requirement states. This is not a statement that it is broken.
- **FAIL** — required and absent.

A verdict is never inferred from a design intention, a code comment or an ADR.
Where the only evidence is a document, the verdict says so.

## A. Phase 3 entry gate

The ROADMAP states Phase 3 is "blocked until Phase 2 is merged into `main`, CI
is green, and an annotated `phase-2` tag exists".

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| A1 | Phase 2 merged into `main` | `ec87dd0` (merge of PR #2) | `git merge-base --is-ancestor main HEAD` succeeds; `main` is an ancestor of this branch, which is 33 ahead and 0 behind | PASS | none |
| A2 | Annotated `phase-2` tag | tag `phase-2` | `git cat-file -t phase-2` reports `tag`, i.e. an annotated tag object, not a lightweight ref | PASS | none |
| A3 **(2F)** | CI green | `.github/workflows/ci.yml` | Read from the GitHub REST API, unauthenticated and read-only: workflow run **30337726989** for `ec87dd0` (the Phase 2 merge into `main`) completed with conclusion **success** at 2026-07-28T07:15:31Z. The entry gate the ROADMAP states — Phase 2 merged, CI green, `phase-2` tag — is therefore fully evidenced | PASS | none. CI for the *closure candidate itself* is a separate question, recorded at G7 |

## B. Phase 3 goal and inference constraint

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| B1 | Delegate one coding task to OpenCode while preserving core authority | `apps/server/src/opencode/composition.ts`, `runtime.ts` | `artifacts/phase-3-2c-real-binary.json` `approved-edit`: real binary, real model, `finalTaskStatus: passed`, `coreVerdict: pass`, Git-authoritative diff digest; `executable-composition.test.ts` "reaches PASS for an approved Git-backed change with passing gates" | PASS | none |
| B2 | The Phase 2 gateway is the only inference path a worker may use | `apps/server/src/gateway/`, `packages/adapter-opencode/src/runtime-config.ts` | `worker-integration.test.ts` "a worker that tries to reach Ollama directly gets nothing useful"; `runtime-config.test.ts` "refuses a configuration that reaches inference directly"; 2C `inference.protocol_attempt` audit entries | PASS | none |
| B3 | Extend the gateway only after probing a pinned OpenCode build and documenting the requirement | `docs/testing/phase-3b-tool-mediation-spike.md` | Spike verdict PASS, conditional on an IntentSmith-generated permission config, recorded before implementation; `artifacts/phase-3b-verification.json` `contractSpike` | PASS | none |

## C. Phase 3 expected outputs (ROADMAP)

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| C1 | Disposable fixture repository | `DisposableWorkspace` (`packages/testing/src/fakes.ts`); `tools/opencode/real-product.ts` builds a throwaway Git repo with a deterministic base commit | `adapter.test.ts` "refuses to run without a disposable workspace"; 2C ran every scenario in a fresh fixture | PASS | none |
| C2 | OpenCode external process adapter | `packages/adapter-opencode/src/adapter.ts` | Offline: a real child process speaking ACP over stdio (`fixtures.ts`). Real: 2C recorded `workerPid`/`workerPgid` per scenario against `opencode-ai@1.18.8` | PASS | none |
| C3 | Capability and version discovery | `adapter.ts` `describe()` and initialize negotiation | ACP protocol version and agent capabilities are negotiated, recorded and refused on mismatch (`adapter.test.ts` "records what the agent actually negotiated", "ends the connection on an unsupported protocol version"). The **binary** version is not discovered by the adapter: `describe()` returns `expectedVersion ?? 'unpinned'`, and the `1.18.8` check lives in the test harness (`real-product.ts:124`), which reports BLOCKED on mismatch. **(2F)** The specification now states this: `docs/test-matrix-phase-1-to-4.md` says binary version is operator-declared and harness-verified rather than adapter-discovered | PARTIAL | None outstanding. The wording was corrected, not the behaviour, so the row stays PARTIAL on purpose: the stronger claim — the adapter asking the executable what it is — is still not made and still not proven |
| C4 | Normalized event stream | `adapter.ts`, `strict-stream.ts`, `stop-reason.ts` | `contract-correctness.test.ts` "emits exactly one terminal event on success" / "…when the agent answers twice" / "records a tool call as evidence but a message only as an artifact"; `strict-stream.test.ts` (14 framing and bound cases) | PASS | none |
| C5 | Proposed diff collection | `apps/server/src/opencode/change-evidence.ts` via `captureProposedChanges` | `authoritativeSource: 'git'` by construction; 2C `git.diffDigest` `2d2a874…`, `changedPaths: ["src/answer.js"]` | PASS | none |
| C6 | Approval before risky actions | `packages/worker-sdk/src/capability.ts`, `apps/server/src/opencode/approval-desk.ts`, `approval-routes.ts` | `capability.test.ts` "requires approval for an edit inside the workspace"; `executable-composition.test.ts` "refuses to pass an unapproved edit even though the worker succeeded"; 2C `deny-while-pending` shows `protectedFileChanged: false` | PASS | see D4 for the shell case |
| C7 | Deterministic test evidence | `vitest.config.ts` excludes `tools/opencode/**` and `tools/ollama/**`; gates are commands IntentSmith chose | 866 tests across 54 files run fully offline with no OpenCode, Ollama, GPU or network | PASS | none |
| C8 **(2F)** | Cancel, timeout and recovery tests | `pending-permission.test.ts`, `contract-correctness.test.ts`, `startup.test.ts`, `restart-recovery.process.test.ts` | Cancel and timeout proven offline **and** against the real binary (2C `cancel-while-pending`, `timeout-while-pending`, both with `protectedFileChanged: false` and `lateApprovalHttpStatus: 404`). Recovery is now proven on the OpenCode composition across a real process death — see D5 | PASS | none |

## D. Phase 3 test matrix (`docs/test-matrix-phase-1-to-4.md`)

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| D1 | Contract: fake and OpenCode adapter pass the same suite | `packages/adapter-opencode/src/worker-contract.test.ts` | Imports `runWorkerAdapterContract` from `@intentsmith/testing/worker-contract` — the same suite `FakeWorker` runs, not a copy — and drives it against a real fake-ACP child process | PASS | none |
| D2 **(2F)** | Integration: OpenCode external process — version, health, capability discovery | `adapter.ts`, `real-product.ts` | Protocol version and capabilities: PASS (C4, C3). Process health: proven as liveness and failure handling (`adapter.test.ts` "fails when the agent crashes mid-turn", "reports a missing executable with actionable guidance"; 2C `worker-termination-while-pending`). Binary version discovery: see C3. There is no separate health *probe* against the external process — health is inferred from the ACP handshake and process state, which the specification now says | PARTIAL | None outstanding, and PARTIAL on purpose for the same reason as C3: what changed is the wording, not the evidence |
| D3 | Integration: diff captured before approval | `capability.ts` (`payload`, `resourcePaths`, payload hash) | The edit payload — including its content — is hashed into the approval, so the approval authorizes that exact change and no other: `capability.test.ts` "changes when the diff changes", "changes when the target path changes", "ignores object key order". The aggregate `ProposedChangeSet` is read from Git *after* the run by design (C5), because a worker must not supply it | PASS | none |
| D4 | Policy: shell and writes — risky action requires approval | `capability.ts` capability catalog | **Writes**: `edit`/`write` require a single-use, payload-bound approval — PASS. **Shell**: `bash` is denied outright, not approval-gated. The recorded reason (`capability.ts:131`) is that the observed permission payload carries a command string but no resource locations, so approving it would mean approving prose. This is stricter than the matrix row was. **(2F)** The row now reads "writes require a single-use, payload-bound approval; shell is denied by policy, not approval-gated", so the specification and the implementation state the same policy | PARTIAL | None outstanding. PARTIAL on purpose: the row as originally written — an approval-gated shell — is not implemented and is deliberately not going to be |
| D5 **(2F)** | Recovery: killed worker — task remains recoverable | `pending-permission.test.ts`, `apps/server/src/recovery.ts`, `startup.test.ts`, `apps/server/src/opencode/restart-recovery.process.test.ts` | Killed **during** a run: PASS — `pending-permission.test.ts` "worker process failure while a permission is outstanding" settles the run, leaves no process and no side effect; 2C `worker-termination-while-pending` shows `processGroupMembersAfterTerminal: []`, `gatewayTokensAfterTerminal: 0`. Killed **with the server**: now proven on the production composition, not the fake. A child process running `createRuntime` with `INTENTSMITH_WORKER=opencode` and no approval decider is driven to a pending approval and SIGKILLed; a second Core on the same file-backed database then reconciles it — one run recovered, run and task `failed`, verdict `blocked` with reason `process_restart`, `approval.revoked` and never `approval.granted`, verdict ordered before the release, zero gateway tokens, zero waiters, a late decision answered 404, the workspace unchanged, and recovery idempotent on a third start. A fresh run in the same workspace through the same composition then reaches `passed` on a Git digest with its own approval, and the interrupted run's rows and audit are byte-identical afterwards | PARTIAL | One residual, and it is a contract rather than a gap: the recovered **task** cannot itself start a new run, because ADR 0007 makes it terminal and ADR 0008 makes terminal statuses accept no command. The regression asserts that refusal (`INVALID_TASK_TRANSITION`) rather than working around it. Carried as H9 |
| D6 | Deterministic E2E: fixture coding task, evidence separated from worker claim | `executable-composition.test.ts`, `verdict.ts` | "refuses to accept the worker's own account in place of Git evidence"; "cannot pass on the worker's account when Git has nothing to show"; 2C `approved-edit` passed on a Git digest and IntentSmith-run gates, never on the agent's claim | PASS | none |

## E. Phase 3B delivered items

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| E1 | Capability and lifecycle ledger for every observed tool | `packages/worker-sdk/src/capability.ts` | `capability.test.ts` "gives every catalogued tool a complete ledger entry", "classifies an unobserved tool as the worst case rather than guessing" | PASS | none |
| E2 | Bounded tool-calling gateway path that translates and never executes | `apps/server/src/gateway/tool-chat.ts` (ADR 0017) | `tool-chat.test.ts`; forced/named `tool_choice`, parallel calls, tool turns with no advertised tools and oversized schemas are refused | PASS | none |
| E3 | Single-use, payload-bound approvals with append-only audit | `packages/core` approval ledger, `run-evidence.ts` | `approval-surface.test.ts` "consumes a decision once: a conflicting second decision cannot change it"; 2C `replayStatus: 409`; `run-evidence.test.ts` "orders request, grant, use, grant revocation and verdict" | PASS | none |
| E4 | Vendor-neutral permission bridge that cannot grant standing access | `adapter.ts` permission authority | `adapter.test.ts` "never selects a standing permission, whatever the agent offers first", "rejects when the agent offers no way to allow exactly once"; `executable-composition.test.ts` "makes a second run ask again rather than inherit the first answer" | PASS | none |
| E5 | Git-backed change capture and a verdict that refuses a success it cannot corroborate | `change-evidence.ts`, `packages/core/src/verdict.ts` | `executable-composition.test.ts` "refuses to pass when a required gate fails", "refuses to accept the worker's own account in place of Git evidence" | PASS | none |
| E6 | Core-owned model profiles and single-GPU residency scheduling | ADR 0018, ADR 0019, `packages/hardware` | Profile authority and `MODEL_TOOL_PROTOCOL_ERROR` proven offline; residency switching proven in both directions against a fake daemon. Real-hardware residency switching remains an opt-in suite and was not exercised in 2C, which used one model throughout | PASS | none for this requirement; the unexercised real-hardware switch is carried in H below |

## F. Run 2D decisions (ADR 0020)

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| F1 | Loopback default, unchanged | `remote-access.ts` `LOOPBACK_ONLY`; `buildServer` defaults to it | `remote-access.test.ts` "defaults to loopback with no authentication and no credential", "serves every route with no credential and no configuration"; the pre-2D suite is unmodified | PASS | none |
| F2 | Explicit VPN opt-in; any other value refuses | `REMOTE_ACCESS_MODE = 'vpn'` | `remote-access.test.ts` "refuses an opt-in value that is not the supported transport"; process level: `startup-refusal.process.test.ts` "an opt-in value naming a transport this does not support" | PASS | none |
| F3 | A single runtime-supplied operator credential, never generated or persisted | `INTENTSMITH_OPERATOR_TOKEN`, `assertUsableToken` | `remote-access.test.ts` "refuses the opt-in with no credential at all", "refuses a credential that is too weak, and never quotes it back", "never returns, echoes or records the credential"; process level: stderr for every refusal contains the rule and never the supplied token | PASS | none |
| F4 | Central authentication decided before route dispatch | one `onRequest` hook registered before any route (`app.ts`) | `remote-access.test.ts` "answers 401 on every route when no credential is presented", "cannot be used to learn whether an id exists", "rejects streamed generation before any model content exists" | PASS | none |
| F5 | Exact IP literal; no wildcard bind, no hostname | `readRemoteAccessConfig` | `remote-access.test.ts` "refuses a wildcard bind and a name, so the operator names an interface"; process level: wildcard and hostname cases exit non-zero with no listener | PASS | none |
| F6 | Worker gateway stays loopback-only with separate run-scoped credentials | `gateway/gateway.ts`, `gateway/token-store.ts` (ADR 0015) | `remote-access.test.ts` "stays on loopback and refuses the operator credential"; `worker-integration.test.ts` "invalidates every remaining token when the gateway closes" | PASS | none |
| F7 | Transport confidentiality is the VPN's; IntentSmith terminates no TLS | absence by construction | No `node:tls`, `node:https` or secure-server usage exists anywhere in `apps/server/src`; the requirement and its consequence are stated in ADR 0020 and `docs/security/remote-vpn-access.md` | PASS | none |
| F8 | Direct public exposure is unsupported | ADR 0020, `docs/security/remote-vpn-access.md` | Enforced where the process can enforce it: a wildcard bind and a hostname are refused. A deliberate port forward or NAT rule in front of a correctly bound VPN interface is outside anything the process can observe or refuse, so this is a documented boundary, not an enforced one | PARTIAL | Nothing implementable at this layer. Keep it stated as unsupported; do not later describe it as prevented |
| F9 | Refusal happens at process level, before a listener exists | `apps/server/src/index.ts` | `startup-refusal.process.test.ts` — the real entry point spawned as a child: eight unsafe configurations each exit non-zero, never print the listen confirmation, create no database, and are refused by a TCP probe on the port they would have bound. A positive control in the same file observes a genuinely open port, so the negative results are measured with an instrument shown to work. Verified by mutation: degrading the refusal to a warning fails all eight cases | PASS | none |
| F10 | Accepted alpha limitations recorded: restart rotation, no accounts, no roles, no rate limiting | ADR 0020 "Accepted limitations"; `docs/security/remote-vpn-access.md` "Known limits" | Both documents state each limitation and the premise that makes it acceptable | PASS | none |

## G. Repository phase-closure convention

Phase 1.1, Phase 2 and Phase 3B were each closed with five identical
deterministic full-suite runs, a clean-clone `pnpm verify`, unchanged coverage
thresholds, a results document and a verification artifact
(`artifacts/phase-3b-verification.json` `gates`). Phase 3 is measured against
the same bar.

| # | Requirement | Implementation / evidence | Proof | Verdict | Remaining work |
|---|---|---|---|---|---|
| G1 **(2F)** | Five deterministic full-suite runs at the closure commit | — | `pnpm test` run five consecutive times at `bfc6c57`: every run exited 0 with **55 files and 869 tests**, in 7.31 s – 7.40 s, leaving no temporary directory and no orphan worker process behind. No run was discarded or repeated | PASS | none |
| G2 **(2F)** | Clean-clone `pnpm verify` at the closure commit | — | `bfc6c57` cloned to an empty directory with no `node_modules`, no `dist` and no `.intentsmith`; `pnpm verify` exited 0 — frozen-lockfile install, typecheck, lint, coverage-gated tests (55 files, 869 tests) and build — and `git status --porcelain` was empty afterwards, which is the assertion CI makes. No dependency version was changed to make it work | PASS | none |
| G3 **(2F)** | Coverage thresholds preserved and met | `vitest.config.ts` `thresholds` | Thresholds unchanged since Phase 1.1. Measured in the clean clone: statements 92.84 %, branches 84.42 %, functions 93.45 %, lines 94.57 %, against gates of 90 / 82 / 88 / 92. The exclusion list for test-only modules was generalized from `**/fixtures.ts` to `**/*fixtures.ts` so it covers the restart regression's child-process fixture; no production file is excluded and no threshold moved | PASS | none |
| G4 **(2F)** | `docs/testing/phase-3-results.md` | `docs/testing/phase-3-results.md` | Written, covering runs 2A-2F | PASS | none |
| G5 **(2F)** | `artifacts/phase-3-verification.json` | `artifacts/phase-3-verification.json` | Written, in the shape of `phase-3b-verification.json`. The document and the artifact are generated from the same measurements and state the same numbers | PASS | none |
| G6 **(2F)** | `README.md` reflects Phase 3 | `README.md` "Current State" | Updated: names Phase 3, says it is a closure candidate rather than merged, and links the results document | PASS | none |
| G7 **(2F)** | CI status for the closure candidate itself | `.github/workflows/ci.yml` | **No CI run exists for it.** The workflow triggers on pull requests and on pushes to `main`, and neither has happened: the branch `phase-3-opencode-worker` was pushed to `origin` at `d2f3f88` for review, which triggers nothing, and no pull request is open. The GitHub API was queried after the push and reports zero workflow runs for the branch. What was verified locally instead is exactly what CI would do — a clean-clone frozen install, `pnpm verify`, and an empty `git status --porcelain` (G2) | NOT PROVEN | Nothing to do locally. CI observes this commit when a pull request is opened for it, and not before |

## H. Carried "not proven" items

These were declared unproven by Phase 3B or by run 2C and remain so. None is a
defect; each is a claim the project has deliberately declined to make.

| # | Item | Source | Verdict | Remaining work |
|---|---|---|---|---|
| H1 | Strict-offline execution | `docs/STATUS.md`; 2C `notProven` | NOT PROVEN | Requires observed network isolation. Belongs to the post-Phase-3 local validation stage, not to Phase 3 |
| H2 | Sandboxed execution (`preferSandbox` / bubblewrap) | 2C `notProven` | NOT PROVEN | The path is attested but was disabled in 2C. Exercise it in local validation |
| H3 | Concurrent runs sharing one Git working tree | 2C `notProven` | NOT PROVEN | Out of Phase 3 scope; the composition serializes one workspace per run |
| H4 | `skill`, `task`, `todowrite`, `webfetch` payload shapes and side effects | `docs/STATUS.md` | NOT PROVEN | All four are denied, so there is no exposure to close; revisit only if one is ever classified differently |
| H5 | Parallel tool calls | `docs/STATUS.md` | NOT PROVEN | Refused, not supported. No work unless the capability is added |
| H6 | Degraded-sandbox runs on a real project | `docs/STATUS.md` | NOT PROVEN | Disposable fixtures only. Local validation stage |
| H7 | Model defaults | `docs/STATUS.md`; `docs/testing/phase-3b-model-probe.md` | NOT PROVEN | The ten-formulation robustness run supersedes the repeated-prompt scores; choosing a default needs more evidence |
| H8 | Real-hardware single-GPU model switching | ADR 0019 | NOT PROVEN | Proven against a fake daemon; the real-hardware suite stays opt-in. Local validation stage |
| H9 **(2F)** | A recovered task starting a new run of its own | ADR 0007, ADR 0008, D5 | NOT PROVEN | Not supported, by decision. An interrupted run's task is terminal, terminal statuses accept no lifecycle command, and retry orchestration is deferred to a later phase. A new attempt is a new task, which D5 proves works. Revisit only when retry orchestration is actually specified; do not describe this as recovery being incomplete |
| H10 **(2F)** | Cleaning up a worker orphaned by SIGKILL | `restart-recovery.process.test.ts` | NOT PROVEN | Not possible, and deliberately not attempted. A Core killed with SIGKILL runs no cleanup, so its OpenCode process is reparented and survives. Recovery does not kill the recorded pid, because a pid from before a restart may belong to something else by then. What the system provides is identification — `worker.process_start` records the process-group leader in the audit trail — not action. The regression asserts the orphan exists rather than pretending it does not |

## Totals

| Verdict | End of 2E | Closure candidate (2F) |
|---|---|---|
| PASS | 30 | **37** |
| PARTIAL | 6 | **5** |
| NOT PROVEN | 11 | **11** |
| FAIL | 3 | **0** |
| **Total** | **50** | **53** |

PARTIAL: C3, D2, D4, D5, F8.
NOT PROVEN: G7, H1-H10.
FAIL: none.

The three added requirements are G7 (CI for the closure candidate) and H9-H10,
the two boundaries the restart regression made explicit. Seven moved to PASS:
A3, C8, G1, G2, G4, G5, G6.

## What blocked Phase 3 closure, and what happened to it

At the end of 2E, four items were real work. Run 2F closed all four.

1. **D5** — the one functional gap: no restart-recovery evidence on the OpenCode
   composition. Closed by `apps/server/src/opencode/restart-recovery.process.test.ts`,
   which interrupts the production composition with a real SIGKILL and proves
   reconciliation, release of every kind of authority, and that the next run
   works and is trustworthy. **The regression found no production defect**: it
   passed against the composition as 2E left it, and no production file was
   changed to make it pass.
2. **G1, G2** — the deterministic-run and clean-clone gates, executed at the
   closure candidate and recorded in section G.
3. **G4, G5, G6** — the results document, the verification artifact and the
   README, all produced.
4. **A3** — read and recorded from the GitHub API, read-only.

What remains non-PASS is now, in every case, either a deliberate non-claim
(H1-H10), a specification wording that has been corrected but whose stronger
original reading is intentionally not implemented (C3, D2, D4), a boundary this
layer cannot enforce (F8), or CI for an unpushed branch (G7). None of them is a
hidden defect, and none of them is work someone forgot.

## What closure does *not* require, and why

Each of these was considered and decided from the evidence rather than assumed.

- **Five deterministic runs of the *real-binary* suite: not required.** The
  five-run convention (Phase 1.1, Phase 2, Phase 3B) has only ever been applied
  to the offline suite, where identical results are a meaningful claim. The
  real-binary suite drives a 14B model whose output is not reproducible;
  repeating it five times would produce five different transcripts and could not
  support the claim the convention exists to make. Five runs of the **offline**
  suite are still required (G1).
- **A repeat of the full five-scenario real-binary matrix: not required.** 2C
  already recorded `approved-edit`, `deny-while-pending`, `cancel-while-pending`,
  `timeout-while-pending` and `worker-termination-while-pending`, each once,
  with cleanup evidence.
- **One focused real-binary regression: required.** Run 2D moved
  `isLoopbackAddress` out of `approval-routes.ts` and composed the peer guard
  with `isOperatorAuthenticated`. On the loopback path the composed guard is
  behaviour-identical, and that is proven in process
  (`approval-surface.test.ts`), but 2C's product-level evidence was collected
  before the change and the decision route is the boundary that evidence runs
  through. Re-running `approved-edit` and `deny-while-pending` against the
  pinned binary at the closure commit re-establishes it. This is roughly a
  quarter of the 2C suite, not a repeat of it.
- **CI changes: not required.** `.github/workflows/ci.yml` already performs a
  clean install with a frozen lockfile, runs `pnpm verify`, and asserts a clean
  working tree. The real-binary and real-Ollama suites are excluded from
  `pnpm verify` by `vitest.config.ts` and must stay excluded.
- **Coverage work: not required.** Thresholds are unchanged and every gate is
  met with margin (G3).
- **Documentation work: required**, but only the three artifacts every previous
  phase produced (G4, G5, G6) plus the two wording corrections (C3, D4).

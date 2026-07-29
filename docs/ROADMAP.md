# Roadmap

## Phase 0 - Foundation Decisions

Status: ready for review.

Outputs:

- greenfield repository;
- product thesis;
- status and roadmap;
- ADRs 0001 to 0005;
- P0 third-party component records;
- dependency boundary proposal;
- minimal contract schema proposal;
- Phase 1 to Phase 4 test matrix.

Milestone tag: `foundation-decisions`.

## Phase 1 - Monorepo, Contracts, and Deterministic Vertical Slice

Status: complete.

Goal: start a minimal typed vertical slice without a real LLM or external worker.

Expected outputs:

- pnpm workspace;
- strict TypeScript;
- `packages/contracts`;
- `packages/core`;
- `packages/persistence`;
- fake worker adapter;
- localhost Fastify lifecycle API;
- CLI lifecycle commands with text and JSON output;
- minimal SQLite migrations;
- unit, contract, persistence, integration, API, and CLI tests.

Acceptance:

- clean install;
- typecheck passes;
- lint passes;
- tests pass offline;
- invalid API boundary payloads are rejected;
- a task can be created, run through a fake worker, cancelled, resumed, and audited;
- `Task` and `TaskRun` are separate so retries and evidence remain immutable.

Verification: `docs/testing/phase-1-results.md` and
`artifacts/phase-1-verification.json`.

## Phase 1.1 - Contract Stabilization, Adversarial Tests, and CI Baseline

Status: complete.

Goal: independently verify Phase 1, fix what the audit found, and make the
integration base trustworthy enough that Phase 2 can test a real adapter with
the same contract suite as the fake.

Outputs:

- independent audit of Phase 1 with a recorded verdict (FAIL, remediated);
- concurrency-safe transactions and per-task command serialization;
- lifecycle commands validated separately from state edges (ADR 0008);
- deferred finalization for a worker that completes while paused;
- injected timer so timeouts are deterministic;
- restart recovery policy for interrupted runs (ADR 0007);
- per-store transaction context isolation (ADR 0010);
- automatically enforced dependency boundaries;
- reusable WorkerAdapter contract suite;
- minimal InferenceProvider port and FakeInferenceProvider (ADR 0009);
- adversarial lifecycle, persistence/recovery, security, and API/CLI
  negative-path suites;
- coverage reporting with regression gates;
- GitHub Actions CI.

Acceptance:

- `pnpm verify` passes from a clean install;
- a dependency boundary violation fails `pnpm verify`;
- race tests are deterministic across repeated runs;
- no real Ollama call, HTTP inference client, or cloud fallback exists.

Verification: `docs/testing/phase-1-1-results.md` and
`artifacts/phase-1-1-verification.json`.

## Phase 2 - Ollama and Hardware Director

Status: complete (branch `phase-2-ollama-hardware`).

Goal: run the first local model through a provider contract.

Verification: `docs/testing/phase-2-results.md` and
`artifacts/phase-2-verification.json`. ADRs 0011-0015.

Delivered: port ownership moved to `packages/inference`; local-only Ollama
adapter passing the unchanged provider contract suite; metadata-driven cloud
rejection; Hardware Director with injected probes; model-fit estimation
separated from execution policy; provider scheduler; startup recovery before
listen; API and CLI surfaces; loopback-only worker inference gateway; 402
offline tests plus a separate opt-in real-Ollama suite.

Expected outputs:

- Ollama adapter;
- health and model discovery;
- GPU, VRAM, and RAM detection;
- hardware profile;
- model fit estimator;
- single-GPU semaphore;
- timeout and cancel;
- local streaming;
- OpenAI-compatible localhost adapter as a contract test double.

Deferred from Phase 2 to a later phase: OS-level network isolation proving the
daemon is not itself proxying remotely, and full multi-turn chat on the worker
gateway.

## Phase 3 - OpenCode Worker POC

Status: complete through run 2F and a **local closure candidate**. Not merged,
not tagged, not pushed.

Entry gate (satisfied): Phase 2 is merged into `main` (`ec87dd0`, PR #2), the
annotated `phase-2` tag exists, and CI for that merge completed successfully
(workflow run `30337726989`).

Goal: delegate one coding task to OpenCode while preserving core authority.
The Phase 2 gateway is the only inference path a worker may use; Phase 3 extends
it only after probing a pinned OpenCode build and documenting the requirement.

Expected outputs:

- disposable fixture repository;
- OpenCode external process adapter;
- capability and version discovery;
- normalized event stream;
- proposed diff collection;
- approval before risky actions;
- deterministic test evidence;
- cancel, timeout, and recovery tests.

### Runs

| Run | Subject |
|---|---|
| 2A | fail-closed OpenCode configuration, evidence-bounded protocol retries, Git-backed evidence required for code verdicts, permission-pending lifecycle cleanup |
| 2B | executable authority stack, run-scoped approval decision surface, structured lifecycle and protocol evidence, trusted verdict provenance |
| 2C | pinned real `opencode-ai@1.18.8` with real local `qwen3:14b` on an RTX 3090: approved edit plus four terminal paths |
| 2D | authenticated remote access for a single operator over a private VPN (ADR 0020) |
| 2E | security closure audit, ADR 0020, process-level refusal proof, acceptance matrix |
| 2F | restart recovery on the OpenCode composition, focused real-binary regression, wording corrections, closure documents and gates |

Runs 2A-2F are complete. The requirement-level audit against this specification
is `docs/testing/phase-3-acceptance-matrix.md`, and the closure evidence is
`docs/testing/phase-3-results.md` with `artifacts/phase-3-verification.json`.

### Phase 3 closure work, and what closed it

1. **Restart recovery on the OpenCode composition** — closed by
   `apps/server/src/opencode/restart-recovery.process.test.ts`, which SIGKILLs a
   real Core running the production composition at a pending approval and proves
   the next Core reconciles everything it left behind and can do useful work.
   No production defect was found and no production code changed.
2. **Five identical deterministic full-suite runs** — recorded in the results
   document.
3. **Clean-clone `pnpm verify`** — recorded in the results document.
4. **`docs/testing/phase-3-results.md` and `artifacts/phase-3-verification.json`**
   — produced, in the shape every previous phase produced.
5. **README "Current State"** — updated.
6. **CI status** — the entry gate's run is recorded. The closure candidate
   itself has no CI run, because the branch is deliberately not pushed and the
   workflow triggers only on pull requests and pushes to `main`. That is
   recorded as NOT PROVEN with its reason rather than implied to be green.
7. **Two wording corrections** — made in `docs/test-matrix-phase-1-to-4.md`.
   Neither promoted a verdict: the rows stay PARTIAL because what changed was
   the specification's accuracy, not the evidence behind it.

Phase 3 is a **local closure candidate**. It is not merged, not tagged and not
pushed; independent review comes before integration.

## Phase 3B - Tool Capability Mediation

Inserted between H and I after the H checkpoint proved that an inference-only
OpenCode integration is not a finished Phase 3, and that closing Phase 3 there
would have moved the problem silently into Phase 4.

Gate: a contract spike against the pinned real binary, run before any
implementation. Verdict PASS, conditional on an IntentSmith-generated permission
config (`docs/testing/phase-3b-tool-mediation-spike.md`).

Delivered:

- capability and lifecycle ledger for every observed tool;
- bounded tool-calling gateway path that translates and never executes;
- single-use, payload-bound approvals with append-only audit;
- vendor-neutral permission bridge that cannot grant standing access;
- git-backed change capture, and a verdict that refuses a success it cannot
  corroborate;
- Core-owned model profiles and single-GPU residency scheduling.

ADRs 0017, 0018, 0019. Evidence in `artifacts/phase-3b-verification.json`.

## Phase 3 run 2D - Remote Operator Access

Delivered: the main API can be bound to a private VPN interface behind one
operator bearer token, supplied at runtime. The loopback default is unchanged
and requires no configuration and no credential.

Remote mode is an explicit opt-in that fails closed before anything is opened: a
non-loopback bind without the opt-in, the opt-in without a credential, a weak
credential, a credential nothing would enforce, an unsupported opt-in value, a
wildcard bind and a hostname are all startup errors. Authentication is one
`onRequest` hook registered before any route, so no route can forget to ask, and
in remote mode nothing is public. The worker inference gateway stays
loopback-only with its own per-run tokens.

Transport confidentiality is entirely the VPN's; IntentSmith terminates no TLS,
and direct public-internet exposure is unsupported. Accepted alpha limits:
rotation is a restart, no accounts, no roles, no rate limiting.

ADR 0020. Documented in `docs/security/remote-vpn-access.md`.

## Post-Phase-3 - Local Validation and Soak Testing

A validation stage, not a development phase. It runs **after** Phase 3 is closed
and **before** Phase 3.1 begins. Nothing in it is implemented yet, and this
section is a specification only.

Its purpose is to find out what a week of real use does to a system that has so
far been proven one scenario at a time. Phase 3 proved that each guarantee holds
once. This stage asks whether they hold repeatedly, overnight, and under a real
model's variability.

Environment, pinned:

- real `opencode-ai@1.18.8`, installed outside this repository, version-checked
  before every session;
- local Ollama serving `qwen3:14b` on the RTX 3090;
- disposable managed workspaces, created and destroyed per run, never a real
  project;
- an isolated `HOME` and `XDG_*` per run, so nothing inherits or leaves behind
  developer state.

Method:

- an overnight runner with checkpoint and resume, so an interrupted night is
  resumable evidence rather than a discarded one;
- **deterministic gates** (exit codes, schema-valid artifacts, invariant checks)
  evaluated separately from **behavioural evidence** (what the model and the
  agent actually did), because the second is not reproducible and must never be
  scored as though it were;
- every scenario classified **PASS**, **FAIL** or **BLOCKED**, with BLOCKED
  reserved for a missing precondition and never used to hide a failure;
- comparison against a recorded baseline, so a regression is a difference rather
  than an opinion;
- machine-readable artifacts as the primary output, with prose derived from them
  and never the other way round.

Leak checks, run after every session:

- **resources** — file descriptors, sockets, temporary directories, disk;
- **processes** — no orphan in any run's process group, no surviving child;
- **tokens** — no gateway or operator credential in any artifact, log, audit
  record, database row or error message;
- **approvals** — no grant outliving its run, no standing permission, no waiter
  left suspended.

Constraints:

- the runner **never changes production code automatically**. It reports; a
  human decides;
- **no claim of strict-offline operation** unless network activity is actually
  observed and the observation is part of the artifact. "No cloud traffic seen"
  is not "cloud traffic impossible", and the distinction has already been
  recorded once in Phase 3B.

Carried into this stage from Phase 3: strict-offline behaviour, sandboxed
(`preferSandbox`) execution, degraded-sandbox runs, real-hardware single-GPU
model switching, and model default selection.

## Phase 4 - MCP and Serena

Goal: use external code intelligence instead of rebuilding LSP and symbol analysis.

Expected outputs:

- MCP client/server boundary;
- Serena adapter;
- capability map;
- symbol lookup;
- references;
- diagnostics;
- rename proof of concept;
- audited tool calls;
- unavailable-Serena fallback.

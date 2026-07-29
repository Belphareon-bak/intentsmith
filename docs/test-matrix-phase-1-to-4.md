# Verification matrix: Phases 1–4

The default suite must remain deterministic, independent of external runtimes
and insensitive to workstation speed. Strict network isolation and a
cold-network installation are separate evidence questions. Real integrations
are separate opt-in gates.

| Guarantee | Deterministic evidence | Optional real evidence | Phase |
| --- | --- | --- | --- |
| Valid lifecycle transitions only | State-machine and use-case tests | Local API/CLI smoke test | 1 |
| Worker claim alone cannot pass | Verdict negative tests | End-to-end task run | 1 |
| Audit is append-only | Repository API and SQL-path tests | Database inspection | 1 |
| SQLite operations are atomic under concurrency | Overlap, rollback and multi-store tests | Clean-clone stress repetition | 1.1 |
| Interrupted runs never auto-restart | Idempotent recovery tests | Process-restart smoke test | 1.1 |
| Adapters cannot mutate Core state | Shared worker/provider contract suites and boundary checks | Adapter package review | 1.1 |
| Timeouts are deterministic | Virtual clock tests | Real runtime cancellation | 1.1 |
| Hardware data is sanitized | Probe normalization and snapshot tests | Local NVIDIA/CPU probe | 2 |
| Oversized models fail explicitly | Hardware Director policy tests | Real model/profile check | 2 |
| Provider errors are stable | Ollama adapter contract tests | Real Ollama suite | 2 |
| No prompt/response is persisted | Persistence and serialization assertions | Real Ollama evidence review | 2 |
| Gateway is loopback-only and opt-in | Lifecycle and binding tests | Real socket tests | 2 |
| Gateway token is run-scoped and revocable | Token lifecycle tests | Real socket cancellation path | 2 |
| Worker descriptor is truthful | Shared worker suite | Real OpenCode capability probe | 3 |
| Exactly one terminal outcome | Adversarial ACP fixtures | Real OpenCode run | 3 |
| Protocol/session mismatches fail closed | ACP parsing and session tests | Real ACP initialization | 3 |
| Initialize occurs before session creation | 12 wire-order and negative handshake tests | Real OpenCode handshake | 3 |
| Child processes terminate on every path | Supervisor/process-group tests | Real executable timeout/cancel | 3 |
| Credentials are contained at ingress | Adversarial echo/redaction tests | Real gateway worker run | 3 |
| Proposed changes match a git diff | Temporary-repository tests | Real OpenCode change set | 3 |
| Approvals persist and expire | Core/persistence contract tests | Restarted approval flow | 3 |
| Degraded sandbox cannot target a real project | Policy tests with disposable fixtures | Platform-specific isolation probe | 3 |
| OpenCode cannot select a cloud-backed model | Forced-config and provider-selection tests | Real gateway-backed prompt | 3 |
| Provider-catalog network behaviour is known | Isolated cache/config fixtures | Real clean-home network probe | 3 |
| MCP tools cannot own lifecycle | Boundary and adversarial server tests | Real MCP server suite | 4 |
| Tool calls are run-attributed and cancellable | MCP contract tests | Serena integration run | 4 |
| Context failure cannot create a pass | Verdict and fallback tests | Serena unavailable/degraded run | 4 |

## Gate classes

### Required on every pull request

- frozen dependency installation;
- typecheck;
- lint;
- unit, contract and integration tests;
- coverage thresholds;
- build;
- dependency-boundary and clean-tree verification.

### Required to close an integration phase

- the relevant opt-in real adapter suite;
- recorded dependency/version provenance;
- a clean-clone run;
- repeated deterministic-suite stability;
- threat-model and known-limit updates.

## Phase 3

| Layer | Scope | Required Evidence |
|---|---|---|
| Contract | worker adapter interface | fake and OpenCode adapter pass same suite |
| Integration | OpenCode external process | ACP protocol version and capabilities discovered by the adapter; binary version operator-declared and harness-verified; health derived from the handshake and process state |
| Integration | proposed diff | diff captured before approval |
| Policy | shell and writes | writes require a single-use, payload-bound approval; shell is denied by policy, not approval-gated |
| Recovery | killed worker | task remains recoverable |
| Deterministic E2E | small fixture coding task | test evidence separated from worker claim |

Two rows were corrected at Phase 3 closure so the specification states what the
implementation does rather than what was assumed before it existed. Neither
weakens a claim:

- **Binary version.** The adapter negotiates and records the *ACP protocol*
  version and the agent's capabilities, and refuses a mismatch. The OpenCode
  *executable's* version is declared by the operator (`INTENTSMITH_OPENCODE_VERSION`)
  and verified by the real-binary harness, which reports BLOCKED on a mismatch.
  The adapter does not ask the executable what it is.
- **Shell.** `bash` is denied outright rather than approval-gated. The observed
  permission payload carries a command string and no resource locations, so an
  approval for it could not be bound to a workspace scope; approving it would
  mean approving prose. This is stricter than "requires approval", not weaker.

The "killed worker, task remains recoverable" row is left exactly as written.
What it is and is not proven to mean is recorded against requirement D5 of
`docs/testing/phase-3-acceptance-matrix.md`, because that is an evidence
question rather than a wording one.

Real suites may require local software or hardware and therefore do not replace offline coverage. They prove that the contracted integration works against an observed upstream version.

Future model comparison is intentionally outside the Phase 1–4 required matrix.
Its staged research requirements are recorded in
[Local model evaluation strategy](testing/local-model-evaluation-strategy.md).
In particular, one successful tool-call prompt is eligibility evidence only,
not a quality or role-assignment verdict.

## C3 semantic-inheritance contract gates

These gates begin as design tests before the later runtimes are implemented:

| Layer | Minimum preserved guarantee |
| --- | --- |
| Expertise | Composition is deterministic; intent and tools remain unchanged; incompatible 5D profiles block |
| Skill | Checkpoints persist and resume exactly once; undeclared steps or security failures fail closed |
| Specialist | Lifecycle is idempotent; disable preserves data; failed reversible update rolls back |
| Autonomous Agent | Triggers are deterministic; deduplication is crash-safe; actions pass through Core policy |
| Project lifecycle | Completed milestone evidence is immutable; deterministic gates precede a passing checkpoint |

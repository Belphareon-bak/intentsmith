# Verification matrix: Phases 1–4

The default suite must remain deterministic, offline and independent of workstation speed. Real integrations are separate opt-in gates.

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
| Child processes terminate on every path | Supervisor/process-group tests | Real executable timeout/cancel | 3 |
| Credentials are contained at ingress | Adversarial echo/redaction tests | Real gateway worker run | 3 |
| Proposed changes match a git diff | Temporary-repository tests | Real OpenCode change set | 3 |
| Approvals persist and expire | Core/persistence contract tests | Restarted approval flow | 3 |
| Degraded sandbox cannot target a real project | Policy tests with disposable fixtures | Platform-specific isolation probe | 3 |
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

Real suites may require local software or hardware and therefore do not replace offline coverage. They prove that the contracted integration works against an observed upstream version.

# Test Matrix: Phase 1 to Phase 4

## Phase 1

| Layer | Scope | Required Evidence |
|---|---|---|
| Unit | lifecycle transitions, policy decisions, ID normalization | deterministic pass/fail |
| Contract | task, capability, event, result schemas | invalid payload rejected |
| Persistence | minimal migrations and repositories | forward migration and recovery |
| Integration | fake model plus fake worker | create, run, cancel, resume task |
| CLI | health and version | offline command output |
| API | health and task boundary | schema validation before core |

## Phase 2

| Layer | Scope | Required Evidence |
|---|---|---|
| Contract | inference provider interface | fake and Ollama-compatible providers pass same suite |
| Integration | Ollama unavailable | actionable error, no fallback to cloud |
| Integration | model fit estimation | too-large model blocked |
| Integration | cancel and timeout | resources released |
| Real local | pinned Ollama model | digest, latency, hardware profile recorded |

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

## Phase 4

| Layer | Scope | Required Evidence |
|---|---|---|
| Contract | MCP tool boundary | scoped tool call envelope |
| Integration | Serena unavailable | explicit blocked/error state |
| Integration | symbol lookup and references | normalized results |
| Policy | rename | approval before write |
| Benchmark | C3 code-intel scenario comparison | outcome, latency, and code-size evidence |

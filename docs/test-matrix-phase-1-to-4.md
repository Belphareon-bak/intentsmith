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
| Integration | OpenCode external process | version, health, capability discovery |
| Integration | proposed diff | diff captured before approval |
| Policy | shell and writes | risky action requires approval |
| Recovery | killed worker | task remains recoverable |
| Deterministic E2E | small fixture coding task | test evidence separated from worker claim |

## Phase 4

| Layer | Scope | Required Evidence |
|---|---|---|
| Contract | MCP tool boundary | scoped tool call envelope |
| Integration | Serena unavailable | explicit blocked/error state |
| Integration | symbol lookup and references | normalized results |
| Policy | rename | approval before write |
| Benchmark | C3 code-intel scenario comparison | outcome, latency, and code-size evidence |

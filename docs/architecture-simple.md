# C.3 Agent — Architecture (One Page)

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    CHAT CONTROLLER                          │
│               (single entry point)                          │
│                  src/unification/                           │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                         CRE                                 │
│           (Conversational Reasoning Engine)                 │
│              src/chat/cre-v2.js                             │
│                                                             │
│    Decides: TOOL_CALL | ANSWER | PLAN | CLARIFY            │
└───────────────┬─────────────┬─────────────┬─────────────────┘
                │             │             │
        ┌───────▼───┐  ┌──────▼──────┐  ┌──▼───────────┐
        │  PLANNER  │  │  EXECUTOR   │  │  LLM GATEWAY │
        │           │  │             │  │              │
        │ src/      │  │ src/tools/  │  │ src/llm/     │
        │ planner/  │  │ executor.js │  │ gateway.js   │
        └───────────┘  └─────────────┘  └──────────────┘
```

## What Each Layer Does

| Layer | Responsibility | NOT Responsibility |
|-------|---------------|-------------------|
| **ChatController** | Route requests, session management | Decision logic |
| **CRE** | Decide WHAT to do | Execute tools |
| **Planner** | Create execution plan | Call LLM directly |
| **Executor** | Run tools | Decide which tools |
| **LLM Gateway** | Authorize & call LLM | Business logic |

## Data Flow

```
User Input → ChatController → CRE Decision → Planner/Executor → Result
     │              │              │                │              │
     │              │              │                │              │
   string       validate       TOOL_CALL         execute        output
                session        or ANSWER        validate
```

## Key Contracts

| Contract | Where Used | Schema |
|----------|-----------|--------|
| PlannerOutput | CRE → Executor | `src/contracts/planner-output.schema.json` |
| ToolCall | Executor input | `src/contracts/tool-call.schema.json` |
| ExecutionResult | Executor output | `src/contracts/execution-result.schema.json` |

## Authority Chain

```
USER > HumanGate > CRE > Planner > Executor > Tool
```

- **USER** — always has final say
- **HumanGate** — blocks dangerous operations
- **CRE** — decides what to do (but USER can override)
- **Planner** — creates plan (CRE approves)
- **Executor** — runs plan (Planner controls)
- **Tool** — does work (Executor controls)

## Golden Path (Reference)

For understanding the system, start here:

```
src/golden/goldenPipeline.js     ← main flow
src/golden/goldenPlannerAdapter.js  ← LLM → contract
src/golden/goldenExecutorAdapter.js ← execute plan
```

See: [docs/golden-path.md](./golden-path.md)

## Key Files

| Purpose | File |
|---------|------|
| Entry point | `src/server.js` |
| Chat routing | `src/unification/chat-controller.js` |
| Decision engine | `src/chat/cre-v2.js` |
| Plan execution | `src/planner/runner.js` |
| Tool execution | `src/tools/executor.js` |
| Tool registry | `src/tools/registry.js` |
| LLM authorization | `src/llm/gateway.js` |
| Human approval | `src/gates/human-gate.js` |
| Contract validation | `src/contracts/validate.js` |

## Invariants

1. **CRE is authority** — LLM doesn't decide, CRE decides
2. **Contracts are enforced** — invalid data → fail fast
3. **Tools have permissions** — no arbitrary execution
4. **User can override** — HumanGate always respected
5. **All changes auditable** — mutations logged

## What LLM Does vs Doesn't Do

### LLM IS Used For:
- Generating plan steps
- Synthesizing text responses
- Understanding user intent (via CRE prompt)

### LLM IS NOT Used For:
- Making system decisions
- Executing tools
- Bypassing gates
- Accessing files directly

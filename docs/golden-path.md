# Golden Path — Reference Pipeline

## Overview

Golden Path is the **single officially supported way** to run the agent. It is the "Hello World" of the architecture — not a feature.

```
User Input
    │
    ▼
┌────────────────────┐
│  Input Validation  │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│   Planner (LLM)    │
│  → raw JSON output │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│  Planner Adapter   │
│  → contract schema │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│  Schema Validation │
│   (fail-fast)      │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│  Approval Gate     │
│  (auto-approve)    │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│     Executor       │
│  (sequential)      │
└────────────────────┘
    │
    ▼
┌────────────────────┐
│  Execution Result  │
│  (contract schema) │
└────────────────────┘
```

## What Golden Path IS

- **Explicit sequence** — every step is visible in one file
- **No magic** — no hidden state, no implicit behavior
- **Deterministic** — same input → same output
- **Contract-validated** — all data matches JSON Schema

## What Golden Path IS NOT

These are intentionally **excluded**:

- ❌ Autonomous loop
- ❌ Memory writes
- ❌ Tool chaining
- ❌ Retries
- ❌ Self-correction
- ❌ Parallel execution

## Files

| File | Purpose |
|------|---------|
| `src/golden/goldenPipeline.js` | Main pipeline — entry point |
| `src/golden/goldenPlannerAdapter.js` | Maps LLM output → contract |
| `src/golden/goldenExecutorAdapter.js` | Executes plan sequentially |

## Contracts

| Contract | Schema File |
|----------|-------------|
| Planner Output | `src/contracts/planner-output.schema.json` |
| Tool Call | `src/contracts/tool-call.schema.json` |
| Execution Result | `src/contracts/execution-result.schema.json` |

## Usage

```javascript
import { runGoldenPath } from './src/golden/goldenPipeline.js';

const result = await runGoldenPath('Search for RTX 5090 prices');

// result.status: 'SUCCESS' | 'PARTIAL' | 'PENDING_APPROVAL' | 'ERROR'
// result.plan: PlannerOutput (validated)
// result.execution: ExecutionResult (validated)
```

## Testing

```bash
npm run test:golden
```

Tests verify:
1. Planner adapter returns valid structure
2. Schema validation passes/fails correctly
3. Executor receives exactly what contract specifies
4. Output is deterministic

## Pipeline Steps

### 1. Input Validation

```javascript
if (!userInput || userInput.trim().length === 0) {
  return { status: 'ERROR', error: { code: 'INVALID_INPUT' } };
}
```

### 2. Planner Call

Calls LLM with structured prompt. Expects JSON response.

### 3. Adapter (LLM → Contract)

```javascript
const plannerOutput = adaptPlannerOutput(rawLLMResponse, userInput);
// → PlannerOutput conforming to planner-output.schema.json
```

### 4. Schema Validation

```javascript
const validation = validate('planner-output', plannerOutput);
if (!validation.valid) throw new ValidationError(...);
```

### 5. Approval Gate

In Golden Path, auto-approve is default:

```javascript
if (!autoApprove && plannerOutput.requires_approval) {
  return { status: 'PENDING_APPROVAL', plan: plannerOutput };
}
```

### 6. Execution

Sequential execution, stop on first failure:

```javascript
for (const step of plannerOutput.steps) {
  const result = await executeStep(step);
  if (result.status === 'failed') break;
}
```

### 7. Result

```javascript
return {
  status: 'SUCCESS',
  plan: plannerOutput,
  execution: executionResult,
  duration_ms: elapsed,
};
```

## Contract Schemas

### PlannerOutput

```json
{
  "plan_id": "uuid-string",
  "goal": "What this plan achieves",
  "steps": [
    {
      "step_id": "step_1",
      "action": "Human-readable description",
      "tool": "web.search",
      "args": { "query": "test" }
    }
  ],
  "requires_approval": true,
  "confidence": 0.85
}
```

**Required fields:** `plan_id`, `goal`, `steps`, `requires_approval`, `confidence`

**No optional fields.**

### ToolCall

```json
{
  "tool": "namespace.action",
  "args": { ... }
}
```

**Pattern:** `tool` must match `^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$`

### ExecutionResult

```json
{
  "plan_id": "uuid-string",
  "status": "completed",
  "step_results": [
    {
      "step_id": "step_1",
      "status": "completed",
      "data": { ... },
      "duration_ms": 150
    }
  ],
  "total_duration_ms": 200
}
```

**Status enum:** `completed`, `partial`, `failed`

## Error Handling

Golden Path uses fail-fast approach:

```
INVALID_INPUT       → input validation failed
PLANNER_CALL_FAILED → LLM call failed
PLANNER_OUTPUT_INVALID → adapter validation failed
EXECUTION_FAILED    → tool execution failed
```

No retries. No recovery. Just clear error codes.

## Why Golden Path Exists

1. **Onboarding** — new developers see full flow in one file
2. **Testing** — baseline for regression tests
3. **Debugging** — minimal path to reproduce issues
4. **Contract enforcement** — proves schema works end-to-end

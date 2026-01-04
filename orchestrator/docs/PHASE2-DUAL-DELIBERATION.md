# Phase 2: Dual Deliberation Executors

**Status:** ✅ COMPLETE  
**Date:** 2026-01-04

## Overview

Phase 2 implements the dual deliberation execution flow with proper context passing between steps.

## What Was Implemented

### 1. prepare-dual.js

**Complete rewrite** to properly:
- Accept context with goal, constraints, working progress
- Generate detailed prompts for D1 and D2
- Emit granular events (designer_start, designer_done)
- Return structured { D1, D2 } output

Key changes:
```javascript
// Before: Empty prompt, hardcoded models
const prompt = "You are a DESIGNER..."; // generic

// After: Full context-aware prompt
const basePrompt = `
## TASK
${goal}

## CONSTRAINTS
${constraints}

## EXISTING PROGRESS
${workingProgress}
`;
```

### 2. review-cross.js

**Fixed cross-review logic** - critical architectural fix:
- R1 now reviews D2 (not D1)
- R2 now reviews D1 (not D2)
- This ensures independent, unbiased review

```
Before (WRONG):
R1 → reviews D1 (self-review!)
R2 → reviews D2 (self-review!)

After (CORRECT):
R1 → reviews D2 (cross-review)
R2 → reviews D1 (cross-review)
```

### 3. decision-maker.js

**Complete rewrite** with:
- Full context input (designs + reviews)
- Schema validation against decision-output.schema.json
- JSON extraction from LLM response (handles markdown blocks)
- proposed_steps extraction for approval flow

### 4. step-executor.js

**Context flow implementation**:
- Step input merges into shared context
- Each step stores its result in context
- Subsequent steps can access previous results

```javascript
// Context accumulation:
context.prepare = prepareResult;  // After prepare step
context.review = reviewResult;    // After review step  
context.decision = decisionResult; // After decision step
```

### 5. event-bus.js

Added `subscribe()` function for:
- Internal event listening
- Test instrumentation
- Future debugging/logging hooks

## Dual Deliberation Flow

```
┌─────────────────────────────────────────────┐
│              PREPARE STEP                   │
│                                             │
│   D1 (deepseek) ──┐   ┌── D2 (qwen3)        │
│   creates         │   │   creates           │
│   Design A        │   │   Design B          │
│                   ▼   ▼                     │
│   context.prepare = { D1, D2 }              │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│              REVIEW STEP                    │
│                                             │
│   R1 reviews D2 ──┐   ┌── R2 reviews D1     │
│   (cross!)        │   │   (cross!)          │
│                   ▼   ▼                     │
│   context.review = { R1_of_D2, R2_of_D1 }   │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│             DECISION STEP                   │
│                                             │
│   Sees: D1, D2, R1_of_D2, R2_of_D1          │
│   Outputs: Schema-validated decision        │
│   + proposed_steps for approval             │
│                                             │
│   context.decision = { title, summary, ... }│
└─────────────────────────────────────────────┘
```

## Testing

```bash
# Unit tests - context flow (no LLM required)
node orchestrator/test/test-context-flow.js
# Expected: 8 passed

# Unit tests - flow selector
node orchestrator/test/test-flow-selector.js
# Expected: 17 passed

# E2E test - dual deliberation (requires Ollama)
node orchestrator/test/test-dual-deliberation.js
```

## Files Changed

```
Modified:
  orchestrator/executors/steps/prepare-dual.js   (complete rewrite)
  orchestrator/executors/steps/review-cross.js   (cross-review fix)
  orchestrator/executors/steps/decision-maker.js (schema validation)
  orchestrator/executors/step-executor.js        (context flow)
  orchestrator/runtime/event-bus.js              (subscribe function)
  working-progress.md                            (status update)

Added:
  orchestrator/test/test-context-flow.js         (unit tests)
  orchestrator/test/test-dual-deliberation.js    (E2E test)
  orchestrator/docs/PHASE2-DUAL-DELIBERATION.md  (this file)
  orchestrator/docs/TARGET-STATE.md              (project vision)
```

## Exit Criteria

- [x] prepare-dual.js generates D1 + D2 with full context
- [x] review-cross.js does actual cross-review
- [x] decision-maker.js validates against schema
- [x] Context flows correctly between steps
- [x] Unit tests pass (25 total)
- [x] Events emitted at each stage

## Next Phase: Execution & Resume

Phase 3 will address:
- Fix resumeExecution cursor logic (skip completed steps)
- Sandbox enforcement for fs/shell executors
- Rollback mechanism
- Diff preview before apply

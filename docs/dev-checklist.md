# Development Checklist

Use this checklist before committing changes to ensure consistency and avoid breaking the system.

## Before Every Commit

### Did you change a contract?

If you modified any file in `src/contracts/`:

- [ ] Update the corresponding JSON Schema file
- [ ] Update `src/contracts/validate.js` if new validation rules needed
- [ ] Run contract tests: `node tests/contracts/planner-output.test.js`
- [ ] Run contract tests: `node tests/contracts/tool-call.test.js`
- [ ] Update any adapters that use the contract

### Did you change the pipeline?

If you modified `src/golden/` or `src/planner/`:

- [ ] Run Golden Path tests: `node tests/golden-path.test.js`
- [ ] Verify the flow still works end-to-end
- [ ] Update `docs/golden-path.md` if flow changed

### Did you add a new tool?

If you added a tool to `src/tools/registry.js`:

- [ ] Tool has `name`, `description`, `params.required`, `params.optional`
- [ ] Tool has `permissions` array defined
- [ ] Tool returns data or `{ error, code }` object
- [ ] Add tool to planner system prompt if needed
- [ ] Consider adding to `src/contracts/tool-call.schema.json` pattern

### Did you change CRE decision logic?

If you modified `src/chat/cre-v2.js` or decision types:

- [ ] Run CRE tests: `npm run test:cre`
- [ ] Verify decision invariants still hold
- [ ] Update decision matrix documentation if needed

### Did you change tool execution or resilience logic?

If you modified `src/executor/tool-executor.js` or `src/executor/circuit-breaker.js`:

- [ ] Run resilience tests: `node tests/e2e-resilience.test.js`
- [ ] Verify circuit breaker state transitions still hold
- [ ] Verify partial failure handling (successful results still reach synthesis)
- [ ] Check per-session isolation (circuit breaker key format `toolType:sessionId`)

### Did you change LLM integration?

If you modified `src/llm/`:

- [ ] Verify LLM Gateway authorization works
- [ ] Run LLM tests: `npm run test:llm:mock`
- [ ] Check that no direct LLM calls bypass gateway

## Quick Test Commands

```bash
# Golden Path tests (fast)
node tests/golden-path.test.js

# Contract tests (fast)
node tests/contracts/planner-output.test.js
node tests/contracts/tool-call.test.js

# All core tests
npm run test

# Resilience tests
node tests/e2e-resilience.test.js

# Full test suite
npm run test:all
```

## File Reference

| Changed This | Check These |
|--------------|-------------|
| `src/contracts/*.json` | Tests + adapters + validate.js |
| `src/golden/` | golden-path.test.js |
| `src/planner/` | planner.test.js, planner-v38.test.js |
| `src/tools/` | tool-executor.test.js |
| `src/executor/` | e2e-resilience.test.js |
| `src/chat/cre-v2.js` | cre-v2.test.js |
| `src/chat/cre-decision.js` | cre-comprehensive.test.js |
| `src/llm/` | llm-gateway.test.js |

## Common Mistakes to Avoid

### Contract Violations

```javascript
// BAD: ad-hoc object shape
return { plan: steps, ok: true };

// GOOD: matches contract exactly
return {
  plan_id: uuid(),
  goal: goal,
  steps: steps,
  requires_approval: true,
  confidence: 0.8
};
```

### Skipping Validation

```javascript
// BAD: trust raw LLM output
const plan = JSON.parse(llmResponse);
execute(plan);

// GOOD: validate first
const plan = adaptPlannerOutput(llmResponse, goal);
// adapter validates internally
execute(plan);
```

### Direct LLM Calls

```javascript
// BAD: bypass gateway
const response = await fetch(ollamaUrl, { ... });

// GOOD: use gateway with auth
const token = llmGateway.authorize({ role: 'PLANNER', ... });
const response = await llmGateway.call(token, { ... });
```

### Optional Fields in Contracts

```javascript
// BAD: adding "helpful" optional fields
{
  plan_id: '...',
  goal: '...',
  steps: [...],
  requires_approval: true,
  confidence: 0.8,
  metadata: { ... },  // NOT IN CONTRACT
  created_at: '...'   // NOT IN CONTRACT
}

// GOOD: exactly what contract specifies
{
  plan_id: '...',
  goal: '...',
  steps: [...],
  requires_approval: true,
  confidence: 0.8
}
```

## When in Doubt

1. Check the contract schema (`src/contracts/*.schema.json`)
2. Run the Golden Path test
3. Ask: "Would a new developer understand this?"

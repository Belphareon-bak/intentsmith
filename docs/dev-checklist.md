# Development Checklist

Use this checklist before committing changes to ensure consistency and avoid breaking the system.

## Before Every Commit

### Did you change CRE decision logic?

If you modified `src/chat/cre-decision.js`, `src/chat/cre-routing-patches.js`, or decision types:

- [ ] Run CRE tests: `npm run test:core`
- [ ] Verify decision invariants still hold (single authority, no bypass)
- [ ] Check all handlers have case for new DecisionType (conversation.js, project.js, expertise.js)
- [ ] Update AUTHORITY.md if gate logic changed

### Did you change a handler?

If you modified files in `src/chat/handlers/`:

- [ ] Run chat tests: `npm run test:chat`
- [ ] If lifecycle-related: `npm run test:lifecycle`
- [ ] If expertise-related: `npm run test:expertises`
- [ ] If sticky mode routing changed: verify intercepts are mirrored in project.js
- [ ] Run E2E: `npm run test:e2e`

### Did you change the expertise system?

If you modified `src/expertises/`:

- [ ] Run expertise tests: `npm run test:expertises`
- [ ] Run merge tests: `npm run test:merge`
- [ ] Run capability tests: `npm run test:capability`
- [ ] If 5D vectors changed: verify capability-enforcer thresholds

### Did you change the lifecycle engine?

If you modified `src/planner/lifecycle*.js`:

- [ ] Run lifecycle tests: `npm run test:lifecycle`
- [ ] Run build tests: `npm run test:workflow`
- [ ] If checkpoint logic changed: `node tests/lifecycle-build.test.js`
- [ ] Verify CheckpointMode (STRUCTURAL/FUNCTIONAL/SECURITY) still works

### Did you change tool execution or resilience logic?

If you modified `src/executor/tool-executor.js` or `src/executor/circuit-breaker.js`:

- [ ] Run resilience tests: `node tests/e2e-resilience.test.js`
- [ ] Verify circuit breaker state transitions still hold
- [ ] Verify partial failure handling (successful results still reach synthesis)
- [ ] Check per-session isolation (circuit breaker key format `toolType:sessionId`)

### Did you change LLM integration?

If you modified `src/llm/`:

- [ ] Verify LLM Gateway timeout/retry logic (no retry on AbortError)
- [ ] Check that no direct Ollama calls bypass gateway
- [ ] Run: `npm run test:chat`

### Did you add or change a specialist?

If you modified `specialists/` or `src/expertises/specialist-*.js`:

- [ ] Run specialist tests: `npm run test:specialists`
- [ ] If ledger-related: `npm run test:ledger`
- [ ] Verify specialist-loader.js handles new plugin format

### Did you change the skills system?

If you modified `src/skills/`:

- [ ] Run: `node tests/modules.test.js` (skills included)
- [ ] If step executors changed: verify sandboxing (write step: realpath, shell step: whitelist)
- [ ] If state machine changed: verify resume flow works

### Did you change the memory system?

If you modified `src/memory/`:

- [ ] Run: `node tests/modules.test.js`
- [ ] If LTM changed: verify confidence decay formula
- [ ] If feedback-detector changed: verify 6 signal types
- [ ] If preferences changed: verify persistence to/from DB

### Did you change the database schema?

If you added a migration in `src/db/migrations/`:

- [ ] Run: `npm run test:db`
- [ ] Migration file follows naming convention: `YYYY_MM_DD_NNN_vVV_description.js`
- [ ] Migration has both `up()` and rollback strategy documented
- [ ] Prepared statements added to `database.js` for new tables

### Did you change the frontend (chat-panel-module)?

If you modified `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`:

- [ ] Validate the authoritative runtime: from `c3-ide/`, run `corepack yarn workspace @c3/chat-panel build`
- [ ] Rebuild the product bundle: from `c3-ide/`, run `corepack yarn build`
- [ ] Package `clean` must report a no-op and preserve `lib`; package `watch` must reject with exit `2`
- [ ] Test the built Electron transport/runtime, not only the module or browser
- [ ] Do not treat current layout/styling as the final IntentSmith UI contract

## Quick Test Commands

```bash
# Core tests (CRE, Gatekeeper, modules)
npm run test:core

# Chat pipeline
npm run test:chat

# Expertise system
npm run test:expertises

# Lifecycle engine
npm run test:lifecycle

# Full deterministic suite
npm test

# Full suite + specialists + agents + E2E
npm run test:all

# Resilience
node tests/e2e-resilience.test.js

# Conversation tests (requires Ollama + GPU)
npm run test:conv
```

## File Reference

| Changed This | Run These Tests |
|--------------|-----------------|
| `src/chat/cre-decision.js` | test:core (cre-comprehensive, cre-gatekeeper) |
| `src/chat/handlers/conversation.js` | test:chat, test:e2e |
| `src/chat/handlers/project.js` | test:chat, test:lifecycle |
| `src/chat/handlers/lifecycle-*.js` | test:lifecycle |
| `src/chat/handlers/expertise.js` | test:expertises |
| `src/chat/handlers/utils/*.js` | test:chat |
| `src/chat/quality/*.js` | test:quality |
| `src/expertises/*.js` | test:expertises, test:merge, test:capability |
| `src/expertises/ledger/*.js` | test:ledger |
| `src/planner/lifecycle*.js` | test:lifecycle, test:workflow |
| `src/planner/quality-score.js` | test:quality |
| `src/executor/*.js` | e2e-resilience.test.js |
| `src/skills/*.js` | modules.test.js |
| `src/memory/*.js` | modules.test.js |
| `src/agents/*.js` | test:agents |
| `src/notifications/*.js` | test:notifications |
| `src/llm/*.js` | test:chat, test:llm |
| `src/db/database.js` | test:db |
| `src/db/migrations/*.js` | test:db |
| `src/ws-bridge/*.js` | test:ws |

## Common Mistakes to Avoid

### Missing DecisionType case

```javascript
// BAD: new DecisionType only handled in conversation.js
case DecisionType.NEW_TYPE:
  // ... only in conversation.js

// GOOD: also add to project.js and expertise.js
// All 3 handlers need the case, otherwise → REFUSE dead-end
```

### Skipping LLM JSON validation

```javascript
// BAD: trust raw LLM output
const result = JSON.parse(llmResponse);

// GOOD: use parseJSON() which strips <think> blocks, fixes trailing commas
const result = parseJSON(llmResponse);
```

### Direct Ollama calls

```javascript
// BAD: bypass gateway
const response = await fetch(ollamaUrl, { ... });

// GOOD: use gateway (handles timeout, retry, model routing)
const response = await llmGateway.generate(model, prompt, options);
```

### Frontend state mutation in focus mode

```javascript
// BAD: mutate session state for layout
s.bottom = 'agent';

// GOOD: derive at render-time, no state mutation
const effectiveBottom = isFocusActive() ? 'agent' : s.bottom;
```

## When in Doubt

1. Run `npm test` (core + chat + expertises + lifecycle)
2. Check ARCHITECTURE.md for the module's design contract
3. Ask: "Does this change affect all 3 handlers?" (conversation, project, expertise)

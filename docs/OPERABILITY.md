# CRE Operability Contract

> System guarantees and operational contracts for CRE v40.x+

## Overview

This document defines the operational guarantees provided by the CRE (Cognitive Reasoning Engine) system. These contracts ensure predictable, debuggable, and maintainable behavior.

---

## 1. Immutability Guarantees

### 1.1 Trace IDs
- **Guarantee**: All trace IDs are immutable UUIDs generated at creation time
- **Format**: `{prefix}_{uuid}` (e.g., `trace_550e8400-e29b-41d4-a716-446655440000`)
- **Invariant**: A trace ID NEVER changes after creation

### 1.2 Append-Only Traces
- **Guarantee**: Trace data is append-only; existing data is never modified
- **Implementation**: All state changes are logged to `_transitions` array
- **Invariant**: `trace.transitions.length` only increases, never decreases

### 1.3 Frozen Behavior Context
- **Guarantee**: BehaviorContext is frozen at execution start
- **Invariant**: After `freeze()`, no settings can be modified
- **API**: `ctx.isFrozen()` returns true after freeze

---

## 2. Determinism Guarantees

### 2.1 Seeded Random
- **Guarantee**: Same seed produces identical random sequence
- **API**: `SeededRandom(seed)` → deterministic sequence
- **Test**: `new SeededRandom(x).next() === new SeededRandom(x).next()`

### 2.2 Frozen Time
- **Guarantee**: Time can be frozen for replay
- **API**: `FrozenTime.freeze(timestamp)` → all calls return same time
- **Invariant**: During replay, `time.now()` returns recorded timestamps

### 2.3 Replay Consistency
- **Guarantee**: `record → replay → compare` produces identical results
- **Requirements**:
  - Same seed → same random sequence
  - Same timeContext → same timestamps
  - Same tool results → same outputs

---

## 3. Safety Guarantees

### 3.1 Skill Safety Profiles
Every skill MUST have a SafetyProfile defining:

| Field | Type | Description |
|-------|------|-------------|
| `level` | SafetyLevel | SAFE, NORMAL, ELEVATED, DANGEROUS |
| `maxSteps` | number | Maximum execution steps |
| `maxDurationMs` | number | Maximum execution time |
| `allowedTools` | string[] | Tools this skill can use |
| `blockedTools` | string[] | Tools this skill cannot use |
| `requiresApproval` | boolean | Requires user approval |
| `canModifyFiles` | boolean | Can modify files |
| `canExecuteCommands` | boolean | Can run shell commands |
| `canAccessNetwork` | boolean | Can make network requests |

### 3.2 Safety Levels

| Level | Description | Default Approval |
|-------|-------------|------------------|
| SAFE | Read-only operations | Not required |
| NORMAL | Standard operations | Not required |
| ELEVATED | Elevated permissions | Recommended |
| DANGEROUS | Significant changes | Required |

---

## 4. Memory Guarantees

### 4.1 Mandatory Entry Typing
Every MemoryEntry MUST have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | MemoryType | YES | FACT, DECISION, PREFERENCE, PATTERN, WARNING, TIP |
| `confidence` | Confidence | YES | CERTAIN (1.0), HIGH (0.8), MEDIUM (0.5), LOW (0.3), GUESS (0.1) |
| `source` | MemorySource | YES | USER, INFERRED, DETECTED, IMPORTED, SYSTEM |
| `content` | string | YES | The actual memory content |

### 4.2 Provenance Tracking
- **Guarantee**: Every memory entry has traceable provenance
- **Invariant**: `entry.source` is always set
- **Benefit**: Enables trust evaluation and debugging

---

## 5. Observability Guarantees

### 5.1 Latency Tracking
- **Guarantee**: Percentiles use sliding window (not global)
- **Window**: Default 100 samples OR 5 minutes (whichever is smaller)
- **Benefit**: Prevents long sessions from corrupting statistics

### 5.2 Failure Patterns
- **Guarantee**: Pattern IDs include behavior version
- **Format**: `patternId = hash(layer + category + error + behaviorVersion)`
- **Benefit**: Enables cross-version pattern comparison

### 5.3 Execution Tracing
- **Guarantee**: Every request has a unique trace ID
- **API**: `trace.computeSummary()` returns timing breakdown
- **Invariant**: Trace status transitions are valid: PENDING → RUNNING → COMPLETED|FAILED

---

## 6. Versioning Guarantees

### 6.1 Behavior Profiles
- **Guarantee**: Old projects work unchanged after upgrade
- **Mechanism**: Behavior profiles snapshot CRE behavior at a version
- **API**: `createBehaviorContext('v40.0')` → v40.0 behavior

### 6.2 Migration Paths
- **Guarantee**: Breaking changes are identified
- **API**: `registry.getMigrationPath('v39.0', 'v40.0')` → diff
- **Contract**: Breaking changes are flagged with `breaking: true`

---

## 7. API Contracts

### 7.1 ExecutionRecorder
```javascript
const recorder = new ExecutionRecorder(execution);
recorder.start();
recorder.recordPlan(plan);
recorder.recordStep(step);
recorder.recordToolResult(toolId, params, result);
recorder.recordDecision(decision);
recorder.complete(output);  // or recorder.fail(error)

// Deterministic context
recorder.getRandom();  // → SeededRandom
recorder.getTime();    // → FrozenTime
recorder.now();        // → timestamp
```

### 7.2 ExecutionReplayer
```javascript
const replayer = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });
await replayer.replay(executor);

// Frozen world during replay
replayer.getRandom();  // → same sequence as recording
replayer.getTime();    // → frozen at recorded time
replayer.now();        // → recorded timestamp
```

### 7.3 SafetyProfile
```javascript
const profile = SafetyProfile.safe();  // Read-only
const profile = SafetyProfile.normal(); // Standard
const profile = SafetyProfile.dangerous(); // Requires approval

profile.isToolAllowed('toolId');  // → boolean
profile.validateSteps(steps);     // → { valid, errors }
profile.merge(otherProfile);      // → more restrictive
```

### 7.4 BehaviorContext
```javascript
const ctx = createBehaviorContext('v40.0');
ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 5);
ctx.freeze();  // Immutable after this

ctx.get(aspect, key, defaultValue);  // → value
ctx.isFrozen();  // → true
ctx.getSnapshot();  // → frozen aspects object
```

---

## 8. Error Handling Contracts

### 8.1 Validation Errors
All validation methods return:
```javascript
{
  valid: boolean,
  errors: string[]
}
```

### 8.2 Required Field Errors
Missing required fields throw immediately with descriptive messages:
```javascript
// MemoryEntry without type:
// "MemoryEntry requires type (MemoryType.FACT, DECISION, etc.)"

// SafetyProfile validation:
// "Skill exceeds maxSteps (20)"
```

---

## 9. Testing Requirements

### 9.1 Replay Consistency Test
Every release MUST pass:
```javascript
// 1. Create and record execution
const recorder = new ExecutionRecorder(execution);
// ... record operations
const recording = recorder.complete(output);

// 2. Replay
const replayer = new ExecutionReplayer(recording);
const result = await replayer.replay();

// 3. Verify determinism
assert(result.differences.length === 0);
```

### 9.2 Safety Profile Validation
Every skill MUST validate against its safety profile:
```javascript
const skill = new Skill(config);
const validation = skill.validateSafety();
assert(validation.valid === true);
```

---

## 10. Performance Contracts

### 10.1 Latency Thresholds (Default)

| Layer | Threshold | Alert |
|-------|-----------|-------|
| CRE | 100ms | Warning |
| Planner | 500ms | Warning |
| Executor | 1000ms | Warning |
| LLM | 5000ms | Warning |
| Tool | 2000ms | Warning |
| Memory | 50ms | Warning |

### 10.2 Memory Limits

| Resource | Default Limit |
|----------|---------------|
| Sliding window samples | 100 |
| Sliding window time | 5 minutes |
| Max execution records | 1000 |
| Max replay store | 100 executions |

---

## 11. Resilience Guarantees

### 11.1 Tool Execution Resilience
- **Timeout enforcement**: Every tool execution has a 30s default timeout via `AbortController`
- **Partial failure**: When multiple tools execute, successful results pass to synthesis even if some tools fail (`ExecutionStatus.PARTIAL`)
- **Auto-retry**: Retryable errors (`TIMEOUT`, `SOURCE_BLOCKED`, `SOURCE_UNAVAILABLE`) get one automatic retry
- **Exception isolation**: Unhandled tool exceptions are caught and classified, never crash the system

### 11.2 Circuit Breaker
- **Per-session isolation**: Key format `toolType:sessionId` — one session's failures don't cascade to others
- **State machine**: `CLOSED → OPEN → HALF_OPEN → CLOSED`
  - OPEN after 5 failures within 60s window
  - HALF_OPEN after 30s reset timeout (tests recovery with up to 3 requests)
  - CLOSED after 2 consecutive successes in HALF_OPEN
- **Invariant**: Circuit breaker transitions are logged and metered

### 11.3 Cancellation & Concurrency
- **Per-conversation mutex**: `activeTurns` Map prevents concurrent processing on same conversation
- **Cancel isolation**: Cancelling one conversation doesn't affect others
- **Safe cleanup**: Turn deletion uses turnId matching to prevent race conditions
- **AbortController propagation**: Created per turn, passed via `context.signal` to all downstream operations

### 11.4 State Integrity
- **Break clears sticky context**: Intent break resets continuity without corrupting session state
- **Recovery after failure**: Failed tool executions don't corrupt state — subsequent calls succeed normally
- **Session consistency**: `SessionState` fields remain coherent across success/failure sequences

### 11.5 Testing
Resilience guarantees are enforced by `tests/e2e-resilience.test.js` (31 tests):
- Section I: Tool timeout, partial failure, exception handling, auto-retry
- Section II: Cancel during tool, activeTurns lifecycle/mutex/isolation
- Section III: State integrity — break during sticky, recovery after failure
- Section IV: Multi-conversation parallelism, per-session circuit breaker isolation
- Section V: Circuit breaker state machine, HALF_OPEN request limiting

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01 | Initial contract |
| 1.1.0 | 2026-02 | Added resilience guarantees (§11) |

---

*This contract is enforced by automated tests and runtime validations.*

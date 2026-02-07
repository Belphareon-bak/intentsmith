# C.3 Tool Executor Contract

> **Version:** 1.0
> **Status:** NORMATIVE
> **Last Updated:** 2026-02-07

This document defines the system contract for `C3ToolExecutor`. It is not API documentation—it is a binding specification that governs what the executor MUST and MUST NOT do.

---

## 1. Purpose & Role

**Executor = side-effect execution ONLY.**

The executor is a thin wrapper that runs tools and returns results. It has exactly one job: execute the requested tool with the given arguments and return the outcome.

The executor:
- ✅ Executes tools
- ✅ Enforces timeouts
- ✅ Sanitizes environment
- ✅ Logs execution (audit trail)
- ✅ Reports success/failure/timeout

The executor does NOT:
- ❌ Make decisions
- ❌ Plan or orchestrate
- ❌ Retry failed operations
- ❌ Read or modify worker state
- ❌ Call CRE or Planner
- ❌ Select tools or models
- ❌ Implement fallback logic

---

## 2. Call Chain & Authority

```
Runner → ActionHandler → Executor → Tool
                ↓
         mark_seen BEFORE action
```

### Authority Boundaries

| Component | Authority |
|-----------|-----------|
| Runner | Retry policy, backoff, workflow control |
| ActionHandler | mark_seen, audit logging, pre/post hooks |
| Executor | Timeout enforcement, env sanitization, execution |
| Tool | Actual side-effect (shell, HTTP, file I/O) |

### Executor MUST NOT

1. **Call CRE** — routing decisions are made upstream
2. **Call Planner** — planning is done before execution
3. **Read Worker state** — executor is stateless
4. **Decide retry** — that's Runner's responsibility
5. **Modify input** — executor receives final, validated input
6. **Cache results** — caching is a separate concern
7. **Log to user** — only to audit trail

---

## 3. Input Contract

### Required Fields

```typescript
interface ToolExecutionRequest {
  correlationId: string;   // REQUIRED - unique ID for tracing
  tool: string;            // REQUIRED - tool name from registry
  args: Record<string, unknown>;  // REQUIRED - tool arguments
  timeoutMs: number;       // REQUIRED - caller-controlled timeout
  sandbox?: {
    type: 'docker' | 'none';
    image?: string;
    workdir?: string;
  };
}
```

### Validation Rules

**Validated BEFORE executor (by ActionHandler):**
- `correlationId` is non-empty string
- `tool` exists in registry
- `args` matches tool schema
- `timeoutMs` is positive integer ≤ 600000 (10 min)

**Validated BY executor (defense in depth):**
- `correlationId` is non-empty
- `timeoutMs` is positive
- `tool` is non-empty string
- `args` is object (not null/undefined)

If validation fails, executor returns immediately with `status: 'error'`.

---

## 4. Execution Semantics

### 4.1 Single-Shot Execution

The executor is **single-shot**:
- One request → one execution → one result
- No internal loops
- No implicit retries
- No "try again with different args"

### 4.2 Timeout Behavior

```
1. Timer starts: timeoutMs
2. On timeout: AbortController.abort('timeout')
3. Graceful period: 1000ms for cleanup
4. Force kill if still running
5. Return status: 'timeout'
```

**Timeout is ALWAYS enforced.** There is no way to disable it.

### 4.3 Cancellation

The executor respects `AbortSignal`:
- If aborted before start → return immediately with `status: 'cancelled'`
- If aborted during execution → terminate and return `status: 'cancelled'`
- Cancellation is immediate (no graceful period)

### 4.4 Execution Order

```
1. Validate request (defense in depth)
2. Log BEFORE_EXECUTION to audit trail
3. Start timeout timer
4. Sanitize environment
5. Execute tool (sandbox or direct)
6. Stop timeout timer
7. Log AFTER_EXECUTION to audit trail
8. Return result
```

This order is invariant. Steps cannot be reordered or skipped.

---

## 5. Result Contract

### Result Schema

```typescript
interface ToolExecutionResult {
  status: 'ok' | 'error' | 'timeout' | 'cancelled';
  retryable: boolean;
  output?: unknown;        // Tool output on success
  error?: string;          // Error message on failure
  executionTimeMs: number; // Actual execution time
  correlationId: string;   // Echo of input correlationId
}
```

### Status Semantics

| Status | Meaning | retryable |
|--------|---------|-----------|
| `ok` | Tool executed successfully | `false` |
| `error` | Tool failed (exception, bad output) | depends on error type |
| `timeout` | Execution exceeded timeoutMs | `false` |
| `cancelled` | Execution was aborted | `false` |

### Retryable Errors

`retryable: true` ONLY for transient infrastructure errors:
- `ECONNRESET` — connection reset
- `ETIMEDOUT` — network timeout (not execution timeout)
- `ECONNREFUSED` — service temporarily unavailable

`retryable: false` for everything else:
- Tool logic errors
- Validation errors
- Execution timeouts
- Cancellation
- Permission errors
- Resource exhaustion

**The executor NEVER retries.** It only marks whether the error IS retryable. The Runner decides whether to actually retry.

---

## 6. Security Requirements

### 6.1 Environment Variable Blocklist

The following environment variables are BLOCKED from tool execution:

```javascript
const BLOCKED_ENV_VARS = [
  // Library injection
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',

  // Runtime modification
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',

  // Shell initialization
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',

  // Regex patterns
  /^LD_/,      // All LD_* variables
  /^DYLD_/,    // All DYLD_* variables
];
```

### 6.2 PATH Restrictions

- On **host execution**: `PATH` modification is FORBIDDEN
- In **Docker sandbox**: custom `PATH` is allowed within container

### 6.3 Network Restrictions

Tools do not have implicit network access. If a tool requires network:
- It must be explicitly declared in tool schema
- Executor does not enforce network policy (that's firewall/sandbox responsibility)

### 6.4 Privilege Requirements

- Executor runs with same privileges as C.3 process
- Executor MUST NOT escalate privileges
- Executor MUST NOT execute setuid binaries
- Docker sandbox uses unprivileged containers

### 6.5 Audit Trail

Every execution MUST be logged to audit trail:

```typescript
interface AuditEntry {
  timestamp: string;        // ISO 8601
  correlationId: string;
  phase: 'BEFORE' | 'AFTER';
  tool: string;
  args: Record<string, unknown>;  // BEFORE only
  result?: ToolExecutionResult;   // AFTER only
  durationMs?: number;            // AFTER only
}
```

Audit entries are append-only. They cannot be modified or deleted by the executor.

---

## 7. Non-Goals

The executor explicitly does NOT implement:

| Feature | Reason | Where It Belongs |
|---------|--------|------------------|
| Retry policy | Executor is single-shot | Runner |
| Exponential backoff | Executor is stateless | Runner |
| LLM integration | Executor is tool-only | Chat layer |
| Tool discovery | Explicit registry only | Registry |
| Orchestration | Executor runs one tool | Workflow engine |
| State persistence | Executor is stateless | Database |
| Result caching | Executor is pure | Cache layer |
| Model selection | Executor doesn't know models | CRE |
| Authentication | Executor uses ambient auth | Auth layer |
| Rate limiting | Executor has no quotas | Gateway |

If any of these features are needed, they MUST be implemented outside the executor.

---

## 8. Invariants

These properties MUST hold at all times:

1. **Single-shot**: One call = one execution = one result
2. **Timeout-enforced**: Every execution has a timeout
3. **Stateless**: Executor holds no state between calls
4. **Audited**: Every execution is logged
5. **Sanitized**: Environment is always sanitized
6. **Bounded**: Execution time ≤ timeoutMs + graceful period
7. **Deterministic**: Same input + same tool = same behavior
8. **No retry**: Executor never retries internally

---

## 9. Implementation Checklist

When implementing `C3ToolExecutor`, verify:

- [ ] Request validation (defense in depth)
- [ ] Timeout timer with AbortController
- [ ] Environment sanitization (blocklist)
- [ ] BEFORE audit log entry
- [ ] Tool execution (sandbox or direct)
- [ ] AFTER audit log entry
- [ ] Result construction
- [ ] No retry logic anywhere
- [ ] No CRE/Planner calls
- [ ] No state between calls

---

## Appendix A: Example Usage

```typescript
const executor = new C3ToolExecutor();

const result = await executor.execute({
  correlationId: 'abc-123',
  tool: 'shell',
  args: { command: 'ls -la' },
  timeoutMs: 30000,
});

// Runner decides retry based on result.retryable
if (result.status === 'error' && result.retryable) {
  // Runner may retry with backoff
}
```

---

## Appendix B: Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-07 | Initial contract |

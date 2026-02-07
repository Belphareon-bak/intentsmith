// Executor Module — Deterministic Execution Layer
// ══════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE ROLE: Agent #3 (Executor)
//   - Executes ONLY canonical plan steps
//   - Shell, FS, HTTP, tool invocations
//   - Sandboxed, audited, deterministic
//   - NEVER interprets intent or modifies plans
//
// ══════════════════════════════════════════════════════════════════════════════

export { toolExecutor, ExecutionStatus } from './tool-executor.js';
export { CircuitBreaker, CircuitState } from './circuit-breaker.js';
export { ToolHealthMonitor, HealthStatus } from './health-monitor.js';

// C3ToolExecutor — Contract v1.0 Implementation (standalone, single-shot)
export { C3ToolExecutor, registerTool, getAuditTrail } from './c3-tool-executor.js';

// Lifecycle Handoff — Barrel re-export
// ══════════════════════════════════════════════════════════════════════════════
// Re-exports from split modules for backwards compatibility.
// All imports from './lifecycle-handoff.js' continue to work unchanged.
//
// Actual code lives in:
//   - lifecycle-state.js      — per-session state management
//   - lifecycle-formatters.js — response formatting
//   - lifecycle-router.js     — phase routing + handlers
// ══════════════════════════════════════════════════════════════════════════════

export { getActiveLifecycleHandoff, cancelLifecycleHandoff } from './lifecycle-state.js';
export { handleLifecycleBuildDetected, handleLifecycleInput } from './lifecycle-router.js';

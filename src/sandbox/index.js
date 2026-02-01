// Sandbox Module — Public API
// ══════════════════════════════════════════════════════════════════════════════

export {
  Capability,
  RiskLevel,
  toolCapabilities,
  getToolCapabilities,
  requiresApproval,
  hasSideEffects,
  getRiskLevel,
  supportsDryRun,
  isPathAllowed,
  listTools,
} from './capabilities.js';

export {
  SandboxedExecutor,
  sandboxedExecutor,
  SandboxMode,
} from './executor.js';

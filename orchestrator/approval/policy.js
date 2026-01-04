export function requiresApproval(step, cfg) {
  if (!cfg.features.approval) return false;

  if (step.type === "shell") {
    return cfg.policies.autoApprove.shell !== "LOW";
  }
  if (step.type === "fs") {
    return cfg.policies.autoApprove.fs !== "LOW";
  }
  return false;
}

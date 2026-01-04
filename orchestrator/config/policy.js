export function shouldAutoApprove(step, cfg) {
  if (!cfg.features.approval) return true;

  if (step.type === "shell") {
    return cfg.policies.autoApprove.shell === "LOW";
  }
  if (step.type === "fs") {
    return cfg.policies.autoApprove.fs === "LOW";
  }
  return false;
}

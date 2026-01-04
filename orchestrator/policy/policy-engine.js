export function requiresApproval(step) {
  return step.risk !== "LOW";
}

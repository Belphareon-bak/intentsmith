export function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    throw new Error("Invalid plan: missing steps[]")
  }
  for (const s of plan.steps) {
    if (s.type !== "shell" && s.type !== "fs") {
      throw new Error("Invalid step type")
    }
    if (s.type === "shell" && typeof s.command !== "string") {
      throw new Error("Invalid shell step")
    }
    if (s.type === "fs" && (!s.action || !s.path)) {
      throw new Error("Invalid fs step")
    }
  }
}

export function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    throw new Error("Invalid plan: missing steps[]")
  }

  for (const step of plan.steps) {
    if (!step.type) {
      throw new Error("Invalid plan step: missing type")
    }

    if (step.type === "shell") {
      if (typeof step.command !== "string") {
        throw new Error("Invalid shell step: missing command")
      }
      continue
    }

    if (step.type === "fs") {
      if (!step.action || !step.path) {
        throw new Error("Invalid fs step")
      }
      continue
    }

    throw new Error("Unknown step type: " + step.type)
  }
}

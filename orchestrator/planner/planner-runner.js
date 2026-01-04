import { validatePlan } from "./plan-schema.js"
import { runPlannerLLM } from "./planner-llm.js"

function normalizeStep(step) {
  // shell string
  if (typeof step === "string") {
    return {
      type: "shell",
      command: step,
      cwd: "sandbox"
    }
  }

  // { command, arguments?, description? }
  if (step.command) {
    const args = Array.isArray(step.arguments)
      ? " " + step.arguments.join(" ")
      : ""

    return {
      type: "shell",
      command: step.command + args,
      cwd: "sandbox",
      description: step.description
    }
  }

  // fs step (future)
  if (step.action) {
    return {
      type: "fs",
      action: step.action,
      path: step.path,
      content: step.content,
      description: step.description
    }
  }

  throw new Error("Unnormalizable planner step: " + JSON.stringify(step))
}

export async function runPlanner(prompt, cfg = {}) {
  const rawPlan = await runPlannerLLM(prompt, cfg)

  if (!rawPlan || !Array.isArray(rawPlan.steps)) {
    throw new Error("Planner returned invalid raw plan")
  }

  const plan = {
    steps: rawPlan.steps.map(normalizeStep)
  }

  validatePlan(plan)
  return plan
}

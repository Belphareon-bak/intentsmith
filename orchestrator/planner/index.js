import { validatePlan } from "./plan-schema.js"
import { leadPlan } from "./lead-planner.js"

/**
 * Public planner API
 * Runtime MUST import ONLY this file.
 */
export async function plan(prompt, options = {}) {
  const raw = await leadPlan(prompt, options)

  if (!raw || !Array.isArray(raw.steps)) {
    throw new Error("Planner returned invalid plan (missing steps[])")
  }

  // leadPlan is expected to already return canonical steps,
  // but we validate again here to harden the boundary.
  const plan = { steps: raw.steps }

  validatePlan(plan)
  return plan
}

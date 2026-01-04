import { runPlanner } from "./planner-runner.js";

export async function leadPlan(goal, cfg = {}) {
  // planner-runner garantuje { steps[] }
  return await runPlannerRunner(goal, cfg);
}

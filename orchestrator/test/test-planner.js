import { runPlanner } from "../planner/planner-runner.js";

const SANDBOX = "/home/belphareon/Projects/copilot-orchestrator/sandbox";

(async () => {
  await runPlannerRunner("Create demo files", { sandbox: SANDBOX });
  console.log("PLANNER DONE");
})();

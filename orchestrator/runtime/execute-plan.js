import { emit } from "./event-bus.js";
import { executeStep } from "../executors/step-executor.js";

export async function executePlan(steps) {
  for (const step of steps) {
    if (step.type === "approval_required") {
      emit({
        type: "approval_request",
        name: "approval_required",
        reason: step.description,
        step
      });
      return;
    }

    await executeStep(step);
  }

  emit({
    type: "plan_done",
    name: "plan_done"
  });
}

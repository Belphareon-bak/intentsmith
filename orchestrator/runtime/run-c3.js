import { plan as planPrompt } from "../planner2/index.js";
import { executeStep } from "../executors/step-executor.js";

import {
  createExecution,
  loadExecution,
  updateMeta,
  saveProgress,
  appendEvent,
} from "./state/state-store-exec.js";

/**
 * runC3
 * - buď plánuje z promptu
 * - nebo vykoná explicitní kroky
 */
export async function runC3({
  prompt = null,
  steps = null,
  sandboxRoot = process.cwd() + "/sandbox",
}) {
  let planResult;

  // 1) PLAN (jen pokud nejsou kroky dodány)
  if (steps) {
    planResult = { steps };
  } else {
    planResult = await planPrompt(prompt);
  }

  if (!planResult || !Array.isArray(planResult.steps)) {
    throw new Error("Invalid plan (no steps)");
  }

  // 2) CREATE EXECUTION
  const executionId = createExecution({
    sandboxRoot,
    plan: planResult,
  });

  updateMeta(executionId, { status: "running" });
  appendEvent(executionId, "EXECUTION_STARTED");

  // 3) LOAD STATE
  const execution = loadExecution(executionId);
  const execSteps = execution.plan.steps;
  const progress = execution.progress;

  // 4) EXECUTE
  for (let i = progress.current_step; i < execSteps.length; i++) {
    progress.current_step = i;
    appendEvent(executionId, `STEP_START ${i}`);

    try {
      await executeStep(execSteps[i], {});
    } catch (err) {
      appendEvent(executionId, `STEP_FAILED ${i}`);
      updateMeta(executionId, { status: "failed" });
      throw err;
    }

    progress.completed_steps.push(i);
    saveProgress(executionId, progress);
    appendEvent(executionId, `STEP_DONE ${i}`);
  }

  // 5) DONE
  updateMeta(executionId, { status: "done" });
  appendEvent(executionId, "EXECUTION_DONE");

  return { executionId };
}

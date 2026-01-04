import fs from "fs";
import path from "path";

const EXEC_ROOT = path.resolve(
  process.cwd(),
  "orchestrator/runtime/state/executions"
);

/**
 * Returns snapshot used by UI / SSE replay.
 * Authoritative, read-only.
 */
export function loadExecutionSnapshot(executionId) {
  const execDir = path.join(EXEC_ROOT, executionId);
  if (!fs.existsSync(execDir)) return null;

  const metaPath = path.join(execDir, "meta.json");
  const progressPath = path.join(execDir, "progress.json");
  const planPath = path.join(execDir, "plan.json");

  if (!fs.existsSync(metaPath) || !fs.existsSync(progressPath)) {
    return null;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));

  let totalSteps = null;
  if (fs.existsSync(planPath)) {
    try {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
      totalSteps = Array.isArray(plan.steps) ? plan.steps.length : null;
    } catch {
      totalSteps = null;
    }
  }

  const isTerminal =
    meta.status === "done" ||
    meta.status === "failed" ||
    meta.status === "cancelled";

  return {
    meta,
    progress: {
      current_step: progress.current_step,
      completed_steps: progress.completed_steps
    },
    total_steps: totalSteps,
    is_terminal: isTerminal
  };
}

/**
 * Returns execution event log lines for SSE replay.
 */
export function loadExecutionEvents(executionId) {
  const eventsPath = path.join(
    EXEC_ROOT,
    executionId,
    "events.log"
  );

  if (!fs.existsSync(eventsPath)) return [];

  return fs
    .readFileSync(eventsPath, "utf-8")
    .split("\n")
    .filter(Boolean);
}

import fs from "fs";
import path from "path";

const STATE_DIR = path.resolve(
  process.cwd(),
  "orchestrator/runtime/state/executions"
);

let execution = null;

export function startExecution({ steps, context, autoApproved = 0 }) {
  execution = {
    steps,
    context,
    index: 0,
    autoApproved,
    waitingForApproval: false,
    status: "running"
  };
}

export function getExecutionState() {
  return execution;
}

export function advanceExecution() {
  if (!execution) return;
  execution.index += 1;
}

export function markWaitingForApproval(type, stepIndex) {
  if (!execution) return;
  execution.waitingForApproval = { type, stepIndex };
}

export function clearApprovalState() {
  if (!execution) return;
  execution.waitingForApproval = false;
}

export function markDone() {
  if (!execution) return;
  execution.status = "done";
}

export function markExecutionFailed() {
  if (!execution) return;
  execution.status = "failed";
}

export function clearExecution() {
  execution = null;
}

export function restoreExecution() {
  // zatím jednoduché: restore NEimplementujeme
  return execution;
}

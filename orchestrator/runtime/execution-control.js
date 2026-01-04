let paused = false;
let cancelled = false;
let lastFailedStepIndex = null;

export function pauseExecution() {
  paused = true;
}

export function resumeExecutionFlag() {
  paused = false;
}

export function cancelExecution() {
  cancelled = true;
}

export function isPaused() {
  return paused;
}

export function isCancelled() {
  return cancelled;
}

export function markFailed(index) {
  lastFailedStepIndex = index;
}

export function consumeFailedIndex() {
  const i = lastFailedStepIndex;
  lastFailedStepIndex = null;
  return i;
}

export function resetControlFlags() {
  paused = false;
  cancelled = false;
  lastFailedStepIndex = null;
}

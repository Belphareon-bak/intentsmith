const TRANSITIONS = {
  created: ["running"],
  running: ["waiting_for_approval", "paused", "failed", "done"],
  waiting_for_approval: ["running"],
  paused: ["running"],
  failed: [],
  done: []
};

export function canTransition(from, to) {
  if (!from || !to) return false;
  return TRANSITIONS[from]?.includes(to) || false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Invalid execution state transition: ${from} -> ${to}`);
    err.code = "INVALID_EXECUTION_STATE";
    throw err;
  }
}

import { executionPolicy } from "./execution-policy.js";
import { isPrivilegedMode } from "./privileged-state.js";

export function validateProposedSteps(steps = []) {
  const privileged = isPrivilegedMode();

  return steps.map(step => {
    let requiresApproval = false;
    let reasons = [];

    if (step.details?.path) {
      for (const p of executionPolicy.forbiddenPaths) {
        if (step.details.path.startsWith(p)) {
          if (!privileged) {
            requiresApproval = true;
            reasons.push(`Writes outside sandbox: ${p}`);
          }
        }
      }
    }

    if (step.details?.command) {
      for (const c of executionPolicy.forbiddenCommands) {
        if (step.details.command.includes(c)) {
          if (!privileged) {
            requiresApproval = true;
            reasons.push(`Privileged command: ${c}`);
          }
        }
      }
    }

    return {
      ...step,
      requiresApproval,
      approvalReasons: reasons
    };
  });
}

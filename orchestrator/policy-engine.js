import path from "path";

export const Decision = {
  AUTO: "auto",
  ASK: "ask",
  DENY: "deny"
};

const SHELL_AUTO = [
  /^mkdir\b/,
  /^ls\b/,
  /^cat\b/,
  /^echo\b/,
  /^pwd\b/
];

const SHELL_DENY = [
  /rm\s+-rf\s+\//,
  /^sudo\b/,
  /mkfs/,
  /dd\b/
];

export function evaluateShell({ command, cwd }) {
  for (const rule of SHELL_DENY) {
    if (rule.test(command)) {
      return { decision: Decision.DENY, reason: "dangerous shell command" };
    }
  }

  for (const rule of SHELL_AUTO) {
    if (rule.test(command)) {
      return { decision: Decision.AUTO };
    }
  }

  return { decision: Decision.ASK };
}

export function evaluateFs({ filePath, sandboxRoot }) {
  const resolved = path.resolve(filePath);
  const sandbox = path.resolve(sandboxRoot);

  if (!resolved.startsWith(sandbox)) {
    return { decision: Decision.DENY, reason: "outside sandbox" };
  }

  // Zápis do sandboxu je bezpečný, ale informativní
  return { decision: Decision.ASK };
}

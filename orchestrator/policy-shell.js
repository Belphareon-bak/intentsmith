const FORBIDDEN = [
  /sudo/,
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+/,
  />\s*\/etc/,
];

export function validateShell({ command, cwd, sandboxRoot }) {
  if (!cwd.startsWith(sandboxRoot)) {
    throw new Error("Shell cwd outside sandbox");
  }

  for (const rule of FORBIDDEN) {
    if (rule.test(command)) {
      throw new Error(`Forbidden shell command: ${command}`);
    }
  }

  return true;
}

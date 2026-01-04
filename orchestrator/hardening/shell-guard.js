const ALLOW = [
  "mkdir",
  "ls",
  "cat",
  "echo",
  "pwd",
  "touch",
  "cp",
  "mv",
  "rm",
  "printf"
];

export function assertShellSafe(command) {
  // DEV MODE: neblokuj (testy, lokální vývoj)
  if ((process.env.C3_MODE || "dev") === "dev") {
    return;
  }

  if (typeof command !== "string" || !command.trim()) {
    throw new Error("Shell guard: empty command");
  }

  const cmd = command.trim().split(/\s+/)[0];

  if (!ALLOW.includes(cmd)) {
    throw new Error("Shell guard: command not allowlisted");
  }
}

import { spawn } from "node:child_process";
import path from "node:path";
import { emit } from "../runtime/event-bus.js";
import { isPrivilegedMode } from "../runtime/privileged-state.js";

const ALLOWLIST = [
  "docker",
  "docker-compose",
  "docker compose",
  "npm",
  "node",
  "git",
  "mkdir",
  "ls",
  "cat",
  "echo"
];

function isAllowed(cmd) {
  return ALLOWLIST.some(a => cmd === a || cmd.startsWith(a + " "));
}

export async function runShell({ command }, sandboxRoot) {
  if (!isAllowed(command)) {
    if (!isPrivilegedMode()) {
      throw new Error(`Command not allowlisted: ${command}`);
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: sandboxRoot,
      shell: true,
      env: process.env
    });

    child.stdout.on("data", d => {
      emit({ type: "shell_stdout", chunk: d.toString() });
    });

    child.stderr.on("data", d => {
      emit({ type: "shell_stderr", chunk: d.toString() });
    });

    child.on("close", code => {
      emit({ type: "shell_exit", code });
      if (code === 0) resolve();
      else reject(new Error(`Shell exited with code ${code}`));
    });
  });
}

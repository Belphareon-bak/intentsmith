import { exec } from "child_process";
import { assertShellSafe } from "../hardening/shell-guard.js";
import { LIMITS } from "../hardening/limits.js";

export function execShell(step) {
  return new Promise((resolve, reject) => {
    let cmd = step.command;

    if (cmd.startsWith("mkdir ") && !cmd.includes("-p")) {
      cmd = cmd.replace(/^mkdir\s+/, "mkdir -p ");
    }

    assertShellSafe(cmd);

    exec(
      cmd,
      {
        cwd: step.cwd || process.cwd(),
        timeout: LIMITS.SHELL_TIMEOUT_MS,
        shell: "/bin/bash"
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      }
    );
  });
}

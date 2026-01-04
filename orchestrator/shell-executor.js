import { exec } from "child_process";
import { approvalManager } from "./approval-manager.js";

export async function runShellCommand({ command, cwd }) {
  const ok = await approvalManager.request({
    preview: { type: "shell", command, cwd, risk: "LOW" }
  });
  if (!ok) throw new Error("Shell denied");

  return new Promise((resolve, reject) =>
    exec(command, { cwd }, (e, out, err) =>
      e ? reject(e) : resolve({ out, err })
    )
  );
}

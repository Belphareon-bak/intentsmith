import fs from "fs";
import path from "path";
import { appendEvent, updateMeta } from "./state-store-exec.js";

const EXEC_ROOT = path.resolve("orchestrator/runtime/state/executions");

export function recoverExecutionsOnBoot() {
  if (!fs.existsSync(EXEC_ROOT)) {
    return;
  }

  const executionIds = fs.readdirSync(EXEC_ROOT);

  for (const executionId of executionIds) {
    const execDir = path.join(EXEC_ROOT, executionId);
    const metaPath = path.join(execDir, "meta.json");

    if (!fs.existsSync(metaPath)) continue;

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

    if (meta.status === "running") {
      updateMeta(executionId, { status: "paused" });
      appendEvent(
        executionId,
        "AUTO_PAUSED_ON_BOOT"
      );
    }
  }
}

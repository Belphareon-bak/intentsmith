import fs from "fs/promises";
import path from "path";
import { approvalManager } from "./approval-manager.js";

export async function approveFsWrite({ filePath, newContent }) {
  const ok = await approvalManager.request({
    preview: {
      type: "fs",
      path: filePath,
      diff: newContent,
      risk: "HIGH"   // ← VYNUTÍ UI
    }
  });

  if (!ok) throw new Error("FS denied");

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, newContent);
}

import fs from "node:fs";
import path from "node:path";
import { emit } from "../runtime/event-bus.js";

export function writeFileSandboxed({ path: targetPath, content }, sandboxRoot) {
  const resolved = path.resolve(sandboxRoot, targetPath);
  if (!resolved.startsWith(sandboxRoot)) {
    throw new Error("FS write outside sandbox is not allowed");
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);

  emit({
    type: "fs_write",
    name: "fs_write",
    path: resolved,
    bytes: Buffer.byteLength(content || "")
  });
}

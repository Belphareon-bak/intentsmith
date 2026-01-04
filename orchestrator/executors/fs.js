import fs from "fs/promises";
import path from "path";

function normalizeAction(action) {
  switch (action) {
    case "createFolder":
    case "create_folder":
    case "create_directory":
      return "mkdir";

    case "createFile":
    case "create_file":
    case "write_file":
      return "write";

    default:
      return null;
  }
}

export async function execFs(step, sandboxRoot) {
  if (!step?.path) {
    throw new Error("execFs: missing path");
  }

  const sandbox = path.resolve(sandboxRoot);

  // 🔑 KLÍČOVÁ OPRAVA:
  // vezmeme JEN basename cílové složky
  const parts = step.path.split("/").filter(Boolean);
  const baseDir = parts[parts.length - (step.action.includes("file") ? 2 : 1)];
  const fileName = step.action.includes("file") ? parts.at(-1) : null;

  const target = fileName
    ? path.join(sandbox, baseDir, fileName)
    : path.join(sandbox, baseDir);

  console.log("FS WRITE →", target);

  if (!target.startsWith(sandbox)) {
    throw new Error("FS guard: escape");
  }

  const action = normalizeAction(step.action);
  if (!action) {
    throw new Error("execFs: unknown action " + step.action);
  }

  if (action === "mkdir") {
    await fs.mkdir(target, { recursive: true });
    return;
  }

  if (action === "write") {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, step.content ?? "", "utf8");
    return;
  }
}

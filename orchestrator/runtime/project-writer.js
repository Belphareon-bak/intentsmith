import fs from "node:fs";
import path from "node:path";
import { getLastProject } from "./project-registry.js";
import { loadProjectState } from "./project-state.js";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function writeSessionCheckpoint() {
  const project = getLastProject();
  if (!project) {
    throw new Error("No active project");
  }

  const state = loadProjectState(project);
  if (!state) {
    throw new Error("Project state not found");
  }

  const projectDir = path.resolve("projects", project);
  ensureDir(projectDir);

  const sessionContextPath = path.join(projectDir, "session-context.md");
  const workingProgressPath = path.join(projectDir, "working-progress.md");

  const sessionContext = `
# Session context

project: ${project}

goal:
${state.goal || "not defined"}

constraints:
${(state.constraints || []).join(", ")}

style:
- explicit approval
- no implicit writes
- deterministic execution
`.trim() + "\n";

  const workingProgress = `
# Working progress

status: ${state.status || "unknown"}

last plan:
${state.lastPlan || "n/a"}

notes:
${state.notes || ""}
`.trim() + "\n";

  fs.writeFileSync(sessionContextPath, sessionContext, "utf-8");
  fs.writeFileSync(workingProgressPath, workingProgress, "utf-8");

  return {
    project,
    files: [
      "session-context.md",
      "working-progress.md"
    ]
  };
}

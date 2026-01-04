import fs from "fs";
import path from "path";
import { emit } from "../runtime/event-bus.js";
import {
  getProjectPath,
  getLastProject
} from "../runtime/project-registry.js";

export async function runDesign(step, context = {}) {
  const projectName =
    step.project ||
    context.project ||
    getLastProject();

  if (!projectName) {
    throw new Error("Design step requires active project");
  }

  const projectDir = getProjectPath(projectName);
  const decisionsPath = path.join(projectDir, "decisions.md");

  fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });

  emit({ type: "design_start", project: projectName });

  const content = `# Design Decisions

## Context
${JSON.stringify(context.analysis || {}, null, 2)}

## Decision
Conceptual design generated successfully.
`;

  fs.writeFileSync(decisionsPath, content, "utf-8");

  emit({
    type: "design_done",
    artifact: "decisions.md",
    path: decisionsPath
  });

  return {
    artifact: "decisions.md",
    path: decisionsPath
  };
}

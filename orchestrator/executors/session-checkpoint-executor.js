import fs from "fs";
import path from "path";
import { emit } from "../runtime/event-bus.js";
import { callLLM } from "../llm/llm-client.js";
import { getProjectPath } from "../runtime/project-registry.js";

export async function runSessionCheckpoint(context = {}) {
  const projectPath = getProjectPath();
  if (!projectPath) throw new Error("No active project");

  const wpPath = path.join(projectPath, "working-progress.md");

  emit({ type: "session_checkpoint_start" });

  const prompt = `
You are maintaining a project working progress snapshot.

TASK:
Summarize the CURRENT STATE of the project.

INPUTS:
GOAL:
${context.build?.goal || ""}

DECISIONS:
${context.design || ""}

RECENT ACTIVITY:
${context.recentActivity || ""}

RULES:
- Be concise
- Human-readable
- Focus on what is DONE, IN PROGRESS, and NEXT
- Markdown output
`;

  const text = await callLLM({
    system: "You summarize project state.",
    user: prompt
  });

  fs.writeFileSync(
    wpPath,
    `# Working Progress\n\n${text}\n`,
    "utf-8"
  );

  emit({ type: "session_checkpoint_done", path: wpPath });

  return { ok: true };
}

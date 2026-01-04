import fs from "fs";
import path from "path";
import { plan } from "./index.js";

export async function planFromBuild(buildId, { project }) {
  if (!buildId) {
    throw new Error("buildId required");
  }
  if (!project || !project.path) {
    throw new Error("project context required");
  }

  const buildPath = path.join(
    project.path,
    "build-requests",
    buildId
  );

  if (!fs.existsSync(buildPath)) {
    throw new Error(`Build request not found: ${buildId}`);
  }

  const buildRequest = JSON.parse(
    fs.readFileSync(buildPath, "utf-8")
  );

  const plannerPrompt = `
You are a planner agent.

Convert the following BUILD REQUEST into a canonical execution plan.

Rules:
- Do NOT execute anything
- Do NOT invent steps
- Output STRICT JSON: { "steps": [...] }

BUILD REQUEST:
${JSON.stringify(buildRequest, null, 2)}
`;

  const result = await plan(plannerPrompt);

  if (!result || !Array.isArray(result.steps)) {
    throw new Error("Planner returned invalid plan");
  }

  return { steps: result.steps };
}

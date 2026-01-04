import fs from "fs";
import path from "node:path";
import { plan } from "../planner2/index.js";
import { emit } from "./event-bus.js";
import { getActiveProjectPath } from "./project-registry.js";

const PLANNER_TIMEOUT_MS = 30000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Planner timeout")), ms)
    )
  ]);
}

export async function handlePlanFromBuild(req, res) {
  let body = "";

  req.on("data", c => body += c);

  req.on("end", async () => {
    try {
      // 🔴 HARD DEBUG — MUST PRINT IF THIS HANDLER IS USED
      console.log("[PLAN_FROM_BUILD] RAW BODY =", body);

      const { buildId } = JSON.parse(body);

      if (!buildId) {
        res.writeHead(400);
        return res.end("buildId required");
      }

      const projectPath = getActiveProjectPath();

      if (!projectPath) {
        res.writeHead(500);
        return res.end("No active project");
      }

      const buildPath = path.join(
        projectPath,
        "build-requests",
        buildId
      );

      if (!fs.existsSync(buildPath)) {
        res.writeHead(404);
        return res.end("build request not found");
      }

      const buildRequest = JSON.parse(
        fs.readFileSync(buildPath, "utf-8")
      );

      emit({
        type: "plan_start",
        buildId,
        project: path.basename(projectPath),
        goal: buildRequest.goal
      });

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

      const result = await withTimeout(
        plan(plannerPrompt),
        PLANNER_TIMEOUT_MS
      );

      if (!result || !Array.isArray(result.steps)) {
        throw new Error("Planner returned invalid plan");
      }

      emit({
        type: "plan_ready",
        buildId,
        steps: result.steps
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "PLAN_READY",
        steps: result.steps
      }, null, 2));
    } catch (err) {
      emit({
        type: "plan_error",
        message: String(err.message || err)
      });
      res.writeHead(500);
      res.end(String(err.message || err));
    }
  });
}

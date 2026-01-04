import http from "http";
import fs from "fs";
import path from "path";
import { emit, addClient } from "./event-bus.js";

import {
  listProjects,
  setActiveProject,
  getLastProject,
  getProjectPath
} from "./project-registry.js";

import { validateBuildRequest } from "../build/build-store.js";
import { planFromBuild } from "../planner2/plan-from-build.js";
import {
  executeWithAutoApproval,
  resumeExecution,
  approveExecution,
  rejectExecution,
  getCurrentExecutionId
} from "./execution-controller.js";

import {
  loadExecutionSnapshot,
  loadExecutionEvents
} from "./state/execution-inspect.js";

import { loadProjectState } from "./project-state.js";

/* ---------------- helpers ---------------- */

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => resolve(body));
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

function text(res, code, msg) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(msg);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

/* ---------------- server ---------------- */

export function startRunServer(port = 3335) {
  const server = http.createServer(async (req, res) => {
    cors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      return res.end();
    }

    try {

      /* ===== SSE ===== */
      if (req.method === "GET" && req.url.startsWith("/run/stream")) {
        const url = new URL(req.url, "http://localhost");
        const executionId = url.searchParams.get("executionId");

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });

        res.write(": connected\n\n");
        res.socket?.setTimeout(0);
        addClient(res);

        if (executionId) {
          const snapshot = loadExecutionSnapshot(executionId);
          if (snapshot) {
            res.write(`data: ${JSON.stringify({
              type: "execution_snapshot",
              executionId,
              ...snapshot
            })}\n\n`);

            const events = loadExecutionEvents(executionId);
            for (const line of events) {
              res.write(`data: ${JSON.stringify({
                type: "execution_event",
                line
              })}\n\n`);
            }
          }
        }
        return;
      }

      /* ===== PROJECT ===== */
      if (req.method === "GET" && req.url === "/project/list") {
        return json(res, 200, { projects: listProjects() });
      }

      if (req.method === "GET" && req.url === "/project/active") {
        return json(res, 200, { activeProject: getLastProject() });
      }

      if (req.method === "POST" && req.url === "/session/start") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { mode, projectName } = body;

        if (mode === "last") {
          const last = getLastProject();
          if (!last) return text(res, 400, "No last project");
          setActiveProject(last);
        } else if (mode === "new" || mode === "select") {
          if (!projectName) return text(res, 400, "projectName required");
          setActiveProject(projectName);
        } else {
          return text(res, 400, "Invalid mode");
        }

        emit({ type: "project_selected", project: getLastProject() });
        return json(res, 200, {
          activeProject: getLastProject(),
          projects: listProjects()
        });
      }

      /* ===== BUILD ===== */
      if (req.method === "POST" && req.url === "/build/request") {
        const body = JSON.parse(await readBody(req) || "{}");
        validateBuildRequest(body);

        const projectName = getLastProject();
        if (!projectName) return text(res, 400, "No active project");

        const projectPath = getProjectPath(projectName);
        const buildDir = path.join(projectPath, "build-requests");
        fs.mkdirSync(buildDir, { recursive: true });

        const buildId = `build-${Date.now()}.json`;
        fs.writeFileSync(
          path.join(buildDir, buildId),
          JSON.stringify(body, null, 2)
        );

        emit({ type: "build_created", project: projectName, buildId });
        return json(res, 200, { buildId });
      }

      /* ===== PLAN ===== */
if (req.method === "POST" && req.url === "/plan/from-build") {
  const body = JSON.parse(await readBody(req) || "{}");
  const { buildId } = body;

  const projectName = getLastProject();
  if (!projectName) {
    return text(res, 400, "No active project");
  }

  const projectPath = getProjectPath(projectName);
  const project = {
    name: projectName,
    path: projectPath
  };

  emit({ type: "plan_start", buildId, project: projectName });

  const result = await planFromBuild(buildId, { project });
	
  // ✅ CRITICAL: persist plan into project state
  const stateDir = path.join(projectPath, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  fs.writeFileSync(
    path.join(stateDir, "plan.json"),
    JSON.stringify(result, null, 2),
    "utf-8"
  );

  emit({ type: "plan_ready", buildId, steps: result.steps });
  return json(res, 200, result);
}
      /* ===== EXECUTION (FIXED, AUTHORITATIVE) ===== */
      if (req.method === "POST" && req.url === "/execute/plan") {
        const projectName = getLastProject();
        if (!projectName) return text(res, 400, "No active project");

        const projectState = loadProjectState(projectName);
        if (!projectState?.plan?.steps?.length) {
          return text(res, 400, "No plan available for execution");
        }

        emit({ type: "execution_start" });

        await executeWithAutoApproval(
          projectState.plan.steps,
          projectState.context || {}
        );

        return text(res, 200, "EXECUTION_STARTED");
      }

      if (req.method === "POST" && req.url === "/execution/resume") {
        const body = JSON.parse(await readBody(req) || "{}");
        await resumeExecution(body.executionId);
        return text(res, 200, "RESUMED");
      }

      /* ===== APPROVAL ===== */
      if (req.method === "POST" && req.url === "/execution/approve") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { executionId, data } = body;
        
        if (!executionId) {
          return text(res, 400, "executionId required");
        }
        
        await approveExecution(executionId, data || {});
        return json(res, 200, { status: "approved", executionId });
      }

      if (req.method === "POST" && req.url === "/execution/reject") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { executionId, reason } = body;
        
        if (!executionId) {
          return text(res, 400, "executionId required");
        }
        
        rejectExecution(executionId, reason || "User rejected");
        return json(res, 200, { status: "rejected", executionId });
      }

      /* ===== EXECUTION STATUS ===== */
      if (req.method === "GET" && req.url.startsWith("/execution/")) {
        const executionId = req.url.split("/execution/")[1];
        
        if (!executionId) {
          return text(res, 400, "executionId required");
        }
        
        const snapshot = loadExecutionSnapshot(executionId);
        if (!snapshot) {
          return text(res, 404, "Execution not found");
        }
        
        return json(res, 200, snapshot);
      }

      if (req.method === "GET" && req.url === "/execution/current") {
        const currentId = getCurrentExecutionId();
        if (!currentId) {
          return json(res, 200, { executionId: null, status: "no_active_execution" });
        }
        
        const snapshot = loadExecutionSnapshot(currentId);
        return json(res, 200, { executionId: currentId, ...snapshot });
      }

      res.writeHead(404);
      res.end("NOT_FOUND");

    } catch (err) {
      console.error("RUN SERVER ERROR:", err);
      emit({ type: "run_error", message: String(err.message || err) });
      res.writeHead(500);
      res.end("ERR");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("C.3 run server on 127.0.0.1:" + port);
  });
}

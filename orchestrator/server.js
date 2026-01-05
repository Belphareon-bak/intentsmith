/**
 * C.3 Unified Server
 * 
 * Kompletní HTTP server integrující všechny komponenty:
 * - Agent API
 * - Tools API
 * - Memory API
 * - Project API
 * - Execution API
 * - SSE Events
 */

import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

// Core imports
import { emit, addClient } from "./runtime/event-bus.js";
import { handleAgentRequest } from "./agent/agent-api.js";
import { handleChatRequest } from "./agent/chat-api.js";
import { toolRegistry, executeTool } from "./tools/index.js";
import { agentMemory } from "./memory/memory-store.js";
import { userProfile } from "./memory/user-profile.js";
import { serverLog } from "./utils/logger.js";

// Execution imports
import {
  executeWithAutoApproval,
  resumeExecution,
  approveExecution,
  rejectExecution,
  getCurrentExecutionId
} from "./runtime/execution-controller.js";

import { loadExecutionSnapshot, loadExecutionEvents } from "./runtime/state/execution-inspect.js";

// Project imports
import {
  listProjects,
  setActiveProject,
  getLastProject,
  getProjectPath
} from "./runtime/project-registry.js";

import { loadProjectState } from "./runtime/project-state.js";
import { planFromBuild } from "./planner2/plan-from-build.js";
import { validateBuildRequest } from "./build/build-store.js";

/* ============== HELPERS ============== */

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
}

function parseQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams) {
    query[key] = value;
  }
  return query;
}

/* ============== STATIC FILES ============== */

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/* ============== SERVER ============== */

export function startServer(port = 3335) {
  const server = http.createServer(async (req, res) => {
    cors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      return res.end();
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;
    const query = parseQuery(url);
    
    // Log request (skip static files and stream)
    if (!pathname.startsWith("/stream") && !pathname.includes(".")) {
      serverLog.info(`${req.method} ${pathname}`);
    }

    try {
      /* ============== SSE STREAM ============== */
      if (req.method === "GET" && pathname === "/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });

        res.write(": connected\n\n");
        res.socket?.setTimeout(0);
        addClient(res);

        // Send initial state if executionId provided
        const executionId = query.executionId;
        if (executionId) {
          const snapshot = loadExecutionSnapshot(executionId);
          if (snapshot) {
            res.write(`data: ${JSON.stringify({
              type: "execution_snapshot",
              executionId,
              ...snapshot
            })}\n\n`);
          }
        }
        return;
      }

      /* ============== AGENT API ============== */
      if (pathname.startsWith("/agent")) {
        const body = req.method !== "GET" ? JSON.parse(await readBody(req) || "{}") : {};
        const result = await handleAgentRequest(req.method, pathname, body, query);
        const httpCode = typeof result.status === 'number' ? result.status : 200;
        return json(res, httpCode, result);
      }

      /* ============== CHAT API (NEW) ============== */
      if (pathname.startsWith("/chat") && !pathname.includes(".")) {
        const body = req.method !== "GET" ? JSON.parse(await readBody(req) || "{}") : {};
        const result = await handleChatRequest(req.method, pathname, body, query);
        return json(res, result.error ? 400 : 200, result);
      }

      /* ============== TOOLS API ============== */
      if (req.method === "GET" && pathname === "/tools") {
        return json(res, 200, {
          tools: toolRegistry.getToolDescriptions(),
          categories: toolRegistry.getCategories()
        });
      }

      if (req.method === "POST" && pathname === "/tools/execute") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { tool, params = {}, workdir } = body;
        
        if (!tool) {
          return json(res, 400, { error: "Tool name required" });
        }

        const result = await executeTool(tool, params, {
          workdir: workdir || process.cwd()
        });
        
        return json(res, 200, result);
      }

      /* ============== MEMORY API ============== */
      if (req.method === "GET" && pathname === "/memory") {
        if (query.search) {
          return json(res, 200, agentMemory.search(query.search));
        }
        return json(res, 200, agentMemory.getStats());
      }

      if (req.method === "POST" && pathname === "/memory") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { key, value, persistent, tags } = body;
        const id = agentMemory.remember(key, value, { persistent, tags });
        return json(res, 200, { id, key });
      }

      /* ============== PROFILE API ============== */
      if (req.method === "GET" && pathname === "/profile") {
        return json(res, 200, userProfile.getAll());
      }

      if (req.method === "POST" && pathname === "/profile") {
        const body = JSON.parse(await readBody(req) || "{}");
        userProfile.update(body);
        return json(res, 200, userProfile.getAll());
      }

      /* ============== PROJECT API ============== */
      if (req.method === "GET" && pathname === "/projects") {
        return json(res, 200, { 
          projects: listProjects(),
          active: getLastProject()
        });
      }

      if (req.method === "POST" && pathname === "/projects/select") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { project } = body;
        
        if (!project) {
          return json(res, 400, { error: "Project name required" });
        }

        setActiveProject(project);
        emit({ type: "project_selected", project });
        
        return json(res, 200, { 
          active: getLastProject(),
          projects: listProjects()
        });
      }

      if (req.method === "GET" && pathname === "/projects/state") {
        const project = query.project || getLastProject();
        if (!project) {
          return json(res, 400, { error: "No active project" });
        }
        
        const state = loadProjectState(project);
        return json(res, 200, state || {});
      }

      /* ============== BUILD API ============== */
      if (req.method === "POST" && pathname === "/build/request") {
        const body = JSON.parse(await readBody(req) || "{}");
        validateBuildRequest(body);

        const projectName = getLastProject();
        if (!projectName) {
          return json(res, 400, { error: "No active project" });
        }

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

      /* ============== PLAN API ============== */
      if (req.method === "POST" && pathname === "/plan/from-build") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { buildId } = body;

        const projectName = getLastProject();
        if (!projectName) {
          return json(res, 400, { error: "No active project" });
        }

        const projectPath = getProjectPath(projectName);
        emit({ type: "plan_start", buildId, project: projectName });

        const result = await planFromBuild(buildId, {
          project: { name: projectName, path: projectPath }
        });

        // Save plan
        const stateDir = path.join(projectPath, "state");
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(
          path.join(stateDir, "plan.json"),
          JSON.stringify(result, null, 2)
        );

        emit({ type: "plan_ready", buildId, steps: result.steps });
        return json(res, 200, result);
      }

      /* ============== EXECUTION API ============== */
      if (req.method === "POST" && pathname === "/execute/plan") {
        const projectName = getLastProject();
        if (!projectName) {
          return json(res, 400, { error: "No active project" });
        }

        const projectState = loadProjectState(projectName);
        if (!projectState?.plan?.steps?.length) {
          return json(res, 400, { error: "No plan available" });
        }

        emit({ type: "execution_start" });

        const executionId = await executeWithAutoApproval(
          projectState.plan.steps,
          projectState.context || {}
        );

        return json(res, 200, { executionId, status: "started" });
      }

      if (req.method === "POST" && pathname === "/execution/resume") {
        const body = JSON.parse(await readBody(req) || "{}");
        await resumeExecution(body.executionId);
        return json(res, 200, { status: "resumed" });
      }

      if (req.method === "POST" && pathname === "/execution/approve") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { executionId, data } = body;
        
        if (!executionId) {
          return json(res, 400, { error: "executionId required" });
        }
        
        await approveExecution(executionId, data || {});
        return json(res, 200, { status: "approved", executionId });
      }

      if (req.method === "POST" && pathname === "/execution/reject") {
        const body = JSON.parse(await readBody(req) || "{}");
        const { executionId, reason } = body;
        
        if (!executionId) {
          return json(res, 400, { error: "executionId required" });
        }
        
        rejectExecution(executionId, reason || "User rejected");
        return json(res, 200, { status: "rejected", executionId });
      }

      if (req.method === "GET" && pathname.startsWith("/execution/")) {
        const executionId = pathname.split("/execution/")[1];
        
        if (executionId === "current") {
          const currentId = getCurrentExecutionId();
          if (!currentId) {
            return json(res, 200, { executionId: null, status: "no_active" });
          }
          const snapshot = loadExecutionSnapshot(currentId);
          return json(res, 200, { executionId: currentId, ...snapshot });
        }
        
        const snapshot = loadExecutionSnapshot(executionId);
        if (!snapshot) {
          return json(res, 404, { error: "Execution not found" });
        }
        
        return json(res, 200, snapshot);
      }

      /* ============== SYSTEM API ============== */
      if (req.method === "GET" && pathname === "/health") {
        return json(res, 200, {
          status: "ok",
          timestamp: new Date().toISOString(),
          version: "1.0.0"
        });
      }

      if (req.method === "GET" && pathname === "/status") {
        return json(res, 200, {
          activeProject: getLastProject(),
          currentExecution: getCurrentExecutionId(),
          tools: toolRegistry.list().length,
          memory: agentMemory.getStats()
        });
      }

      /* ============== STATIC FILES ============== */
      if (req.method === "GET") {
        // Remove leading slash for file path
        const cleanPath = pathname === "/" ? "/index.html" : pathname;
        const staticPath = path.join(process.cwd(), "ui", cleanPath);
        
        serverLog.debug(`Static file request: ${cleanPath} -> ${staticPath}`);
        
        if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
          if (serveStatic(res, staticPath)) return;
        }
        
        // Fallback to index.html only for non-file paths
        if (!pathname.includes(".")) {
          const indexPath = path.join(process.cwd(), "ui", "index.html");
          if (fs.existsSync(indexPath)) {
            if (serveStatic(res, indexPath)) return;
          }
        }
      }

      /* ============== 404 ============== */
      serverLog.warn(`404 Not Found: ${pathname}`);
      return json(res, 404, { error: "Not found", path: pathname });

    } catch (err) {
      console.error("Server error:", err);
      emit({ type: "server_error", message: err.message });
      return json(res, 500, { error: err.message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖 C.3 AI Agent Server                                  ║
║                                                           ║
║   http://127.0.0.1:${port}                                  ║
║                                                           ║
║   Endpoints:                                              ║
║   • GET  /health          - Health check                  ║
║   • GET  /status          - System status                 ║
║   • GET  /stream          - SSE events                    ║
║   •                                                       ║
║   • POST /agent/run       - Start agent task              ║
║   • GET  /agent/status    - Agent status                  ║
║   • GET  /agent/tools     - List tools                    ║
║   •                                                       ║
║   • GET  /tools           - All tools                     ║
║   • POST /tools/execute   - Execute tool                  ║
║   •                                                       ║
║   • GET  /memory          - Memory stats                  ║
║   • POST /memory          - Store memory                  ║
║   •                                                       ║
║   • GET  /profile         - User profile                  ║
║   • POST /profile         - Update profile                ║
║   •                                                       ║
║   • GET  /projects        - List projects                 ║
║   • POST /projects/select - Select project                ║
║   •                                                       ║
║   • POST /execute/plan    - Execute plan                  ║
║   • POST /execution/*     - Execution control             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
  });

  return server;
}

// Start if run directly
if (process.argv[1]?.endsWith("server.js")) {
  startServer(process.env.PORT || 3335);
}

export default startServer;

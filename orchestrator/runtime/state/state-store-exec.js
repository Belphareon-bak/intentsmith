import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXEC_ROOT = path.resolve(__dirname, "executions");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function createExecution({ sandboxRoot, plan }) {
  console.log(">>> CREATE_EXECUTION CALLED <<<");
  console.log("EXEC_ROOT =", EXEC_ROOT);

  ensureDir(EXEC_ROOT);

  const executionId = crypto.randomUUID();
  const execDir = path.join(EXEC_ROOT, executionId);

  ensureDir(execDir);

  fs.writeFileSync(path.join(execDir, "meta.json"), JSON.stringify({
    execution_id: executionId,
    status: "created",
    sandbox_root: sandboxRoot,
    created_at: new Date().toISOString(),
  }, null, 2));

  fs.writeFileSync(path.join(execDir, "progress.json"), JSON.stringify({
    current_step: 0,
    completed_steps: [],
  }, null, 2));

  fs.writeFileSync(path.join(execDir, "plan.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(execDir, "context.json"), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(execDir, "events.log"), "");

  return executionId;
}

export function loadExecution(executionId) {
  const execDir = path.join(EXEC_ROOT, executionId);
  
  if (!fs.existsSync(execDir)) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  return {
    meta: JSON.parse(fs.readFileSync(path.join(execDir, "meta.json"))),
    progress: JSON.parse(fs.readFileSync(path.join(execDir, "progress.json"))),
    plan: JSON.parse(fs.readFileSync(path.join(execDir, "plan.json"))),
  };
}

export function updateMeta(executionId, patch) {
  const metaPath = path.join(EXEC_ROOT, executionId, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath));
  Object.assign(meta, patch);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export function saveProgress(executionId, progress) {
  fs.writeFileSync(
    path.join(EXEC_ROOT, executionId, "progress.json"),
    JSON.stringify(progress, null, 2)
  );
}

export function appendEvent(executionId, event) {
  fs.appendFileSync(
    path.join(EXEC_ROOT, executionId, "events.log"),
    `${new Date().toISOString()} ${event}\n`
  );
}

/**
 * Save execution context (accumulated step results)
 */
export function saveContext(executionId, context) {
  const contextPath = path.join(EXEC_ROOT, executionId, "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
}

/**
 * Load execution context
 */
export function loadContext(executionId) {
  const contextPath = path.join(EXEC_ROOT, executionId, "context.json");
  
  if (!fs.existsSync(contextPath)) {
    return {};
  }
  
  try {
    return JSON.parse(fs.readFileSync(contextPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * List all executions
 */
export function listExecutions() {
  ensureDir(EXEC_ROOT);
  
  const dirs = fs.readdirSync(EXEC_ROOT).filter(name => {
    const stat = fs.statSync(path.join(EXEC_ROOT, name));
    return stat.isDirectory();
  });
  
  return dirs.map(executionId => {
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(EXEC_ROOT, executionId, "meta.json"), "utf-8")
      );
      return { executionId, ...meta };
    } catch {
      return { executionId, status: "unknown" };
    }
  });
}

/**
 * Get execution directory path
 */
export function getExecutionPath(executionId) {
  return path.join(EXEC_ROOT, executionId);
}

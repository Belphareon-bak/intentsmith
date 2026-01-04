import fs from "fs";
import path from "path";
import { getProjectPath } from "./project-registry.js";

export function loadProjectState(name) {
  const base = getProjectPath(name);
  const stateDir = path.join(base, "state");

  function read(file) {
    const p = path.join(base, file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  }

  function readState(file) {
    const p = path.join(stateDir, file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  }

  return {
    project: JSON.parse(read("project.json") || "{}"),
    sessionContext: read("session-context.md"),
    workingProgress: read("working-progress.md"),
    decisions: read("decisions.md"),

    // 🔴 KRITICKÉ – AUTHORITATIVE PLAN
    plan: (() => {
      try {
        return JSON.parse(readState("plan.json") || "null");
      } catch {
        return null;
      }
    })()
  };
}

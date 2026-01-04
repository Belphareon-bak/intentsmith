import fs from "node:fs";
import path from "node:path";

const PROJECTS_ROOT = path.resolve("./sandbox/projects");
const ACTIVE_PROJECT_FILE = path.resolve("./sandbox/.active-project");

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function ensureFile(p, content) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content);
  }
}

export function listProjects() {
  ensureDir(PROJECTS_ROOT);
  return fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

export function getLastProject() {
  if (!fs.existsSync(ACTIVE_PROJECT_FILE)) return null;
  return fs.readFileSync(ACTIVE_PROJECT_FILE, "utf-8").trim();
}

export function getProjectPath(projectName) {
  return path.join(PROJECTS_ROOT, projectName);
}

export function setActiveProject(projectName) {
  ensureDir(PROJECTS_ROOT);

  const projectPath = getProjectPath(projectName);
  ensureDir(projectPath);

  // ---- project memory ----
  ensureFile(
    path.join(projectPath, "working-progress.md"),
    `# Working Progress — ${projectName}\n\n(autocreated)\n`
  );

  ensureFile(
    path.join(projectPath, "session-context.md"),
    `# Session Context — ${projectName}\n\n(autocreated)\n`
  );

  fs.writeFileSync(ACTIVE_PROJECT_FILE, projectName);
  return projectPath;
}

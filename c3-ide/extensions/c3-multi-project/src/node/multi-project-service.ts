/**
 * @c3/multi-project — Backend Service
 *
 * Manages workspace with multiple projects:
 *   - Scans projects/ directory for project.json files
 *   - Creates new projects with scaffolding
 *   - Switches active project (persisted in .c3/settings.json)
 *   - Soft-deletes to .c3/trash/
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  C3MultiProject,
  C3MultiProjectClient,
  ProjectEntry,
  ProjectPhase,
  WorkspaceInfo,
} from '../common/multi-project-protocol';

export class C3MultiProjectService implements C3MultiProject {

  private client: C3MultiProjectClient | undefined;

  setClient(client: C3MultiProjectClient): void {
    this.client = client;
  }

  // ─── Workspace Scanning ────────────────────────────────

  async scanWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    const projectsDir = path.join(workspacePath, 'projects');
    const settingsPath = path.join(workspacePath, '.c3', 'settings.json');

    await ensureDir(projectsDir);
    await ensureDir(path.join(workspacePath, '.c3'));

    const projects: ProjectEntry[] = [];

    // Scan projects directory
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(projectsDir);
    } catch { /* empty */ }

    for (const entry of entries) {
      const projectDir = path.join(projectsDir, entry);
      const stat = await fs.promises.stat(projectDir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const projectJsonPath = path.join(projectDir, 'project.json');
      if (!await pathExists(projectJsonPath)) continue;

      try {
        const data = JSON.parse(
          await fs.promises.readFile(projectJsonPath, 'utf-8'),
        );

        projects.push({
          slug: entry,
          name: data.name || entry,
          phase: (data.phase as ProjectPhase) || 'idle',
          currentSprint: data.currentSprint || 0,
          currentStep: data.currentStep || data.designTurn || 0,
          lastModified: stat.mtime.toISOString(),
          path: projectDir,
        });
      } catch { /* skip corrupt project.json */ }
    }

    // Sort by last modified (newest first)
    projects.sort((a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );

    // Get active project
    let activeProjectSlug: string | null = null;
    if (await pathExists(settingsPath)) {
      try {
        const settings = JSON.parse(
          await fs.promises.readFile(settingsPath, 'utf-8'),
        );
        activeProjectSlug = settings.activeProject || null;
      } catch { /* ignore */ }
    }

    return {
      rootPath: workspacePath,
      projects,
      activeProjectSlug,
      settingsPath,
    };
  }

  // ─── Create Project ────────────────────────────────────

  async createProject(workspacePath: string, name: string): Promise<ProjectEntry> {
    const slug = this.slugify(name);
    const projectDir = path.join(workspacePath, 'projects', slug);

    if (await pathExists(projectDir)) {
      throw new Error(`Projekt '${slug}' již existuje`);
    }

    // Create directory structure
    await ensureDir(projectDir);
    await ensureDir(path.join(projectDir, 'design'));
    await ensureDir(path.join(projectDir, 'src'));
    await ensureDir(path.join(projectDir, 'chat'));
    await ensureDir(path.join(projectDir, '.c3'));

    // Create project.json
    const projectData = {
      name,
      phase: 'design',
      currentSprint: 0,
      designTurn: 0,
      createdAt: new Date().toISOString(),
      pending_changes: [],
    };

    await atomicWriteJson(
      path.join(projectDir, 'project.json'),
      projectData,
    );

    const entry: ProjectEntry = {
      slug,
      name,
      phase: 'design',
      currentSprint: 0,
      currentStep: 0,
      lastModified: new Date().toISOString(),
      path: projectDir,
    };

    this.client?.onProjectCreated(entry);
    return entry;
  }

  // ─── Switch Project ────────────────────────────────────

  async switchProject(
    workspacePath: string,
    slug: string | null,
  ): Promise<ProjectEntry | null> {
    const settingsPath = path.join(workspacePath, '.c3', 'settings.json');
    await ensureDir(path.dirname(settingsPath));

    // Load existing settings
    let settings: Record<string, any> = {};
    if (await pathExists(settingsPath)) {
      try {
        settings = JSON.parse(
          await fs.promises.readFile(settingsPath, 'utf-8'),
        );
      } catch { /* ignore */ }
    }

    // Update active project
    settings.activeProject = slug;
    await atomicWriteJson(settingsPath, settings);

    if (!slug) {
      this.client?.onProjectSwitched(null);
      return null;
    }

    // Load and return the project entry
    const workspace = await this.scanWorkspace(workspacePath);
    const project = workspace.projects.find(p => p.slug === slug) || null;
    this.client?.onProjectSwitched(project);
    return project;
  }

  // ─── Get Active ────────────────────────────────────────

  async getActiveProject(workspacePath: string): Promise<ProjectEntry | null> {
    const workspace = await this.scanWorkspace(workspacePath);
    if (!workspace.activeProjectSlug) return null;
    return workspace.projects.find(
      p => p.slug === workspace.activeProjectSlug,
    ) || null;
  }

  // ─── Delete (soft) ─────────────────────────────────────

  async deleteProject(workspacePath: string, slug: string): Promise<void> {
    const projectDir = path.join(workspacePath, 'projects', slug);
    if (!await pathExists(projectDir)) {
      throw new Error(`Projekt '${slug}' neexistuje`);
    }

    // Move to trash
    const trashDir = path.join(workspacePath, '.c3', 'trash');
    await ensureDir(trashDir);

    const trashName = `${slug}-${Date.now()}`;
    await fs.promises.rename(projectDir, path.join(trashDir, trashName));

    // If this was the active project, deactivate
    const settingsPath = path.join(workspacePath, '.c3', 'settings.json');
    if (await pathExists(settingsPath)) {
      try {
        const settings = JSON.parse(
          await fs.promises.readFile(settingsPath, 'utf-8'),
        );
        if (settings.activeProject === slug) {
          settings.activeProject = null;
          await atomicWriteJson(settingsPath, settings);
        }
      } catch { /* ignore */ }
    }
  }

  // ─── Slug ──────────────────────────────────────────────

  slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'projekt';
  }
}

// ─── Helpers ─────────────────────────────────────────────

async function ensureDir(d: string): Promise<void> {
  await fs.promises.mkdir(d, { recursive: true });
}
async function pathExists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}
async function atomicWriteJson(filePath: string, data: any): Promise<void> {
  const tmp = filePath + '.tmp';
  await ensureDir(path.dirname(filePath));
  const handle = await fs.promises.open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf-8');
    await handle.sync();
  } finally { await handle.close(); }
  await fs.promises.rename(tmp, filePath);
}

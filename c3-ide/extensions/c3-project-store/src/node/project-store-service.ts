/**
 * @c3/project-store — Service (Node.js backend)
 *
 * Persistent project state via project.json.
 *
 * Key implementation details:
 *   - Atomic write: project.json.tmp → fsync → rename (POSIX atomic)
 *   - Schema migration: v0 → v1 (and future v1 → v2)
 *   - Auto-save: turn complete, phase change, shutdown, watchdog (60s)
 *   - Rehydration: on startup, load project + restore phase
 *   - PENDING_REVIEW state detection for auto-opening Review Panel
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  C3ProjectStore,
  C3Project,
  C3Phase,
  C3Decision,
  PendingChange,
  RehydrationResult,
  SaveTrigger,
} from '../common/project-store-protocol';

const PROJECT_FILE = 'project.json';
const CURRENT_SCHEMA = 1;

@injectable()
export class C3ProjectStoreService implements C3ProjectStore {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastSavedProject: C3Project | null = null;

  // ─── Lifecycle ─────────────────────────────────────────

  /** Start auto-save watchdog (60s interval) */
  startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (this.lastSavedProject) {
        this.saveProject(this.lastSavedProject, 'watchdog');
      }
    }, 60_000);
  }

  /** Stop watchdog and flush final save */
  async stopWatchdog(): Promise<void> {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.lastSavedProject) {
      await this.saveProject(this.lastSavedProject, 'graceful_shutdown');
    }
  }

  // ─── Public API ────────────────────────────────────────

  async loadActiveProject(workspacePath: string): Promise<C3Project | null> {
    const projectFile = path.join(workspacePath, PROJECT_FILE);

    if (!await fs.pathExists(projectFile)) {
      return null;
    }

    try {
      let data = await fs.readJson(projectFile);

      // Schema migration
      if (!data.schema_version || data.schema_version < CURRENT_SCHEMA) {
        data = this.migrateSchema(data);
        data.path = workspacePath;
        await this.saveProject(data, 'explicit');
      }

      if (!data.path) {
        data.path = workspacePath;
      }

      if (data.active) {
        this.lastSavedProject = data;
        return data;
      }
    } catch (err: any) {
      this.logger.error(`Failed to load project from ${projectFile}: ${err.message}`);

      // Try to load from backup (.bak)
      const backupFile = projectFile + '.bak';
      if (await fs.pathExists(backupFile)) {
        this.logger.info('Attempting recovery from backup...');
        try {
          const backup = await fs.readJson(backupFile);
          backup.path = workspacePath;
          await this.saveProject(backup, 'explicit');
          return backup;
        } catch {
          this.logger.error('Backup recovery also failed');
        }
      }
    }

    return null;
  }

  /**
   * Save project — ATOMIC WRITE.
   *
   * 1. Write to project.json.tmp
   * 2. fsync(fd)
   * 3. rename(project.json.tmp → project.json) ← atomic on POSIX (ext4, btrfs)
   *
   * Without this: IDE crash during write = corrupted project.json = data loss.
   */
  async saveProject(project: C3Project, trigger: SaveTrigger = 'explicit'): Promise<void> {
    project.updated_at = new Date().toISOString();
    this.lastSavedProject = project;

    const filePath = path.join(project.path, PROJECT_FILE);
    await this.atomicWriteJson(filePath, project);

    this.logger.debug(`Project saved (${trigger}): ${project.project_id} phase=${project.phase}`);
  }

  async createProject(workspacePath: string, name: string, type: string): Promise<C3Project> {
    const projectId = this.generateProjectId(name);
    const now = new Date().toISOString();

    const project: C3Project = {
      schema_version: CURRENT_SCHEMA,
      project_id: projectId,
      name,
      type,
      phase: 'design',
      active: true,
      created_at: now,
      updated_at: now,
      path: workspacePath,
      context: {
        stack: {},
        decisions: [],
        current_sprint: 0,
        total_sprints: 0,
        design_turns: 0,
      },
      files: {
        design: 'design/architecture.md',
        sprints: 'design/sprints.md',
        chat_log: 'chat/conversation.jsonl',
      },
    };

    // Create directory structure
    await fs.ensureDir(path.join(workspacePath, 'design'));
    await fs.ensureDir(path.join(workspacePath, 'chat'));
    await fs.ensureDir(path.join(workspacePath, 'agent-log'));
    await fs.ensureDir(path.join(workspacePath, '.c3'));

    await this.saveProject(project, 'explicit');
    return project;
  }

  async updatePhase(project: C3Project, phase: C3Phase): Promise<void> {
    const oldPhase = project.phase;
    project.phase = phase;
    await this.saveProject(project, 'phase_change');
    this.logger.info(`Phase change: ${oldPhase} → ${phase} (project: ${project.project_id})`);
  }

  async addDecision(project: C3Project, decision: C3Decision): Promise<void> {
    project.context.decisions.push(decision);
    await this.saveProject(project, 'turn_complete');
  }

  async setPendingChanges(project: C3Project, changes: PendingChange[]): Promise<void> {
    project.pending_changes = changes;
    project.phase = 'pending_review';

    // Create pending diffs directory
    const diffsDir = path.join(project.path, '.c3', 'pending-diffs');
    await fs.ensureDir(diffsDir);

    await this.saveProject(project, 'phase_change');
    this.logger.info(`Pending review set: ${changes.length} file(s)`);
  }

  async clearPendingChanges(project: C3Project): Promise<void> {
    project.pending_changes = undefined;
    if (project.phase === 'pending_review') {
      project.phase = 'build'; // or wherever we return to
    }
    await this.saveProject(project, 'phase_change');
  }

  async rehydrateSession(workspacePath: string): Promise<RehydrationResult> {
    const project = await this.loadActiveProject(workspacePath);

    if (!project) {
      return { found: false, hasPendingReview: false };
    }

    return {
      found: true,
      project,
      hasPendingReview: project.phase === 'pending_review' &&
        (project.pending_changes?.length ?? 0) > 0,
    };
  }

  // ─── Schema Migration ─────────────────────────────────

  private migrateSchema(data: any): C3Project {
    // v0 → v1
    if (!data.schema_version || data.schema_version === 0) {
      data.schema_version = 1;

      // Normalize phase names (old: 'designing' → new: 'design')
      const phaseMap: Record<string, C3Phase> = {
        designing: 'design',
        building: 'build',
        reviewing: 'review',
      };
      if (data.phase && phaseMap[data.phase]) {
        data.phase = phaseMap[data.phase];
      }

      // Ensure context exists
      if (!data.context) {
        data.context = {
          stack: {},
          decisions: [],
          current_sprint: 0,
          total_sprints: 0,
          design_turns: 0,
        };
      }

      // Ensure files section exists
      if (!data.files) {
        data.files = {};
      }

      this.logger.info(`Schema migration: v0 → v1 (project: ${data.project_id || 'unknown'})`);
    }

    // Future: v1 → v2, v2 → v3, etc.
    // if (data.schema_version === 1) { ... migrate to v2 ... }

    return data;
  }

  // ─── Atomic Write ──────────────────────────────────────

  /**
   * Atomic JSON file write:
   * 1. Write to .tmp file
   * 2. fsync (ensure data on disk)
   * 3. rename (atomic on POSIX filesystems)
   *
   * Also creates a .bak backup before overwriting.
   */
  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';
    const content = JSON.stringify(data, null, 2) + '\n';

    // Create backup of existing file
    if (await fs.pathExists(filePath)) {
      try {
        await fs.copy(filePath, bakPath, { overwrite: true });
      } catch {
        // Backup failure is not critical
      }
    }

    // Write to tmp
    const fd = await fs.open(tmpPath, 'w');
    try {
      await fs.writeFile(fd, content, 'utf-8');
      await fs.fsync(fd);
    } finally {
      await fs.close(fd);
    }

    // Atomic rename
    await fs.rename(tmpPath, filePath);
  }

  // ─── Helpers ───────────────────────────────────────────

  private generateProjectId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return slug || `project-${Date.now()}`;
  }
}

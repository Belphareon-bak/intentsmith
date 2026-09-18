/**
 * @intentsmith/multi-project — Protocol (common)
 *
 * Workspace structure:
 *   intentsmith-workspace/
 *   ├── projects/
 *   │   ├── mobilni-aplikace/
 *   │   │   ├── project.json
 *   │   │   ├── design/
 *   │   │   └── src/
 *   │   └── e-shop-backend/
 *   │       ├── project.json
 *   │       └── src/
 *   └── .intentsmith/
 *       ├── settings.json
 *       └── global-history.jsonl
 *
 * Project Switcher (Ctrl+Shift+P → "IntentSmith: Přepnout projekt"):
 *   📐 Mobilní aplikace (DESIGN, krok 12) ← aktivní
 *   🔨 E-shop backend (BUILD, sprint 3)
 *   💬 Bez projektu (volná konverzace)
 *   + Nový projekt...
 */

export const IntentSmithMultiProjectPath = '/services/intentsmith-multi-project';
export const IntentSmithMultiProject = Symbol('IntentSmithMultiProject');

// ─── Types ───────────────────────────────────────────────

export type ProjectPhase = 'design' | 'build' | 'pending_review' | 'review' | 'idle';

export interface ProjectEntry {
  /** Directory name under projects/ */
  slug: string;
  /** Human-readable name from project.json */
  name: string;
  /** Current phase */
  phase: ProjectPhase;
  /** Current sprint number (0 if in design) */
  currentSprint: number;
  /** Design turn or build step */
  currentStep: number;
  /** Last modified timestamp */
  lastModified: string;
  /** Absolute path to project directory */
  path: string;
}

export interface WorkspaceInfo {
  /** Absolute path to workspace root */
  rootPath: string;
  /** All discovered projects */
  projects: ProjectEntry[];
  /** Currently active project slug (null = no project) */
  activeProjectSlug: string | null;
  /** Global settings path */
  settingsPath: string;
}

export const PHASE_ICONS: Record<ProjectPhase | 'none', string> = {
  design: '📐',
  build: '🔨',
  pending_review: '🔍',
  review: '🔍',
  idle: '💤',
  none: '💬',
};

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  design: 'DESIGN',
  build: 'BUILD',
  pending_review: 'PENDING REVIEW',
  review: 'REVIEW',
  idle: 'IDLE',
};

// ─── Service Interface ───────────────────────────────────

export interface IntentSmithMultiProject {
  /** Scan workspace for all projects */
  scanWorkspace(workspacePath: string): Promise<WorkspaceInfo>;

  /** Create a new project in workspace */
  createProject(workspacePath: string, name: string): Promise<ProjectEntry>;

  /** Switch to a project (or null for no project) */
  switchProject(workspacePath: string, slug: string | null): Promise<ProjectEntry | null>;

  /** Get currently active project */
  getActiveProject(workspacePath: string): Promise<ProjectEntry | null>;

  /** Delete a project (moves to .intentsmith/trash/) */
  deleteProject(workspacePath: string, slug: string): Promise<void>;

  /** Generate slug from name */
  slugify(name: string): string;
}

// ─── Events ──────────────────────────────────────────────

export const IntentSmithMultiProjectClient = Symbol('IntentSmithMultiProjectClient');

export interface IntentSmithMultiProjectClient {
  onProjectSwitched(project: ProjectEntry | null): void;
  onProjectCreated(project: ProjectEntry): void;
  onWorkspaceChanged(info: WorkspaceInfo): void;
}

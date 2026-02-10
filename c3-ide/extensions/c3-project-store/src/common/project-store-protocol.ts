/**
 * @c3/project-store — Protocol (common)
 *
 * Project store provides persistent project state via project.json.
 * Survives IDE restart, backend restart, crash.
 *
 * Key invariants:
 *   - schema_version for migrations
 *   - Atomic writes (tmp + fsync + rename)
 *   - PENDING_REVIEW state survives restart → auto-open Review Panel
 */

export const C3ProjectStorePath = '/services/c3-project-store';
export const C3ProjectStore = Symbol('C3ProjectStore');

// ─── Project Model ───────────────────────────────────────

export interface C3Project {
  schema_version: number;
  project_id: string;
  name: string;
  type: string;
  phase: C3Phase;
  active: boolean;
  created_at: string;
  updated_at: string;
  path: string;

  context: C3ProjectContext;
  files: C3ProjectFiles;

  /** Pending changes waiting for review (set when phase === 'pending_review') */
  pending_changes?: PendingChange[];
}

export type C3Phase =
  | 'design'
  | 'build'
  | 'pending_review'
  | 'review'
  | 'apply'
  | 'idle';

export interface C3ProjectContext {
  stack: Record<string, string>;
  decisions: C3Decision[];
  current_sprint: number;
  total_sprints: number;
  design_turns: number;
}

export interface C3Decision {
  what: string;
  why: string;
  when: string;
}

export interface C3ProjectFiles {
  design?: string;
  sprints?: string;
  chat_log?: string;
}

export interface PendingChange {
  file: string;
  diff_path: string;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
}

// ─── Service Interface ───────────────────────────────────

export interface C3ProjectStore {
  /** Load active project from workspace */
  loadActiveProject(workspacePath: string): Promise<C3Project | null>;

  /** Save project (atomic write: tmp → fsync → rename) */
  saveProject(project: C3Project): Promise<void>;

  /** Create new project */
  createProject(workspacePath: string, name: string, type: string): Promise<C3Project>;

  /** Update project phase */
  updatePhase(project: C3Project, phase: C3Phase): Promise<void>;

  /** Add decision to project context */
  addDecision(project: C3Project, decision: C3Decision): Promise<void>;

  /** Set pending changes (transition to PENDING_REVIEW) */
  setPendingChanges(project: C3Project, changes: PendingChange[]): Promise<void>;

  /** Clear pending changes (after review complete) */
  clearPendingChanges(project: C3Project): Promise<void>;

  /** Rehydrate backend session state from stored project */
  rehydrateSession(workspacePath: string): Promise<RehydrationResult>;
}

export interface RehydrationResult {
  found: boolean;
  project?: C3Project;
  /** True if project was in pending_review → IDE should auto-open Review Panel */
  hasPendingReview: boolean;
}

// ─── Auto-save Events ────────────────────────────────────

export type SaveTrigger =
  | 'turn_complete'
  | 'phase_change'
  | 'graceful_shutdown'
  | 'watchdog'
  | 'explicit';

/**
 * @intentsmith/project-store — Protocol (common)
 *
 * Project store provides persistent project state via project.json.
 * Survives IDE restart, backend restart, crash.
 *
 * Key invariants:
 *   - schema_version for migrations
 *   - Atomic writes (tmp + fsync + rename)
 *   - PENDING_REVIEW state survives restart → auto-open Review Panel
 */

export const IntentSmithProjectStorePath = '/services/intentsmith-project-store';
export const IntentSmithProjectStore = Symbol('IntentSmithProjectStore');

// ─── Project Model ───────────────────────────────────────

export interface IntentSmithProject {
  schema_version: number;
  project_id: string;
  name: string;
  type: string;
  phase: IntentSmithPhase;
  active: boolean;
  created_at: string;
  updated_at: string;
  path: string;

  context: IntentSmithProjectContext;
  files: IntentSmithProjectFiles;

  /** Pending changes waiting for review (set when phase === 'pending_review') */
  pending_changes?: PendingChange[];
}

export type IntentSmithPhase =
  | 'design'
  | 'build'
  | 'pending_review'
  | 'review'
  | 'apply'
  | 'idle';

export interface IntentSmithProjectContext {
  stack: Record<string, string>;
  decisions: IntentSmithDecision[];
  current_sprint: number;
  total_sprints: number;
  design_turns: number;
}

export interface IntentSmithDecision {
  what: string;
  why: string;
  when: string;
}

export interface IntentSmithProjectFiles {
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

export interface IntentSmithProjectStore {
  /** Load active project from workspace */
  loadActiveProject(workspacePath: string): Promise<IntentSmithProject | null>;

  /** Save project (atomic write: tmp → fsync → rename) */
  saveProject(project: IntentSmithProject): Promise<void>;

  /** Create new project */
  createProject(workspacePath: string, name: string, type: string): Promise<IntentSmithProject>;

  /** Update project phase */
  updatePhase(project: IntentSmithProject, phase: IntentSmithPhase): Promise<void>;

  /** Add decision to project context */
  addDecision(project: IntentSmithProject, decision: IntentSmithDecision): Promise<void>;

  /** Set pending changes (transition to PENDING_REVIEW) */
  setPendingChanges(project: IntentSmithProject, changes: PendingChange[]): Promise<void>;

  /** Clear pending changes (after review complete) */
  clearPendingChanges(project: IntentSmithProject): Promise<void>;

  /** Rehydrate backend session state from stored project */
  rehydrateSession(workspacePath: string): Promise<RehydrationResult>;
}

export interface RehydrationResult {
  found: boolean;
  project?: IntentSmithProject;
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

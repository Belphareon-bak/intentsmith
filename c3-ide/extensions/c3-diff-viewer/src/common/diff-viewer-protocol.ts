/**
 * @c3/diff-viewer — Protocol (common)
 *
 * Defines the diff proposal model used across the review pipeline:
 *
 *   BUILD → agent generates diff(s)
 *         → PENDING_REVIEW (persisted in project.json)
 *         → user opens IDE (maybe after restart!)
 *         → REVIEW (reviews diffs)
 *         → APPLY (accept) / REJECT
 *         → back to BUILD or next sprint
 *
 * PENDING_REVIEW is a critical state — user may leave/restart
 * between diff generation and review. project.json must know.
 *
 * Diff format: unified diff (patch format), stored in .c3/pending-diffs/
 */

export const C3DiffViewerPath = '/services/c3-diff-viewer';
export const C3DiffViewer = Symbol('C3DiffViewer');

// ─── Code Change Proposal ────────────────────────────────

export interface CodeChangeProposal {
  /** Unique ID for this proposal */
  id: string;
  /** Relative file path from project root */
  filePath: string;
  /** Human-readable description of the change */
  description: string;
  /** Unified diff content */
  diff: string;
  /** Path to stored patch file (.c3/pending-diffs/xxx.patch) */
  patchPath: string;
  /** Lines added / removed */
  stats: DiffStats;
  /** Review status */
  status: ProposalStatus;
  /** Original file content (before change) */
  originalContent?: string;
  /** Modified file content (after change applied) */
  modifiedContent?: string;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  /** True if this is a new file */
  isNew: boolean;
  /** True if this file is being deleted */
  isDelete: boolean;
}

export type ProposalStatus =
  | 'pending'       // Not yet reviewed
  | 'accepted'      // User accepted
  | 'rejected'      // User rejected
  | 'edited';       // User edited the proposed code

export type UserReviewAction =
  | 'accept'
  | 'reject'
  | 'edit';

// ─── Change Set (multi-file atomic group) ────────────────

export interface ChangeSet {
  /** Unique ID */
  id: string;
  /** Human-readable label, e.g. "Sprint 1, Step 3: VPN service" */
  label: string;
  /** All proposals in this set */
  proposals: CodeChangeProposal[];
  /** Overall status */
  status: ChangeSetStatus;
  /** When the agent created this set */
  createdAt: string;
  /** Sprint/step context for commit message generation */
  context: ChangeSetContext;
}

export type ChangeSetStatus =
  | 'pending'        // At least one proposal not reviewed
  | 'reviewed'       // All reviewed, mixed accept/reject
  | 'all_accepted'   // All accepted, ready to apply
  | 'all_rejected'   // All rejected
  | 'applied';       // Changes written to disk + committed

export interface ChangeSetContext {
  sprintNumber: number;
  stepNumber: number;
  intent: string;
  /** Summary for commit message */
  summary: string;
  /** Detailed bullet points for commit body */
  details: string[];
}

// ─── Service Interface ───────────────────────────────────

export interface C3DiffViewer {
  /** Create a new change set from agent proposals */
  createChangeSet(
    projectPath: string,
    label: string,
    proposals: Omit<CodeChangeProposal, 'id' | 'patchPath' | 'status'>[],
    context: ChangeSetContext,
  ): Promise<ChangeSet>;

  /** Load existing change set (e.g. after restart from PENDING_REVIEW) */
  loadChangeSet(projectPath: string): Promise<ChangeSet | null>;

  /** Get diff content for a specific proposal (original + modified) */
  getProposalContent(
    projectPath: string,
    proposal: CodeChangeProposal,
  ): Promise<{ original: string; modified: string }>;

  /** Update proposal status after user review */
  updateProposalStatus(
    projectPath: string,
    proposalId: string,
    status: ProposalStatus,
    editedContent?: string,
  ): Promise<ChangeSet>;

  /** Apply accepted changes to disk */
  applyAccepted(projectPath: string): Promise<ApplyResult>;

  /** Reject all and clean up */
  rejectAll(projectPath: string): Promise<void>;

  /** Parse a unified diff string into stats */
  parseDiffStats(diff: string): DiffStats;
}

export interface ApplyResult {
  applied: number;
  rejected: number;
  edited: number;
  /** Files that were actually written */
  writtenFiles: string[];
  /** Commit hash if git auto-commit succeeded */
  commitHash?: string;
}

// ─── Events (backend → frontend) ─────────────────────────

export const C3DiffViewerClient = Symbol('C3DiffViewerClient');

export interface C3DiffViewerClient {
  onChangeSetCreated(changeSet: ChangeSet): void;
  onProposalStatusChanged(proposalId: string, status: ProposalStatus): void;
  onChangeSetApplied(result: ApplyResult): void;
}

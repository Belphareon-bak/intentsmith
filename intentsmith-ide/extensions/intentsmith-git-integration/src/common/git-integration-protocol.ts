/**
 * @intentsmith/git-integration — Protocol (common)
 *
 * Minimal git integration (not a full git UI):
 *   - Auto-commit after Accept All with descriptive message
 *   - Branch management: intentsmith/sprint-N
 *   - NO merge/rebase/push (user does that)
 *
 * Commit message format:
 *   feat(vpn): Add WireGuard tunnel configuration
 *
 *   IntentSmith Agent — Sprint 1, Step 3
 *   - Added VPN service with WireGuard integration
 *   - Added connection state management
 *   - Added unit tests for tunnel lifecycle
 */

export const IntentSmithGitIntegrationPath = '/services/intentsmith-git-integration';
export const IntentSmithGitIntegration = Symbol('IntentSmithGitIntegration');

// ─── Types ───────────────────────────────────────────────

export interface CommitRequest {
  /** Files to stage (relative paths) */
  files: string[];
  /** Commit subject line */
  subject: string;
  /** Commit body lines */
  body: string[];
  /** Sprint/step context metadata */
  context: CommitContext;
}

export interface CommitContext {
  sprintNumber: number;
  stepNumber: number;
  intent: string;
  projectName: string;
}

export interface CommitResult {
  success: boolean;
  hash?: string;
  error?: string;
}

export interface BranchInfo {
  current: string;
  intentsmithBranches: string[];
}

// ─── Service Interface ───────────────────────────────────

export interface IntentSmithGitIntegration {
  /** Check if project is a git repo */
  isGitRepo(projectPath: string): Promise<boolean>;

  /** Get current branch info */
  getBranchInfo(projectPath: string): Promise<BranchInfo>;

  /** Create and checkout IntentSmith sprint branch */
  createSprintBranch(projectPath: string, sprintNumber: number): Promise<string>;

  /** Auto-commit accepted changes with descriptive message */
  autoCommit(projectPath: string, request: CommitRequest): Promise<CommitResult>;

  /** Generate commit message from change set context */
  generateCommitMessage(request: CommitRequest): CommitMessage;

  /** Check if working tree is clean */
  isClean(projectPath: string): Promise<boolean>;
}

export interface CommitMessage {
  subject: string;
  body: string;
  full: string;
}

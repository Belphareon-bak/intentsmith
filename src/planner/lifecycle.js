// Project Lifecycle Orchestrator
// ══════════════════════════════════════════════════════════════════════════════
// State machine + delegation to sub-modules.
// Manages ProjectPhase transitions, persistence, session continuity, git auto-init.
//
// Architecture:
//   CRE → BUILD intent → isProjectScopeBuild() → lifecycle-handoff.js → HERE
//   This orchestrator delegates to:
//     - lifecycle-spec.js     → SPEC phase
//     - lifecycle-planning.js → PLANNING phase
//     - lifecycle-build.js    → BUILD phase (milestones)
//     - lifecycle-review.js   → REVIEW + drift
//     - lifecycle-change.js   → CHANGE MANAGEMENT
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { lifecycles as lifecycleRepo, milestones as msRepo } from '../db/database.js';
import { GitManager } from '../architect/git.js';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const ProjectPhase = Object.freeze({
  SPEC:              'SPEC',
  SPEC_REVIEW:       'SPEC_REVIEW',
  PLANNING:          'PLANNING',
  PLAN_REVIEW:       'PLAN_REVIEW',
  BUILD:             'BUILD',
  PROJECT_REVIEW:    'PROJECT_REVIEW',
  CHANGE_MANAGEMENT: 'CHANGE_MANAGEMENT',
  PAUSED:            'PAUSED',
  COMPLETED:         'COMPLETED',
  FAILED:            'FAILED',
});

export const MilestoneStatus = Object.freeze({
  PENDING:       'PENDING',
  PLANNING:      'PLANNING',
  AWAITING_PLAN: 'AWAITING_PLAN',
  EXECUTING:     'EXECUTING',
  TESTING:       'TESTING',
  REVIEW:        'REVIEW',
  PASSED:        'PASSED',
  FAILED:        'FAILED',
  BLOCKED:       'BLOCKED',
  SKIPPED:       'SKIPPED',
});

export const ChangeRequestStatus = Object.freeze({
  PROPOSED: 'PROPOSED',
  ANALYZED: 'ANALYZED',
  APPROVED: 'APPROVED',
  APPLIED:  'APPLIED',
  REJECTED: 'REJECTED',
});

// ─── Valid phase transitions ─────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  [ProjectPhase.SPEC]:              [ProjectPhase.SPEC_REVIEW, ProjectPhase.FAILED],
  [ProjectPhase.SPEC_REVIEW]:       [ProjectPhase.SPEC, ProjectPhase.PLANNING, ProjectPhase.FAILED],
  [ProjectPhase.PLANNING]:          [ProjectPhase.PLAN_REVIEW, ProjectPhase.FAILED],
  [ProjectPhase.PLAN_REVIEW]:       [ProjectPhase.PLANNING, ProjectPhase.BUILD, ProjectPhase.FAILED],
  [ProjectPhase.BUILD]:             [ProjectPhase.PROJECT_REVIEW, ProjectPhase.CHANGE_MANAGEMENT, ProjectPhase.PAUSED, ProjectPhase.COMPLETED, ProjectPhase.FAILED],
  [ProjectPhase.PROJECT_REVIEW]:    [ProjectPhase.BUILD, ProjectPhase.CHANGE_MANAGEMENT, ProjectPhase.FAILED],
  [ProjectPhase.CHANGE_MANAGEMENT]: [ProjectPhase.BUILD, ProjectPhase.FAILED],
  [ProjectPhase.PAUSED]:            [ProjectPhase.BUILD, ProjectPhase.CHANGE_MANAGEMENT, ProjectPhase.FAILED],
  [ProjectPhase.COMPLETED]:         [], // terminal
  [ProjectPhase.FAILED]:            [], // terminal
};

// ─── ProjectLifecycle Class ──────────────────────────────────────────────────

export class ProjectLifecycle {
  /**
   * @param {Object} options
   * @param {string} options.id - Lifecycle ID
   * @param {number} options.projectId - Project DB ID
   * @param {string} options.projectPath - Filesystem path for git ops
   * @param {Object} [options.lifecycleConfig] - Override lifecycle config
   * @param {Function} [options.callLLM] - DI: override LLM calls (null = default from workflow.js)
   * @param {Object} [options.executor] - DI: override WorkflowOrchestrator (null = default)
   */
  constructor({ id, projectId, projectPath, lifecycleConfig = {}, callLLM = null, executor = null }) {
    this.id = id;
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.config = {
      reviewFrequency: config.lifecycle.reviewFrequency,
      maxMilestoneLOC: config.lifecycle.maxMilestoneLOC,
      maxMilestoneFiles: config.lifecycle.maxMilestoneFiles,
      maxMilestoneRetries: config.lifecycle.maxMilestoneRetries,
      autoCommit: config.lifecycle.autoCommit,
      ...lifecycleConfig,
    };
    this.git = new GitManager(projectPath);
    this.callLLM = callLLM;
    this.executor = executor;
    this._phase = ProjectPhase.SPEC;
    this._completedMilestoneCount = 0;
  }

  // ─── Phase management ────────────────────────────────────────────────────

  get phase() {
    return this._phase;
  }

  /**
   * Transition to a new phase with validation.
   * @param {string} newPhase - Target ProjectPhase
   * @throws {Error} If transition is invalid
   */
  async transitionTo(newPhase) {
    const allowed = VALID_TRANSITIONS[this._phase];
    if (!allowed || !allowed.includes(newPhase)) {
      throw new Error(`Invalid phase transition: ${this._phase} → ${newPhase}`);
    }

    const oldPhase = this._phase;
    this._phase = newPhase;

    // Persist
    lifecycleRepo.updatePhase.run(newPhase, this.id);

    logger.info('Lifecycle', `Phase transition: ${oldPhase} → ${newPhase}`, {
      lifecycleId: this.id,
    });
  }

  /**
   * Force-fail the lifecycle (from any state).
   * @param {string} reason
   */
  async fail(reason) {
    const oldPhase = this._phase;
    this._phase = ProjectPhase.FAILED;
    lifecycleRepo.updatePhase.run(ProjectPhase.FAILED, this.id);

    logger.error('Lifecycle', `Lifecycle FAILED from ${oldPhase}: ${reason}`, {
      lifecycleId: this.id,
    });
  }

  // ─── Git auto-init ────────────────────────────────────────────────────────

  /**
   * Ensure git is available. Auto-init if needed.
   */
  async ensureGit() {
    return this.git.ensureRepo(this.projectPath);
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Save lifecycle to DB (create or update).
   */
  save() {
    lifecycleRepo.save(this.id, this.projectId, this._phase, null, this.config);
  }

  /**
   * Check if review is due (every N completed milestones).
   * @returns {boolean}
   */
  isReviewDue() {
    return this._completedMilestoneCount > 0
      && this._completedMilestoneCount % this.config.reviewFrequency === 0;
  }

  /**
   * Increment completed milestone count.
   */
  incrementCompleted() {
    this._completedMilestoneCount++;
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /**
   * Get full lifecycle status for display.
   */
  getStatus() {
    return {
      id: this.id,
      projectId: this.projectId,
      phase: this._phase,
      completedMilestones: this._completedMilestoneCount,
      config: this.config,
    };
  }

  // ─── Static: Resume ───────────────────────────────────────────────────────

  /**
   * Resume a lifecycle from DB.
   * @param {string} lifecycleId
   * @param {string} projectPath
   * @returns {ProjectLifecycle|null}
   */
  static resume(lifecycleId, projectPath) {
    const row = lifecycleRepo.findById.get(lifecycleId);
    if (!row) return null;

    let lcConfig = {};
    try { lcConfig = JSON.parse(row.config); } catch { /* defaults */ }

    const lc = new ProjectLifecycle({
      id: row.id,
      projectId: row.project_id,
      projectPath,
      lifecycleConfig: lcConfig,
    });
    lc._phase = row.phase;

    // Count completed milestones for review frequency
    const completed = msRepo.findByStatus.all(lifecycleId, 'PASSED');
    lc._completedMilestoneCount = completed.length;

    logger.info('Lifecycle', `Resumed lifecycle in phase ${row.phase}`, {
      lifecycleId,
      completedMs: lc._completedMilestoneCount,
    });

    return lc;
  }

  /**
   * Create a new lifecycle and persist it.
   * @param {Object} options - { id, projectId, projectPath, lifecycleConfig }
   * @returns {Promise<ProjectLifecycle>}
   */
  static async create(options) {
    if (!options.id) {
      options.id = `lc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const lc = new ProjectLifecycle(options);
    lc.save();
    await lc.ensureGit();
    return lc;
  }
}

export default {
  ProjectPhase,
  MilestoneStatus,
  ChangeRequestStatus,
  ProjectLifecycle,
};

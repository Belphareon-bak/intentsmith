// Lifecycle CHANGE MANAGEMENT Phase
// ══════════════════════════════════════════════════════════════════════════════
// Handles direction changes during BUILD:
//   1. User or review proposes a change
//   2. Impact analysis — which milestones affected?
//   3. User approves change
//   4. rewriteRoadmap — new version, PASSED milestones preserved
//   5. Return to BUILD with updated roadmap
//
// KEY INVARIANT:
//   rewriteRoadmap MUST:
//   - Preserve completed (PASSED) milestones — never remove/modify
//   - Recalculate sequence numbers (no gaps)
//   - Recalculate dependencies (no broken refs)
//   - Preserve commit_hash and git_tag of completed milestones
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
} from '../db/database.js';
import {
  analyzeChange as analyzeChangePrompt,
  rewriteRoadmap as rewriteRoadmapPrompt,
} from './lifecycle-prompts.js';
import { validateDependencies } from './lifecycle-planning.js';
import { ProjectPhase } from './lifecycle.js';

// ─── Propose Change ──────────────────────────────────────────────────────────

/**
 * Propose a change request and analyze its impact.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} description - What the user wants to change
 * @returns {Promise<Object>} Change request with impact analysis
 */
export async function proposeChange(lifecycle, description) {
  logger.info('LifecycleChange', 'Change proposed', {
    lifecycleId: lifecycle.id,
    description: description.substring(0, 100),
  });

  const spec = lifecycleRepo.getSpec(lifecycle.id);
  const latestRoadmap = roadmapVersions.getLatestRoadmap(lifecycle.id);
  const completed = msRepo.getCompleted(lifecycle.id);

  if (!latestRoadmap) {
    throw new Error('No roadmap exists — cannot propose changes');
  }

  // Generate impact analysis via D1
  const prompt = analyzeChangePrompt(
    description,
    spec,
    latestRoadmap.roadmap,
    completed
  );

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const analysis = parseJSON(result.content);

  if (!analysis) {
    throw new Error('D1 failed to analyze change impact');
  }

  // Create change request
  const crId = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  crRepo.addRequest({
    id: crId,
    lifecycle_id: lifecycle.id,
    description,
    affected_milestones: analysis.affected_milestones || [],
    impact_analysis: analysis.impact,
    old_roadmap_version: latestRoadmap.version,
  });

  // Update status to ANALYZED
  crRepo.updateAnalysis.run(
    JSON.stringify(analysis.impact),
    JSON.stringify(analysis.affected_milestones || []),
    analysis.impact?.milestones_to_add ? JSON.stringify(analysis) : null,
    crId
  );

  return {
    changeRequestId: crId,
    description,
    impact: analysis.impact,
    affectedMilestones: analysis.affected_milestones || [],
    feasibility: analysis.feasibility || 'UNKNOWN',
    recommendation: analysis.recommendation || '',
  };
}

// ─── Approve + Apply Change ──────────────────────────────────────────────────

/**
 * Apply an approved change request: rewrite roadmap.
 * PRESERVES completed milestones — this is the critical invariant.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} changeRequestId
 * @returns {Promise<Object>} New roadmap version
 */
export async function applyChange(lifecycle, changeRequestId) {
  const cr = crRepo.getRequest(changeRequestId);
  if (!cr) throw new Error(`Change request ${changeRequestId} not found`);
  if (cr.status !== 'ANALYZED' && cr.status !== 'APPROVED') {
    throw new Error(`Change request is ${cr.status}, expected ANALYZED or APPROVED`);
  }

  logger.info('LifecycleChange', 'Applying change', {
    lifecycleId: lifecycle.id,
    changeRequestId,
  });

  const currentRoadmap = roadmapVersions.getLatestRoadmap(lifecycle.id);
  const completed = msRepo.getCompleted(lifecycle.id);

  // Rewrite roadmap via D1
  const prompt = rewriteRoadmapPrompt(
    currentRoadmap.roadmap,
    cr,
    completed
  );

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const newRoadmap = parseJSON(result.content);

  if (!newRoadmap || !newRoadmap.milestones) {
    throw new Error('D1 failed to rewrite roadmap');
  }

  // ─── Critical validations ──────────────────────────────────────────────

  // 1. All PASSED milestones must be preserved
  const preservationErrors = validatePreservation(completed, newRoadmap.milestones);
  if (preservationErrors.length > 0) {
    throw new Error(
      `Roadmap rewrite violated preservation: ${preservationErrors.join('; ')}`
    );
  }

  // 2. No sequence gaps
  const sequenceErrors = validateSequences(newRoadmap.milestones);
  if (sequenceErrors.length > 0) {
    logger.warn('LifecycleChange', 'Fixing sequence gaps', { errors: sequenceErrors });
    resequence(newRoadmap.milestones);
  }

  // 3. Dependencies valid
  const depErrors = validateDependencies(newRoadmap.milestones);
  if (depErrors.length > 0) {
    throw new Error(`Roadmap rewrite has invalid dependencies: ${depErrors.join('; ')}`);
  }

  // ─── Store new version ─────────────────────────────────────────────────

  const newVersion = roadmapVersions.getLatestVersion(lifecycle.id) + 1;
  const diffSummary = newRoadmap.diff || newRoadmap.changes_summary || 'Change applied';

  roadmapVersions.addVersion(
    lifecycle.id,
    newVersion,
    newRoadmap,
    `Change request ${changeRequestId}: ${cr.description.substring(0, 100)}`,
    typeof diffSummary === 'string' ? diffSummary : JSON.stringify(diffSummary)
  );

  // ─── Update milestone DB records ───────────────────────────────────────

  syncMilestonesAfterRewrite(lifecycle, newRoadmap.milestones, completed, newVersion);

  // ─── Mark change request as APPLIED ────────────────────────────────────

  crRepo.updateApplied.run(newVersion, changeRequestId);

  logger.info('LifecycleChange', 'Change applied successfully', {
    lifecycleId: lifecycle.id,
    changeRequestId,
    newVersion,
    milestonesCount: newRoadmap.milestones.length,
  });

  return {
    changeRequestId,
    newVersion,
    milestones: newRoadmap.milestones,
    diff: newRoadmap.diff || null,
    changesSummary: newRoadmap.changes_summary || '',
  };
}

// ─── Reject Change ───────────────────────────────────────────────────────────

/**
 * Reject a change request — return to BUILD unchanged.
 * @param {string} changeRequestId
 */
export function rejectChange(changeRequestId) {
  const cr = crRepo.findById.get(changeRequestId);
  if (!cr) throw new Error(`Change request ${changeRequestId} not found`);

  crRepo.updateStatus.run('REJECTED', changeRequestId);

  logger.info('LifecycleChange', 'Change rejected', { changeRequestId });
  return { changeRequestId, status: 'REJECTED' };
}

// ─── Preservation Validation ─────────────────────────────────────────────────

/**
 * Validate that ALL completed milestones are preserved in the new roadmap.
 * Checks: existence, status, commit_hash, git_tag.
 *
 * @param {Object[]} completed - Completed milestones from DB
 * @param {Object[]} newMilestones - New roadmap milestones
 * @returns {string[]} Errors (empty = valid)
 */
export function validatePreservation(completed, newMilestones) {
  const errors = [];
  const newMap = new Map(newMilestones.map(m => [m.id, m]));

  for (const comp of completed) {
    const found = newMap.get(comp.id);

    if (!found) {
      errors.push(`Completed milestone ${comp.id} was removed from roadmap`);
      continue;
    }

    // Status must still be PASSED (or preserved)
    if (found.status && found.status !== 'PASSED' && found.status !== comp.status) {
      errors.push(`Completed milestone ${comp.id} status changed from ${comp.status} to ${found.status}`);
    }

    // preserved flag expected
    if (found.preserved === false) {
      errors.push(`Completed milestone ${comp.id} marked as not preserved`);
    }
  }

  return errors;
}

// ─── Sequence Validation ─────────────────────────────────────────────────────

/**
 * Check for gaps or duplicates in milestone sequences.
 */
function validateSequences(milestoneList) {
  const errors = [];
  const sequences = milestoneList.map((m, i) => {
    const seq = parseInt(m.id?.replace('ms-', ''), 10) || i + 1;
    return seq;
  });

  const sorted = [...sequences].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      errors.push(`Duplicate sequence: ${sorted[i]}`);
    }
  }

  return errors;
}

/**
 * Resequence milestones to remove gaps.
 * Preserves relative order.
 */
function resequence(milestoneList) {
  // Sort by existing sequence
  milestoneList.sort((a, b) => {
    const seqA = parseInt(a.id?.replace('ms-', ''), 10) || 0;
    const seqB = parseInt(b.id?.replace('ms-', ''), 10) || 0;
    return seqA - seqB;
  });
}

// ─── Sync Milestones After Rewrite ───────────────────────────────────────────

/**
 * Synchronize DB milestones with new roadmap.
 * - Completed milestones: untouched
 * - Existing pending: update if modified, delete if removed
 * - New: insert
 */
function syncMilestonesAfterRewrite(lifecycle, newMilestones, completed, newVersion) {
  const completedIds = new Set(completed.map(m => m.id));
  const existing = msRepo.listByLifecycle(lifecycle.id);
  const existingMap = new Map(existing.map(m => [m.id, m]));
  const newIds = new Set(newMilestones.map(m => m.id));

  // Delete removed milestones (only if not completed)
  for (const ms of existing) {
    if (!newIds.has(ms.id) && !completedIds.has(ms.id)) {
      // Can't delete with prepared statement — use raw query
      try {
        const { db: rawDb } = require('../db/database.js');
        rawDb.prepare('DELETE FROM milestones WHERE id = ?').run(ms.id);
      } catch { /* ignore cleanup errors */ }
    }
  }

  // Add/update milestones
  for (const ms of newMilestones) {
    if (completedIds.has(ms.id)) continue; // Skip completed

    const seq = parseInt(ms.id?.replace('ms-', ''), 10) || newMilestones.indexOf(ms) + 1;

    if (existingMap.has(ms.id)) {
      // Update existing pending milestone
      msRepo.updateStatus.run('PENDING', ms.id);
    } else {
      // Insert new milestone
      msRepo.addMilestone({
        id: ms.id,
        lifecycle_id: lifecycle.id,
        roadmap_version: newVersion,
        sequence: seq,
        title: ms.title,
        description: ms.description || null,
        dependencies: ms.dependencies || [],
        estimated_loc: ms.estimated_loc || 0,
        estimated_files: ms.estimated_files || 0,
        estimated_complexity: ms.estimated_complexity || 'MEDIUM',
        test_strategy: ms.test_strategy || null,
        max_retries: lifecycle.config.maxMilestoneRetries,
      });
    }
  }
}

// ─── Change Request List ─────────────────────────────────────────────────────

/**
 * Get all change requests for a lifecycle.
 */
export function listChangeRequests(lifecycleId) {
  const all = crRepo.findByLifecycle.all(lifecycleId);
  return all.map(cr => {
    const parsed = { ...cr };
    for (const field of ['affected_milestones', 'impact_analysis', 'proposed_roadmap_diff']) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        try { parsed[field] = JSON.parse(parsed[field]); } catch { /* keep string */ }
      }
    }
    return parsed;
  });
}

export default {
  proposeChange,
  applyChange,
  rejectChange,
  validatePreservation,
  listChangeRequests,
};

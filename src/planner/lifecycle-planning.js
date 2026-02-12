// Lifecycle PLANNING Phase — Roadmap Generation & Versioning
// ══════════════════════════════════════════════════════════════════════════════
// PLANNING → PLAN_REVIEW flow:
//   1. Spec approved → D1 generates roadmap with milestones
//   2. Each milestone: size estimates, dependencies, test strategy
//   3. Size validation per milestone (max LOC, max files)
//   4. User reviews → approve or revise → start BUILD
//
// IMMUTABLE VERSIONING:
//   Change = new version with diff + reason.
//   Completed milestones preserved across versions.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import {
  lifecycles as lifecycleRepo,
  roadmapVersions,
  milestones as msRepo,
} from '../db/database.js';
import { generateRoadmap as generateRoadmapPrompt } from './lifecycle-prompts.js';
import { validateMilestoneSize, suggestMilestoneSplit } from './milestone-size.js';
import { ProjectPhase } from './lifecycle.js';

// ─── PLANNING Phase Operations ───────────────────────────────────────────────

/**
 * Generate a roadmap from the approved spec.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<{ roadmap: Object, milestones: Object[], sizeWarnings: Object[] }>}
 */
export async function generateRoadmap(lifecycle) {
  logger.info('LifecyclePlanning', 'Generating roadmap', { lifecycleId: lifecycle.id });

  const spec = lifecycleRepo.getSpec(lifecycle.id);
  if (!spec) {
    throw new Error('No spec found — complete SPEC phase first');
  }

  const prompt = generateRoadmapPrompt(spec);
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const roadmap = parseJSON(result.content);

  if (!roadmap || !roadmap.milestones || roadmap.milestones.length === 0) {
    throw new Error('D1 failed to generate a roadmap with milestones');
  }

  // Validate each milestone size
  const sizeWarnings = [];
  for (const ms of roadmap.milestones) {
    const validation = validateMilestoneSize(ms, {
      maxLOC: lifecycle.config.maxMilestoneLOC,
      maxFiles: lifecycle.config.maxMilestoneFiles,
    });

    if (!validation.fits) {
      const split = suggestMilestoneSplit(ms);
      sizeWarnings.push({
        milestoneId: ms.id,
        title: ms.title,
        issues: validation.issues,
        suggestions: split.suggestions,
      });
    } else if (validation.warnings.length > 0) {
      sizeWarnings.push({
        milestoneId: ms.id,
        title: ms.title,
        warnings: validation.warnings,
      });
    }
  }

  // Validate dependencies — no circular, no missing refs
  const depErrors = validateDependencies(roadmap.milestones);
  if (depErrors.length > 0) {
    logger.warn('LifecyclePlanning', 'Dependency issues in roadmap', { errors: depErrors });
  }

  // Store as version 1 (or next version)
  const currentVersion = roadmapVersions.getLatestVersion(lifecycle.id);
  const newVersion = currentVersion + 1;

  roadmapVersions.addVersion(
    lifecycle.id,
    newVersion,
    roadmap,
    newVersion === 1 ? 'Initial roadmap' : 'Revised roadmap',
    null
  );

  // Create milestone DB records
  for (const ms of roadmap.milestones) {
    msRepo.addMilestone({
      id: ms.id,
      lifecycle_id: lifecycle.id,
      roadmap_version: newVersion,
      sequence: parseInt(ms.id.replace('ms-', ''), 10) || roadmap.milestones.indexOf(ms) + 1,
      title: ms.title,
      description: ms.description,
      dependencies: ms.dependencies || [],
      estimated_loc: ms.estimated_loc || 0,
      estimated_files: ms.estimated_files || 0,
      estimated_complexity: ms.estimated_complexity || 'MEDIUM',
      test_strategy: ms.test_strategy || null,
      max_retries: lifecycle.config.maxMilestoneRetries,
    });
  }

  logger.info('LifecyclePlanning', `Roadmap v${newVersion} created`, {
    lifecycleId: lifecycle.id,
    milestones: roadmap.milestones.length,
    sizeWarnings: sizeWarnings.length,
  });

  return {
    roadmap,
    version: newVersion,
    milestones: roadmap.milestones,
    sizeWarnings,
    dependencyErrors: depErrors,
  };
}

/**
 * Approve the roadmap → transition to BUILD.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<void>}
 */
export async function approveRoadmap(lifecycle) {
  const latest = roadmapVersions.getLatestRoadmap(lifecycle.id);
  if (!latest) {
    throw new Error('No roadmap to approve — generate one first');
  }

  // Check for blocking size issues
  const milestonesList = msRepo.listByLifecycle(lifecycle.id);
  const blockers = [];
  for (const ms of milestonesList) {
    if (ms.status !== 'PENDING') continue;
    const validation = validateMilestoneSize(ms, {
      maxLOC: lifecycle.config.maxMilestoneLOC,
      maxFiles: lifecycle.config.maxMilestoneFiles,
    });
    if (!validation.fits) {
      blockers.push({ id: ms.id, title: ms.title, issues: validation.issues });
    }
  }

  if (blockers.length > 0) {
    throw new Error(
      `Cannot approve: ${blockers.length} milestone(s) exceed size limits: ${blockers.map(b => b.id).join(', ')}`
    );
  }

  await lifecycle.transitionTo(ProjectPhase.BUILD);
  logger.info('LifecyclePlanning', 'Roadmap approved, transitioning to BUILD', {
    lifecycleId: lifecycle.id,
    version: latest.version,
  });
}

/**
 * Revise the roadmap based on user feedback.
 * Creates a new version, preserving completed milestones.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} feedback - User's revision feedback
 * @returns {Promise<{ roadmap: Object, version: number, sizeWarnings: Object[] }>}
 */
export async function reviseRoadmap(lifecycle, feedback) {
  logger.info('LifecyclePlanning', 'Revising roadmap', { lifecycleId: lifecycle.id });

  const spec = lifecycleRepo.getSpec(lifecycle.id);
  const currentRoadmap = roadmapVersions.getLatestRoadmap(lifecycle.id);

  if (!currentRoadmap) {
    throw new Error('No roadmap to revise — generate one first');
  }

  // Get completed milestones (must be preserved)
  const completed = msRepo.getCompleted(lifecycle.id);

  // Re-generate with feedback
  const enrichedPrompt = `${generateRoadmapPrompt(spec)}

## User Feedback on Previous Roadmap
${feedback}

## Previous Roadmap (for reference)
${JSON.stringify(currentRoadmap.roadmap, null, 2)}

## Completed Milestones (MUST be preserved as-is)
${completed.map(m => `- ${m.id}: ${m.title} (PASSED, commit: ${m.commit_hash})`).join('\n') || 'None'}

IMPORTANT: Do NOT modify or remove completed milestones. Adjust remaining milestones based on feedback.`;

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', enrichedPrompt);
  const newRoadmap = parseJSON(result.content);

  if (!newRoadmap || !newRoadmap.milestones) {
    throw new Error('D1 failed to revise roadmap');
  }

  // Verify completed milestones are preserved
  for (const comp of completed) {
    const found = newRoadmap.milestones.find(m => m.id === comp.id);
    if (!found) {
      throw new Error(`Revised roadmap dropped completed milestone ${comp.id}`);
    }
  }

  // Size validation
  const sizeWarnings = [];
  for (const ms of newRoadmap.milestones) {
    const validation = validateMilestoneSize(ms, {
      maxLOC: lifecycle.config.maxMilestoneLOC,
      maxFiles: lifecycle.config.maxMilestoneFiles,
    });
    if (!validation.fits || validation.warnings.length > 0) {
      sizeWarnings.push({
        milestoneId: ms.id,
        issues: validation.issues,
        warnings: validation.warnings,
      });
    }
  }

  // Store as new version
  const newVersion = roadmapVersions.getLatestVersion(lifecycle.id) + 1;
  const diffSummary = computeRoadmapDiff(currentRoadmap.roadmap, newRoadmap);

  roadmapVersions.addVersion(
    lifecycle.id,
    newVersion,
    newRoadmap,
    `User revision: ${feedback.substring(0, 100)}`,
    JSON.stringify(diffSummary)
  );

  // Update milestone DB records for new/changed milestones
  // Keep completed milestones, re-create pending ones
  const existingMs = msRepo.listByLifecycle(lifecycle.id);
  const existingIds = new Set(existingMs.map(m => m.id));

  for (const ms of newRoadmap.milestones) {
    // Skip completed milestones — already in DB
    if (completed.some(c => c.id === ms.id)) continue;

    // Delete old pending version if exists
    if (existingIds.has(ms.id)) {
      // Update in place for existing non-completed
      msRepo.updateStatus.run('PENDING', ms.id);
    } else {
      // Add new milestone
      msRepo.addMilestone({
        id: ms.id,
        lifecycle_id: lifecycle.id,
        roadmap_version: newVersion,
        sequence: parseInt(ms.id.replace('ms-', ''), 10) || newRoadmap.milestones.indexOf(ms) + 1,
        title: ms.title,
        description: ms.description,
        dependencies: ms.dependencies || [],
        estimated_loc: ms.estimated_loc || 0,
        estimated_files: ms.estimated_files || 0,
        estimated_complexity: ms.estimated_complexity || 'MEDIUM',
        test_strategy: ms.test_strategy || null,
        max_retries: lifecycle.config.maxMilestoneRetries,
      });
    }
  }

  // Ensure phase is PLANNING (may have been in PLAN_REVIEW)
  if (lifecycle.phase === ProjectPhase.PLAN_REVIEW) {
    await lifecycle.transitionTo(ProjectPhase.PLANNING);
  }

  return {
    roadmap: newRoadmap,
    version: newVersion,
    sizeWarnings,
    diff: diffSummary,
  };
}

// ─── Dependency Validation ───────────────────────────────────────────────────

/**
 * Validate milestone dependencies — no circular, no missing refs.
 * @param {Object[]} milestoneList
 * @returns {string[]} errors
 */
export function validateDependencies(milestoneList) {
  const errors = [];
  const ids = new Set(milestoneList.map(m => m.id));

  for (const ms of milestoneList) {
    const deps = ms.dependencies || [];
    for (const dep of deps) {
      if (!ids.has(dep)) {
        errors.push(`${ms.id} depends on ${dep} which doesn't exist`);
      }
      if (dep === ms.id) {
        errors.push(`${ms.id} depends on itself`);
      }
    }
  }

  // Check for circular dependencies
  const visited = new Set();
  const visiting = new Set();

  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    const ms = milestoneList.find(m => m.id === id);
    if (ms) {
      for (const dep of (ms.dependencies || [])) {
        if (hasCycle(dep)) {
          errors.push(`Circular dependency detected involving ${id}`);
          return true;
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const ms of milestoneList) {
    visited.clear();
    visiting.clear();
    hasCycle(ms.id);
  }

  return [...new Set(errors)]; // deduplicate
}

// ─── Roadmap Diff ────────────────────────────────────────────────────────────

/**
 * Compute diff between two roadmap versions.
 * @param {Object} oldRoadmap
 * @param {Object} newRoadmap
 * @returns {{ added: string[], removed: string[], modified: string[], preserved: string[] }}
 */
function computeRoadmapDiff(oldRoadmap, newRoadmap) {
  const oldIds = new Set((oldRoadmap?.milestones || []).map(m => m.id));
  const newIds = new Set((newRoadmap?.milestones || []).map(m => m.id));

  const added = [...newIds].filter(id => !oldIds.has(id));
  const removed = [...oldIds].filter(id => !newIds.has(id));
  const preserved = [...newIds].filter(id => oldIds.has(id));

  // Check for modifications in preserved milestones
  const modified = [];
  for (const id of preserved) {
    const oldMs = (oldRoadmap?.milestones || []).find(m => m.id === id);
    const newMs = (newRoadmap?.milestones || []).find(m => m.id === id);
    if (oldMs && newMs && JSON.stringify(oldMs) !== JSON.stringify(newMs)) {
      modified.push(id);
    }
  }

  return { added, removed, modified, preserved: preserved.filter(id => !modified.includes(id)) };
}

/**
 * Check if a milestone's dependencies are all completed.
 * @param {string} milestoneId
 * @param {string} lifecycleId
 * @returns {{ ready: boolean, blockedBy: string[] }}
 */
export function checkDependencies(milestoneId, lifecycleId) {
  const ms = msRepo.getMilestone(milestoneId);
  if (!ms) return { ready: false, blockedBy: ['milestone not found'] };

  const deps = ms.dependencies || [];
  if (deps.length === 0) return { ready: true, blockedBy: [] };

  const blockedBy = [];
  for (const depId of deps) {
    const dep = msRepo.getMilestone(depId);
    if (!dep || dep.status !== 'PASSED') {
      blockedBy.push(depId);
    }
  }

  return { ready: blockedBy.length === 0, blockedBy };
}

export default {
  generateRoadmap,
  approveRoadmap,
  reviseRoadmap,
  validateDependencies,
  checkDependencies,
};

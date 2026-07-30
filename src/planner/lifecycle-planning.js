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

import { writeFile } from 'fs/promises';
import { join, isAbsolute } from 'path';
import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import {
  lifecycles as lifecycleRepo,
  roadmapVersions,
  milestones as msRepo,
} from '../db/database.js';
import { generateRoadmap as generateRoadmapPrompt } from './lifecycle-prompts.js';
import { validateMilestoneSize, suggestMilestoneSplit } from './milestone-size.js';
import { splitFirstRoadmapMilestone } from './milestone-decomposer.js';
import { ProjectPhase } from './lifecycle.js';
import { logRoadmapScore } from './quality-telemetry.js';
import {
  assertCompletedMilestonesPreserved,
  syncRevisedMilestones,
} from './milestone-sync.js';

// v112: Adaptive Build Strategy — lazy-loaded
let _buildStratLoaded = false;
let _selectStrategy, _formatStrategyForPrompt;

async function ensureBuildStrategy() {
  if (_buildStratLoaded) return true;
  try {
    const mod = await import('./build-strategy.js');
    _selectStrategy = mod.selectStrategy;
    _formatStrategyForPrompt = mod.formatStrategyForPrompt;
    _buildStratLoaded = true;
    return true;
  } catch (err) {
    logger.warn('LifecyclePlanning', `Build strategy not available: ${err.message}`);
    return false;
  }
}

// ─── Milestone ID Scoping ────────────────────────────────────────────────────
// Milestone IDs from D1 are always "ms-1", "ms-2", etc. — global collisions
// when multiple lifecycles coexist. Scope with lifecycle suffix before DB storage.

/** "ms-1" + "lc-1772...-msh2" → "ms-1@msh2" */
export function scopeId(lifecycleId, rawId) {
  if (!rawId || rawId.includes('@')) return rawId; // already scoped or null
  const suffix = lifecycleId.split('-').pop();
  return `${rawId}@${suffix}`;
}

/** "ms-1@msh2" → "ms-1" */
export function rawId(scopedId) {
  if (!scopedId) return scopedId;
  return scopedId.replace(/@[^@]+$/, '');
}

/** Scope all milestone IDs + dependency references in a roadmap's milestones array. */
function _scopeRoadmapMilestones(milestones, lifecycleId) {
  for (const ms of milestones) {
    ms.id = scopeId(lifecycleId, ms.id);
    if (Array.isArray(ms.dependencies)) {
      ms.dependencies = ms.dependencies.map(d => scopeId(lifecycleId, d));
    }
  }
}

// ─── PLANNING Phase Operations ───────────────────────────────────────────────

/**
 * Generate a roadmap from the approved spec.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<{ roadmap: Object, milestones: Object[], sizeWarnings: Object[] }>}
 */
export async function generateRoadmap(lifecycle, context) {
  logger.info('LifecyclePlanning', 'Generating roadmap', { lifecycleId: lifecycle.id });

  const spec = lifecycleRepo.getSpec(lifecycle.id);
  if (!spec) {
    throw new Error('No spec found — complete SPEC phase first');
  }
  // System step: spec loaded for roadmap generation
  if (typeof context?.onSystemStep === 'function') {
    try { context.onSystemStep('spec_loaded', lifecycle.id, 2); } catch (_) {}
  }

  // v112: Inject build strategy hint if architecture is available
  let strategySection = '';
  if (await ensureBuildStrategy()) {
    try {
      const arch = lifecycle._detectedArchitecture || context?.architecture || null;
      if (arch) {
        const stratResult = _selectStrategy(arch);
        strategySection = _formatStrategyForPrompt(stratResult);
        if (strategySection) {
          logger.info('LifecyclePlanning', `Build strategy: ${stratResult.strategy} (${Math.round(stratResult.confidence * 100)}%)`, {
            lifecycleId: lifecycle.id,
          });
        }
      }
    } catch (err) {
      logger.warn('LifecyclePlanning', `Build strategy selection failed: ${err.message}`);
    }
  }

  const prompt = generateRoadmapPrompt(spec) + (strategySection ? `\n\n${strategySection}` : '');
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const roadmap = parseJSON(result.content);

  if (!roadmap || !roadmap.milestones || roadmap.milestones.length === 0) {
    throw new Error('D1 failed to generate a roadmap with milestones');
  }

  // Validate roadmap quality (min milestones, coverage, required fields)
  const roadmapCheck = validateRoadmap(roadmap, spec);
  if (!roadmapCheck.valid) {
    logger.warn('LifecyclePlanning', 'Roadmap validation failed, retrying D1', {
      lifecycleId: lifecycle.id,
      errors: roadmapCheck.errors,
    });

    // Retry with explicit constraints + higher temperature
    const frCount = (spec?.requirements?.functional || []).length;
    const minMs = frCount >= 5 ? 4 : 3;
    const retryPrompt = generateRoadmapPrompt(spec) +
      `\n\nCRITICAL: Your previous attempt failed validation. Fix these issues:\n` +
      roadmapCheck.errors.map(e => `- ${e}`).join('\n') +
      `\n\nYou MUST generate at least ${minMs} milestones. The LAST milestone must cover integration, testing and documentation.`;

    const retryResult = await llm('D1', retryPrompt);
    const retryRoadmap = parseJSON(retryResult.content);

    if (retryRoadmap?.milestones?.length > 0) {
      const retryCheck = validateRoadmap(retryRoadmap, spec);
      if (retryCheck.valid) {
        Object.assign(roadmap, retryRoadmap);
      } else {
        logger.warn('LifecyclePlanning', 'Retry also failed validation, proceeding with best effort', {
          retryErrors: retryCheck.errors,
        });
        // Use whichever has more milestones
        if (retryRoadmap.milestones.length > roadmap.milestones.length) {
          Object.assign(roadmap, retryRoadmap);
        }
      }
    }
  }

  // v135.1: Auto-split first milestone if it exceeds stricter thresholds.
  try {
    const split = splitFirstRoadmapMilestone(roadmap);
    if (split.split) {
      logger.info('LifecyclePlanning', 'Auto-split first milestone', {
        original: split.originalMilestoneId,
        replacements: split.replacementIds.length,
        lifecycleId: lifecycle.id,
      });
    }
  } catch (err) {
    logger.warn('LifecyclePlanning', `First milestone auto-split failed: ${err.message}`);
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

  // Store raw (unscoped) roadmap in versions — D1 prompts reference this
  roadmapVersions.addVersion(
    lifecycle.id,
    newVersion,
    roadmap,
    newVersion === 1 ? 'Initial roadmap' : 'Revised roadmap',
    null
  );

  // Scope milestone IDs to prevent cross-lifecycle PK collisions
  _scopeRoadmapMilestones(roadmap.milestones, lifecycle.id);

  // Create milestone DB records (scoped IDs)
  for (let i = 0; i < roadmap.milestones.length; i++) {
    const ms = roadmap.milestones[i];
    // Resolve checkpoint_mode: explicit from LLM > positional heuristic
    const checkpointMode = ms.checkpoint_mode ||
      (i === 0 ? 'STRUCTURAL' : i === roadmap.milestones.length - 1 ? 'SECURITY' : 'FUNCTIONAL');

    msRepo.addMilestone({
      id: ms.id,
      lifecycle_id: lifecycle.id,
      roadmap_version: newVersion,
      sequence: i + 1,
      title: ms.title,
      description: ms.description,
      dependencies: ms.dependencies || [],
      estimated_loc: ms.estimated_loc || 0,
      estimated_files: ms.estimated_files || 0,
      estimated_complexity: ms.estimated_complexity || 'MEDIUM',
      test_strategy: ms.test_strategy || null,
      max_retries: lifecycle.config.maxMilestoneRetries,
      checkpoint_mode: checkpointMode,
    });
  }

  // Write ROADMAP.md to disk (after milestones are in DB)
  await writeRoadmapFile(lifecycle.projectPath, lifecycle.id, context);

  // v97: Auto-generate ARCHITECTURE.json from spec
  try {
    const { architectureContractPrompt } = await import('./architecture-check.js');
    const archPrompt = architectureContractPrompt(spec);
    const archResult = await llm('D1', archPrompt);
    const archContract = parseJSON(archResult.content);
    if (archContract?.layers && archContract?.rules && archContract?.fileStructure) {
      await writeFile(
        join(lifecycle.projectPath, 'ARCHITECTURE.json'),
        JSON.stringify(archContract, null, 2),
        'utf-8'
      );
      logger.info('LifecyclePlanning', 'ARCHITECTURE.json generated', {
        lifecycleId: lifecycle.id,
        layers: archContract.layers.length,
        rules: archContract.rules.length,
      });

      // v100: Also generate .c3/architecture-policy.json from ACF
      try {
        const { acfToPolicy, savePolicy } = await import('./architecture-policy.js');
        const policy = acfToPolicy(archContract);
        await savePolicy(lifecycle.projectPath, policy);
        logger.info('LifecyclePlanning', 'Architecture policy generated from ACF', {
          lifecycleId: lifecycle.id,
        });
      } catch (policyErr) {
        logger.warn('LifecyclePlanning', 'Policy generation failed (non-blocking)', { error: policyErr.message });
      }
    }
  } catch (err) {
    logger.warn('LifecyclePlanning', 'ARCHITECTURE.json generation failed (non-blocking)', { error: err.message });
  }

  // Quality telemetry — observational, never blocks
  logRoadmapScore(lifecycle.id, roadmap, newVersion);

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

  // Re-generate with feedback — use raw (unscoped) IDs in prompt so D1 produces standard ms-N format
  const enrichedPrompt = `${generateRoadmapPrompt(spec)}

## User Feedback on Previous Roadmap
${feedback}

## Previous Roadmap (for reference)
${JSON.stringify(currentRoadmap.roadmap, null, 2)}

## Completed Milestones (MUST be preserved as-is)
${completed.map(m => `- ${rawId(m.id)}: ${m.title} (PASSED, commit: ${m.commit_hash})`).join('\n') || 'None'}

IMPORTANT: Do NOT modify or remove completed milestones. Adjust remaining milestones based on feedback.`;

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', enrichedPrompt);
  const newRoadmap = parseJSON(result.content);

  if (!newRoadmap || !newRoadmap.milestones) {
    throw new Error('D1 failed to revise roadmap');
  }

  assertCompletedMilestonesPreserved(
    currentRoadmap.roadmap.milestones,
    newRoadmap.milestones,
    completed.map(milestone => rawId(milestone.id))
  );

  // Scope all IDs before comparison with DB (which has scoped IDs)
  _scopeRoadmapMilestones(newRoadmap.milestones, lifecycle.id);

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

  // Store raw (unscoped) version for D1 prompts
  const newVersion = roadmapVersions.getLatestVersion(lifecycle.id) + 1;
  const diffSummary = computeRoadmapDiff(currentRoadmap.roadmap, newRoadmap);

  // Unscope for version storage (D1 prompts reference this)
  const unscopedRoadmap = {
    ...newRoadmap,
    milestones: newRoadmap.milestones.map(m => ({
      ...m,
      id: rawId(m.id),
      dependencies: (m.dependencies || []).map(d => rawId(d)),
    })),
  };

  // Store the immutable version and apply its definitions in one transaction.
  // A rejected reorder must not become the latest roadmap version.
  syncRevisedMilestones(
    lifecycle,
    newRoadmap.milestones,
    completed,
    newVersion,
    {
      persistVersion: () => roadmapVersions.addVersion(
        lifecycle.id,
        newVersion,
        unscopedRoadmap,
        `User revision: ${feedback.substring(0, 100)}`,
        JSON.stringify(diffSummary)
      ),
    }
  );

  // Write ROADMAP.md to disk (after milestones are updated in DB)
  await writeRoadmapFile(lifecycle.projectPath, lifecycle.id);

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

// ─── Roadmap Validation ──────────────────────────────────────────────────────

/**
 * Validate a roadmap against quality requirements.
 * @param {Object} roadmap - { milestones: [...], requirements_coverage?: {...} }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRoadmap(roadmap, spec = null) {
  const errors = [];

  if (!roadmap) {
    return { valid: false, errors: ['Roadmap is null or undefined'] };
  }

  if (!Array.isArray(roadmap.milestones) || roadmap.milestones.length === 0) {
    return { valid: false, errors: ['Roadmap has no milestones'] };
  }

  const ms = roadmap.milestones;

  // ─── Minimum milestone count ──────────────────────────────────────────
  const frCount = (spec?.requirements?.functional || []).length;
  const minMs = frCount >= 5 ? 4 : 3;
  if (ms.length < minMs) {
    errors.push(`Need ≥${minMs} milestones, got ${ms.length}`);
  }

  // ─── Each milestone: required fields ──────────────────────────────────
  for (const m of ms) {
    if (!m.title) errors.push(`Milestone ${m.id || '?'}: missing title`);
    if (!m.description) errors.push(`${m.id || '?'}: missing description`);

    if (!Array.isArray(m.acceptance_criteria) || m.acceptance_criteria.length === 0) {
      errors.push(`Milestone ${m.id || '?'} missing acceptance_criteria`);
    }
    if (!Array.isArray(m.deliverables) || m.deliverables.length === 0) {
      errors.push(`${m.id || '?'}: missing deliverables`);
    }
    if (!m.test_strategy || typeof m.test_strategy !== 'object') {
      errors.push(`Milestone ${m.id || '?'} missing test_strategy`);
    }
  }

  // ─── Last milestone: integration/testing/docs ─────────────────────────
  if (ms.length > 0) {
    const last = ms[ms.length - 1];
    const lastText = (last.title || '') + ' ' + (last.description || '');
    if (!/test|integr|doc|kvalit|final|verifi/i.test(lastText)) {
      errors.push('Last milestone should cover integration/testing/documentation');
    }
  }

  // ─── Dependencies ─────────────────────────────────────────────────────
  const depErrors = validateDependencies(roadmap.milestones);
  errors.push(...depErrors);

  // ─── Requirements coverage ────────────────────────────────────────────
  if (!roadmap.requirements_coverage) {
    errors.push('Roadmap missing requirements_coverage');
  } else {
    const uncovered = roadmap.requirements_coverage.uncovered || [];
    if (uncovered.length > 0) {
      const rationale = roadmap.requirements_coverage.rationale_for_uncovered || '';
      if (!rationale || rationale.trim().length === 0) {
        errors.push(`Roadmap has ${uncovered.length} uncovered requirements without rationale`);
      }
    }
  }

  // ─── Spec-based FR coverage (if spec available) ───────────────────────
  if (spec) {
    const frIds = (spec.requirements?.functional || [])
      .map(fr => fr.id || fr.name || '')
      .filter(Boolean);

    // FR ID uniqueness
    if (frIds.length > 0 && new Set(frIds).size !== frIds.length) {
      errors.push('Duplicate functional requirement IDs in spec');
    }

    // Check each FR appears in requirements_addressed of at least one milestone
    for (const frId of frIds) {
      const covered = ms.some(m =>
        (m.requirements_addressed || []).includes(frId) ||
        (m.goals_addressed || []).includes(frId)
      );
      if (!covered) {
        // Also check requirements_coverage map
        const covMap = roadmap.requirements_coverage || {};
        const inMap = covMap[frId] || (covMap.covered || []).includes(frId);
        if (!inMap) {
          errors.push(`Requirement ${frId} not covered by any milestone`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
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
    // PASSED = completed, SKIPPED = user explicitly skipped (satisfies dependency)
    if (!dep || (dep.status !== 'PASSED' && dep.status !== 'SKIPPED')) {
      blockedBy.push(depId);
    }
  }

  return { ready: blockedBy.length === 0, blockedBy };
}

// ─── ROADMAP.md File Writer ─────────────────────────────────────────────────

const STATUS_LABELS = {
  PASSED: 'DONE',
  EXECUTING: 'IN PROGRESS',
  TESTING: 'TESTING',
  REVIEW: 'IN REVIEW',
  PLANNING: 'PLANNING',
  AWAITING_PLAN: 'AWAITING PLAN',
  PENDING: 'PENDING',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
};

/**
 * Write ROADMAP.md to disk — physical file reflecting current roadmap state.
 * Called after: generateRoadmap(), reviseRoadmap(), milestone PASSED, change applied.
 *
 * @param {string} projectPath - Project root directory
 * @param {string} lifecycleId - Lifecycle ID
 */
export async function writeRoadmapFile(projectPath, lifecycleId, context) {
  if (!projectPath || !lifecycleId) return;
  if (!isAbsolute(projectPath)) {
    logger.warn('LifecyclePlanning', `writeRoadmapFile: skipped — not absolute path (${projectPath})`);
    return;
  }

  try {
    const milestonesList = msRepo.listByLifecycle(lifecycleId);
    const latestVersion = roadmapVersions.getLatestVersion(lifecycleId);
    const versions = roadmapVersions.findByLifecycle.all(lifecycleId);

    const lines = [];
    lines.push('# ROADMAP');
    lines.push('');
    lines.push(`> C3 Lifecycle Engine — Roadmap v${latestVersion}`);
    lines.push('');
    lines.push('## Milestones');
    lines.push('');
    lines.push('| # | Milestone | Status | Commit |');
    lines.push('|---|-----------|--------|--------|');

    for (const ms of milestonesList) {
      const seq = ms.sequence || '?';
      const status = STATUS_LABELS[ms.status] || ms.status;
      const commit = ms.commit_hash ? `\`${ms.commit_hash.substring(0, 7)}\`` : '—';
      lines.push(`| ${seq} | ${ms.title} | ${status} | ${commit} |`);
    }

    if (versions.length > 0) {
      lines.push('');
      lines.push('## Version History');
      lines.push('');
      const sorted = [...versions].sort((a, b) => a.version - b.version);
      for (const v of sorted) {
        const date = v.created_at ? v.created_at.split('T')[0] : '?';
        const reason = v.change_reason || 'No description';
        lines.push(`- **v${v.version}** (${date}): ${reason}`);
      }
    }

    lines.push('');

    const filePath = join(projectPath, 'ROADMAP.md');
    await writeFile(filePath, lines.join('\n'), 'utf-8');

    // System step: file written
    if (context && typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('file_written', 'ROADMAP.md \u2192 ' + filePath); } catch (_) {}
    }

    logger.info('LifecyclePlanning', 'ROADMAP.md written', {
      lifecycleId,
      version: latestVersion,
      milestones: milestonesList.length,
    });
  } catch (err) {
    logger.warn('LifecyclePlanning', `Failed to write ROADMAP.md: ${err.message}`, {
      lifecycleId,
      projectPath,
    });
  }
}

export default {
  generateRoadmap,
  approveRoadmap,
  reviseRoadmap,
  validateRoadmap,
  validateDependencies,
  checkDependencies,
  writeRoadmapFile,
  scopeId,
  rawId,
};

// Milestone Decomposer v100 — Auto-Split Large Milestones
// ══════════════════════════════════════════════════════════════════════════════
//
// When a milestone exceeds size limits (>1500 LOC or >8 files):
//   1. Analyze scope_files
//   2. Group by module/layer from snapshot
//   3. Detect inter-group dependencies
//   4. Split into subtasks (max 800 LOC each)
//   5. Topological sort by dependencies
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import path from 'path';

// ─── Size Thresholds ────────────────────────────────────────────────────────

const DEFAULT_MAX_LOC = 1500;
const DEFAULT_MAX_FILES = 8;
const SUBTASK_MAX_LOC = 800;

// v135.1: Stricter thresholds for first milestone (no prior context, highest hallucination risk)
const FIRST_MS_MAX_LOC = 800;
const FIRST_MS_MAX_FILES = 5;

// ─── Should Decompose? ──────────────────────────────────────────────────────

/**
 * Determine if a milestone should be decomposed into subtasks.
 *
 * @param {Object} milestone - { estimated_loc, estimated_files, estimated_complexity, scope_files }
 * @param {Object} [snapshot] - Project snapshot (unused for now, reserved)
 * @param {Object} [opts]
 * @param {number} [opts.maxLOC=1500] - LOC threshold
 * @param {number} [opts.maxFiles=8] - File count threshold
 * @param {boolean} [opts.firstMilestone=false] - v135.1: Use stricter thresholds for first milestone
 * @returns {boolean}
 */
export function shouldDecompose(milestone, snapshot = null, opts = {}) {
  if (!milestone) return false;

  const isFirst = opts.firstMilestone || false;
  const maxLOC = isFirst ? FIRST_MS_MAX_LOC : (opts.maxLOC || DEFAULT_MAX_LOC);
  const maxFiles = isFirst ? FIRST_MS_MAX_FILES : (opts.maxFiles || DEFAULT_MAX_FILES);

  const estimatedLoc = milestone.estimated_loc || 0;
  const estimatedFiles = milestone.estimated_files || 0;
  const complexity = (milestone.estimated_complexity || '').toUpperCase();

  // Direct size check
  if (estimatedLoc > maxLOC) return true;
  if (estimatedFiles > maxFiles) return true;

  // High complexity + medium size = decompose
  if (complexity === 'HIGH' && estimatedLoc > maxLOC * 0.6) return true;

  // Scope files count
  const scopeFiles = _parseScopeFiles(milestone.scope_files);
  if (scopeFiles.length > maxFiles) return true;

  return false;
}

// ─── Decompose Milestone ────────────────────────────────────────────────────

/**
 * Split a milestone into ordered subtasks.
 *
 * @param {Object} milestone - { id, title, description, scope_files, estimated_loc }
 * @param {Object} [snapshot] - Project snapshot for module grouping
 * @param {Object} [opts]
 * @returns {Object} SubtaskPlan
 */
export function decomposeMilestone(milestone, snapshot = null, opts = {}) {
  if (!milestone) {
    return { originalMilestone: null, subtasks: [], executionOrder: [], totalEstimatedLoc: 0 };
  }

  const scopeFiles = _parseScopeFiles(milestone.scope_files);
  const totalLOC = milestone.estimated_loc || scopeFiles.length * 100;

  // 1. Group files by module/layer
  const groups = _groupByModule(scopeFiles, snapshot);

  // 2. Split large groups into sub-groups (max SUBTASK_MAX_LOC)
  const subtasks = [];
  let subtaskIdx = 1;

  for (const [module, files] of Object.entries(groups)) {
    const groupLOC = Math.round((files.length / Math.max(scopeFiles.length, 1)) * totalLOC);

    if (groupLOC > SUBTASK_MAX_LOC && files.length > 1) {
      // Split this group
      const chunkSize = Math.ceil(files.length / Math.ceil(groupLOC / SUBTASK_MAX_LOC));
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);
        const chunkLOC = Math.round((chunk.length / Math.max(scopeFiles.length, 1)) * totalLOC);
        subtasks.push({
          id: `${milestone.id}-sub${subtaskIdx}`,
          title: `${milestone.title} — ${module} (part ${Math.floor(i / chunkSize) + 1})`,
          scope_files: chunk,
          estimated_loc: chunkLOC,
          dependencies: subtaskIdx > 1 ? [`${milestone.id}-sub${subtaskIdx - 1}`] : [],
          module,
        });
        subtaskIdx++;
      }
    } else {
      subtasks.push({
        id: `${milestone.id}-sub${subtaskIdx}`,
        title: `${milestone.title} — ${module}`,
        scope_files: files,
        estimated_loc: groupLOC,
        dependencies: [],
        module,
      });
      subtaskIdx++;
    }
  }

  // 3. Establish dependencies: infra/model before service, service before controller
  _assignDependencies(subtasks);

  // 4. Topological sort
  const executionOrder = _topologicalSort(subtasks);

  logger.info('MilestoneDecomposer', `Decomposed "${milestone.title}" into ${subtasks.length} subtasks`, {
    milestoneId: milestone.id,
    totalLOC,
    subtaskCount: subtasks.length,
  });

  return {
    originalMilestone: milestone.id,
    subtasks,
    executionOrder,
    totalEstimatedLoc: totalLOC,
  };
}

/**
 * Replace an oversized first roadmap milestone with schema-complete milestones.
 * Later milestones that depended on the original milestone are rewired to the
 * final replacement so roadmap ordering and dependency validity are preserved.
 *
 * @param {Object} roadmap - Roadmap with a milestones array
 * @returns {{ split: boolean, originalMilestoneId?: string, replacementIds?: string[] }}
 */
export function splitFirstRoadmapMilestone(roadmap) {
  const milestones = roadmap?.milestones;
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { split: false };
  }

  const original = milestones[0];
  if (!shouldDecompose(original, null, { firstMilestone: true })) {
    return { split: false };
  }

  const plan = decomposeMilestone(original, null);
  if (!Array.isArray(plan.subtasks) || plan.subtasks.length < 2) {
    return { split: false };
  }

  const byId = new Map(plan.subtasks.map(subtask => [subtask.id, subtask]));
  const ordered = plan.executionOrder
    .map(id => byId.get(id))
    .filter(Boolean);
  for (const subtask of plan.subtasks) {
    if (!ordered.includes(subtask)) ordered.push(subtask);
  }

  const originalDependencies = Array.isArray(original.dependencies)
    ? original.dependencies
    : [];
  const replacements = ordered.map((subtask, index) => ({
    ...original,
    ...subtask,
    description: original.description,
    deliverables: subtask.scope_files.length > 0
      ? [...subtask.scope_files]
      : [...(original.deliverables || [])],
    acceptance_criteria: [...(original.acceptance_criteria || [])],
    requirements_addressed: [...(original.requirements_addressed || [])],
    goals_addressed: [...(original.goals_addressed || [])],
    test_strategy: original.test_strategy ? { ...original.test_strategy } : original.test_strategy,
    estimated_files: subtask.scope_files.length,
    dependencies: [...new Set([
      ...originalDependencies,
      ...(subtask.dependencies || []),
    ])],
    checkpoint_mode: index === 0
      ? original.checkpoint_mode
      : 'FUNCTIONAL',
    auto_decomposed_from: original.id,
  }));

  const finalReplacementId = replacements[replacements.length - 1].id;
  const remaining = milestones.slice(1).map(milestone => ({
    ...milestone,
    dependencies: (milestone.dependencies || []).map(dependency => (
      dependency === original.id ? finalReplacementId : dependency
    )),
  }));

  roadmap.milestones = [...replacements, ...remaining];
  return {
    split: true,
    originalMilestoneId: original.id,
    replacementIds: replacements.map(milestone => milestone.id),
  };
}

// ─── Execute Subtasks ───────────────────────────────────────────────────────

/**
 * Execute subtasks sequentially. Each subtask = mini-milestone.
 * Stops on first failure.
 *
 * @param {Object} subtaskPlan - From decomposeMilestone()
 * @param {Function} executor - async (subtask) => { success: boolean, ... }
 * @returns {Promise<Object>} Execution results
 */
export async function executeSubtasks(subtaskPlan, executor) {
  if (!subtaskPlan?.subtasks || !executor) {
    return { completed: [], failed: null, results: new Map() };
  }

  const order = subtaskPlan.executionOrder.length > 0
    ? subtaskPlan.executionOrder
    : subtaskPlan.subtasks.map(s => s.id);

  const results = new Map();
  const completed = [];
  let failed = null;

  for (const subtaskId of order) {
    const subtask = subtaskPlan.subtasks.find(s => s.id === subtaskId);
    if (!subtask) continue;

    try {
      const result = await executor(subtask);
      results.set(subtaskId, result);

      if (result.success) {
        completed.push(subtaskId);
      } else {
        failed = subtaskId;
        break;
      }
    } catch (err) {
      results.set(subtaskId, { success: false, error: err.message });
      failed = subtaskId;
      break;
    }
  }

  logger.info('MilestoneDecomposer', `Subtask execution: ${completed.length}/${order.length} completed`, {
    failed,
  });

  return { completed, failed, results };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _parseScopeFiles(scopeFiles) {
  if (!scopeFiles) return [];
  if (Array.isArray(scopeFiles)) return scopeFiles;
  if (typeof scopeFiles === 'string') {
    try { return JSON.parse(scopeFiles); } catch { return []; }
  }
  return [];
}

function _groupByModule(files, snapshot) {
  const groups = {};

  for (const file of files) {
    let module = 'other';

    // Try snapshot module map first
    if (snapshot?.moduleMap) {
      for (const [mod, modFiles] of Object.entries(snapshot.moduleMap)) {
        if (modFiles.includes(file)) {
          module = mod;
          break;
        }
      }
    }

    // Fallback: derive from directory structure
    if (module === 'other') {
      const parts = file.split('/');
      if (parts.length >= 2) {
        module = parts.slice(0, 2).join('/');
      } else {
        module = path.dirname(file) || 'root';
      }
    }

    if (!groups[module]) groups[module] = [];
    groups[module].push(file);
  }

  return groups;
}

const LAYER_ORDER = {
  model: 0, models: 0, entity: 0, entities: 0, domain: 0, types: 0,
  infra: 1, infrastructure: 1, config: 1, db: 1, database: 1,
  repository: 2, repositories: 2, repos: 2, dao: 2, data: 2,
  service: 3, services: 3, usecases: 3,
  controller: 4, controllers: 4, handlers: 4, routes: 4, api: 4,
  ui: 5, components: 5, views: 5, pages: 5, frontend: 5,
  test: 6, tests: 6, __tests__: 6, spec: 6,
};

function _assignDependencies(subtasks) {
  // Sort subtasks by layer order and add dependencies
  const ordered = subtasks
    .map(s => {
      const moduleParts = (s.module || '').split('/');
      const lastPart = moduleParts[moduleParts.length - 1]?.toLowerCase() || '';
      return { ...s, layerOrder: LAYER_ORDER[lastPart] ?? 3 };
    })
    .sort((a, b) => a.layerOrder - b.layerOrder);

  // Each subtask depends on all subtasks with lower layer order
  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i];
    const prev = ordered[i - 1];
    if (current.layerOrder > prev.layerOrder) {
      // Find the actual subtask and add dependency
      const actualSubtask = subtasks.find(s => s.id === current.id);
      if (actualSubtask && !actualSubtask.dependencies.includes(prev.id)) {
        actualSubtask.dependencies.push(prev.id);
      }
    }
  }
}

function _topologicalSort(subtasks) {
  const idSet = new Set(subtasks.map(s => s.id));
  const inDegree = new Map();
  const adjList = new Map();

  for (const s of subtasks) {
    inDegree.set(s.id, 0);
    adjList.set(s.id, []);
  }

  for (const s of subtasks) {
    for (const dep of s.dependencies) {
      if (!idSet.has(dep)) continue;
      adjList.get(dep).push(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
    }
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result = [];
  while (queue.length > 0) {
    const current = queue.shift();
    result.push(current);
    for (const next of adjList.get(current) || []) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Add any remaining (in case of cycles — shouldn't happen but safety)
  for (const s of subtasks) {
    if (!result.includes(s.id)) result.push(s.id);
  }

  return result;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  shouldDecompose,
  decomposeMilestone,
  executeSubtasks,
};

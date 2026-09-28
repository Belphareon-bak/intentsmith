import { db, milestones as msRepo } from '../db/database.js';

const COMPLETION_METADATA_FIELDS = new Set([
  'status',
  'preserved',
  'commit_hash',
  'git_tag',
  'health_score',
  'started_at',
  'completed_at',
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) normalized[key] = canonicalize(value[key]);
  }
  return normalized;
}

function canonicalCompletedDefinition(milestone) {
  const definition = {};
  for (const [key, value] of Object.entries(milestone)) {
    if (!COMPLETION_METADATA_FIELDS.has(key) && value !== undefined) {
      definition[key] = value;
    }
  }
  return JSON.stringify(canonicalize(definition));
}

/**
 * Reject any content change to a completed milestone before a new immutable
 * roadmap version is stored. Completion metadata may be added, but the
 * milestone definition itself must match the preceding roadmap exactly.
 */
export function assertCompletedMilestonesPreserved(
  previousMilestones,
  revisedMilestones,
  completedIds
) {
  const previousById = new Map(previousMilestones.map(milestone => [milestone.id, milestone]));
  const revisedById = new Map(revisedMilestones.map(milestone => [milestone.id, milestone]));

  for (const id of completedIds) {
    const previous = previousById.get(id);
    const revised = revisedById.get(id);
    if (!previous || !revised) {
      throw new Error(`Revised roadmap dropped completed milestone ${id}`);
    }
    if (revised.status != null && revised.status !== 'PASSED') {
      throw new Error(`Revised roadmap changed completed milestone ${id} status to ${revised.status}`);
    }
    if (revised.preserved === false) {
      throw new Error(`Revised roadmap marked completed milestone ${id} as not preserved`);
    }
    if (canonicalCompletedDefinition(previous) !== canonicalCompletedDefinition(revised)) {
      throw new Error(`Revised roadmap mutated completed milestone ${id}`);
    }
  }
}

/**
 * Synchronize non-completed milestone definitions with a revised roadmap.
 *
 * Completed milestones remain byte-for-byte owned by their finished roadmap
 * version. Pending/failed milestones are redefined and any stale local plan or
 * execution state is cleared so a revision cannot execute an old plan under a
 * new title, dependency graph, or test strategy.
 */
export function syncRevisedMilestones(
  lifecycle,
  revisedMilestones,
  completed,
  newVersion,
  { persistVersion, finalize } = {}
) {
  const milestoneIds = revisedMilestones.map(milestone => milestone.id);
  const missingIdCount = milestoneIds.filter(id => typeof id !== 'string' || id.length === 0).length;
  const duplicateIds = [...new Set(
    milestoneIds.filter((id, index) => milestoneIds.indexOf(id) !== index)
  )];
  if (missingIdCount > 0) {
    throw new Error(`Revised roadmap contains ${missingIdCount} milestone(s) without an ID`);
  }
  if (duplicateIds.length > 0) {
    throw new Error(`Revised roadmap contains duplicate milestone IDs: ${duplicateIds.join(', ')}`);
  }

  const completedIds = new Set(completed.map(milestone => milestone.id));
  const revisedIds = new Set(revisedMilestones.map(milestone => milestone.id));

  const synchronize = db.transaction(() => {
    const existing = msRepo.listByLifecycle(lifecycle.id);
    const existingById = new Map(existing.map(milestone => [milestone.id, milestone]));

    for (let index = 0; index < revisedMilestones.length; index++) {
      const milestone = revisedMilestones[index];
      if (!completedIds.has(milestone.id)) continue;

      const stored = existingById.get(milestone.id);
      const expectedSequence = index + 1;
      if (!stored || stored.sequence !== expectedSequence) {
        throw new Error(
          `Revised roadmap moved completed milestone ${milestone.id}; `
          + `expected sequence ${stored?.sequence ?? 'missing'}, got ${expectedSequence}`
        );
      }
    }

    persistVersion?.();

    for (const milestone of existing) {
      if (!completedIds.has(milestone.id) && !revisedIds.has(milestone.id)) {
        msRepo.deleteById.run(milestone.id);
      }
    }

    // Free the unique (lifecycle_id, sequence) slots before applying a reorder.
    msRepo.parkIncompleteSequences.run(lifecycle.id);

    for (let index = 0; index < revisedMilestones.length; index++) {
      const milestone = revisedMilestones[index];
      if (completedIds.has(milestone.id)) continue;

      const checkpointMode = milestone.checkpoint_mode
        || (index === 0
          ? 'STRUCTURAL'
          : index === revisedMilestones.length - 1
            ? 'SECURITY'
            : 'FUNCTIONAL');
      const definition = {
        ...milestone,
        lifecycle_id: lifecycle.id,
        roadmap_version: newVersion,
        sequence: index + 1,
        max_retries: lifecycle.config.maxMilestoneRetries,
        checkpoint_mode: checkpointMode,
      };

      if (existingById.has(milestone.id)) {
        msRepo.updateMilestoneDefinition(definition);
      } else {
        msRepo.addMilestone(definition);
      }
    }

    finalize?.();
  });

  synchronize();
}

import {
  M6_CANDIDATE_PHASE_IDS,
  M6_CANDIDATE_PHASE_LIMITS,
  M6_CANDIDATE_PLAN_CONTRACT,
  M6_CANDIDATE_PLAN_VERSION,
  M6_DIRECT_FRESH_CLONE_PROGRAMS,
  M6_DIRECT_OWNED_SERVER_PROGRAMS,
  M6_PHYSICAL_GPU_PROGRAMS,
} from '../../contracts/m6/candidate-plan-v1.js';

const CONTROLLED_SOAK_BLOCKERS = Object.freeze([
  'toolchain:iproute2',
  'toolchain:linux-user-network-namespace',
  'server',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function activeRequired(registry, predicate) {
  return (registry?.suites || [])
    .filter(suite => suite.required === true && suite.state === 'ACTIVE' && predicate(suite))
    .map(suite => suite.id)
    .sort();
}

function phaseLimits(id) {
  return { ...M6_CANDIDATE_PHASE_LIMITS[id] };
}

export function buildM6CandidateExecutionPlan(registry) {
  const fresh = new Set(M6_DIRECT_FRESH_CLONE_PROGRAMS);
  const direct = new Set([
    ...M6_DIRECT_FRESH_CLONE_PROGRAMS,
    ...M6_DIRECT_OWNED_SERVER_PROGRAMS,
    ...M6_PHYSICAL_GPU_PROGRAMS,
  ]);
  const phases = [
    {
      id: 'deterministic-offline-database',
      ...phaseLimits('deterministic-offline-database'),
      runner: 'nightly-audit',
      programIds: activeRequired(registry, suite => (
        suite.profile === 'offline' || suite.profile === 'database'
      )),
      allowedBlockers: ['toolchain:python-pdf-runtime'],
      requiresCleanCandidate: true,
      requiresFreshClone: false,
      requiresGpuCensus: false,
      requiresOwnedServer: false,
    },
    {
      id: 'owned-production-server',
      ...phaseLimits('owned-production-server'),
      runner: 'm6-owned-program',
      programIds: [...M6_DIRECT_OWNED_SERVER_PROGRAMS],
      allowedBlockers: [],
      requiresCleanCandidate: true,
      requiresFreshClone: false,
      requiresGpuCensus: false,
      requiresOwnedServer: true,
    },
    {
      id: 'model-and-server',
      ...phaseLimits('model-and-server'),
      runner: 'nightly-audit',
      programIds: activeRequired(registry, suite => (
        (suite.profile === 'model' || suite.profile === 'server')
        && !direct.has(suite.id)
      )),
      allowedBlockers: ['ollama', 'gpu'],
      requiresCleanCandidate: true,
      requiresFreshClone: false,
      requiresGpuCensus: true,
      requiresOwnedServer: false,
    },
    {
      id: 'controlled-soak',
      ...phaseLimits('controlled-soak'),
      runner: 'nightly-audit',
      programIds: activeRequired(registry, suite => (
        suite.profile === 'soak' && !fresh.has(suite.id)
      )),
      allowedBlockers: [...CONTROLLED_SOAK_BLOCKERS],
      requiresCleanCandidate: true,
      requiresFreshClone: false,
      requiresGpuCensus: false,
      requiresOwnedServer: false,
    },
    {
      id: 'fresh-clone-install-build-studio',
      ...phaseLimits('fresh-clone-install-build-studio'),
      runner: 'm6-fresh-clone',
      programIds: [...M6_DIRECT_FRESH_CLONE_PROGRAMS],
      allowedBlockers: [
        'ollama',
        'gpu',
        'toolchain:iproute2',
        'toolchain:linux-user-network-namespace',
        'toolchain:x11-display',
      ],
      requiresCleanCandidate: true,
      requiresFreshClone: true,
      requiresGpuCensus: true,
      requiresOwnedServer: true,
    },
    {
      id: 'physical-ollama-gpu',
      ...phaseLimits('physical-ollama-gpu'),
      runner: 'nightly-audit',
      programIds: [...M6_PHYSICAL_GPU_PROGRAMS],
      allowedBlockers: ['ollama', 'gpu'],
      requiresCleanCandidate: true,
      requiresFreshClone: false,
      requiresGpuCensus: true,
      requiresOwnedServer: false,
    },
  ];
  return deepFreeze({
    contract: M6_CANDIDATE_PLAN_CONTRACT,
    version: M6_CANDIDATE_PLAN_VERSION,
    acceptsArguments: false,
    concurrency: 1,
    phases,
  });
}

export function validateM6CandidateExecutionPlan(plan, registry) {
  const errors = [];
  if (plan?.contract !== M6_CANDIDATE_PLAN_CONTRACT) errors.push('plan:contract');
  if (plan?.version !== M6_CANDIDATE_PLAN_VERSION) errors.push('plan:version');
  if (plan?.acceptsArguments !== false) errors.push('plan:arguments');
  if (plan?.concurrency !== 1) errors.push('plan:concurrency');
  if (!Array.isArray(plan?.phases)) errors.push('plan:phases');
  const phaseIds = (plan?.phases || []).map(phase => phase.id);
  if (JSON.stringify(phaseIds) !== JSON.stringify(M6_CANDIDATE_PHASE_IDS)) {
    errors.push('plan:phase-order');
  }
  const registryById = new Map((registry?.suites || []).map(suite => [suite.id, suite]));
  const seen = new Set();
  for (const phase of plan?.phases || []) {
    if (!Array.isArray(phase.programIds) || phase.programIds.length === 0) {
      errors.push(`${phase.id}:empty`);
      continue;
    }
    if (phase.requiresCleanCandidate !== true) errors.push(`${phase.id}:clean-candidate`);
    for (const programId of phase.programIds) {
      if (seen.has(programId)) errors.push(`plan:duplicate-program:${programId}`);
      seen.add(programId);
      const suite = registryById.get(programId);
      if (!suite) errors.push(`${phase.id}:missing-program:${programId}`);
      else {
        if (suite.required !== true || suite.state !== 'ACTIVE') {
          errors.push(`${phase.id}:program-not-required-active:${programId}`);
        }
      }
    }
  }

  const requiredActive = activeRequired(registry, () => true);
  const selected = new Set((plan?.phases || []).flatMap(phase => phase.programIds || []));
  for (const id of requiredActive) {
    if (!selected.has(id)) errors.push(`plan:required-program-uncovered:${id}`);
  }
  for (const id of selected) {
    if (!requiredActive.includes(id)) errors.push(`plan:unexpected-program:${id}`);
  }
  if (JSON.stringify(plan) !== JSON.stringify(buildM6CandidateExecutionPlan(registry))) {
    errors.push('plan:exact-authority');
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

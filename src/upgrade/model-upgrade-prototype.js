// Small orchestration helpers for the v136.1 model-upgrade prototype.

import { artifactFromInventory, resolveInstalledArtifact } from './model-evaluation-history.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';
import {
  applicabilityContractForRole,
  checkModelEvaluationApplicability,
} from '../eval/role-evaluation-plan.js';
import { parseModelNameExtended } from './model-family-extensions.js';
import { normalizeInstalledModel } from './model-inventory.js';

export const DEFAULT_RESPONSIBILITY_POLICY = Object.freeze({
  // Operator direction 2026-09-24: at most two unrelated roles; a known
  // conflict does not authorize a weaker/unqualified replacement.
  maxRolesPerModel: 2,
  allowedSharedRolePairs: Object.freeze([]),
  changePenalty: 0.005,
  independentRolePairs: Object.freeze([
    Object.freeze(['D1', 'R1']),
    Object.freeze(['D1', 'R2']),
    Object.freeze(['D2', 'R1']),
    Object.freeze(['CODE', 'R1']),
    Object.freeze(['CODE', 'R2']),
    Object.freeze(['D2', 'R2']),
    Object.freeze(['R1', 'R2']),
  ]),
});

const RESPONSIBILITY_ROLES = new Set(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const pairKey = pair => [...pair].sort().join(':');
function responsibilityPolicy(input = DEFAULT_RESPONSIBILITY_POLICY) {
  const policy = { ...DEFAULT_RESPONSIBILITY_POLICY, ...input };
  if (!Number.isInteger(policy.maxRolesPerModel) || policy.maxRolesPerModel < 1 || policy.maxRolesPerModel > 2
    || !Number.isFinite(policy.changePenalty) || policy.changePenalty < 0) throw new Error('INVALID_RESPONSIBILITY_POLICY');
  for (const pairs of [policy.allowedSharedRolePairs, policy.independentRolePairs]) {
    if (!Array.isArray(pairs) || pairs.some(pair => !Array.isArray(pair) || pair.length !== 2
      || pair[0] === pair[1] || pair.some(role => !RESPONSIBILITY_ROLES.has(role)))) throw new Error('INVALID_RESPONSIBILITY_POLICY');
  }
  // Extra restrictions may be supplied, mandatory author/reviewer exclusions
  // cannot be removed by supplying an empty list or a sharing exception.
  policy.independentRolePairs = [...new Map([...DEFAULT_RESPONSIBILITY_POLICY.independentRolePairs,
    ...policy.independentRolePairs].map(pair => [pairKey(pair), pair])).values()];
  return policy;
}

function responsibilityArtifacts(inventory = []) {
  const byName = new Map(), lineageByDigest = new Map();
  for (const row of inventory) {
    const name = canonicalModelName(row?.name || row?.modelName);
    const digest = normalizeModelDigestSha256(row?.digestSha256 || row?.digest);
    if (!name) continue;
    const lineage = normalizeModelDigestSha256(row?.lineageSha256);
    const entry = { digestSha256: row?.lineageSha256 != null && !lineage ? null : digest, lineageSha256: lineage };
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(entry);
    if (digest && lineage) {
      if (!lineageByDigest.has(digest)) lineageByDigest.set(digest, new Set());
      lineageByDigest.get(digest).add(lineage);
    }
  }
  return model => {
    const rows = byName.get(canonicalModelName(model)) || [];
    const digests = new Set(rows.map(row => row.digestSha256));
    if (digests.size !== 1 || digests.has(null)) return null;
    const digestSha256 = [...digests][0];
    const lineages = lineageByDigest.get(digestSha256) || new Set();
    if (lineages.size > 1) return null;
    return { digestSha256, lineageSha256: [...lineages][0] || null };
  };
}

export function auditResponsibilitySegregation(bindings = {}, inputPolicy = DEFAULT_RESPONSIBILITY_POLICY, context = {}) {
  const policy = responsibilityPolicy(inputPolicy);
  const artifactFor = responsibilityArtifacts(context.inventory);
  const resolved = {}, violations = [];
  const byModel = new Map();
  for (const [role, model] of Object.entries(bindings)) {
    const artifact = artifactFor(model);
    const expected = context.artifactsByRole?.[role];
    if (!RESPONSIBILITY_ROLES.has(role)) violations.push({ type: 'unknown-role', model, roles: [role] });
    if (!canonicalModelName(model) || !artifact) violations.push({ type: 'identity-unverified', model, roles: [role] });
    if (expected && (!sameModelName(expected.modelName, model)
      || normalizeModelDigestSha256(expected.digestSha256) !== artifact?.digestSha256)) {
      violations.push({ type: 'binding-artifact-drift', model, roles: [role] });
    }
    resolved[role] = artifact;
    const key = artifact?.lineageSha256 ? `lineage:${artifact.lineageSha256}`
      : artifact ? `sha256:${artifact.digestSha256}` : `unverified:${canonicalModelName(model) || role}`;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(role);
  }
  const allowed = new Set(policy.allowedSharedRolePairs.map(pairKey));
  const independent = new Set(policy.independentRolePairs.map(pairKey));
  for (const [identity, roles] of byModel) {
    const model = [...new Set(roles.map(role => bindings[role]))].join(' / ');
    if (roles.length > policy.maxRolesPerModel) {
      violations.push({
        type: 'role-capacity', model, identity, roles: [...roles],
        maximum: policy.maxRolesPerModel,
      });
    }
    for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
      const pair = [roles[i], roles[j]], key = pairKey(pair);
      if (independent.has(key) || !allowed.has(key)) violations.push({
        type: independent.has(key) ? 'independence' : 'sharing-not-approved', model, identity, roles: pair,
      });
    }
  }
  return Object.freeze({
    compliant: violations.length === 0,
    identityScope: 'exact-digest-and-explicit-lineage',
    lineageUnverifiedRoles: Object.freeze(Object.keys(bindings).filter(role => !resolved[role]?.lineageSha256)),
    violations: Object.freeze(violations.map(row => Object.freeze({ ...row, roles: Object.freeze(row.roles) }))),
    assignments: Object.freeze(Object.fromEntries(
      [...byModel].map(([model, roles]) => [model, Object.freeze([...roles])]),
    )),
  });
}

/**
 * Select the highest-scoring whole-role portfolio that satisfies separation.
 * Only individually eligible alternatives can replace an incumbent. Existing
 * conflicts never waive that condition. The incumbent is a no-change option,
 * not evidence that its current concentration or self-review is acceptable.
 */
export function selectResponsibilityPortfolio(input = {}) {
  const before = input.before || {};
  const policy = responsibilityPolicy(input.policy);
  const evidenceByRole = input.evidenceByRole || {};
  const roles = input.roles || Object.keys(before);
  if (!Array.isArray(roles) || new Set(roles).size !== roles.length
    || roles.some(role => !RESPONSIBILITY_ROLES.has(role))) throw new Error('INVALID_RESPONSIBILITY_ROLES');
  const context = { inventory: input.inventory || [] };
  const artifactFor = responsibilityArtifacts(context.inventory);
  const optionsByRole = {};
  const beforeAudit = auditResponsibilitySegregation(before, policy, { ...context, artifactsByRole: input.artifactsByRole });
  const repairingExistingViolation = !beforeAudit.compliant;
  const rejectedOptions = [];

  for (const role of roles) {
    const current = before[role];
    const byModel = new Map();
    for (const row of evidenceByRole[role] || []) {
      const key = canonicalModelName(row.model);
      const score = row.score;
      const artifact = artifactFor(row.model);
      const reject = reason => rejectedOptions.push({ role, model: row.model, reason });
      if (!key || !Number.isFinite(score) || score < 0 || score > 1) { reject('INVALID_SCORE'); continue; }
      if (!artifact || normalizeModelDigestSha256(row.digestSha256) !== artifact.digestSha256) {
        reject('EVIDENCE_ARTIFACT_UNVERIFIED'); continue;
      }
      if (!sameModelName(row.model, current) && row.eligibleForChange !== true) {
        reject('ROLE_CHANGE_NOT_QUALIFIED'); continue;
      }
      const previous = byModel.get(key);
      if (!previous || score > previous.score) {
        byModel.set(key, { model: row.model, score, source: row.source || 'evaluation' });
      }
    }
    const currentKey = canonicalModelName(current);
    if (currentKey && !byModel.has(currentKey)) {
      byModel.set(currentKey, { model: current, score: null, source: 'unmeasured-incumbent' });
    }
    let options = [...byModel.values()];
    // A role without comparative evidence remains fixed. This prevents a
    // portfolio repair from silently replacing an unmeasured responsibility.
    if (current && !Number.isFinite(byModel.get(currentKey)?.score)) {
      options = options.filter(row => sameModelName(row.model, current));
    }
    optionsByRole[role] = options;
  }

  let best = null;
  const visit = (index, bindings, utility, choices) => {
    if (index === roles.length) {
      const audit = auditResponsibilitySegregation(bindings, policy, context);
      if (!audit.compliant) return;
      if (!best || utility > best.utility) {
        best = { bindings: { ...bindings }, utility, choices: { ...choices }, audit };
      }
      return;
    }
    const role = roles[index];
    for (const option of optionsByRole[role] || []) {
      const next = { ...bindings, [role]: option.model };
      // Capacity and independence are monotonic while the DFS adds roles, so
      // partial violations can be pruned without hiding a later solution.
      if (!auditResponsibilitySegregation(next, policy, context).compliant) continue;
      const changed = before[role] && !sameModelName(before[role], option.model);
      const value = Number.isFinite(option.score) ? option.score : 0;
      visit(index + 1, next, utility + value - (changed ? policy.changePenalty : 0), {
        ...choices, [role]: { ...option, changed: !!changed },
      });
    }
  };
  // Filtered hunts must keep every other responsibility in the search state.
  // A missing/drifted baseline requires reconciliation, not a solver repair.
  const fixed = Object.fromEntries(Object.entries(before).filter(([role]) => !roles.includes(role)));
  if (!beforeAudit.violations.some(row => ['identity-unverified', 'binding-artifact-drift', 'unknown-role'].includes(row.type))) {
    visit(0, fixed, 0, {});
  }

  if (!best) {
    return Object.freeze({
      bindings: Object.freeze({ ...before }),
      choices: Object.freeze({}),
      audit: beforeAudit,
      changedRoles: Object.freeze([]),
      feasible: false,
      rejectedOptions: Object.freeze(rejectedOptions),
    });
  }
  const changedRoles = roles.filter(role => !sameModelName(before[role], best.bindings[role]));
  return Object.freeze({
    bindings: Object.freeze(best.bindings),
    choices: Object.freeze(best.choices),
    audit: best.audit,
    utility: best.utility,
    changedRoles: Object.freeze(changedRoles),
    feasible: true,
    repairMode: repairingExistingViolation,
    rejectedOptions: Object.freeze(rejectedOptions),
  });
}

export function createHistoryCallbacks(options) {
  const {
    history,
    inventory = [],
    baseUrl,
    hardware = {},
    measurements = new Map(),
  } = options || {};
  if (!history) throw new TypeError('history is required');
  const artifacts = new Map();

  for (const row of inventory) {
    const artifact = artifactFromInventory(row.name, inventory);
    if (artifact) artifacts.set(artifact.canonicalName, artifact);
  }

  const resolveArtifact = async model => {
    const key = canonicalModelName(model);
    if (!key) throw new Error(`Invalid model identity: ${model}`);
    if (artifacts.has(key)) return artifacts.get(key);
    const artifact = await resolveInstalledArtifact(model, { baseUrl });
    artifacts.set(key, artifact);
    return artifact;
  };

  return Object.freeze({
    resolveArtifact: async model => ({
      ...await resolveArtifact(model),
      ...(history.providerVersion && history.providerVersion !== 'UNRECORDED'
        ? { providerVersion: history.providerVersion } : {}),
    }),
    async refreshArtifact(model) {
      artifacts.delete(canonicalModelName(model));
      return this.resolveArtifact(model);
    },
    async loadCollection(input) {
      const row = history.getCollection({ ...input, digestSha256: input.artifact.digestSha256,
        contractSha256: input.suiteContractSha256 });
      return row ? { ...row, score: null, collection: row.metadata.collection, historyRunId: row.runId } : null;
    },
    async saveCollection(input) {
      return history.recordCollection({ ...input, contractSha256: input.suiteContractSha256,
        hardware, metadata: { source: 'model-upgrade-hunt-collection-v1' } });
    },
    async loadHistoricalSummary(input) {
      if (!input.suiteContractSha256) return null;
      const artifact = await resolveArtifact(input.model);
      const row = history.getComplete({
        digestSha256: artifact.digestSha256,
        role: input.role,
        suiteName: input.suiteName,
        suiteVersion: input.suiteVersion,
        contractSha256: input.suiteContractSha256,
      });
      if (!row) return null;
      return {
        suite: input.suiteName,
        model: input.model,
        runs: row.repeats,
        tasks: row.tasks,
        score: row.score,
        unstableTasks: row.tasks.filter(task => Number(task.spread) > 0).map(task => task.name),
        durationMs: row.durationMs,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        historyRunId: row.runId,
      };
    },
    async saveHistoricalSummary(input) {
      if (!input.suiteContractSha256) {
        throw new Error(`Missing suite contract for ${input.suiteName}`);
      }
      const artifact = await resolveArtifact(input.model);
      const observedDigest = normalizeModelDigestSha256(input.artifact?.digestSha256);
      if (!observedDigest
        || observedDigest !== artifact.digestSha256
        || !sameModelName(input.artifact?.modelName, artifact.modelName)) {
        throw new Error(`Evaluation artifact proof mismatch for ${input.model}`);
      }
      const measurement = measurements.get(canonicalModelName(input.model)) || {};
      return history.recordComplete({
        artifact,
        role: input.role,
        suiteName: input.suiteName,
        suiteVersion: input.suiteVersion,
        contractSha256: input.suiteContractSha256,
        summary: input.summary,
        fresh: input.fresh === true,
        durationMs: input.summary.durationMs,
        startedAt: input.summary.startedAt,
        completedAt: input.summary.completedAt,
        tokensPerSecond: measurement.throughput?.tokensPerSecond,
        vramBytes: measurement.placement?.vramBytes,
        hardware,
        metadata: { source: 'model-upgrade-hunt-v136.1' },
      });
    },
  });
}

// Only an attempted inference with its captured identity gets an evaluation
// failure row. Preparation/persistence failures remain in the hunt journal.
export function recordRoleEvaluationFailures({ result, history, plans, hardware }) {
  return (result.roleErrors || []).filter(failure => failure.artifact && failure.model)
    .map(failure => {
      const plan = plans[failure.role];
      const attempts = failure.attemptedTasks || [];
      const planned = Number.isSafeInteger(plan.taskCount) && Number.isSafeInteger(plan.repeats)
        ? plan.taskCount * plan.repeats : null;
      return history.recordTerminal({
        artifact: failure.artifact, role: failure.role,
        suiteName: plan.suiteName, suiteVersion: plan.suiteVersion,
        contractSha256: plan.suiteContractSha256, repeats: plan.repeats,
        status: 'FAILED', hardware,
        errorCode: 'CANDIDATE_EVALUATION_RETRYABLE', errorMessage: failure.error,
        startedAt: failure.startedAt, completedAt: failure.completedAt,
        durationMs: Date.parse(failure.completedAt) - Date.parse(failure.startedAt),
        tasks: attempts.map(task => ({
          name: task.name, repeat: task.repeat, mean: task.score, scores: [task.score],
          responses: [task.response || ''], durationMs: task.durationMs ?? null,
          details: [{ ...(task.detail || {}), outcome: task.outcome,
            valid: task.valid, reason: task.error || task.detail?.reason || null }],
        })),
        metadata: { source: 'model-upgrade-hunt-v136.1', stage: 'trial',
          attemptCounts: {
            planned,
            observed: attempts.length,
            notAttempted: planned === null ? null : Math.max(0, planned - attempts.length),
            invalid: attempts.filter(task => task.valid === false).length,
            operationalFailure: attempts.filter(task => task.outcome === 'OPERATIONAL_FAILURE').length,
          },
          candidate: result.model, failure },
      });
    });
}

export function evaluationStateForArtifact(artifact, roles, plans, history, hardware = null) {
  const perRole = {};
  let missing = 0;
  let rejected = 0;
  let hardwareBlock = null;
  for (const role of roles || []) {
    const plan = plans?.[role];
    if (!plan) continue;
    const roleHardwareBlock = history.getHardwareBlock?.({
      digestSha256: artifact.digestSha256, role, hardware,
    });
    if (roleHardwareBlock) {
      hardwareBlock ||= roleHardwareBlock;
      perRole[role] = 'rejected';
      rejected++;
      continue;
    }
    const complete = history.getComplete({
      digestSha256: artifact.digestSha256,
      role,
      suiteName: plan.suiteName,
      suiteVersion: plan.suiteVersion,
      contractSha256: plan.suiteContractSha256,
    });
    const collected = plan.collectionOnly && history.getCollection?.({
      digestSha256: artifact.digestSha256, role, suiteName: plan.suiteName,
      suiteVersion: plan.suiteVersion, contractSha256: plan.suiteContractSha256,
    });
    const terminal = complete || collected ? null : history.getTerminal({
      digestSha256: artifact.digestSha256,
      role,
      suiteName: plan.suiteName,
      suiteVersion: plan.suiteVersion,
      contractSha256: plan.suiteContractSha256,
      hardware,
    });
    const gradingPending = collected && plan.acceptance?.graders?.some(g => !g.judge
      || g.judge.digestSha256 !== artifact.digestSha256);
    perRole[role] = complete ? 'scored' : gradingPending ? 'grading-pending' : collected ? 'awaiting-review' : (terminal ? 'rejected' : 'unseen');
    if (!complete && !terminal && (!collected || gradingPending)) missing++;
    if (terminal) rejected++;
  }
  const state = missing ? 'unseen' : rejected ? 'rejected'
    : Object.values(perRole).includes('awaiting-review') ? 'awaiting-review' : 'scored';
  return Object.freeze({ state, missing, rejected, perRole, hardwareBlock });
}

/**
 * Rebind an already measured artifact-wide CPU spill to every current,
 * technically applicable role contract on the exact same GPU/context.
 * Placement is independent of the prompt role, so loading the same oversized
 * artifact again would only repeat forbidden RAM spill without new evidence.
 */
export function materializeCurrentHardwareBlocks(input = {}) {
  const {
    candidates = [], roles = [], plans = {}, history, hardware = null,
  } = input;
  if (!history) throw new TypeError('history is required');
  const created = [];

  for (const candidate of candidates) {
    const normalized = normalizeInstalledModel(candidate);
    const artifact = artifactFromInventory(normalized.name, candidates);
    if (!artifact) continue;
    const placementEvidence = history.getHardwareBlock({
      digestSha256: artifact.digestSha256,
      hardware,
    });
    if (!placementEvidence) continue;

    for (const role of roles) {
      const plan = plans?.[role];
      if (!plan) continue;
      const applicability = checkModelEvaluationApplicability(
        normalized,
        plan.applicabilityContract || applicabilityContractForRole(role),
      );
      if (!applicability.applicable) continue;
      const exactIdentity = {
        digestSha256: artifact.digestSha256,
        role,
        suiteName: plan.suiteName,
        suiteVersion: plan.suiteVersion,
        contractSha256: plan.suiteContractSha256,
      };
      if (history.getComplete(exactIdentity) || history.getTerminal({
        ...exactIdentity,
        hardware,
      })) continue;

      const placementEvidenceRunId = placementEvidence.metadata?.placementEvidenceRunId
        || placementEvidence.runId;
      created.push(history.recordTerminal({
        artifact,
        role,
        suiteName: plan.suiteName,
        suiteVersion: plan.suiteVersion,
        contractSha256: plan.suiteContractSha256,
        status: 'BLOCKED',
        repeats: plan.repeats,
        durationMs: 0,
        completedAt: new Date().toISOString(),
        hardware: placementEvidence.hardware,
        metadata: {
          ...placementEvidence.metadata,
          source: 'model-evaluation-hardware-block-reuse-v1',
          placementEvidenceRunId,
          placementMeasuredAt: placementEvidence.completedAt,
          timestampSemantics: 'derived-block-write-not-a-new-model-load',
        },
        errorCode: 'CANDIDATE_VRAM_FIT_FAILED',
        errorMessage: placementEvidence.errorMessage,
      }));
    }
  }
  return Object.freeze(created);
}

/**
 * Installed alternatives are valuable prototype candidates: no download is
 * needed, and exact digests are already known. Keep only role-compatible
 * alternatives and label whether the current suite contract is already
 * scored. This function does not claim that every compatible model is likely
 * better; callers still rank and limit the queue.
 */
export function buildInstalledCandidateQueue(input = {}) {
  const {
    candidates = [], roles = [], bindings = {}, plans = {}, history, hardware = null,
    ignoreHardwareBlocks = false,
  } = input;
  if (!history) throw new TypeError('history is required');
  const byModel = new Map();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeInstalledModel(candidate);
    const artifact = artifactFromInventory(normalizedCandidate.name, candidates);
    if (!artifact) continue;
    const profile = parseModelNameExtended(normalizedCandidate.name);
    const candidateRoles = [];
    for (const role of roles) {
      if (sameModelName(normalizedCandidate.name, bindings[role])) continue;
      const applicability = checkModelEvaluationApplicability({
        name: normalizedCandidate.name,
        params: normalizedCandidate.params ?? profile.params,
        category: normalizedCandidate.category ?? profile.category,
        capabilities: normalizedCandidate.capabilities,
      }, plans?.[role]?.applicabilityContract || applicabilityContractForRole(role));
      if (!applicability.applicable) continue;
      candidateRoles.push(role);
    }
    if (!candidateRoles.length) continue;
    const evalState = evaluationStateForArtifact(
      artifact, candidateRoles, plans, history, ignoreHardwareBlocks ? null : hardware,
    );
    // A deterministic failure for this exact artifact and suite contract is a
    // completed screening result, not a reason to spend GPU time again. Keep
    // the row forever, but omit only the affected roles from the next queue.
    const runnableRoles = candidateRoles.filter(role => !['rejected','awaiting-review'].includes(evalState.perRole[role]));
    if (!runnableRoles.length) continue;
    const priority = candidateRoles.reduce((score, role) => {
      const category = normalizedCandidate.category ?? profile.category;
      if (role === 'CODE' && category === 'code') return score + 12;
      if (role === 'VISION' && category === 'vision') return score + 12;
      if ((role === 'D1' || role === 'R1') && category === 'reasoning') return score + 10;
      return score + 4;
    }, 0) + (evalState.missing * 2) + Math.min(6, Number(normalizedCandidate.params || 0) / 8);
    byModel.set(artifact.canonicalName, {
      ...normalizedCandidate,
      artifact,
      roles: runnableRoles,
      evaluationState: evalState,
      priority: Math.round(priority * 100) / 100,
      reasons: [
        'already installed',
        evalState.state === 'scored' ? 'current contract already scored' : `${evalState.missing} current suite(s) unseen`,
      ],
    });
  }
  return [...byModel.values()].sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);
}

export function resolveCurrentBindings(defaults = {}, repository, roles = Object.keys(defaults)) {
  if (!repository || typeof repository.getDesired !== 'function') {
    throw new TypeError('repository.getDesired is required');
  }
  const durable = {};
  const artifacts = {};
  for (const role of roles) {
    const desired = repository.getDesired(role);
    if (!desired?.modelName) continue;
    const digestSha256 = normalizeModelDigestSha256(desired.digestSha256);
    if (!digestSha256) {
      throw new Error(`Durable binding ${role} is missing an exact SHA-256 digest`);
    }
    durable[role] = desired.modelName;
    artifacts[role] = Object.freeze({
      modelName: desired.modelName,
      digestSha256,
    });
  }
  return Object.freeze({
    bindings: Object.freeze({ ...defaults, ...durable }),
    durable: Object.freeze(durable),
    artifacts: Object.freeze(artifacts),
  });
}

export default {
  DEFAULT_RESPONSIBILITY_POLICY,
  auditResponsibilitySegregation,
  selectResponsibilityPortfolio,
  createHistoryCallbacks,
  evaluationStateForArtifact,
  buildInstalledCandidateQueue,
  resolveCurrentBindings,
};

export function prioritizeRoleGaps(candidates, roleScores) {
  const gap = role => 1 - (Number.isFinite(roleScores[role]) ? roleScores[role] : 0);
  return candidates.map(candidate => {
    const roles = [...candidate.roles].sort((a,b) => gap(b)-gap(a));
    return { ...candidate, roles, roleUrgency: Math.max(0, ...roles.map(gap)),
      priorityRole: roles[0] || null, roleScores: Object.fromEntries(roles.map(r => [r, roleScores[r] ?? null])) };
  }).sort((a,b) => b.roleUrgency-a.roleUrgency || b.priority-a.priority || a.sizeGB-b.sizeGB);
}

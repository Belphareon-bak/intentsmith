// Small orchestration helpers for the v136.1 model-upgrade prototype.

import { artifactFromInventory, resolveInstalledArtifact } from './model-evaluation-history.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';
import { checkRoleEligibility } from './candidate-eligibility.js';
import { MODEL_PROFILES } from './model-profiles.js';
import { parseModelNameExtended } from './model-family-extensions.js';

export const DEFAULT_RESPONSIBILITY_POLICY = Object.freeze({
  // The operator-approved product rule is "no model may own a majority of
  // roles". IntentSmith currently has seven primary roles, hence at most 3.
  maxRolesPerModel: 3,
  maxQualityDrop: 0.15,
  changePenalty: 0.005,
  independentRolePairs: Object.freeze([
    Object.freeze(['D1', 'R1']),
    Object.freeze(['CODE', 'R1']),
    Object.freeze(['CODE', 'R2']),
    Object.freeze(['D2', 'R2']),
  ]),
});

export function auditResponsibilitySegregation(bindings = {}, policy = DEFAULT_RESPONSIBILITY_POLICY) {
  const byModel = new Map();
  for (const [role, model] of Object.entries(bindings)) {
    const key = canonicalModelName(model);
    if (!key) continue;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(role);
  }
  const violations = [];
  for (const [model, roles] of byModel) {
    if (roles.length > policy.maxRolesPerModel) {
      violations.push(Object.freeze({
        type: 'role-capacity', model, roles: Object.freeze([...roles]),
        maximum: policy.maxRolesPerModel,
      }));
    }
  }
  for (const [left, right] of policy.independentRolePairs || []) {
    if (bindings[left] && bindings[right] && sameModelName(bindings[left], bindings[right])) {
      violations.push(Object.freeze({
        type: 'independence', model: canonicalModelName(bindings[left]),
        roles: Object.freeze([left, right]),
      }));
    }
  }
  return Object.freeze({
    compliant: violations.length === 0,
    violations: Object.freeze(violations),
    assignments: Object.freeze(Object.fromEntries(
      [...byModel].map(([model, roles]) => [model, Object.freeze([...roles])]),
    )),
  });
}

/**
 * Select the highest-scoring whole-role portfolio that satisfies separation.
 * A role may accept a slightly weaker alternative to preserve independent
 * review, but never more than maxQualityDrop below the best measured option.
 * The incumbent always remains a safe no-change option.
 */
export function selectResponsibilityPortfolio(input = {}) {
  const before = input.before || {};
  const policy = input.policy || DEFAULT_RESPONSIBILITY_POLICY;
  const evidenceByRole = input.evidenceByRole || {};
  const roles = input.roles || Object.keys(before);
  const optionsByRole = {};
  const repairingExistingViolation = !auditResponsibilitySegregation(before, policy).compliant;

  for (const role of roles) {
    const current = before[role];
    const byModel = new Map();
    for (const row of evidenceByRole[role] || []) {
      const key = canonicalModelName(row.model);
      const score = Number(row.score);
      if (!key || !Number.isFinite(score)) continue;
      // A compliant portfolio may move only to a model that actually won its
      // pairwise decision. Raw suite averages cannot overrule task majority,
      // noise or language evidence gates. Near-equivalent non-winners remain
      // available only when repairing a portfolio that was already invalid.
      if (!repairingExistingViolation && row.eligibleForChange === false
        && !sameModelName(row.model, current)) continue;
      const previous = byModel.get(key);
      if (!previous || score > previous.score) {
        byModel.set(key, { model: row.model, score, source: row.source || 'evaluation' });
      }
    }
    const currentKey = canonicalModelName(current);
    if (currentKey && !byModel.has(currentKey)) {
      byModel.set(currentKey, { model: current, score: null, source: 'unmeasured-incumbent' });
    }
    const measured = [...byModel.values()].filter(row => Number.isFinite(row.score));
    const bestScore = measured.length ? Math.max(...measured.map(row => row.score)) : null;
    let options = [...byModel.values()].filter(row => (
      !Number.isFinite(bestScore)
      || !Number.isFinite(row.score)
      || row.score >= bestScore - policy.maxQualityDrop
      || sameModelName(row.model, current)
    ));
    // A role without comparative evidence remains fixed. This prevents a
    // portfolio repair from silently replacing an unmeasured responsibility.
    if (!measured.length && current) options = options.filter(row => sameModelName(row.model, current));
    optionsByRole[role] = options;
  }

  let best = null;
  const visit = (index, bindings, utility, choices) => {
    if (index === roles.length) {
      const audit = auditResponsibilitySegregation(bindings, policy);
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
      const partialPolicy = {
        ...policy,
        independentRolePairs: (policy.independentRolePairs || [])
          .filter(([left, right]) => left in next && right in next),
      };
      if (!auditResponsibilitySegregation(next, partialPolicy).compliant) continue;
      const changed = before[role] && !sameModelName(before[role], option.model);
      const value = Number.isFinite(option.score) ? option.score : 0;
      visit(index + 1, next, utility + value - (changed ? policy.changePenalty : 0), {
        ...choices, [role]: { ...option, changed: !!changed },
      });
    }
  };
  visit(0, {}, 0, {});

  if (!best) {
    return Object.freeze({
      bindings: Object.freeze({ ...before }),
      choices: Object.freeze({}),
      audit: auditResponsibilitySegregation(before, policy),
      changedRoles: Object.freeze([]),
      feasible: false,
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
    resolveArtifact,
    async loadHistoricalSummary(input) {
      if (!input.suiteContractSha256) return null;
      const artifact = await resolveArtifact(input.model);
      const row = history.getComplete({
        digestSha256: artifact.digestSha256,
        role: input.role,
        suiteName: input.suiteName,
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
        durationMs: input.summary.durationMs,
        tokensPerSecond: measurement.throughput?.tokensPerSecond,
        vramBytes: measurement.placement?.vramBytes,
        hardware,
        metadata: { source: 'model-upgrade-hunt-v136.1' },
      });
    },
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
      contractSha256: plan.suiteContractSha256,
    });
    const terminal = complete ? null : history.getTerminal({
      digestSha256: artifact.digestSha256,
      role,
      suiteName: plan.suiteName,
      contractSha256: plan.suiteContractSha256,
      hardware,
    });
    perRole[role] = complete ? 'scored' : (terminal ? 'rejected' : 'unseen');
    if (!complete && !terminal) missing++;
    if (terminal) rejected++;
  }
  const state = missing ? 'unseen' : (rejected ? 'rejected' : 'scored');
  return Object.freeze({ state, missing, rejected, perRole, hardwareBlock });
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
    const artifact = artifactFromInventory(candidate.name, candidates);
    if (!artifact) continue;
    const profile = parseModelNameExtended(candidate.name);
    const candidateRoles = [];
    for (const role of roles) {
      if (sameModelName(candidate.name, bindings[role])) continue;
      const eligibility = checkRoleEligibility({
        name: candidate.name,
        params: candidate.params ?? profile.params,
        category: candidate.category ?? profile.category,
        capabilities: candidate.capabilities ?? null,
      }, role);
      if (!eligibility.eligible) continue;
      const preferred = MODEL_PROFILES[role]?.preferredCategories;
      const category = candidate.category ?? profile.category;
      if (preferred?.length && category && category !== 'unknown' && !preferred.includes(category)) continue;
      candidateRoles.push(role);
    }
    if (!candidateRoles.length) continue;
    const evalState = evaluationStateForArtifact(
      artifact, candidateRoles, plans, history, ignoreHardwareBlocks ? null : hardware,
    );
    // A deterministic failure for this exact artifact and suite contract is a
    // completed screening result, not a reason to spend GPU time again. Keep
    // the row forever, but omit only the affected roles from the next queue.
    const runnableRoles = candidateRoles.filter(role => evalState.perRole[role] !== 'rejected');
    if (!runnableRoles.length) continue;
    const priority = candidateRoles.reduce((score, role) => {
      const category = candidate.category ?? profile.category;
      if (role === 'CODE' && category === 'code') return score + 12;
      if (role === 'VISION' && category === 'vision') return score + 12;
      if ((role === 'D1' || role === 'R1') && category === 'reasoning') return score + 10;
      return score + 4;
    }, 0) + (evalState.missing * 2) + Math.min(6, Number(candidate.params || 0) / 8);
    byModel.set(artifact.canonicalName, {
      ...candidate,
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

// Operator-authorized rejection of exact hunt artifacts. No inference, no
// provider mutation endpoint, and no deletion based on an aggregate ranking.
import { createHash } from 'node:crypto';
import { MODEL_EVALUATION_ROLES, artifactFromInventory } from './model-evaluation-history.js';
import { canonicalModelName, sameModelName } from './model-identity.js';
import { normalizeInstalledModel } from './model-inventory.js';
import { checkRoleEligibility } from './candidate-eligibility.js';
import { trialRole } from './pairwise-trial.js';
import { ROLE_IMPROVEMENT_THRESHOLDS } from '../eval/role-evaluation-plan.js';
import { auditResponsibilitySegregation } from './model-upgrade-prototype.js';

export const HUNT_RETENTION_POLICY = 'all-role-loss-or-production-gpu-unfit-v1';
const keep = (reason, detail = {}) => ({ eligible: false, reason, ...detail });

export function huntRetentionKey({ inventory, bindings, plans, hardware, providerVersion }) {
  if (!providerVersion || providerVersion === 'UNRECORDED') throw new Error('RETENTION_PROVIDER_UNKNOWN');
  const roles = MODEL_EVALUATION_ROLES.map(role => {
    const artifact = artifactFromInventory(bindings[role], inventory);
    const plan = plans[role];
    if (!artifact || !plan?.suiteContractSha256) throw new Error('RETENTION_BINDING_OR_PLAN_MISSING');
    return [role, artifact.canonicalName, artifact.digestSha256, plan.suiteContractSha256,
      ROLE_IMPROVEMENT_THRESHOLDS[role], plan.minimumDiscriminatingTasks,
      plan.minimumDiscriminatingByLanguage, plan.applicabilityContract];
  });
  return `retention:${createHash('sha256').update(JSON.stringify([
    HUNT_RETENTION_POLICY, providerVersion, hardware.model, hardware.vramMb, hardware.numCtx, roles,
  ])).digest('hex')}`;
}

function validRun(row, artifact, role, plan, hardware, providerVersion) {
  const expectedNames = plan.suite.tests.map(task => task.name).sort();
  return row?.status === 'COMPLETE'
    && sameModelName(row.artifact?.modelName, artifact.modelName)
    && row.artifact?.digestSha256 === artifact.digestSha256 && row.role === role
    && row.suiteName === plan.suiteName && row.suiteVersion === plan.suiteVersion
    && row.contractSha256 === plan.suiteContractSha256
    && row.metadata?.provider?.version === providerVersion
    && row.metadata?.provider?.proof === 'RESPONSE_BOUND'
    && row.repeats === plan.repeats && row.repeats >= 3
    && row.hardware?.model === hardware.model && row.hardware?.vramMb === hardware.vramMb
    && row.hardware?.numCtx === hardware.numCtx
    && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1
    && Array.isArray(row.tasks) && row.tasks.length === expectedNames.length
    && JSON.stringify(row.tasks.map(task => task.name).sort()) === JSON.stringify(expectedNames)
    && row.tasks.every(task => Number.isFinite(task.mean) && task.mean >= 0 && task.mean <= 1
      && Number.isFinite(task.spread) && task.spread >= 0 && task.spread <= 1);
}

/** All seven roles are considered, even when the hunt was restricted to CODE. */
export async function assessHuntRetention(input) {
  const { modelName, inventory, bindings, plans, hardware, history } = input;
  const providerVersion = history.providerVersion;
  const model = inventory.find(row => sameModelName(row.name, modelName));
  const artifact = artifactFromInventory(modelName, inventory);
  if (!artifact || !Array.isArray(model?.capabilities) || !model.capabilities.includes('completion')) {
    return keep('RETENTION_IDENTITY_OR_CAPABILITIES_UNKNOWN');
  }
  if (Object.values(bindings).some(name => sameModelName(name, modelName))) return keep('RETENTION_BOUND');
  if (!hardware?.model || !(hardware.vramMb > 0) || !(hardware.numCtx > 0)) return keep('RETENTION_HARDWARE_UNKNOWN');
  if (!auditResponsibilitySegregation(bindings).compliant) return keep('RETENTION_PORTFOLIO_UNRESOLVED');
  const key = huntRetentionKey({ ...input, providerVersion });
  const profile = normalizeInstalledModel(model);
  const roles = MODEL_EVALUATION_ROLES.filter(role => checkRoleEligibility(profile, role).eligible);
  if (!roles.length) return keep('RETENTION_NO_APPLICABLE_ROLES');
  const block = history.getHardwareBlock?.({ digestSha256: artifact.digestSha256, hardware });
  const placement = block?.metadata;
  if (block?.status === 'BLOCKED' && block.errorCode === 'CANDIDATE_VRAM_FIT_FAILED'
    && block.artifact?.digestSha256 === artifact.digestSha256
    && sameModelName(block.artifact?.modelName, artifact.modelName)
    && placement?.provider?.version === providerVersion
    && placement.provider.proof === 'RUN_PREFLIGHT'
    && block.hardware?.model === hardware.model && block.hardware.vramMb === hardware.vramMb
    && Number(placement.numCtx) === hardware.numCtx
    && Number.isSafeInteger(placement.sizeBytes) && placement.sizeBytes > 0
    && Number.isSafeInteger(placement.vramBytes) && placement.vramBytes >= 0
    && placement.cpuBytes > 0 && placement.cpuBytes === placement.sizeBytes - placement.vramBytes) {
    const contradictory = roles.some(role => {
      const plan = plans[role];
      const row = history.getComplete({ digestSha256: artifact.digestSha256, role,
        suiteName: plan.suiteName, suiteVersion: plan.suiteVersion, contractSha256: plan.suiteContractSha256 });
      return validRun(row, artifact, role, plan, hardware, providerVersion);
    });
    if (contradictory) return keep('RETENTION_PLACEMENT_CONTRADICTED');
    return { eligible: true, reason: 'RETENTION_PRODUCTION_GPU_UNFIT', policy: HUNT_RETENTION_POLICY,
      key, artifact, roles, providerVersion, hardware, placementEvidence: block };
  }
  const trials = [];
  for (const role of roles) {
    const plan = plans[role];
    if (!plan?.decisionReady || plan.taskCount < plan.minimumTaskCount) return keep('RETENTION_SUITE_NOT_READY', { role });
    const incumbent = artifactFromInventory(bindings[role], inventory);
    const rows = new Map();
    for (const identity of [artifact, incumbent]) {
      if (!identity) return keep('RETENTION_INCUMBENT_MISSING', { role });
      const row = history.getComplete({ digestSha256: identity.digestSha256, role,
        suiteName: plan.suiteName, suiteVersion: plan.suiteVersion, contractSha256: plan.suiteContractSha256 });
      if (!validRun(row, identity, role, plan, hardware, providerVersion)) {
        return keep('RETENTION_EVIDENCE_INCOMPLETE', { role, model: identity.modelName });
      }
      rows.set(identity.canonicalName, row);
    }
    const trial = await trialRole({ runSuite: () => { throw new Error('RETENTION_MUST_NOT_INFER'); } },
      role, artifact.modelName, incumbent.modelName, {
        evaluationPlan: plan, threshold: ROLE_IMPROVEMENT_THRESHOLDS[role], repeats: plan.repeats,
        loadHistoricalSummary: async ({ model: name }) => {
          const row = rows.get(canonicalModelName(name));
          if (!row) throw new Error('RETENTION_RUN_MISSING');
          return { tasks: row.tasks, runs: row.repeats, score: row.score, historyRunId: row.runId,
            unstableTasks: row.tasks.filter(task => task.spread > 0).map(task => task.name) };
        },
      });
    const c = trial.comparison;
    const threshold = ROLE_IMPROVEMENT_THRESHOLDS[role];
    // "Incumbent stays" also includes ties and lack of a candidate majority.
    // Require a real, sufficiently broad loss and a material overall gap.
    if (trial.decision?.reasonCode !== 'INCUMBENT_QUALITY' || c.inconclusive
      || c.margin > -threshold || c.incumbentWins <= c.candidateWins
      || c.incumbentSuiteScore - c.candidateSuiteScore < threshold) {
      return keep('RETENTION_ROLE_NOT_CLEARLY_LOST', { role, trial });
    }
    const candidateRun = rows.get(artifact.canonicalName);
    const incumbentRun = rows.get(incumbent.canonicalName);
    trials.push({ ...trial, resources: {
      candidate: { tokensPerSecond: candidateRun.tokensPerSecond, vramBytes: candidateRun.vramBytes },
      incumbent: { tokensPerSecond: incumbentRun.tokensPerSecond, vramBytes: incumbentRun.vramBytes },
      policy: 'quality-first; speed does not override a proven quality loss',
    } });
  }
  return { eligible: true, reason: 'RETENTION_ALL_APPLICABLE_ROLES_LOST', policy: HUNT_RETENTION_POLICY,
    key, artifact, roles, trials, providerVersion, hardware };
}

/** Registry rechecks this proof inside its exclusive exact-artifact mutation. */
export async function pruneRejectedHuntModels({ registry, journal, getInventory, getBindings,
  getProviderVersion, assertIdle, history, plans, hardware }) {
  const results = [];
  const candidates = await getInventory();
  for (const candidate of candidates) {
    let approved = null;
    try {
      const assess = async inventory => {
        if (await getProviderVersion() !== history.providerVersion) throw new Error('RETENTION_PROVIDER_CHANGED');
        return assessHuntRetention({ modelName: candidate.name, inventory, bindings: getBindings(inventory), plans, history, hardware });
      };
      const preview = await assess(await getInventory());
      if (!preview.eligible) { results.push({ model: candidate.name, status: 'KEPT', ...preview }); continue; }
      await assertIdle();
      const deletion = await registry.deleteRejectedModel(candidate.name, {
        source: 'AUTO_CLEANUP', expectedDigestSha256: preview.artifact.digestSha256,
      }, async ({ inventory, artifact }) => {
        await assertIdle();
        const proof = await assess(inventory);
        if (!proof.eligible || proof.artifact.digestSha256 !== artifact.digestSha256) {
          throw new Error(`RETENTION_RECHECK_FAILED:${proof.reason}`);
        }
        approved = proof;
        journal.recordRetention({ ...candidate, artifact: proof.artifact }, proof.key, { status: 'APPROVED', proof });
      });
      journal.recordRetention({ ...candidate, artifact: approved.artifact }, approved.key, { status: 'DELETED', proof: approved, deletion });
      results.push({ model: candidate.name, status: 'DELETED', proof: approved, deletion });
    } catch (error) {
      if (approved) journal.recordRetention({ ...candidate, artifact: approved.artifact }, approved.key, { status: 'DELETE_FAILED', proof: approved,
        error: error.message, code: error.code || null });
      results.push({ model: candidate.name, status: approved ? 'DELETE_FAILED' : 'KEPT', reason: error.code || error.message });
    }
  }
  return results;
}

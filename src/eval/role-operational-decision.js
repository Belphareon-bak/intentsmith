// Qualification of a complete role workflow, not a score for one isolated
// answer. This consumes reviewed receipts; it never runs or approves a model.
import { validatePairedPlan, decidePairedPlan, decideCodePilot } from './code-pilot-decision.js';

const roles = new Set(['D1', 'D2', 'R1', 'R2', 'CHAT', 'VISION']);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const requireValue = (ok, reason) => { if (!ok) throw new Error(`ROLE_OPERATIONAL_EVIDENCE_INVALID:${reason}`); };

export function decideRoleOperational(plan, attempts, qualifications = {}) {
  if (plan?.role === 'CODE') return decideCodePilot(plan, attempts, qualifications);
  requireValue(roles.has(plan?.role), 'role');
  validatePairedPlan(plan, plan.role, 'completed_role_workflow_without_repair_help');
  const workflow = plan.roleWorkflow;
  requireValue(workflow?.role === plan.role && text(workflow.name)
    && hash(workflow.contractSha256) && workflow.scope === 'COMPLETE_ROLE_WORKFLOW'
    && workflow.acceptanceChecks?.length > 0 && workflow.regressionChecks?.length > 0
    && [...workflow.acceptanceChecks, ...workflow.regressionChecks].every(text)
    && new Set([...workflow.acceptanceChecks, ...workflow.regressionChecks]).size
      === workflow.acceptanceChecks.length + workflow.regressionChecks.length, 'workflow');
  requireValue(Array.isArray(plan.developmentGroups) && plan.developmentGroups.length > 0
    && plan.developmentGroups.every(text), 'development groups');
  const development = new Set(plan.developmentGroups);
  for (const scenario of plan.scenarios) {
    requireValue(hash(scenario.originSha256) && hash(scenario.inputSha256)
      && !development.has(scenario.independenceGroup) && !development.has(scenario.originSha256), 'holdout overlap');
  }
  const originGroups = new Map();
  for (const scenario of plan.scenarios) {
    requireValue(!originGroups.has(scenario.originSha256)
      || originGroups.get(scenario.originSha256) === scenario.independenceGroup, 'one origin counted twice');
    originGroups.set(scenario.originSha256, scenario.independenceGroup);
  }
  const keys = [...workflow.acceptanceChecks, ...workflow.regressionChecks].sort();
  for (const attempt of attempts) {
    // Invalid attempts remain in the paired engine's denominator and block a
    // decision. A missing receipt must not be turned into a model's zero.
    if (attempt.valid !== true) continue;
    const receipt = attempt.workflowReceipt;
    const scenario = plan.scenarios.find(s => s.id === attempt.scenario);
    requireValue(receipt?.role === plan.role && receipt.scope === workflow.scope
      && receipt.workflowContractSha256 === workflow.contractSha256
      && receipt.inputSha256 === scenario?.inputSha256
      && hash(receipt.finalStateSha256) && hash(receipt.traceSha256)
      && receipt.environmentValid === true && receipt.independentVerification === true
      && receipt.repairHelp === attempt.repairHelp && attempt.repairHelp === 0
      && Array.isArray(receipt.checks)
      && JSON.stringify(receipt.checks.map(c => c.id).sort()) === JSON.stringify(keys)
      && receipt.checks.every(c => typeof c.passed === 'boolean' && hash(c.evidenceSha256)), 'final state receipt');
    const completed = receipt.checks.every(c => c.passed) && attempt.durationMs <= plan.budget.attemptMs;
    requireValue(completed === (attempt.score === 1), 'score contradicts final state');
  }
  return decidePairedPlan(plan, attempts, qualifications);
}

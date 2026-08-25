// Append-only role-specific decisions over two exact evaluation runs.

import { createHash, randomUUID } from 'node:crypto';
import { MODEL_EVALUATION_DECISION_REASON } from './pairwise-trial.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function requireText(value, label, max = 128) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
}

function policyContract(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('decision policy must be an object');
  }
  const canonicalJson = JSON.stringify(stable(policy));
  return Object.freeze({
    version: requireText(policy.version, 'policy.version'),
    canonicalJson,
    sha256: createHash('sha256').update(canonicalJson).digest('hex'),
  });
}

function outcomeForDecision(decision) {
  switch (decision?.reasonCode) {
    case MODEL_EVALUATION_DECISION_REASON.CANDIDATE_QUALITY:
      return 'CANDIDATE';
    case MODEL_EVALUATION_DECISION_REASON.INCUMBENT_QUALITY:
      return 'INCUMBENT';
    case MODEL_EVALUATION_DECISION_REASON.INSUFFICIENT_EVIDENCE:
    case MODEL_EVALUATION_DECISION_REASON.QUALITY_INCONCLUSIVE:
      return 'INCONCLUSIVE';
    default:
      throw new TypeError('decision.reasonCode must be a stable evaluation decision enum');
  }
}

export class ModelEvaluationDecisionStore {
  constructor(db) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('ModelEvaluationDecisionStore requires a SQLite database');
    }
    const table = db.prepare(`
      SELECT 1 AS ok FROM sqlite_master
      WHERE type = 'table' AND name = 'model_evaluation_decisions'
    `).get();
    if (!table) throw new Error('model_evaluation_decisions migration is not applied');
    this._db = db;
  }

  recordTrial(trial, input = {}) {
    if (trial?.skipped) throw new TypeError('a skipped trial cannot become a decision');
    const role = requireText(trial?.role, 'trial.role', 16).toUpperCase();
    const incumbentRunId = requireText(trial?.comparison?.incumbentRunId, 'incumbentRunId');
    const candidateRunId = requireText(trial?.comparison?.candidateRunId, 'candidateRunId');
    const basis = requireText(trial?.decision?.basis || 'unknown', 'decision.basis');
    const contract = policyContract(trial?.policy);
    const policySuiteName = requireText(trial?.policy?.suiteName, 'policy.suiteName');
    const policySuiteVersion = requireText(trial?.policy?.suiteVersion, 'policy.suiteVersion');
    const policySuiteContractSha256 = requireText(
      trial?.policy?.suiteContractSha256,
      'policy.suiteContractSha256',
      64,
    ).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(policySuiteContractSha256)) {
      throw new TypeError('policy.suiteContractSha256 must be a lowercase SHA-256');
    }
    const exactRuns = this._db.prepare(`
      SELECT run_id, suite_name, suite_version, suite_contract_sha256, status
      FROM model_evaluation_runs
      WHERE run_id IN (?, ?)
      ORDER BY run_id
    `).all(incumbentRunId, candidateRunId);
    if (exactRuns.length !== 2 || exactRuns.some(run => (
      run.status !== 'COMPLETE'
      || run.suite_name !== policySuiteName
      || run.suite_version !== policySuiteVersion
      || run.suite_contract_sha256 !== policySuiteContractSha256
    ))) {
      throw new TypeError('decision policy must identify the exact COMPLETE suite contract of both runs');
    }
    const decisionId = input.decisionId || `decision_${randomUUID()}`;
    const outcome = outcomeForDecision(trial.decision);
    const details = {
      candidateModel: input.candidateModel || null,
      incumbentModel: input.incumbentModel || null,
      activationEligible: input.activationEligible === true,
      activationBlockReason: input.activationEligible === true
        ? null
        : requireText(
          input.activationBlockReason || 'PORTFOLIO_DECISION_NOT_RECORDED',
          'activationBlockReason',
          256,
        ),
      decision: trial.decision,
      comparison: trial.comparison,
      policy: trial.policy,
      source: input.source || 'model-upgrade-hunt-v136.1',
    };
    this._db.prepare(`
      INSERT INTO model_evaluation_decisions (
        decision_id, role, incumbent_run_id, candidate_run_id,
        policy_version, policy_contract_sha256, outcome, basis, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decisionId,
      role,
      incumbentRunId,
      candidateRunId,
      contract.version,
      contract.sha256,
      outcome,
      basis,
      JSON.stringify(details),
    );
    return this.get(decisionId);
  }

  get(decisionId) {
    const row = this._db.prepare(
      'SELECT * FROM model_evaluation_decisions WHERE decision_id = ?'
    ).get(decisionId);
    if (!row) return null;
    return Object.freeze({
      decisionId: row.decision_id,
      role: row.role,
      incumbentRunId: row.incumbent_run_id,
      candidateRunId: row.candidate_run_id,
      policyVersion: row.policy_version,
      policyContractSha256: row.policy_contract_sha256,
      outcome: row.outcome,
      basis: row.basis,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at,
    });
  }

  listForRole(role) {
    return this._db.prepare(`
      SELECT decision_id
      FROM model_evaluation_decisions
      WHERE role = ?
      ORDER BY created_at, decision_id
    `).all(requireText(role, 'role', 16).toUpperCase()).map(row => this.get(row.decision_id));
  }
}

export default ModelEvaluationDecisionStore;

// Authoritative read model for current role-specific model evaluations.
//
// A row is current only when both the installed artifact digest and the exact
// versioned suite contract match. Timestamps are displayed, never converted
// into an arbitrary freshness TTL. Legacy name-only rows cannot match.

import { createRoleEvaluationPlans } from '../eval/role-evaluation-plan.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';

export class ModelEvaluationReadError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelEvaluationReadError';
    this.code = code;
    this.httpStatus = options.httpStatus || 500;
  }
}

function exactArtifact(row) {
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  const canonicalName = canonicalModelName(name);
  const digestSha256 = normalizeModelDigestSha256(row?.digestSha256 || row?.digest);
  return {
    name,
    canonicalName,
    digestSha256,
    size: Number.isFinite(row?.size) ? row.size : null,
    modifiedAt: row?.modified_at || row?.modifiedAt || null,
  };
}

function decodeCurrentRow(row) {
  if (!row) return null;
  return Object.freeze({
    runId: row.run_id,
    status: row.status,
    score: row.score == null ? null : Number(row.score),
    passed: Number(row.passed),
    total: Number(row.total),
    repeats: Number(row.repeats),
    durationMs: Number(row.duration_ms),
    testedAt: row.completed_at,
    startedAt: row.started_at,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  });
}

function currentStatus(db, artifact, role, plan) {
  if (!artifact.digestSha256) {
    return Object.freeze({
      status: 'BLOCKED',
      score: null,
      testedAt: null,
      runId: null,
      errorCode: 'ARTIFACT_DIGEST_MISSING',
      errorMessage: 'Installed model does not expose an exact SHA-256 digest',
    });
  }
  const row = db.prepare(`
    SELECT run_id, status, score, passed, total, repeats, duration_ms,
           error_code, error_message, started_at, completed_at
    FROM model_evaluation_runs
    WHERE model_digest_sha256 = ?
      AND suite_name = ?
      AND suite_contract_sha256 = ?
      AND role = ?
    ORDER BY CASE status WHEN 'COMPLETE' THEN 0 ELSE 1 END,
             completed_at DESC,
             run_id DESC
    LIMIT 1
  `).get(artifact.digestSha256, plan.suiteName, plan.suiteContractSha256, role);
  return decodeCurrentRow(row) || Object.freeze({
    status: 'MISSING',
    score: null,
    testedAt: null,
    runId: null,
    errorCode: null,
    errorMessage: null,
  });
}

function decodeDecision(row, context) {
  const details = JSON.parse(row.details_json);
  const incumbentArtifact = context.inventory.find(artifact => (
    artifact.digestSha256 === row.incumbent_digest_sha256
  ));
  const candidateArtifact = context.inventory.find(artifact => (
    artifact.digestSha256 === row.candidate_digest_sha256
  ));
  const bindingArtifact = context.inventory.find(artifact => (
    sameModelName(context.binding, artifact.name)
  ));
  let actionability = 'NOT_CANDIDATE_WIN';
  if (row.outcome === 'CANDIDATE') {
    if (details.activationEligible !== true) actionability = 'PORTFOLIO_NOT_APPROVED';
    else if (context.bindingAuthority.status !== 'DURABLE') {
      actionability = 'BINDING_AUTHORITY_DEGRADED';
    } else if (!bindingArtifact?.digestSha256) actionability = 'BINDING_ARTIFACT_UNRESOLVED';
    else if (bindingArtifact.digestSha256 !== row.incumbent_digest_sha256) {
      actionability = 'INCUMBENT_BINDING_CHANGED';
    } else if (!candidateArtifact) actionability = 'CANDIDATE_NOT_INSTALLED';
    else actionability = 'READY_FOR_MANUAL_BINDING';
  }
  return Object.freeze({
    decisionId: row.decision_id,
    role: row.role,
    outcome: row.outcome,
    basis: row.basis,
    policyVersion: row.policy_version,
    policyContractSha256: row.policy_contract_sha256,
    incumbentRunId: row.incumbent_run_id,
    incumbentModel: row.incumbent_model_name,
    incumbentDigestSha256: row.incumbent_digest_sha256,
    candidateRunId: row.candidate_run_id,
    candidateModel: row.candidate_model_name,
    candidateDigestSha256: row.candidate_digest_sha256,
    suiteName: row.suite_name,
    suiteVersion: row.suite_version,
    suiteContractSha256: row.suite_contract_sha256,
    createdAt: row.created_at,
    actionable: actionability === 'READY_FOR_MANUAL_BINDING',
    actionability,
    incumbentInstalled: Boolean(incumbentArtifact),
    candidateInstalled: Boolean(candidateArtifact),
    details: Object.freeze(details),
  });
}

function normalizeBindingAuthority(value) {
  const authority = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    status: typeof authority.status === 'string'
      ? authority.status
      : 'UNVERIFIED_RUNTIME',
    durableRoles: Object.freeze(Array.isArray(authority.durableRoles)
      ? [...authority.durableRoles]
      : []),
    verifiedRoles: Object.freeze(Array.isArray(authority.verifiedRoles)
      ? [...authority.verifiedRoles]
      : []),
    reason: typeof authority.reason === 'string' ? authority.reason : null,
    failures: Object.freeze(Array.isArray(authority.failures)
      ? [...authority.failures]
      : []),
  });
}

export class ModelEvaluationReadModel {
  constructor(db, opts = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('ModelEvaluationReadModel requires a SQLite database');
    }
    this._db = db;
    this._plans = opts.plans || createRoleEvaluationPlans();
    const tables = new Set(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('model_evaluation_runs', 'model_evaluation_decisions')
    `).all().map(row => row.name));
    if (!tables.has('model_evaluation_runs') || !tables.has('model_evaluation_decisions')) {
      throw new ModelEvaluationReadError(
      'MODEL_EVALUATION_SCHEMA_MISSING',
      'model evaluation run/decision migrations are not applied',
      { httpStatus: 503 },
      );
    }
  }

  read(input = {}) {
    const inventory = Array.isArray(input.inventory) ? input.inventory.map(exactArtifact) : [];
    const bindings = input.bindings && typeof input.bindings === 'object' ? input.bindings : {};
    const bindingAuthority = normalizeBindingAuthority(input.bindingAuthority);
    try {
      const models = inventory.map(artifact => {
        const evaluations = {};
        for (const [role, plan] of Object.entries(this._plans)) {
          const result = currentStatus(this._db, artifact, role, plan);
          evaluations[role] = Object.freeze({
            role,
            suiteName: plan.suiteName,
            suiteVersion: plan.suiteVersion,
            suiteContractSha256: plan.suiteContractSha256,
            taskCount: plan.taskCount,
            minimumTaskCount: plan.minimumTaskCount,
            decisionReady: plan.decisionReady,
            runtimeBlockCode: plan.runtimeBlockCode || null,
            runtimeBlockReason: plan.runtimeBlockReason || null,
            isCurrentBinding: sameModelName(bindings[role], artifact.name),
            ...result,
          });
        }
        return Object.freeze({ ...artifact, evaluations: Object.freeze(evaluations) });
      });

      const roles = {};
      const decisions = [];
      for (const [role, plan] of Object.entries(this._plans)) {
        const artifacts = models.map(model => Object.freeze({
          model: model.name,
          canonicalName: model.canonicalName,
          digestSha256: model.digestSha256,
          ...model.evaluations[role],
        }));
        const roleDecisions = this._db.prepare(`
          SELECT d.decision_id, d.role, d.incumbent_run_id, d.candidate_run_id,
                 d.policy_version, d.policy_contract_sha256, d.outcome, d.basis,
                 d.details_json, d.created_at,
                 incumbent.model_name AS incumbent_model_name,
                 incumbent.model_digest_sha256 AS incumbent_digest_sha256,
                 candidate.model_name AS candidate_model_name,
                 candidate.model_digest_sha256 AS candidate_digest_sha256,
                 candidate.suite_name, candidate.suite_version,
                 candidate.suite_contract_sha256
          FROM model_evaluation_decisions d
          JOIN model_evaluation_runs incumbent ON incumbent.run_id = d.incumbent_run_id
          JOIN model_evaluation_runs candidate ON candidate.run_id = d.candidate_run_id
          WHERE d.role = ?
            AND incumbent.role = d.role
            AND candidate.role = d.role
            AND candidate.suite_name = ?
            AND candidate.suite_version = ?
            AND candidate.suite_contract_sha256 = ?
          ORDER BY d.created_at DESC, d.decision_id DESC
        `).all(role, plan.suiteName, plan.suiteVersion, plan.suiteContractSha256).map(row => (
          decodeDecision(row, { inventory, binding: bindings[role], bindingAuthority })
        ));
        decisions.push(...roleDecisions);
        roles[role] = Object.freeze({
          role,
          binding: bindings[role] || null,
          suiteName: plan.suiteName,
          suiteVersion: plan.suiteVersion,
          suiteContractSha256: plan.suiteContractSha256,
          repeats: plan.repeats,
          taskCount: plan.taskCount,
          minimumTaskCount: plan.minimumTaskCount,
          decisionReady: plan.decisionReady,
          runtimeBlockCode: plan.runtimeBlockCode || null,
          runtimeBlockReason: plan.runtimeBlockReason || null,
          minimumDiscriminatingTasks: plan.minimumDiscriminatingTasks,
          minimumDiscriminatingByLanguage: plan.minimumDiscriminatingByLanguage,
          artifacts: Object.freeze(artifacts),
          latestDecision: roleDecisions[0] || null,
          decisions: Object.freeze(roleDecisions),
        });
      }

      const statusCounts = { COMPLETE: 0, FAILED: 0, BLOCKED: 0, MISSING: 0 };
      for (const model of models) {
        for (const row of Object.values(model.evaluations)) statusCounts[row.status]++;
      }
      return Object.freeze({
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        authority: Object.freeze({
          status: 'READY',
          tables: Object.freeze(['model_evaluation_runs', 'model_evaluation_decisions']),
          currentContractOnly: true,
          legacyFallback: false,
        }),
        bindingAuthority,
        bindings: Object.freeze({ ...bindings }),
        statusCounts: Object.freeze(statusCounts),
        decisions: Object.freeze(decisions),
        roles: Object.freeze(roles),
        models: Object.freeze(models),
      });
    } catch (error) {
      if (error instanceof ModelEvaluationReadError) throw error;
      throw new ModelEvaluationReadError(
        'MODEL_EVALUATION_DB_READ_FAILED',
        `Model evaluation read failed: ${error.message}`,
        { cause: error, httpStatus: 503 },
      );
    }
  }
}

export default ModelEvaluationReadModel;

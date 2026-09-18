// Authoritative read model for current role-specific model evaluations.
//
// A row is current only when both the installed artifact digest and the exact
// versioned suite contract match. Timestamps are displayed, never converted
// into an arbitrary freshness TTL. Legacy name-only rows cannot match.

import {
  checkModelEvaluationApplicability,
  createRoleEvaluationPlans,
} from '../eval/role-evaluation-plan.js';
import { normalizeInstalledModel } from './model-inventory.js';
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

export const MODEL_EVALUATION_INTERVAL_INTEGRITY = Object.freeze({
  VERIFIED: 'VERIFIED',
  LEGACY_UNVERIFIED: 'LEGACY_UNVERIFIED',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
});

const INTERVAL_TOLERANCE_MS = 2;

function decodedInterval(row) {
  const startedMs = Date.parse(row.started_at);
  const completedMs = Date.parse(row.completed_at);
  const durationMs = Number(row.duration_ms);
  const verified = Number.isFinite(startedMs)
    && Number.isFinite(completedMs)
    && completedMs >= startedMs
    && Number.isSafeInteger(durationMs)
    && durationMs >= 0
    && Math.abs((completedMs - startedMs) - durationMs) <= INTERVAL_TOLERANCE_MS;
  if (verified) {
    return Object.freeze({
      durationMs,
      testedAt: row.completed_at,
      startedAt: row.started_at,
      intervalIntegrity: MODEL_EVALUATION_INTERVAL_INTEGRITY.VERIFIED,
      testedAtProvenance: 'VERIFIED_COMPLETION_BOUNDARY',
    });
  }
  return Object.freeze({
    durationMs: null,
    testedAt: Number.isFinite(completedMs) ? row.completed_at : null,
    startedAt: null,
    intervalIntegrity: MODEL_EVALUATION_INTERVAL_INTEGRITY.LEGACY_UNVERIFIED,
    testedAtProvenance: Number.isFinite(completedMs) ? 'LEGACY_RECORDED_AT_ONLY' : 'UNAVAILABLE',
  });
}

function unavailableInterval() {
  return Object.freeze({
    durationMs: null,
    testedAt: null,
    startedAt: null,
    intervalIntegrity: MODEL_EVALUATION_INTERVAL_INTEGRITY.NOT_AVAILABLE,
    testedAtProvenance: 'UNAVAILABLE',
  });
}

function exactArtifact(row) {
  const normalized = normalizeInstalledModel(row);
  const name = normalized.name;
  const canonicalName = canonicalModelName(name);
  const digestSha256 = normalizeModelDigestSha256(normalized.digestSha256);
  return {
    name,
    canonicalName,
    digestSha256,
    size: normalized.size,
    modifiedAt: normalized.modifiedAt,
    params: normalized.params,
    family: normalized.family,
    category: normalized.category,
    capabilities: Object.freeze([...normalized.capabilities]),
  };
}

function roleApplicability(artifact, plan) {
  return checkModelEvaluationApplicability(artifact, plan);
}

function taskDetails(row) {
  const tasks = JSON.parse(row.task_results_json || '[]');
  return tasks.map(t => ({ name: t.name, repeat: t.repeat ?? null, language: t.language || null,
    mean: t.mean == null ? null : Number(t.mean), spread: Number(t.spread || 0), scores: t.scores || [],
    rubric: t.rubric || [], details: (t.details || []).map(d => d && ({
      reason: d.reason || null, syntaxOk: d.syntaxOk, applied: d.applied,
      outcome: d.outcome, valid: d.valid, timedOut: d.timedOut,
      targetedPassed: d.targetedPassed, targeted: d.targeted, regressions: d.regressions,
      schema: d.schema, parts: d.parts, penalties: d.penalties,
      precision: d.precision, recall: d.recall, f1: d.f1,
      truePositive: d.truePositive, falsePositive: d.falsePositive, falseNegative: d.falseNegative,
      observed: d.observed, expected: d.expected,
      responseFormat: d.responseFormat, strictJson: d.strictJson,
    })) }));
}
// Presentation only: no prompts, grading rules or contract hashes are changed.
const TASK_LABELS = {
  patch_8cae1b583963: 'Výběr starých modelů bez duplicit',
  patch_0fe346cc820c: 'Souběh inference a změny modelu',
  patch_6fc5e4eb7dce: 'Ochrana modelu během práce s VRAM',
  patch_ef4ae48ec16e: 'Jistota rozhodnutí při porovnání modelů',
  patch_e8cdbe02e5de: 'Uložení odpovědi, chyby a zrušení',
  patch_22149f55b861: 'Uvolnění časovače po úspěšné odpovědi',
  patch_adb1258cfec0: 'Uvolnění časovače při síťové chybě',
  repo_audit_error_envelope: 'Rozpoznání neúspěšného auditu',
  repo_history_late_guard: 'Chyba v historii před pozdní kontrolou',
  repo_history_early_guard: 'Ochrana historie včasnou kontrolou',
  repo_immutable_refinement: 'Zápis do neměnného výsledku',
  reason_budget: 'Výpočet rozpočtu a daně', reason_order: 'Pořadí závislých kroků',
  reason_critical_path: 'Kritická cesta a délka plánu', reason_table: 'Porovnání hodnot v tabulce',
  reason_sets: 'Průniky a rozdíly množin', reason_rate: 'Rychlost práce a doba dokončení',
  reason_logic: 'Logický úsudek', reason_transform: 'Vícekroková transformace',
  review_sql_null: 'SQL injection a prázdná hodnota', review_path_async: 'Bezpečnost cest a asynchronní volání',
  'review_command_secret': 'Příkazová injekce a únik tajemství', review_bounds_resource: 'Meze indexů a únik prostředků',
  review_auth_race: 'Obcházení oprávnění a souběh', review_clean: 'Správný kód bez falešných nálezů',
  vision_red: 'Barva a jednolitost obrazu', vision_dots: 'Počet objektů a barvy',
  vision_ring: 'Tvar, popředí a pozadí', vision_dots_cz: 'Počet a barvy v češtině',
  vision_no_image: 'Přiznání chybějícího obrázku',
  grounded_summary: 'Shrnutí podle podkladů', action_email: 'Pracovní e-mail s úkolem',
  context_correction: 'Zapracování opravy kontextu', missing_context: 'Doplnění chybějícího zadání',
  structured_extraction: 'Extrakce údajů do JSON', translation_from_czech: 'Překlad z češtiny',
  instruction_priority: 'Priorita pokynů', state_updates: 'Aktualizace stavu',
  capability_boundary: 'Přiznání mezí přístupu', exact_markdown_table: 'Přesná tabulka Markdown',
  professional_rewrite: 'Profesionální přeformulování', conditional_action: 'Výběr podmíněné akce',
  exact_csv: 'Přesný CSV výstup', ambiguous_reference: 'Vyjasnění nejednoznačného odkazu',
  completion_vs_verification: 'Rozlišení dokončení a ověření', quantifier_scope: 'Počty a rozsah tvrzení',
  evidence_boundary: 'Oddělení důkazu od domněnky', exact_yaml: 'Přesný YAML výstup',
  multi_correction: 'Více oprav zadání', neutral_escalation: 'Věcná eskalace',
  inclusion_exclusion: 'Zahrnutí a vyloučení položek', coherent_status_paragraph: 'Souvislá zpráva o stavu',
  customer_delay_explanation: 'Vysvětlení zpoždění zákazníkovi', grounded_comparison_paragraph: 'Porovnání podle podkladů',
  exact_bullets: 'Přesné odrážky', professional_reply: 'Profesionální odpověď',
  declension: 'Skloňování jmen', plural_agreement: 'Shoda v množném čísle', formal_register: 'Formální vyjadřování',
  ambiguity_clarification: 'Vyjasnění zadání', vocative_request: 'Oslovení a žádost',
  double_negation_counts: 'Dvojitý zápor a počty', grammar_correction: 'Oprava české gramatiky',
  numeral_cases: 'Číslovky a pády', relative_pronoun: 'Vztažná věta',
  conditional_deadline: 'Podmíněný termín', customer_explanation_paragraph: 'Souvislé vysvětlení zákazníkovi',
};
function taskCatalog(plan) {
  return (plan.suite?.tests || []).map(t => {
    const g = t.contractMaterial?.gradingInputs;
    const source = typeof g?.source === 'string' ? g.source : g?.source?.path;
    const simple = t.name.replace(/^(?:reason|review)_(?=repo_)/, '').replace(/^(?:en|cz)_/, '');
    return { name: t.name, label: TASK_LABELS[t.name] || TASK_LABELS[simple] || t.description || t.name.replaceAll('_', ' '),
      type: plan.suiteName === 'code_patch' ? 'Oprava kódu · spuštěné testy' : plan.suiteName === 'review_v2' ? 'Revize kódu'
        : plan.suiteName === 'reasoning_v2' ? 'Analýza a logika' : plan.suiteName === 'vision_v2' ? 'Porozumění obrazu' : 'Konverzace',
      source: source || null, language: t.language || null, difficulty: t.difficulty || null, skill: t.skill || null,
      requirements: g?.failToPass || t.rubric || [], context: g?.context || null };
  });
}

function decodeCurrentRow(row, includeTasks = true) {
  if (!row) return null;
  const interval = decodedInterval(row);
  return Object.freeze({
    runId: row.run_id,
    status: row.status,
    providerVersion: row.provider_version || null,
    providerProvenance: row.provider_version ? 'RECORDED' : 'UNRECORDED',
    score: row.score == null ? null : Number(row.score),
    passed: Number(row.passed),
    total: Number(row.total),
    repeats: Number(row.repeats),
    attemptCounts: JSON.parse(row.metadata_json || '{}').attemptCounts || null,
    tasks: includeTasks ? Object.freeze(taskDetails(row)) : undefined,
    ...interval,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  });
}

function currentStatus(db, artifact, role, plan, providerVersion = null) {
  if (!artifact.digestSha256) {
    return Object.freeze({
      status: 'BLOCKED',
      score: null,
      runId: null,
      errorCode: 'ARTIFACT_DIGEST_MISSING',
      errorMessage: 'Installed model does not expose an exact SHA-256 digest',
      ...unavailableInterval(),
    });
  }
  const row = db.prepare(`
    SELECT *,
           json_extract(metadata_json, '$.provider.version') AS provider_version
    FROM model_evaluation_runs
    WHERE model_digest_sha256 = ?
      AND suite_name = ?
      AND suite_version = ?
      AND suite_contract_sha256 = ?
      AND role = ?
      AND (? IS NULL OR json_extract(metadata_json, '$.provider.version') = ?)
    ORDER BY CASE status WHEN 'COMPLETE' THEN 0 ELSE 1 END,
             completed_at DESC,
             rowid DESC
    LIMIT 1
  `).get(
    artifact.digestSha256,
    plan.suiteName,
    plan.suiteVersion,
    plan.suiteContractSha256,
    role,
    providerVersion, providerVersion,
  );
  if (row) return decodeCurrentRow(row);
  const previous = db.prepare(`SELECT suite_name, suite_version, suite_contract_sha256, completed_at,
      json_extract(metadata_json, '$.provider.version') AS provider_version
    FROM model_evaluation_runs WHERE model_digest_sha256 = ? AND role = ? AND status = 'COMPLETE'
    ORDER BY completed_at DESC LIMIT 1`).get(artifact.digestSha256, role);
  const missingReason = !previous ? 'NOT_EVALUATED'
    : (previous.suite_contract_sha256 !== plan.suiteContractSha256 || previous.suite_name !== plan.suiteName || previous.suite_version !== plan.suiteVersion) ? 'SUITE_CHANGED' : 'PROVIDER_CHANGED';
  return Object.freeze({
    status: 'MISSING', score: null, runId: null, errorCode: null, errorMessage: null,
    missingReason,
    missingExplanation: missingReason === 'SUITE_CHANGED'
      ? 'Model je stažený, ale uložené měření patří starší testovací sadě. Spusť test pro aktuální sadu.'
      : missingReason === 'PROVIDER_CHANGED'
        ? 'Uložené měření nemá požadovanou verzi Ollamy. Spusť aktuální test.'
        : 'Model je stažený, ale pro tuto roli zatím nemá odpovídající měření. Spusť test.',
    ...unavailableInterval(),
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
    if (context.providerVersion && row.provider_version !== context.providerVersion) actionability = 'PROVIDER_VERSION_CHANGED';
    else if (details.activationEligible !== true) actionability = 'PORTFOLIO_NOT_APPROVED';
    else if (context.bindingAuthority.status !== 'DURABLE') {
      actionability = 'BINDING_AUTHORITY_DEGRADED';
    } else if (!bindingArtifact?.digestSha256) actionability = 'BINDING_ARTIFACT_UNRESOLVED';
    else if (bindingArtifact.digestSha256 !== row.incumbent_digest_sha256) {
      actionability = 'INCUMBENT_BINDING_CHANGED';
    } else if (!candidateArtifact) actionability = 'CANDIDATE_NOT_INSTALLED';
    else if (context.currentRuns?.get(row.incumbent_digest_sha256) !== row.incumbent_run_id
      || context.currentRuns?.get(row.candidate_digest_sha256) !== row.candidate_run_id) actionability = 'EVALUATION_REPLACED';
    else actionability = 'READY_FOR_MANUAL_BINDING';
  }
  return Object.freeze({
    decisionId: row.decision_id,
    providerVersion: row.provider_version || null,
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

  readRun(runId) {
    if (typeof runId !== 'string' || runId.length > 200) {
      throw new ModelEvaluationReadError('INVALID_RUN_ID', 'Invalid evaluation ID', { httpStatus: 400 });
    }
    try {
      const row = this._db.prepare(`SELECT *, json_extract(metadata_json, '$.provider.version') AS provider_version
        FROM model_evaluation_runs WHERE run_id = ?`).get(runId);
      if (!row) throw new ModelEvaluationReadError('EVALUATION_NOT_FOUND', 'Měření nebylo nalezeno.', { httpStatus: 404 });
      const plan = this._plans[row.role];
      const exact = plan && row.suite_name === plan.suiteName && row.suite_version === plan.suiteVersion
        && row.suite_contract_sha256 === plan.suiteContractSha256;
      return Object.freeze({ ...decodeCurrentRow(row), model: row.model_name, role: row.role,
        digestSha256: row.model_digest_sha256, suiteName: row.suite_name, suiteVersion: row.suite_version,
        suiteContractSha256: row.suite_contract_sha256, tokensPerSecond: row.tokens_per_second,
        taskCatalog: exact ? taskCatalog(plan) : [], catalogMatchesContract: Boolean(exact),
      });
    } catch (error) {
      if (error instanceof ModelEvaluationReadError) throw error;
      throw new ModelEvaluationReadError('MODEL_EVALUATION_DB_READ_FAILED', 'Detail měření nelze načíst.', { cause: error, httpStatus: 503 });
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
          const result = currentStatus(this._db, artifact, role, plan, input.providerVersion || null);
          const applicability = roleApplicability(artifact, plan);
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
            applicable: applicability.applicable,
            applicabilityReasonCode: applicability.reasonCode,
            applicabilityReason: applicability.reason,
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
                 candidate.suite_contract_sha256,
                 json_extract(candidate.metadata_json, '$.provider.version') AS provider_version
          FROM model_evaluation_decisions d
          JOIN model_evaluation_runs incumbent ON incumbent.run_id = d.incumbent_run_id
          JOIN model_evaluation_runs candidate ON candidate.run_id = d.candidate_run_id
          WHERE d.role = ?
            AND incumbent.role = d.role
            AND candidate.role = d.role
            AND incumbent.suite_name = ?
            AND incumbent.suite_version = ?
            AND incumbent.suite_contract_sha256 = ?
            AND candidate.suite_name = ?
            AND candidate.suite_version = ?
            AND candidate.suite_contract_sha256 = ?
          ORDER BY d.created_at DESC, d.decision_id DESC
        `).all(
          role,
          plan.suiteName,
          plan.suiteVersion,
          plan.suiteContractSha256,
          plan.suiteName,
          plan.suiteVersion,
          plan.suiteContractSha256,
        ).map(row => (
          decodeDecision(row, { inventory, binding: bindings[role], bindingAuthority, providerVersion: input.providerVersion || null, currentRuns: new Map(artifacts.map(a => [a.digestSha256, a.runId])) })
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
          coverage: Object.freeze({
            applicable: artifacts.filter(row => row.applicable).length,
            notApplicable: artifacts.filter(row => !row.applicable).length,
            applicableMissing: artifacts.filter(row => (
              row.applicable && row.status === 'MISSING'
            )).length,
          }),
          applicabilityContract: plan.applicabilityContract,
          tasks: Object.freeze(taskCatalog(plan)),
          artifacts: Object.freeze(artifacts),
          latestDecision: roleDecisions[0] || null,
          decisions: Object.freeze(roleDecisions),
        });
      }

      const statusCounts = { COMPLETE: 0, FAILED: 0, BLOCKED: 0, MISSING: 0 };
      const applicableStatusCounts = { COMPLETE: 0, FAILED: 0, BLOCKED: 0, MISSING: 0 };
      let notApplicableCount = 0;
      for (const model of models) {
        for (const row of Object.values(model.evaluations)) {
          statusCounts[row.status]++;
          if (row.applicable) applicableStatusCounts[row.status]++;
          else notApplicableCount++;
        }
      }
      return Object.freeze({
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        providerVersion: input.providerVersion || null,
        authority: Object.freeze({
          status: 'READY',
          tables: Object.freeze(['model_evaluation_runs', 'model_evaluation_decisions']),
          currentContractOnly: true,
          legacyFallback: false,
          applicability: 'versioned-technical-compatibility',
        }),
        bindingAuthority,
        bindings: Object.freeze({ ...bindings }),
        statusCounts: Object.freeze(statusCounts),
        coverage: Object.freeze({
          applicableStatusCounts: Object.freeze(applicableStatusCounts),
          applicableTotal: Object.values(applicableStatusCounts)
            .reduce((sum, count) => sum + count, 0),
          notApplicable: notApplicableCount,
          total: models.length * Object.keys(this._plans).length,
        }),
        history: Object.freeze(this._db.prepare(`SELECT *, json_extract(metadata_json, '$.provider.version') AS provider_version
          FROM model_evaluation_runs ORDER BY completed_at DESC, rowid DESC LIMIT 200`).all().map(row => ({
            ...decodeCurrentRow(row, false), model: row.model_name, role: row.role, digestSha256: row.model_digest_sha256,
            suiteName: row.suite_name, suiteContractSha256: row.suite_contract_sha256,
            current: models.some(m => m.digestSha256 === row.model_digest_sha256 && m.evaluations[row.role]?.runId === row.run_id),
          }))),
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

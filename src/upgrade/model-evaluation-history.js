// Durable, append-only model evaluation history.
//
// A display name is not a model identity and a suite name is not an
// evaluation contract. Reuse is allowed only for the same Ollama artifact
// digest and the same hash of prompts, graders, options and repetitions.

import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_MODEL_EVALUATION_OPTIONS } from '../eval/model-evaluation-runner.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  if (typeof value === 'function') return value.toString();
  if (value === undefined) return null;
  return value;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requireText(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
}

export const MODEL_EVALUATION_ROLES = Object.freeze([
  'D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION',
]);

const MODEL_EVALUATION_ROLE_SET = new Set(MODEL_EVALUATION_ROLES);

export function requireModelEvaluationRole(value) {
  const role = requireText(value, 'role', 16).toUpperCase();
  if (!MODEL_EVALUATION_ROLE_SET.has(role)) {
    throw new TypeError(`role must be one of ${MODEL_EVALUATION_ROLES.join(', ')}`);
  }
  return role;
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function evaluationInterval(input = {}, durationMs = 0) {
  const boundedDurationMs = Math.max(0, Math.round(Number(durationMs) || 0));
  const completedValue = input.completedAt || new Date().toISOString();
  const completedMs = Date.parse(completedValue);
  if (!Number.isFinite(completedMs)) throw new TypeError('completedAt must be a valid timestamp');
  const startedValue = input.startedAt
    || new Date(completedMs - boundedDurationMs).toISOString();
  const startedMs = Date.parse(startedValue);
  if (!Number.isFinite(startedMs)) throw new TypeError('startedAt must be a valid timestamp');
  if (startedMs > completedMs) throw new TypeError('startedAt must not follow completedAt');
  const measuredDurationMs = completedMs - startedMs;
  return Object.freeze({
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    durationMs: input.startedAt && input.completedAt
      ? measuredDurationMs
      : (boundedDurationMs || measuredDurationMs),
  });
}

// Loading can fail because another evaluator acquired VRAM between drain and
// placement inspection. Keep that attempt as evidence, but never turn a
// transient resource race into a permanent rejection of the exact artifact.
const RETRYABLE_TERMINAL_CODES = new Set([
  'HUNT_GPU_BUSY',
  'MODEL_EVALUATION_RESPONSE_PROVIDER_MISMATCH',
  'CANDIDATE_MEASURE_FAILED',       // compatibility with prototype.1 rows
  'CANDIDATE_MEASURE_RETRYABLE',
  'CANDIDATE_EVALUATION_RETRYABLE',
]);

export function suiteContract(suite, opts = {}) {
  if (!suite || typeof suite !== 'object') throw new TypeError('suite is required');
  const suiteName = requireText(suite.name, 'suite.name', 128);
  const suiteVersion = requireText(opts.version || suite.version || 'unversioned', 'suite version', 128);
  const repeats = Number.isSafeInteger(opts.repeats) && opts.repeats > 0 ? opts.repeats : 1;
  const tests = [...(suite.tests || [])].map(test => {
    if (!Object.hasOwn(test || {}, 'contractMaterial')
      || test.contractMaterial === null
      || typeof test.contractMaterial !== 'object'
      || Array.isArray(test.contractMaterial)) {
      throw new TypeError(
        `${suiteName}/${test?.name || 'unnamed'} must expose explicit contractMaterial`,
      );
    }
    return {
      name: test.name,
      language: test.language ?? null,
      weight: test.weight ?? 1,
      options: stableValue(Object.fromEntries(Object.entries(DEFAULT_MODEL_EVALUATION_OPTIONS)
        .map(([key, value]) => [key, test.options?.[key] ?? value]))),
      promptAndGradingInputs: stableValue(test.contractMaterial),
      rubric: stableValue(test.rubric || []),
      grade: String(test.grade),
    };
  });
  const material = stableValue({
    suiteName,
    suiteVersion,
    repeats,
    tests,
    extra: opts.extra ?? suite.contractMaterial ?? null,
  });
  return Object.freeze({
    suiteName,
    suiteVersion,
    repeats,
    sha256: sha256(JSON.stringify(material)),
  });
}

export function artifactFromInventory(modelName, inventory = []) {
  const row = (inventory || []).find(item => sameModelName(item?.name, modelName));
  if (!row) return null;
  const digestSha256 = normalizeModelDigestSha256(row.digest);
  const canonicalName = canonicalModelName(row.name);
  if (!digestSha256 || !canonicalName) return null;
  return Object.freeze({
    modelName: String(row.name).trim(),
    canonicalName,
    digestSha256,
    sizeBytes: Number.isFinite(row.size) ? row.size : null,
    details: row.details || null,
  });
}

export async function resolveInstalledArtifact(modelName, opts = {}) {
  const baseUrl = opts.baseUrl || 'http://127.0.0.1:11434';
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(opts.timeout ?? 10_000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status} while resolving model identity`);
  const body = await response.json();
  const artifact = artifactFromInventory(modelName, body.models || []);
  if (!artifact) throw new Error(`Exact installed artifact not found for ${modelName}`);
  return artifact;
}

export class ModelEvaluationHistory {
  constructor(db = null) {
    this._db = null;
    this.providerVersion = 'UNRECORDED';
    if (db) this.setDb(db);
  }

  setDb(db) {
    this._db = db;
    if (db) {
      const exists = db.prepare(`
        SELECT 1 AS ok FROM sqlite_master
        WHERE type = 'table' AND name = 'model_evaluation_runs'
      `).get();
      if (!exists) throw new Error('model_evaluation_runs migration is not applied');
    }
  }

  setProviderVersion(version) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
      throw new TypeError('exact Ollama provider version is required');
    }
    this.providerVersion = version;
  }

  #metadata(input) {
    return {
      ...(input.metadata || {}),
      provider: this.providerVersion === 'UNRECORDED' ? null : {
        name: 'ollama', version: this.providerVersion, proof: 'RESPONSE_BOUND',
      },
    };
  }

  getComplete(input) {
    if (!this._db) return null;
    const digestSha256 = normalizeModelDigestSha256(input?.digestSha256);
    const role = requireModelEvaluationRole(input?.role);
    const suiteName = requireText(input?.suiteName, 'suiteName', 128);
    const suiteVersion = requireText(input?.suiteVersion, 'suiteVersion', 128);
    const contractSha256 = normalizeModelDigestSha256(input?.contractSha256);
    if (!digestSha256 || !contractSha256) return null;
    const row = this._db.prepare(`
      SELECT * FROM model_evaluation_runs
      WHERE model_digest_sha256 = ?
        AND suite_name = ?
        AND suite_version = ?
        AND suite_contract_sha256 = ?
        AND role = ?
        AND status = 'COMPLETE'
        AND COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED') = ?
      LIMIT 1
    `).get(digestSha256, suiteName, suiteVersion, contractSha256, role, this.providerVersion);
    return row ? this.#decode(row) : null;
  }

  hasComplete(input) {
    return this.getComplete(input) !== null;
  }

  getHardwareBlock(input) {
    if (!this._db) return null;
    const digestSha256 = normalizeModelDigestSha256(input?.digestSha256);
    const wanted = input?.hardware || null;
    const wantedNumCtx = Number(wanted?.numCtx);
    if (!digestSha256 || !wanted || !Number.isSafeInteger(wantedNumCtx) || wantedNumCtx <= 0) return null;
    const rows = this._db.prepare(`
      SELECT * FROM model_evaluation_runs
      WHERE model_digest_sha256 = ?
        AND status = 'BLOCKED'
        AND error_code = 'CANDIDATE_VRAM_FIT_FAILED'
        AND COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED') = ?
      ORDER BY completed_at DESC, run_id DESC
    `).all(digestSha256, this.providerVersion);
    for (const row of rows) {
      const decoded = this.#decode(row);
      const observed = decoded.hardware || null;
      const observedNumCtx = Number(decoded.metadata?.numCtx ?? observed?.numCtx);
      if (observed
        && String(wanted.model || '') === String(observed.model || '')
        && Number(wanted.vramMb || 0) === Number(observed.vramMb || 0)
        && Number.isSafeInteger(observedNumCtx)
        && observedNumCtx > 0
        && observedNumCtx === wantedNumCtx) return decoded;
    }
    return null;
  }

  getTerminal(input) {
    if (!this._db) return null;
    const digestSha256 = normalizeModelDigestSha256(input?.digestSha256);
    const role = requireModelEvaluationRole(input?.role);
    const suiteName = requireText(input?.suiteName, 'suiteName', 128);
    const suiteVersion = requireText(input?.suiteVersion, 'suiteVersion', 128);
    const contractSha256 = normalizeModelDigestSha256(input?.contractSha256);
    // A name-only failure is retained as evidence, but cannot safely suppress a
    // later test: a mutable Ollama tag may then point at a different artifact.
    if (!digestSha256 || !contractSha256) return null;
    const rows = this._db.prepare(`
      SELECT * FROM model_evaluation_runs
      WHERE model_digest_sha256 = ?
        AND suite_name = ?
        AND suite_version = ?
        AND suite_contract_sha256 = ?
        AND role = ?
        AND status IN ('FAILED', 'BLOCKED')
        AND COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED') = ?
      ORDER BY completed_at DESC, run_id DESC
    `).all(digestSha256, suiteName, suiteVersion, contractSha256, role, this.providerVersion);
    for (const row of rows) {
      const decoded = this.#decode(row);
      if (RETRYABLE_TERMINAL_CODES.has(decoded.errorCode)) continue;
      // FAILED means the exact artifact failed the suite/capability contract
      // independently of GPU. BLOCKED is reusable only on the same detected
      // hardware; a larger future GPU must get a fair chance.
      if (decoded.status === 'FAILED') return decoded;
      const wanted = input?.hardware || null;
      const observed = decoded.hardware || null;
      if (wanted && observed
        && String(wanted.model || '') === String(observed.model || '')
        && Number(wanted.vramMb || 0) === Number(observed.vramMb || 0)) return decoded;
    }
    return null;
  }

  recordComplete(input) {
    const artifact = input?.artifact || {};
    const digestSha256 = normalizeModelDigestSha256(artifact.digestSha256);
    const canonicalName = canonicalModelName(artifact.canonicalName || artifact.modelName);
    const modelName = requireText(artifact.modelName, 'artifact.modelName');
    const suiteName = requireText(input?.suiteName, 'suiteName', 128);
    const suiteVersion = requireText(input?.suiteVersion, 'suiteVersion', 128);
    const contractSha256 = normalizeModelDigestSha256(input?.contractSha256);
    const role = requireModelEvaluationRole(input?.role);
    if (!digestSha256 || !canonicalName || !contractSha256) {
      throw new TypeError('complete evaluation requires exact model and suite SHA-256 identities');
    }

    const existing = this.getComplete({
      digestSha256, role, suiteName, suiteVersion, contractSha256,
    });
    if (existing) return Object.freeze({ ...existing, reused: true });

    const summary = input.summary || {};
    const score = Number(summary.score);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new TypeError('complete evaluation score must be between 0 and 1');
    }
    const tasks = Array.isArray(summary.tasks) ? summary.tasks : [];
    const interval = evaluationInterval(
      input,
      input.durationMs ?? summary.durationMs ?? 0,
    );
    const runId = input.runId || `eval_${randomUUID()}`;

    try {
      this._db.prepare(`
        INSERT INTO model_evaluation_runs (
          run_id, model_name, model_canonical_name, model_digest_sha256,
          suite_name, suite_version, suite_contract_sha256, role, status,
          score, passed, total, repeats, duration_ms, tokens_per_second,
          vram_bytes, task_results_json, hardware_json, metadata_json,
          started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        modelName,
        canonicalName,
        digestSha256,
        suiteName,
        suiteVersion,
        contractSha256,
        role,
        score,
        tasks.filter(task => Number(task.mean) >= 0.6).length,
        tasks.length,
        Number.isSafeInteger(summary.runs) && summary.runs > 0 ? summary.runs : 1,
        interval.durationMs,
        Number.isFinite(input.tokensPerSecond) ? input.tokensPerSecond : null,
        Number.isSafeInteger(input.vramBytes) && input.vramBytes >= 0 ? input.vramBytes : null,
        json(tasks, []),
        json(input.hardware, {}),
        json(this.#metadata(input), {}),
        interval.startedAt,
        interval.completedAt,
      );
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const raced = this.getComplete({
          digestSha256, role, suiteName, suiteVersion, contractSha256,
        });
        if (raced) return Object.freeze({ ...raced, reused: true });
      }
      throw error;
    }
    return this.getComplete({
      digestSha256, role, suiteName, suiteVersion, contractSha256,
    });
  }

  recordTerminal(input) {
    const status = input?.status;
    if (status !== 'FAILED' && status !== 'BLOCKED') {
      throw new TypeError('terminal history status must be FAILED or BLOCKED');
    }
    const artifact = input?.artifact || {};
    const modelName = requireText(artifact.modelName || input.modelName, 'modelName');
    const canonicalName = canonicalModelName(artifact.canonicalName || modelName);
    const digestSha256 = normalizeModelDigestSha256(artifact.digestSha256);
    const suiteName = requireText(input?.suiteName, 'suiteName', 128);
    const suiteVersion = requireText(input?.suiteVersion, 'suiteVersion', 128);
    const contractSha256 = normalizeModelDigestSha256(input?.contractSha256);
    const role = requireModelEvaluationRole(input?.role);
    if (!canonicalName || !contractSha256) throw new TypeError('invalid terminal evaluation identity');
    const interval = evaluationInterval(input, input.durationMs ?? 0);
    const runId = input.runId || `eval_${randomUUID()}`;
    this._db.prepare(`
      INSERT INTO model_evaluation_runs (
        run_id, model_name, model_canonical_name, model_digest_sha256,
        suite_name, suite_version, suite_contract_sha256, role, status,
        repeats, duration_ms, task_results_json, hardware_json, metadata_json,
        error_code, error_message, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId, modelName, canonicalName, digestSha256,
      suiteName, suiteVersion, contractSha256, role, status,
      Number.isSafeInteger(input.repeats) && input.repeats > 0 ? input.repeats : 1,
      interval.durationMs,
      json(input.tasks, []), json(input.hardware, {}),
      json({ ...this.#metadata(input), provider: this.providerVersion === 'UNRECORDED' ? null
        : { name: 'ollama', version: this.providerVersion, proof: 'RUN_PREFLIGHT' } }, {}),
      input.errorCode || null, input.errorMessage || null,
      interval.startedAt, interval.completedAt,
    );
    return this.#decode(
      this._db.prepare('SELECT * FROM model_evaluation_runs WHERE run_id = ?').get(runId),
    );
  }

  listForModel(modelName) {
    if (!this._db) return [];
    const canonicalName = canonicalModelName(modelName);
    if (!canonicalName) return [];
    return this._db.prepare(`
      SELECT * FROM model_evaluation_runs
      WHERE model_canonical_name = ?
      ORDER BY completed_at, run_id
    `).all(canonicalName).map(row => this.#decode(row));
  }

  count() {
    if (!this._db) return 0;
    return this._db.prepare('SELECT COUNT(*) AS count FROM model_evaluation_runs').get().count;
  }

  #decode(row) {
    return Object.freeze({
      runId: row.run_id,
      artifact: Object.freeze({
        modelName: row.model_name,
        canonicalName: row.model_canonical_name,
        digestSha256: row.model_digest_sha256,
      }),
      suiteName: row.suite_name,
      suiteVersion: row.suite_version,
      contractSha256: row.suite_contract_sha256,
      role: row.role,
      status: row.status,
      score: row.score == null ? null : Number(row.score),
      passed: Number(row.passed),
      total: Number(row.total),
      repeats: Number(row.repeats),
      durationMs: Number(row.duration_ms),
      tokensPerSecond: row.tokens_per_second == null ? null : Number(row.tokens_per_second),
      vramBytes: row.vram_bytes == null ? null : Number(row.vram_bytes),
      tasks: parseJson(row.task_results_json, []),
      hardware: parseJson(row.hardware_json, {}),
      metadata: parseJson(row.metadata_json, {}),
      providerVersion: parseJson(row.metadata_json, {})?.provider?.version || null,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    });
  }
}

export const modelEvaluationHistory = new ModelEvaluationHistory();

export default {
  ModelEvaluationHistory,
  modelEvaluationHistory,
  suiteContract,
  artifactFromInventory,
  resolveInstalledArtifact,
  MODEL_EVALUATION_ROLES,
  requireModelEvaluationRole,
};

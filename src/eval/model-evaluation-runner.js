// Generic direct-Ollama runner for versioned model-evaluation suites.
//
// This module deliberately has no DB persistence and no global suite registry.
// The caller supplies an exact, versioned suite through an evaluation plan and
// persists the resulting immutable summary through ModelEvaluationHistory.

import { config } from '../config.js';
import {
  normalizeModelDigestSha256,
  sameModelName,
} from '../upgrade/model-identity.js';

export const DEFAULT_MODEL_EVALUATION_OPTIONS = Object.freeze({
  timeout: 30_000,
  num_predict: 512,
  num_ctx: 4096,
  temperature: 0.1,
  top_p: 0.9,
});

function promptData(promptResult) {
  if (promptResult && typeof promptResult === 'object') return promptResult;
  return { text: String(promptResult ?? '') };
}

export const MODEL_EVALUATION_ARTIFACT_ERROR = Object.freeze({
  EXPECTATION_INVALID: 'MODEL_EVALUATION_ARTIFACT_EXPECTATION_INVALID',
  RESPONSE_UNVERIFIED: 'MODEL_EVALUATION_RESPONSE_ARTIFACT_UNVERIFIED',
  RESPONSE_DRIFT: 'MODEL_EVALUATION_RESPONSE_ARTIFACT_DRIFT',
  RESPONSE_MODEL_MISMATCH: 'MODEL_EVALUATION_RESPONSE_MODEL_MISMATCH',
});

export class ModelEvaluationArtifactError extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ModelEvaluationArtifactError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function expectedArtifactIdentity(modelName, artifact) {
  if (artifact == null) return null;
  const digestSha256 = normalizeModelDigestSha256(artifact.digestSha256);
  if (!digestSha256 || !sameModelName(artifact.modelName, modelName)) {
    throw new ModelEvaluationArtifactError(
      MODEL_EVALUATION_ARTIFACT_ERROR.EXPECTATION_INVALID,
      'Authoritative evaluation requires an exact artifact matching the requested model.',
      { modelName },
    );
  }
  return Object.freeze({ modelName: artifact.modelName.trim(), digestSha256 });
}

export class ModelEvaluationRunner {
  constructor(ollamaBaseUrl, opts = {}) {
    this._baseUrl = ollamaBaseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    this._suites = Object.freeze({ ...(opts.suites || {}) });
    this._cancelled = false;
  }

  cancel() { this._cancelled = true; }

  async _callModel(modelName, messages, options = {}, expectedArtifact = null) {
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? DEFAULT_MODEL_EVALUATION_OPTIONS.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(`${this._baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
          think: false,
          options: {
            temperature: options.temperature ?? DEFAULT_MODEL_EVALUATION_OPTIONS.temperature,
            top_p: options.top_p ?? DEFAULT_MODEL_EVALUATION_OPTIONS.top_p,
            num_predict: options.num_predict ?? DEFAULT_MODEL_EVALUATION_OPTIONS.num_predict,
            num_ctx: options.num_ctx ?? DEFAULT_MODEL_EVALUATION_OPTIONS.num_ctx,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const data = await response.json();
      const expected = expectedArtifactIdentity(modelName, expectedArtifact);
      if (expected) {
        if (!sameModelName(data.model, expected.modelName)) {
          throw new ModelEvaluationArtifactError(
            MODEL_EVALUATION_ARTIFACT_ERROR.RESPONSE_MODEL_MISMATCH,
            'The evaluation response does not identify the requested model.',
            { expectedModelName: expected.modelName, observedModelName: data.model || null },
          );
        }
        const observedDigestSha256 = normalizeModelDigestSha256(
          data.digest || data.model_digest_sha256,
        );
        if (!observedDigestSha256) {
          throw new ModelEvaluationArtifactError(
            MODEL_EVALUATION_ARTIFACT_ERROR.RESPONSE_UNVERIFIED,
            'The evaluation response did not attest the served artifact digest.',
            { modelName: expected.modelName, expectedDigestSha256: expected.digestSha256 },
          );
        }
        if (observedDigestSha256 !== expected.digestSha256) {
          throw new ModelEvaluationArtifactError(
            MODEL_EVALUATION_ARTIFACT_ERROR.RESPONSE_DRIFT,
            'The evaluation response came from a different model artifact.',
            {
              modelName: expected.modelName,
              expectedDigestSha256: expected.digestSha256,
              observedDigestSha256,
            },
          );
        }
      }
      return {
        content: data.message?.content || data.response || '',
        evalCount: data.eval_count || 0,
        promptEvalCount: data.prompt_eval_count || 0,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof ModelEvaluationArtifactError) throw err;
      return {
        content: '',
        evalCount: 0,
        promptEvalCount: 0,
        durationMs: Date.now() - started,
        error: err.message,
        timedOut: err.name === 'AbortError',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async _runTest(testDef, modelName, expectedArtifact = null) {
    const data = promptData(testDef.prompt());
    const messages = data.messages || [{ role: 'user', content: data.text || '' }];
    if (data.images?.length) {
      const last = messages.length - 1;
      messages[last] = { ...messages[last], images: data.images };
    }
    const result = await this._callModel(
      modelName,
      messages,
      testDef.options || data.options || {},
      expectedArtifact,
    );
    if (result.error) {
      return {
        name: testDef.name,
        language: testDef.language || null,
        passed: false,
        score: 0,
        response: '',
        durationMs: result.durationMs,
        evalTokens: 0,
        error: result.error,
        timedOut: !!result.timedOut,
        rubric: testDef.rubric || [],
      };
    }
    const graded = await testDef.grade(result.content, data);
    return {
      name: testDef.name,
      language: testDef.language || null,
      passed: !!graded.passed,
      score: Math.max(0, Math.min(1, Number(graded.score) || 0)),
      response: result.content.substring(0, 2000),
      durationMs: result.durationMs,
      evalTokens: result.evalCount,
      detail: graded.detail || null,
      rubric: testDef.rubric || [],
    };
  }

  async runSuite(suiteName, modelName, onProgress, expectedArtifact = null) {
    const suite = this._suites[suiteName];
    if (!suite) throw new Error(`Unknown evaluation suite: ${suiteName}`);
    this._cancelled = false;
    const started = Date.now();
    const definitions = suite.tests;
    const tests = [];

    for (let i = 0; i < definitions.length; i++) {
      if (this._cancelled) break;
      const definition = definitions[i];
      onProgress?.({
        suite: suiteName,
        testName: definition.name,
        status: 'running',
        currentTest: i + 1,
        totalTests: definitions.length,
        percent: Math.round((i / definitions.length) * 100),
      });
      tests.push(await this._runTest(definition, modelName, expectedArtifact));
    }

    const score = tests.reduce((sum, row) => sum + row.score, 0) / (tests.length || 1);
    const passed = tests.filter(row => row.passed).length;
    onProgress?.({
      suite: suiteName,
      testName: null,
      status: this._cancelled ? 'cancelled' : 'complete',
      currentTest: tests.length,
      totalTests: definitions.length,
      percent: this._cancelled ? Math.round((tests.length / (definitions.length || 1)) * 100) : 100,
      score,
    });
    return {
      suite: suiteName,
      model: modelName,
      score,
      passed,
      total: definitions.length,
      tests,
      cancelled: this._cancelled,
      durationMs: Date.now() - started,
    };
  }
}

export default ModelEvaluationRunner;

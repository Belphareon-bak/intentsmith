// CRE v45.0 LLM Bridge
// ══════════════════════════════════════════════════════════════════════════════
//
// Authorized LLM interface for server endpoints.
// All calls go through LLMGateway with proper auth tokens.
//
// This replaces legacy direct callOllama() calls.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  LLMGatewayError,
  LLMGatewayErrorCode,
  callWithAuth,
  callWithPolicy,
  llmGateway,
} from './gateway.js';
import {
  LLMCallerRole,
  LLMCapability,
  RoleTokenLimits,
  createAuthToken,
  validateAuthToken,
} from './auth-types.js';
import { logger } from '../core/logger.js';
import { config } from '../config.js';
import {
  AbortSource,
  abortSourceOf,
  isAbortError,
} from '../core/abort-error.js';
import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_VERSION,
  M1_MODEL_PURPOSE,
  validateModelRequest,
  validateModelResult,
} from '../../contracts/m1/index.js';
import { isPlainRecord } from '../../contracts/m1/shared.js';

// Session counter for unique IDs
let sessionCounter = 0;

/**
 * Generate unique session ID
 */
function generateSessionId() {
  return `srv-${Date.now()}-${++sessionCounter}`;
}

/**
 * Generate unique decision ID
 */
function generateDecisionId(prefix = 'dec') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const M1_TEXT_MODEL_ROLES = new Set(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT']);
const M1_MODEL_PURPOSES = new Set(Object.values(M1_MODEL_PURPOSE));
const M1_CALLER_PURPOSE_CAPABILITY = Object.freeze({
  [LLMCallerRole.CRE_DECISION]: Object.freeze({
    [M1_MODEL_PURPOSE.CLASSIFY]: LLMCapability.CLASSIFICATION,
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.CRE_PLANNING]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.SYNTHESIZER]: Object.freeze({
    [M1_MODEL_PURPOSE.SYNTHESIZE]: LLMCapability.SUMMARIZATION,
  }),
  [LLMCallerRole.REFLECTOR]: Object.freeze({
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.WORKFLOW_CLASSIFIER]: Object.freeze({
    [M1_MODEL_PURPOSE.CLASSIFY]: LLMCapability.CLASSIFICATION,
  }),
  [LLMCallerRole.WORKFLOW_THINKER]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.WORKFLOW_ANALYZER]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.WORKFLOW_PLANNER]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.WORKFLOW_CODER]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.CODE_GENERATION,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.CODE_GENERATION,
  }),
  [LLMCallerRole.WORKFLOW_REVIEWER]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.CODE_REVIEW,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.CODE_REVIEW,
  }),
  [LLMCallerRole.SKILL_EXECUTOR]: Object.freeze({
    [M1_MODEL_PURPOSE.ANSWER]: LLMCapability.REASONING,
    [M1_MODEL_PURPOSE.REFINE]: LLMCapability.REASONING,
  }),
  [LLMCallerRole.SKILL_RESOLVER]: Object.freeze({
    [M1_MODEL_PURPOSE.CLASSIFY]: LLMCapability.CLASSIFICATION,
  }),
});
const M1_PARAMETER_KEYS = new Set([
  'temperature',
  'top_p',
  'repeat_penalty',
  'maxTokens',
  'num_ctx',
  'timeout',
  'format',
]);
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;

function m1AdapterError(code, message, validationErrors = []) {
  const error = new Error(message);
  error.code = code;
  error.validationErrors = Object.freeze([...validationErrors]);
  return error;
}

function isRuntimeAbortSignal(value) {
  if (value === null) return true;
  try {
    return (
      typeof abortSignalAbortedGetter === 'function'
      && typeof abortSignalAbortedGetter.call(value) === 'boolean'
    );
  } catch {
    return false;
  }
}

function snapshotM1Request(request) {
  let snapshot;
  try {
    snapshot = structuredClone(request);
  } catch {
    throw m1AdapterError(
      'M1_MODEL_REQUEST_INVALID',
      'Invalid M1 ModelRequest.',
      ['model-request:uncloneable'],
    );
  }
  const validation = validateModelRequest(snapshot);
  if (!validation.valid) {
    throw m1AdapterError(
      'M1_MODEL_REQUEST_INVALID',
      'Invalid M1 ModelRequest.',
      validation.errors,
    );
  }
  const freezeJson = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freezeJson(child);
      Object.freeze(value);
    }
    return value;
  };
  return freezeJson(snapshot);
}

function finiteRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function integerRange(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function normalizeM1Parameters(parameters) {
  if (parameters === undefined) return Object.freeze({});
  if (!isPlainRecord(parameters)) {
    throw m1AdapterError(
      'MODEL_PARAMETERS_INVALID',
      'Model parameters must be a plain record.',
    );
  }
  const unknown = Object.keys(parameters).filter(key => !M1_PARAMETER_KEYS.has(key));
  if (unknown.length > 0) {
    throw m1AdapterError(
      'MODEL_PARAMETERS_INVALID',
      'Model parameters contain unsupported keys.',
      unknown.map(key => `unsupported:${key}`),
    );
  }

  const normalized = {};
  if (Object.hasOwn(parameters, 'temperature')) {
    if (!finiteRange(parameters.temperature, 0, 2)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model temperature is invalid.');
    }
    normalized.temperature = parameters.temperature;
  }
  if (Object.hasOwn(parameters, 'top_p')) {
    if (!finiteRange(parameters.top_p, 0, 1)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model top_p is invalid.');
    }
    normalized.top_p = parameters.top_p;
  }
  if (Object.hasOwn(parameters, 'repeat_penalty')) {
    if (!finiteRange(parameters.repeat_penalty, 0.01, 4)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model repeat penalty is invalid.');
    }
    normalized.repeat_penalty = parameters.repeat_penalty;
  }
  if (Object.hasOwn(parameters, 'maxTokens')) {
    if (!integerRange(parameters.maxTokens, 1, 65536)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model token limit is invalid.');
    }
    normalized.maxTokens = parameters.maxTokens;
  }
  if (Object.hasOwn(parameters, 'num_ctx')) {
    if (!integerRange(parameters.num_ctx, 512, 262144)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model context size is invalid.');
    }
    normalized.num_ctx = parameters.num_ctx;
  }
  if (Object.hasOwn(parameters, 'timeout')) {
    if (!integerRange(parameters.timeout, 1, 900000)) {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model timeout is invalid.');
    }
    normalized.timeout = parameters.timeout;
  }
  if (Object.hasOwn(parameters, 'format')) {
    if (parameters.format !== 'json') {
      throw m1AdapterError('MODEL_PARAMETERS_INVALID', 'Model format is invalid.');
    }
    normalized.format = 'json';
  }
  return Object.freeze(normalized);
}

function m1ModelIdentity(request) {
  return {
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
  };
}

function isKnownM1CallerRole(role) {
  return (
    typeof role === 'string'
    && Object.hasOwn(LLMCallerRole, role)
    && LLMCallerRole[role] === role
  );
}

function capabilityForM1Request(request) {
  const purposes = M1_CALLER_PURPOSE_CAPABILITY[request.callerRole];
  return purposes?.[request.purpose] ?? null;
}

function recordM1ModelResult(request, result, authorizedCallerRole = null) {
  llmGateway.audit.log('M1_MODEL_RESULT', {
    ...m1ModelIdentity(request),
    callerRole: isKnownM1CallerRole(authorizedCallerRole)
      ? authorizedCallerRole
      : null,
    modelRole: M1_TEXT_MODEL_ROLES.has(request.modelRole)
      ? request.modelRole
      : null,
    purpose: M1_MODEL_PURPOSES.has(request.purpose)
      ? request.purpose
      : null,
    status: result.status,
    errorCode: result.error?.code ?? null,
  });
  return result;
}

export function createM1ModelResult(request, terminal) {
  const result = {
    contract: M1_CONTRACT_KIND.MODEL_RESULT,
    version: M1_CONTRACT_VERSION,
    ...m1ModelIdentity(request),
    ...terminal,
  };
  const validation = validateModelResult(result);
  if (!validation.valid) {
    throw m1AdapterError(
      'M1_MODEL_RESULT_INVALID',
      'M1 model result violated the connector contract.',
      validation.errors,
    );
  }
  return result;
}

export function mapM1ModelFailure(request, error, signal = null) {
  const abortResult = () => {
    const source = abortSourceOf(error, signal);
    if (source === AbortSource.TIMEOUT) {
      return createM1ModelResult(request, {
        status: 'timeout',
        error: {
          code: 'MODEL_TIMEOUT',
          message: 'Model request timed out.',
        },
      });
    }
    return createM1ModelResult(request, {
      status: 'cancelled',
      error: {
        code: 'MODEL_CANCELLED',
        message: 'Model request was cancelled.',
      },
    });
  };
  if (isAbortError(error)) {
    return abortResult();
  }
  if (
    error instanceof LLMGatewayError
    && error.code === LLMGatewayErrorCode.QUEUE_TIMEOUT
  ) {
    return createM1ModelResult(request, {
      status: 'timeout',
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }
  if (error instanceof LLMGatewayError) {
    return createM1ModelResult(request, {
      status: 'error',
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }
  if (error?.code === 'MODEL_PARAMETERS_INVALID') {
    return createM1ModelResult(request, {
      status: 'error',
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }
  if (signal?.aborted) {
    return abortResult();
  }
  return createM1ModelResult(request, {
    status: 'error',
    error: {
      code: 'MODEL_PROCESSING_FAILED',
      message: 'Model request failed.',
    },
  });
}

function validateM1Authority(request, authToken) {
  const validation = validateAuthToken(authToken);
  if (!validation.valid) {
    return {
      code: 'MODEL_AUTHORIZATION_REQUIRED',
      message: 'Model request requires issued process-local authorization.',
    };
  }
  if (
    authToken.role !== request.callerRole
    || authToken.decisionId !== request.requestId
    || authToken.auditContext.sessionId !== request.conversationId
    || authToken.auditContext.stepId !== request.turnId
  ) {
    return {
      code: 'MODEL_AUTHORIZATION_MISMATCH',
      message: 'Model authorization does not match the request identity.',
    };
  }
  if (authToken.maxTokens > RoleTokenLimits[authToken.role]) {
    return {
      code: 'MODEL_AUTHORIZATION_INVALID',
      message: 'Model authorization exceeds the caller role token limit.',
    };
  }
  return null;
}

/**
 * Execute one validated ModelRequest through the v1 policy boundary.
 * Transport cancellation is supplied separately and never enters the public
 * connector payload.
 */
export async function executeM1ModelRequest(request, runtime = {}) {
  if (!isPlainRecord(runtime)) {
    throw m1AdapterError(
      'M1_MODEL_RUNTIME_INVALID',
      'M1 model runtime options must be a plain record.',
    );
  }
  const runtimeSnapshot = { ...runtime };
  const runtimeKeys = Object.keys(runtimeSnapshot);
  if (runtimeKeys.some(key => !['authToken', 'signal'].includes(key))) {
    throw m1AdapterError(
      'M1_MODEL_RUNTIME_INVALID',
      'M1 model runtime options contain unsupported keys.',
    );
  }
  const { authToken = null, signal = null } = runtimeSnapshot;
  if (!isRuntimeAbortSignal(signal)) {
    throw m1AdapterError(
      'M1_MODEL_RUNTIME_INVALID',
      'M1 model runtime signal must be an AbortSignal.',
    );
  }
  const modelRequest = snapshotM1Request(request);

  if (!isKnownM1CallerRole(modelRequest.callerRole)) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_CALLER_ROLE_INVALID',
        message: 'Model caller role is invalid.',
      },
    }));
  }
  if (modelRequest.callerRole === LLMCallerRole.LEGACY_DIRECT) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_CALLER_ROLE_UNSUPPORTED',
        message: 'Legacy direct model access is not supported by connector v1.',
      },
    }));
  }
  const presentedTokenValidation = validateAuthToken(authToken);
  const presentedCallerRole = presentedTokenValidation.valid
    ? authToken.role
    : null;
  const authorityError = validateM1Authority(modelRequest, authToken);
  if (authorityError) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: authorityError,
    }), presentedCallerRole);
  }
  const authorizedCallerRole = authToken.role;
  const capability = capabilityForM1Request(modelRequest);
  if (capability === null) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_PURPOSE_NOT_AUTHORIZED',
        message: 'Model purpose is not authorized for the caller role.',
      },
    }), authorizedCallerRole);
  }
  if (modelRequest.modelRole === 'VISION') {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_ROLE_UNSUPPORTED',
        message: 'Vision requests require a separate image connector.',
      },
    }), authorizedCallerRole);
  }
  if (!M1_TEXT_MODEL_ROLES.has(modelRequest.modelRole)) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_ROLE_INVALID',
        message: 'Model role is invalid.',
      },
    }), authorizedCallerRole);
  }

  const model = config.models?.[modelRequest.modelRole];
  if (typeof model !== 'string' || model.trim().length === 0) {
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'error',
      error: {
        code: 'MODEL_ROLE_UNBOUND',
        message: 'Model role has no configured binding.',
      },
    }), authorizedCallerRole);
  }

  let parameters;
  try {
    parameters = normalizeM1Parameters(modelRequest.parameters);
  } catch (error) {
    return recordM1ModelResult(
      modelRequest,
      mapM1ModelFailure(modelRequest, error, signal),
      authorizedCallerRole,
    );
  }

  try {
    const result = await callWithPolicy(authToken, modelRequest.prompt, {
      ...parameters,
      systemPrompt: modelRequest.systemPrompt ?? '',
      model,
      capability,
      requestType: `m1:${modelRequest.purpose}`,
      signal,
      correlation: {
        ...m1ModelIdentity(modelRequest),
        callerRole: modelRequest.callerRole,
        modelRole: modelRequest.modelRole,
        purpose: modelRequest.purpose,
      },
    });
    const usage = {};
    if (Number.isFinite(result.promptEvalCount)) {
      usage.promptEvalCount = result.promptEvalCount;
    }
    if (Number.isFinite(result.evalCount)) {
      usage.evalCount = result.evalCount;
    }
    return recordM1ModelResult(modelRequest, createM1ModelResult(modelRequest, {
      status: 'ok',
      response: {
        content: result.content,
        model: result.model,
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
      },
    }), authorizedCallerRole);
  } catch (error) {
    return recordM1ModelResult(
      modelRequest,
      mapM1ModelFailure(modelRequest, error, signal),
      authorizedCallerRole,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CRE BRIDGE - Authorized LLM calls for server endpoints
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call LLM for intent classification
 * Used by artifact pipeline and routing logic
 *
 * @param {string} prompt - Classification prompt
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, duration: number}>}
 */
export async function classifyIntent(prompt, systemPrompt = '', options = {}) {
  const token = createAuthToken({
    role: 'WORKFLOW_CLASSIFIER',
    decisionId: generateDecisionId('classify'),
    auditContext: {
      sessionId: options.sessionId || generateSessionId(),
      goalId: options.goalId || null
    },
    capabilities: [LLMCapability.CLASSIFICATION, LLMCapability.JSON_OUTPUT]
  });

  return await callWithAuth(token, prompt, {
    systemPrompt,
    model: config.models?.FAST || config.models?.CHAT,
    temperature: 0.1,
    format: options.format || 'json',
    // One attempt. Classification has an immediate regex fallback, so retrying
    // a refused connection only delays it -- measured at ~6 s for three
    // attempts. A slow model is unaffected: timeouts are never retried.
    retries: 1,
    ...options
  });
}

/**
 * Call LLM for chat response generation
 * Used by simple chat endpoints
 *
 * @param {string} prompt - User prompt with context
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, duration: number}>}
 */
export async function generateChatResponse(prompt, systemPrompt = '', options = {}) {
  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: generateDecisionId('chat'),
    auditContext: {
      sessionId: options.sessionId || generateSessionId(),
      goalId: options.goalId || null
    },
    maxTokens: options.maxTokens || 4096
  });

  return await callWithAuth(token, prompt, {
    systemPrompt,
    model: options.model || config.models?.CHAT,
    temperature: options.temperature ?? 0.5,
    top_p: options.top_p ?? 0.75,
    repeat_penalty: options.repeat_penalty ?? 1.1,
    ...options
  });
}

/**
 * Call LLM for artifact generation
 * Used by artifact pipeline for content creation
 *
 * @param {string} prompt - Generation prompt
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, duration: number}>}
 */
export async function generateArtifact(prompt, systemPrompt = '', options = {}) {
  const sessionId = options.sessionId || generateSessionId();
  const decisionId = generateDecisionId('artifact');

  logger.debug('CREBridge', `generateArtifact called`, {
    decisionId,
    sessionId,
    promptLength: prompt?.length,
    hasSystemPrompt: !!systemPrompt
  });

  const token = createAuthToken({
    role: 'WORKFLOW_CODER',
    decisionId,
    auditContext: {
      sessionId,
      goalId: options.goalId || null
    },
    maxTokens: options.maxTokens || 8000,
    capabilities: [LLMCapability.CODE_GENERATION, LLMCapability.JSON_OUTPUT]
  });

  logger.debug('CREBridge', `Token created`, {
    decisionId,
    role: token.role,
    expiresIn: token.expiresAt - Date.now()
  });

  try {
    const result = await callWithAuth(token, prompt, {
      systemPrompt,
      model: options.model || config.models?.CHAT,
      temperature: options.temperature ?? 0.3,
      ...options
    });

    logger.debug('CREBridge', `generateArtifact success`, {
      decisionId,
      contentLength: result?.content?.length
    });

    return result;
  } catch (err) {
    logger.error('CREBridge', `generateArtifact failed`, {
      decisionId,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' <- ')
    });
    throw err;
  }
}

/**
 * Call vision model with images
 * Note: Vision uses different endpoint, needs special handling
 *
 * @param {string} prompt - Text prompt
 * @param {string[]} images - Base64 encoded images
 * @param {string} systemPrompt - System prompt
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, duration: number}>}
 */
export async function analyzeImages(prompt, images, systemPrompt = '', options = {}) {
  // Vision calls require direct Ollama access (different API endpoint)
  // Create auth token for audit trail even though vision bypasses chat API
  const token = createAuthToken({
    role: 'TOOL_INTERNAL',
    decisionId: generateDecisionId('vision'),
    auditContext: {
      sessionId: options.sessionId || generateSessionId(),
      goalId: options.goalId || null
    },
    maxTokens: 2048,
    capabilities: [LLMCapability.EXTRACTION]
  });

  logger.info('CREBridge', `Vision call authorized`, {
    decisionId: token.decisionId,
    imageCount: images.length
  });

  // Vision uses /api/generate endpoint (not /api/chat)
  const model = config.models?.VISION || 'llava:13b';
  const timeout = config.timeouts?.VISION || 60000;
  const startTime = Date.now();

  const body = {
    model,
    prompt,
    system: systemPrompt,
    images,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 2048,
      num_ctx: 4096,
    },
  };

  const maxRetries = config.ollama?.retries || 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${config.ollama?.baseUrl || 'http://127.0.0.1:11434'}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes('not found') || errorText.includes('does not exist')) {
          throw new Error(`Vision model "${model}" not installed. Run: ollama pull ${model}`);
        }
        throw new Error(`Ollama HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      return {
        content: data.response || '',
        model,
        duration,
        role: 'VISION',
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, (config.ollama?.retryDelay || 1000) * attempt));
      }
    }
  }

  throw new Error(`Vision failed: ${lastError?.message}`);
}

/**
 * Create an LLM call function compatible with artifact pipeline
 * This returns a function that wraps generateArtifact
 *
 * @param {Object} options - Session options
 * @returns {Function} LLM call function
 */
export function createPipelineLLM(options = {}) {
  const sessionId = options.sessionId || generateSessionId();

  return async (prompt, systemPrompt, llmOptions = {}) => {
    return await generateArtifact(prompt, systemPrompt, {
      ...llmOptions,
      sessionId
    });
  };
}

/**
 * Create an LLM call function for intent classification
 *
 * @param {Object} options - Session options
 * @returns {Function} LLM call function
 */
export function createClassifierLLM(options = {}) {
  const sessionId = options.sessionId || generateSessionId();

  return async (prompt, systemPrompt, llmOptions = {}) => {
    return await classifyIntent(prompt, systemPrompt, {
      ...llmOptions,
      sessionId
    });
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  createM1ModelResult,
  mapM1ModelFailure,
  executeM1ModelRequest,
  classifyIntent,
  generateChatResponse,
  generateArtifact,
  analyzeImages,
  createPipelineLLM,
  createClassifierLLM
};

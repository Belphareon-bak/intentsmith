// CRE v45.0 LLM Bridge
// ══════════════════════════════════════════════════════════════════════════════
//
// Authorized LLM interface for server endpoints.
// All calls go through LLMGateway with proper auth tokens.
//
// This replaces legacy direct callOllama() calls.
//
// ══════════════════════════════════════════════════════════════════════════════

import { llmGateway, callWithAuth } from './gateway.js';
import { createAuthToken, LLMCallerRole, LLMCapability } from './auth-types.js';
import { logger } from '../core/logger.js';
import { config } from '../config.js';

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
  classifyIntent,
  generateChatResponse,
  generateArtifact,
  analyzeImages,
  createPipelineLLM,
  createClassifierLLM
};

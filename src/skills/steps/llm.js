// LLM Step — calls LLM with substituted prompt
// ══════════════════════════════════════════════════════════════════════════════
//
// Sends a prompt (with substitutions) to LLM via callWithAuth.
// Returns LLM response content as output.
//
// On LLM failure: { retryable: true, errorType: 'transient' }
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { callWithAuth } from '../../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../../llm/auth-types.js';
import { config } from '../../config.js';
import { substitute } from './substitute.js';

/**
 * Execute an LLM step.
 *
 * @param {Object} stepDef - Step definition from skill JSON
 * @param {Object} context - { executionId, params, stepsOutput }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeLLM(stepDef, context) {
  try {
    const prompt = stepDef.prompt;
    if (!prompt) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `LLM step "${stepDef.id}": missing "prompt" field`,
      };
    }

    const resolvedPrompt = substitute(prompt, context.params, context.stepsOutput);
    const resolvedSystem = stepDef.systemPrompt
      ? substitute(stepDef.systemPrompt, context.params, context.stepsOutput)
      : '';

    const token = createAuthToken({
      role: LLMCallerRole.SKILL_EXECUTOR,
      decisionId: `skill-step-${context.executionId}-${stepDef.id}`,
      auditContext: {
        sessionId: context.sessionId || `skill-${context.executionId}`,
        stepId: stepDef.id,
      },
    });

    const result = await callWithAuth(token, resolvedPrompt, {
      systemPrompt: resolvedSystem,
      model: stepDef.model || config.models?.CHAT,
      temperature: stepDef.temperature ?? 0.3,
      maxTokens: stepDef.maxTokens || 4096,
    });

    if (!result?.content) {
      return {
        status: 'error',
        output: null,
        retryable: true,
        errorType: 'transient',
        errorMessage: `LLM step "${stepDef.id}": empty LLM response`,
      };
    }

    return {
      status: 'success',
      output: result.content,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: true,
      errorType: 'transient',
      errorMessage: `LLM step "${stepDef.id}": ${err.message}`,
    };
  }
}

// Validate Step — checks output against success criteria via LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// Non-interactive step. Uses LLM to verify that content meets specified
// criteria (successCriteria). If validation fails, the skill FAILS —
// skills guarantee results per contract.
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { callWithAuth } from '../../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../../llm/auth-types.js';
import { config } from '../../config.js';
import { substitute } from './substitute.js';

const VALIDATION_SYSTEM_PROMPT = `Jsi validátor kvality. Tvůj úkol je ověřit, zda obsah splňuje zadaná kritéria.

Odpověz POUZE v tomto formátu:
PASS — pokud obsah splňuje všechna kritéria
FAIL: <konkrétní důvod> — pokud obsah nesplňuje některé kritérium

Buď přísný a konkrétní. Kontroluj každé kritérium zvlášť.`;

/**
 * Execute a validate step (non-interactive — LLM checks criteria).
 *
 * @param {Object} stepDef - Step definition from skill JSON
 * @param {Object} context - { executionId, params, stepsOutput, sessionId }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeValidate(stepDef, context) {
  try {
    const content = stepDef.content;
    const criteria = stepDef.criteria;

    if (!content) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Validate step "${stepDef.id}": missing "content" field`,
      };
    }

    if (!criteria) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Validate step "${stepDef.id}": missing "criteria" field`,
      };
    }

    const resolvedContent = substitute(content, context.params, context.stepsOutput);
    const resolvedCriteria = substitute(criteria, context.params, context.stepsOutput);

    const prompt = `## Obsah k validaci:\n\n${resolvedContent}\n\n## Kritéria:\n\n${resolvedCriteria}\n\nSplňuje obsah všechna kritéria?`;

    const token = createAuthToken({
      role: LLMCallerRole.SKILL_EXECUTOR,
      decisionId: `skill-validate-${context.executionId}-${stepDef.id}`,
      auditContext: {
        sessionId: context.sessionId || `skill-${context.executionId}`,
        stepId: stepDef.id,
      },
    });

    const result = await callWithAuth(token, prompt, {
      systemPrompt: VALIDATION_SYSTEM_PROMPT,
      model: stepDef.model || config.models?.CHAT,
      temperature: 0.1,
      maxTokens: 500,
    });

    if (!result?.content) {
      return {
        status: 'error',
        output: null,
        retryable: true,
        errorType: 'transient',
        errorMessage: `Validate step "${stepDef.id}": empty LLM response`,
      };
    }

    const response = result.content.trim();

    // Parse PASS/FAIL
    if (response.startsWith('PASS')) {
      return {
        status: 'success',
        output: resolvedContent,
        retryable: false,
        errorType: null,
      };
    }

    // FAIL — extract reason
    const failReason = response.startsWith('FAIL:')
      ? response.substring(5).trim()
      : response;

    const failMessage = stepDef.failMessage
      ? substitute(stepDef.failMessage, context.params, context.stepsOutput)
      : `Validace selhala: ${failReason}`;

    return {
      status: 'error',
      output: failReason,
      retryable: false,
      errorType: 'validation',
      errorMessage: failMessage,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: true,
      errorType: 'transient',
      errorMessage: `Validate step "${stepDef.id}": ${err.message}`,
    };
  }
}

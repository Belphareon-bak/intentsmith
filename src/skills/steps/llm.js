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
 * Clean LLM output when format is 'json'.
 * Strips <think> blocks, markdown code fences, and orphaned </think> tags.
 * Same patterns as parseJSON in lifecycle — proven with deepseek-r1.
 */
function cleanJSONOutput(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  let s = raw;
  // Strip <think>...</think> blocks (deepseek-r1)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Strip orphaned </think> tags
  s = s.replace(/<\/think>/gi, '');
  // Trim before fence detection (think removal may leave leading newlines)
  s = s.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.trim();
  // Fix trailing commas (deepseek-r1 quirk: ,] or ,})
  s = s.replace(/,(\s*[}\]])/g, '$1');
  return s;
}

/**
 * Verify cleaned output is parseable JSON. Returns null if valid, error string if not.
 */
function validateJSON(s) {
  try {
    JSON.parse(s);
    return null;
  } catch (e) {
    return e.message;
  }
}

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

    let resolvedPrompt = substitute(prompt, context.params, context.stepsOutput);
    const resolvedSystem = stepDef.systemPrompt
      ? substitute(stepDef.systemPrompt, context.params, context.stepsOutput)
      : '';

    // Inject validation failure context from retry loop (runner sets _validateFailReason)
    const failReason = context.stepsOutput?._validateFailReason;
    if (failReason) {
      resolvedPrompt += `\n\nPŘEDCHOZÍ POKUS SELHAL PŘI VALIDACI: ${failReason}\nOprav výstup tak, aby splňoval všechna kritéria. Vrať POUZE opravený výstup.`;
      // Clear after use so subsequent steps don't see it
      delete context.stepsOutput._validateFailReason;
    }

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

    // Clean output when format is 'json' (strips <think> blocks, code fences)
    let output = stepDef.format === 'json'
      ? cleanJSONOutput(result.content)
      : result.content;

    // JSON format: verify parseable, attempt one LLM repair if not
    if (stepDef.format === 'json') {
      const parseErr = validateJSON(output);
      if (parseErr) {
        // Try to extract JSON object from mixed prose+JSON response
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extracted = jsonMatch[0].replace(/,(\s*[}\]])/g, '$1');
          if (!validateJSON(extracted)) {
            output = extracted;
          }
        }
        // If still invalid, mark as retryable so _executeStepWithRetry can retry
        if (validateJSON(output)) {
          return {
            status: 'error',
            output: output, // preserve for diagnostics
            retryable: true,
            errorType: 'transient',
            errorMessage: `LLM step "${stepDef.id}": format is json but output is not valid JSON: ${parseErr}`,
          };
        }
      }
    }

    return {
      status: 'success',
      output,
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

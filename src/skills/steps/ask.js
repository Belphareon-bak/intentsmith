// Ask Step — interactive question that pauses execution for user input
// ══════════════════════════════════════════════════════════════════════════════
//
// Pauses execution, shows a question to the user, waits for response.
// User response becomes the step output on resume.
//
// Step I/O contract: { status: 'awaiting_input', prompt, retryable: false }
//
// ══════════════════════════════════════════════════════════════════════════════

import { substitute } from './substitute.js';

/**
 * Execute an ask step (interactive — pauses for user input).
 *
 * @param {Object} stepDef - Step definition from skill JSON
 * @param {Object} context - { params, stepsOutput }
 * @returns {{ status: string, prompt: string, output: null, retryable: boolean, errorType: string|null }}
 */
export async function executeAsk(stepDef, context) {
  try {
    const prompt = stepDef.prompt;
    if (!prompt) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Ask step "${stepDef.id}": missing "prompt" field`,
      };
    }

    const resolvedPrompt = substitute(prompt, context.params, context.stepsOutput);

    return {
      status: 'awaiting_input',
      output: null,
      prompt: resolvedPrompt,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Ask step "${stepDef.id}": ${err.message}`,
    };
  }
}

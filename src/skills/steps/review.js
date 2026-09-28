// Review Step — shows generated content for user approval or correction
// ══════════════════════════════════════════════════════════════════════════════
//
// Pauses execution, shows content (typically from a prior step) to user.
// User either approves (content passes through) or provides corrections.
//
// On resume:
//   "ano"/"ok"/"schválit" → step output = reviewed content (pass-through)
//   anything else         → step output = user's correction/feedback
//
// Step I/O contract: { status: 'awaiting_input', prompt, content, retryable: false }
//
// ══════════════════════════════════════════════════════════════════════════════

import { substitute } from './substitute.js';

/**
 * Execute a review step (interactive — pauses for user approval/correction).
 *
 * @param {Object} stepDef - Step definition from skill JSON
 * @param {Object} context - { params, stepsOutput }
 * @returns {{ status: string, prompt: string, content: string, output: null, retryable: boolean, errorType: string|null }}
 */
export async function executeReview(stepDef, context) {
  try {
    const content = stepDef.content;
    if (!content) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Review step "${stepDef.id}": missing "content" field`,
      };
    }

    const resolvedContent = substitute(content, context.params, context.stepsOutput);
    const resolvedPrompt = stepDef.prompt
      ? substitute(stepDef.prompt, context.params, context.stepsOutput)
      : 'Zkontroluj výsledek. Schválit (ano) nebo navrhnout úpravy:';

    return {
      status: 'awaiting_input',
      output: null,
      prompt: resolvedPrompt,
      content: resolvedContent,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Review step "${stepDef.id}": ${err.message}`,
    };
  }
}

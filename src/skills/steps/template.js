// Template Step — pure string substitution, no LLM call
// ══════════════════════════════════════════════════════════════════════════════
//
// Takes a template string, substitutes params + prior step outputs,
// returns the resolved string as output.
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { substitute } from './substitute.js';

/**
 * Execute a template step.
 *
 * @param {Object} stepDef - Step definition from skill JSON
 * @param {Object} context - { params, stepsOutput }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeTemplate(stepDef, context) {
  try {
    const template = stepDef.template;
    if (!template) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Template step "${stepDef.id}": missing "template" field`,
      };
    }

    const result = substitute(template, context.params, context.stepsOutput);

    return {
      status: 'success',
      output: result,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Template step "${stepDef.id}": ${err.message}`,
    };
  }
}

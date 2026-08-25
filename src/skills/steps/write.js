// Write Step — prepares and settles an exact M2 file.write effect
// ══════════════════════════════════════════════════════════════════════════════
//
// Security:
//   - Never writes directly; path and byte authority belong to the injected M2 bridge
//   - Governed manifests must declare file.write explicitly
//   - Legacy definitions without toolId retain compatibility but map only to file.write
//   - On security violation: { errorType: 'security', retryable: false }
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { substitute } from './substitute.js';

/**
 * Execute a write step.
 *
 * @param {Object} stepDef - Step definition { id, type: 'write', path, content, toolId? }
 * @param {Object} context - { params, stepsOutput, effectAuthority, authorityBinding }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeWrite(stepDef, context) {
  try {
    if (!stepDef.path) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Write step "${stepDef.id}": missing "path" field`,
      };
    }

    const toolId = stepDef.toolId ?? 'file.write';
    if (toolId !== 'file.write') {
      return {
        status: 'error', output: null, retryable: false, errorType: 'security',
        errorMessage: `Write step "${stepDef.id}": exact M2 toolId "file.write" is required`,
      };
    }
    if (!context.effectAuthority || !context.authorityBinding) {
      return {
        status: 'error', output: null, retryable: false, errorType: 'security',
        errorMessage: `Write step "${stepDef.id}": M2 effect authority is unavailable`,
      };
    }

    const rawPath = substitute(stepDef.path, context.params, context.stepsOutput);

    // Resolve content from stepDef.content or prior step output
    const content = stepDef.content
      ? substitute(stepDef.content, context.params, context.stepsOutput)
      : '';

    if (context.approvalEffectId) {
      const output = await context.effectAuthority.approveWrite({
        binding: context.authorityBinding,
        effectId: context.approvalEffectId,
        signal: context.signal,
      });
      return { status: 'success', output, retryable: false, errorType: null };
    }

    const prepared = await context.effectAuthority.prepareWrite({
      binding: context.authorityBinding,
      path: rawPath,
      content,
      signal: context.signal,
    });
    if (prepared.state === 'terminal') {
      return { status: 'success', output: prepared, retryable: false, errorType: null };
    }
    return {
      status: 'awaiting_input',
      output: prepared,
      prompt: `Pro provedení napiš přesně: schválit efekt ${prepared.effectId}`,
      content: content.length <= 4096 ? content : `${content.slice(0, 4096)}\n…`,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: err?.code?.includes('AUTHORITY') || err?.code?.includes('EFFECT') ? 'security' : 'validation',
      errorMessage: `Write step "${stepDef.id}": ${err.message}`,
    };
  }
}

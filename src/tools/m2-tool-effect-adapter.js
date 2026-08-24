import { validateM2ToolRequest } from '../../contracts/m2/tool-v1.js';

function unavailable(reason) {
  return Object.freeze({ state: 'unavailable', effectRequestId: null, reason });
}

/**
 * Narrow production adapter from the typed Tool connector to the canonical
 * EffectRequest runtime. Only file.write has enough exact information today.
 * Network search deliberately remains unavailable: a query does not identify
 * the concrete provider requests and redirects that an ApprovalGrant must bind.
 */
export function createM2ToolEffectAdapter({ effectRuntime = null } = {}) {
  return Object.freeze({
    async prepare({ request, context = {}, signal } = {}) {
      const validation = validateM2ToolRequest(request);
      if (!validation.valid) {
        throw Object.assign(new TypeError('Tool effect adapter received an invalid ToolRequest'), {
          code: 'TOOL_EFFECT_REQUEST_INVALID',
          details: validation.errors,
        });
      }
      if (request.toolId !== 'file.write' || request.requiredEffectKind !== 'fs.write') {
        return unavailable('No exact effect translation is installed for this tool');
      }
      const projectId = request.origin.projectId;
      const projectRoot = context?.project?.path ?? context?.projectPath;
      if (
        request.actor.type !== 'user'
        || !Number.isSafeInteger(projectId)
        || projectId <= 0
        || typeof projectRoot !== 'string'
        || projectRoot.length === 0
        || !(['string', 'number'].includes(typeof context.sessionId))
        || String(context.sessionId).length === 0
        || !(['string', 'number'].includes(typeof context.conversationId))
        || String(context.conversationId).length === 0
      ) return unavailable('file.write requires an authenticated registered project');

      let runtime = effectRuntime;
      if (!runtime) {
        const module = await import('../effects/effect-file-runtime.js');
        runtime = module.effectFileRuntime;
      }
      if (!runtime || typeof runtime.requestFilesystemWrite !== 'function') {
        return unavailable('Filesystem effect runtime is not ready');
      }
      const prepared = await runtime.requestFilesystemWrite({
        // Durable authority session follows the persisted conversation so a
        // websocket reconnect cannot change ToolRequest/EffectRequest bytes.
        sessionId: String(context.conversationId),
        conversationId: String(context.conversationId),
        subjectId: request.actor.id,
        operationId: request.requestId,
        projectId,
        projectRoot,
        relativePath: request.input.path,
        content: request.input.content,
        signal,
      });
      return Object.freeze({
        state: prepared.state === 'terminal'
          ? (prepared.result?.terminalStatus === 'succeeded' ? 'succeeded' : 'terminal')
          : 'approval_required',
        effectRequestId: prepared.effectId,
        effectRequest: prepared.request,
        effectResult: prepared.result || null,
        output: prepared.result?.terminalStatus === 'succeeded'
          ? {
            path: request.input.path,
            effectId: prepared.effectId,
            terminalStatus: prepared.result.terminalStatus,
          }
          : null,
        evidenceRefs: prepared.result ? [`effect:${prepared.effectId}`] : [],
      });
    },
  });
}

export default createM2ToolEffectAdapter;

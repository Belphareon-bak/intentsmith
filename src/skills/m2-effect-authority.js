import { projects } from '../db/database.js';
import { effectFileRuntime } from '../effects/effect-file-runtime.js';
import { toolExecutor } from '../executor/tool-executor.js';

function fail(message, code = 'M3_SKILL_EFFECT_AUTHORITY_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function buildContext(binding, signal = null) {
  if (
    binding?.actorType !== 'user'
    || typeof binding.actorId !== 'string'
    || !Number.isSafeInteger(binding.projectId)
    || binding.projectId <= 0
    || !Number.isSafeInteger(binding.userMessageId)
    || binding.userMessageId <= 0
  ) fail('Skill execution has no exact authenticated project binding');
  const project = projects.findById.get(binding.projectId);
  if (!project?.path) fail('Skill project is no longer registered', 'M3_SKILL_PROJECT_UNAVAILABLE');
  return Object.freeze({
    sessionId: binding.sessionId,
    conversationId: binding.conversationId,
    userMessageId: binding.userMessageId,
    authenticatedSubject: Object.freeze({ actorType: 'user', actorId: binding.actorId }),
    project: Object.freeze({ id: project.id, name: project.name, path: project.path }),
    projectId: project.id,
    effectOriginSurface: 'skill',
    signal,
  });
}

function requireTerminalSuccess(settlement) {
  const result = settlement?.result;
  if (!result) fail('M2 tool settlement did not produce durable terminal truth');
  if (result.status !== 'ok') {
    fail(
      `M2 file.write ended as ${result.status}: ${result.error?.code || 'unknown'}`,
      result.error?.code || 'M3_SKILL_EFFECT_FAILED',
    );
  }
  return Object.freeze({
    toolId: result.toolId,
    requestId: result.requestId,
    effectId: result.effectRequestId,
    status: result.status,
    path: settlement.value?.path || result.output?.path || null,
    terminalStatus: settlement.value?.terminalStatus || result.output?.terminalStatus || 'succeeded',
    evidenceRefs: Object.freeze([...(result.evidenceRefs || [])]),
  });
}

export const skillM2EffectAuthority = Object.freeze({
  async prepareWrite({ binding, path, content, signal = null }) {
    const context = buildContext(binding, signal);
    const execution = await toolExecutor.executeM2Tool({
      toolId: 'file.write',
      input: { path, content },
      context,
      timeoutMs: 120_000,
    });
    if (execution.result) return Object.freeze({ state: 'terminal', ...requireTerminalSuccess(execution) });
    if (execution.state !== 'approval_required' || typeof execution.effectRequestId !== 'string') {
      fail('M2 file.write returned neither terminal truth nor approval authority');
    }
    return Object.freeze({
      state: 'approval_required',
      toolId: execution.request.toolId,
      requestId: execution.request.requestId,
      effectId: execution.effectRequestId,
      path,
      payloadDigest: execution.request.inputDigest,
      payloadBytes: Buffer.byteLength(content, 'utf8'),
    });
  },

  async approveWrite({ binding, effectId, signal = null }) {
    const context = buildContext(binding, signal);
    await effectFileRuntime.approveFilesystemWrite({
      effectId,
      conversationId: binding.conversationId,
      subjectId: binding.actorId,
      signal,
    });
    return requireTerminalSuccess(await toolExecutor.settleM2Effect({ effectId, context }));
  },

  async cancelWrite({ binding, effectId }) {
    const context = buildContext(binding, null);
    await effectFileRuntime.cancelFilesystemWrite({
      effectId,
      conversationId: binding.conversationId,
      subjectId: binding.actorId,
    });
    return await toolExecutor.settleM2Effect({ effectId, context });
  },
});

export default skillM2EffectAuthority;

// A core-issued conversation continuation, never a filesystem/model grant.
// JSON copied from a client, model, history or stored turn cannot be re-issued
// through the generic message writer. Durable reads still revalidate M2 scope.
import { createHash } from 'node:crypto';
import { computeM2ToolRequestDigest, validateM2ToolRequest } from '../../contracts/m2/tool-v1.js';

const issued = new WeakSet();
const completionGuards = new WeakMap();
const sha = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function binding(execution, context) {
  const request = execution?.request;
  const effectId = execution?.result?.effectRequestId || execution?.effectRequestId;
  const conversationId = String(context?.conversationId ?? '');
  const projectId = Number(context?.project?.id ?? context?.projectId);
  if (!validateM2ToolRequest(request).valid || request.toolId !== 'file.read' || request.toolVersion !== 2
      || !/^effect:[a-f0-9]{64}$/.test(effectId || '')
      || context?.authenticatedSubject?.actorType !== 'user'
      || request.actor.type !== 'user' || request.actor.id !== context.authenticatedSubject.actorId
      || !Number.isSafeInteger(projectId) || projectId <= 0 || request.origin.projectId !== projectId
      || !conversationId || request.origin.conversationId !== `conversation:${sha(conversationId).slice(7)}`) {
    throw Object.assign(new Error('File explanation continuation identity mismatch'), { code: 'TOOL_FILE_EXPLAIN_CONTEXT_MISMATCH' });
  }
  return { requestId: request.requestId, requestDigest: computeM2ToolRequestDigest(request), effectId,
    actorId: request.actor.id, projectId, conversationId, path: request.input.path };
}

export function issueFileExplainContinuation(execution, context, question, completion = null, assertCurrent = null) {
  if (typeof question !== 'string' || !question.trim()) {
    throw Object.assign(new Error('Original explanation question is required'), { code: 'TOOL_FILE_EXPLAIN_QUESTION_REQUIRED' });
  }
  const value = Object.freeze({ version: 1, ...binding(execution, context), question,
    questionDigest: sha(question), language: context.langCtx?.language === 'en' ? 'en' : 'cs',
    state: completion ? 'complete' : 'pending',
    ...(completion ? { contentRef: execution.result.output.contentRef,
      contentDigest: execution.result.output.contentDigest, answerDigest: sha(completion.content),
      model: completion.model, finishReason: 'stop' } : {}),
  });
  if (completion && typeof assertCurrent !== 'function') throw new Error('Completion scope guard is required');
  issued.add(value);
  if (completion) completionGuards.set(value, assertCurrent);
  return value;
}

export function isIssuedFileExplainContinuation(value) {
  return Boolean(value && issued.has(value));
}

export function assertFileExplainContinuationCurrent(value) {
  if (!isIssuedFileExplainContinuation(value)) throw new Error('Unissued file explanation continuation');
  completionGuards.get(value)?.();
}

export function getFileExplainContinuation(execution, context) {
  const store = context?.conversationStore;
  if (!store?.isDurableReady?.() || typeof store.getFileExplainTurn !== 'function') return null;
  const expected = binding(execution, context);
  const turn = store.getFileExplainTurn(expected.conversationId, expected.requestId);
  if (!turn) return null;
  const value = turn.metadata?.m2FileExplain;
  if (turn.role !== 'assistant' || value?.version !== 1
      || Object.entries(expected).some(([key, item]) => value[key] !== item)
      || typeof value.question !== 'string' || !value.question.trim() || value.questionDigest !== sha(value.question)
      || !['cs', 'en'].includes(value.language) || !['pending', 'complete'].includes(value.state)) {
    throw Object.assign(new Error('Stored explanation continuation does not match'), { code: 'TOOL_FILE_EXPLAIN_CONTEXT_MISMATCH' });
  }
  if (value.state === 'complete' && (value.contentRef !== execution.result?.output?.contentRef
      || value.contentDigest !== execution.result?.output?.contentDigest
      || value.finishReason !== 'stop' || typeof value.model !== 'string'
      || typeof turn.content !== 'string' || value.answerDigest !== sha(turn.content))) {
    throw Object.assign(new Error('Stored explanation completion does not match'), { code: 'TOOL_FILE_EXPLAIN_CONTEXT_MISMATCH' });
  }
  return { ...value, ...(value.state === 'complete' ? { content: turn.content } : {}) };
}

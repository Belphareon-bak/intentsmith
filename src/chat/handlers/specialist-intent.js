// Core-owned semantic connector supplied through the registered package API.
// A model proposes typed inputs; package validation precedes deterministic use.
import { classifyIntent } from '../../llm/cre-bridge.js';

export function specialistIntentContext(context) {
  const projectId = context.project?.id ?? null;
  const history = (Array.isArray(context.history) ? context.history : context.dbHistory || [])
    .slice(-8).flatMap(turn => {
      if (turn.isSummary) return [];
      const role = turn.role || (turn.response?.tag?.speaker === 'user' ? 'user' : 'assistant');
      const content = turn.content ?? turn.response?.content;
      const metadata = turn.metadata || {};
      const sourceProject = role === 'user' ? metadata.projectId : metadata.saveSourceProjectId;
      const hasSource = Object.hasOwn(metadata,
        role === 'user' ? 'projectId' : 'saveSourceProjectId');
      if (!['user', 'assistant'].includes(role) || typeof content !== 'string'
          || !hasSource || sourceProject !== projectId
          || (role === 'assistant' && metadata.saveSourceEligible !== true)) return [];
      return [{ role, content: content.slice(0, 500) }];
    });
  return {
    history,
    async interpretInput({ instruction, input, numeric }) {
      const result = await classifyIntent(JSON.stringify({
        task: 'specialist.input.interpretation', currentInput: input,
        numericGrounding: numeric, history,
      }), instruction, {
        sessionId: context.sessionId, signal: context.signal || undefined,
        temperature: 0, maxTokens: 1024, timeout: 45_000, format: 'json',
      });
      if (result.finishReason === 'length') throw new Error('Specialist input plan truncated');
      try { return JSON.parse(result.content); }
      catch { return null; }
    },
  };
}

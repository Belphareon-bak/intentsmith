// Explicit model outputs for filesystem consumer tests. This helper never
// parses natural language or contacts a provider. M1 live/HTTP tests assess
// interpretation separately; these fixtures exercise grounded M2 admission.
import assert from 'node:assert/strict';
import { llmGateway } from '../../src/llm/gateway.js';

export function answerSavePlan(target, messageId, transformation = 'none') {
  return {
    action: 'write', question: null, target,
    source: { kind: 'answer', messageId },
    transformation, writeMode: 'replace', understood: true, unsupported: [],
  };
}

export function ambiguousSavePlan(question) {
  return {
    action: 'clarify', question, target: null, source: null,
    transformation: 'none', writeMode: 'replace', understood: false, unsupported: [],
  };
}

export function fileSaveSemanticFixture({ request, plan, summary = null }) {
  const calls = [];
  return {
    calls,
    async interpretSave(prompt, system, options) {
      const parsed = JSON.parse(prompt);
      assert.equal(parsed.request, request, 'the model must receive the complete original request');
      assert.match(system, /Interpret the whole current user request/);
      assert.equal(options.requestType, 'file.save.interpret');
      assert.equal(options.format?.type, 'object');
      calls.push({ kind: 'interpret', input: parsed });
      return { content: JSON.stringify(plan), model: 'controlled-file-save-fixture' };
    },
    async summarizeSave(prompt, system, options) {
      const parsed = JSON.parse(prompt);
      assert.equal(parsed.request, request);
      assert.match(system, /Summarize only the supplied answer/);
      assert.equal(options.requestType, 'file.save.summarize');
      assert.equal(typeof summary, 'string', 'a summary output must be explicitly provided');
      calls.push({ kind: 'summarize', input: parsed });
      return { content: summary, finishReason: 'stop', model: 'controlled-file-save-fixture' };
    },
  };
}

// Project routing reaches classifyIntent through the real auth bridge without
// an injected file-handler dependency. Bound its existing gateway test seam
// to these exact requests; unexpected model work fails instead of reaching GPU.
export async function withFileSaveSemanticProvider(fixtures, callback) {
  const original = llmGateway.call;
  llmGateway.call = async (prompt, options = {}) => {
    const parsed = JSON.parse(prompt);
    const fixture = fixtures.get(parsed.request);
    assert(fixture, `unexpected model request: ${parsed.request}`);
    if (options.requestType === 'file.save.interpret') {
      return fixture.interpretSave(prompt, options.systemPrompt, options);
    }
    if (options.requestType === 'file.save.summarize') {
      return fixture.summarizeSave(prompt, options.systemPrompt, options);
    }
    assert.fail(`unexpected model operation: ${options.requestType}`);
  };
  try {
    return await callback();
  } finally {
    llmGateway.call = original;
  }
}

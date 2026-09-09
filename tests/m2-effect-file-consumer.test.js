import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isM2ProjectRelativePath, validateEffectRequest } from '../contracts/m2/effect-v1.js';
import { computeM2ToolValueDigest, validateM2ToolRequest } from '../contracts/m2/tool-v1.js';
import { createM2FileReadPolicyPayload } from '../contracts/m2/file-read-output-v1.js';
import { suite, testAsync, summary } from './harness.js';

const { handleFileWriteDecision, handleFileDecision, renderM2FileReadResult } = await import('../src/chat/handlers/file.js');
const { parseExactEffectApproval, handleExactEffectApproval } = await import('../src/chat/handlers/pre-handler.js');
const { handleToolCallDecision } = await import('../src/chat/handlers/decisions.js');
const { toolExecutor, ToolExecutor, ExecutionStatus, ToolResult } = await import('../src/executor/tool-executor.js');

function decision(filePath = 'notes/result.md') {
  const serialized = { type: 'FILE_WRITE', metadata: { handler: 'file.write', filePath } };
  return {
    metadata: { handler: 'file.write', filePath },
    toJSON: () => serialized,
  };
}

function context(projectRoot, overrides = {}) {
  return {
    project: { id: 17, path: projectRoot },
    projectId: 17,
    authenticatedSubject: { actorType: 'user', actorId: 'user-1' },
    userMessageId: 41,
    sessionId: 'session-1',
    conversationId: 'conversation-1',
    history: [
      { response: { content: 'authoritative assistant content\n', tag: { speaker: 'system' } } },
      { response: { content: 'ulož to do notes/result.md', tag: { speaker: 'user' } } },
    ],
    langCtx: { language: 'en' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function withProject(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-effect-consumer-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(projectRoot, { recursive: true });
  try {
    return await callback({ directory, projectRoot });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

suite('M2 first filesystem effect consumer');

await testAsync('handler delegates exact bytes and authority context to the M2 ToolRequest seam without writing', async () => {
  await withProject(async ({ projectRoot }) => {
    const calls = [];
    const requestReached = new Promise(resolve => {
      calls.onRequest = resolve;
    });
    let release;
    const runtimeResult = new Promise(resolve => { release = resolve; });
    const injectedToolExecutor = {
      async executeM2Tool(input) {
        calls.push(input);
        calls.onRequest();
        return runtimeResult;
      },
    };
    const handlerContext = context(projectRoot);
    const target = path.join(projectRoot, 'notes/result.md');
    const responsePromise = handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      handlerContext,
      { toolExecutor: injectedToolExecutor },
    );

    await requestReached;
    assert.equal(existsSync(target), false, 'consumer must not write before or instead of the broker runtime');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      toolId: 'file.write',
      input: {
        path: 'notes/result.md',
        content: 'authoritative assistant content\n',
      },
      context: handlerContext,
      timeoutMs: 120_000,
    });

    release({
      request: { requestId: `tool:${'f'.repeat(64)}` },
      effectRequestId: `effect:${'a'.repeat(64)}`,
      state: 'approval_required',
      result: null,
    });
    const response = await responsePromise;
    assert.equal(existsSync(target), false, 'request registration must not be presented as a completed write');
    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.handler, 'file.write');
    assert.equal(response.tag.metadata.fileOperation, false);
    assert.equal(response.tag.metadata.approvalRequired, true);
    assert.equal(response.tag.metadata.effectState, 'approval_required');
    assert.equal(response.tag.metadata.effectId, `effect:${'a'.repeat(64)}`);
    assert.match(response.content, /awaits approval/i);
  });
});

await testAsync('missing project or authenticated caller blocks before the runtime seam', async () => {
  await withProject(async ({ projectRoot }) => {
    let runtimeCalls = 0;
    const injectedToolExecutor = {
      async executeM2Tool() {
        runtimeCalls += 1;
        return {
          request: { requestId: `tool:${'f'.repeat(64)}` },
          effectRequestId: `effect:${'b'.repeat(64)}`,
          state: 'approval_required',
          result: null,
        };
      },
    };
    const cases = [
      context(projectRoot, { project: null, projectId: null }),
      context(projectRoot, { authenticatedSubject: null }),
      context(projectRoot, { userMessageId: null }),
    ];

    for (const handlerContext of cases) {
      const response = await handleFileWriteDecision(
        'ulož to do notes/result.md',
        decision(),
        handlerContext,
        { toolExecutor: injectedToolExecutor },
      );
      assert.equal(response.tag.metadata.securityBlocked, true);
      assert.equal(response.tag.metadata.error, 'effect_authority_required');
      assert.equal(response.tag.canExecute, false);
    }
    assert.equal(runtimeCalls, 0);
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('runtime rejection is surfaced as authorization failure and never falls back to a legacy write', async () => {
  await withProject(async ({ projectRoot }) => {
    let runtimeCalls = 0;
    const injectedToolExecutor = {
      async executeM2Tool() {
        runtimeCalls += 1;
        const error = new Error('workspace changed after approval');
        error.code = 'EFFECT_WORKSPACE_STALE';
        throw error;
      },
    };
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      { toolExecutor: injectedToolExecutor },
    );

    assert.equal(runtimeCalls, 1);
    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.error, 'EFFECT_WORKSPACE_STALE');
    assert.equal(response.tag.metadata.fileOperation, undefined);
    assert.match(response.content, /was not authorized/i);
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('an unavailable injected runtime fails closed instead of using direct filesystem APIs', async () => {
  await withProject(async ({ projectRoot }) => {
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      { toolExecutor: {} },
    );

    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('an idempotent terminal retry is rendered without asking for a second approval', async () => {
  await withProject(async ({ projectRoot }) => {
    const effectId = `effect:${'d'.repeat(64)}`;
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      {
        toolExecutor: {
          async executeM2Tool() {
            return {
              request: { requestId: `tool:${'e'.repeat(64)}` },
              value: { path: 'notes/result.md', effectId, terminalStatus: 'succeeded' },
              result: { status: 'ok', effectRequestId: effectId },
            };
          },
        },
      },
    );

    assert.equal(response.tag.metadata.effectId, effectId);
    assert.equal(response.tag.metadata.effectState, 'terminal');
    assert.equal(response.tag.metadata.terminalStatus, 'ok');
    assert.equal(response.tag.metadata.approvalRequired, false);
    assert.equal(response.tag.metadata.fileOperation, true);
    assert.doesNotMatch(response.content, /approve|schvál/i);
  });
});

await testAsync('approval parser accepts only a command containing the exact full effect ID', async () => {
  const effectId = `effect:${'c'.repeat(64)}`;
  assert.equal(parseExactEffectApproval(`schválit efekt ${effectId}`), effectId);
  assert.equal(parseExactEffectApproval(`approve effect ${effectId}`), effectId);
  for (const rejected of ['ano', 'schvaluji', 'schválit efekt', `schválit efekt ${effectId.slice(0, -1)}`]) {
    assert.equal(parseExactEffectApproval(rejected), null);
  }
});

await testAsync('security hook is telemetry-only and authority denial comes from the M2 executor', async () => {
  const originalExecute = toolExecutor.execute;
  let executorCalls = 0;
  toolExecutor.execute = async () => {
    executorCalls += 1;
    return {
      status: ExecutionStatus.FAILED,
      duration: 1,
      toolResults: [ToolResult.failed({
        type: 'file.write',
        error: 'exact effect approval is required',
        errorCode: 'TOOL_EFFECT_AUTHORITY_REQUIRED',
      })],
    };
  };
  const authorityError = new Error('M2 effect authority is required');
  authorityError.code = 'M2_EFFECT_AUTHORITY_REQUIRED';
  const legacyDecision = {
    intent: 'FILE_WRITE',
    confidence: 1,
    tools: ['web.search', 'file.write'],
    metadata: {},
    toJSON: () => ({ intent: 'FILE_WRITE', tools: ['web.search', 'file.write'] }),
  };
  const hookedTools = [];

  try {
    const response = await handleToolCallDecision('write the file', legacyDecision, {
        sessionState: null,
        history: [],
        hasActiveProject: true,
        onToolCall: async tool => {
          hookedTools.push(tool);
          if (tool === 'file.write') throw authorityError;
        },
      });
    assert.deepEqual(hookedTools, ['web.search', 'file.write']);
    assert.equal(executorCalls, 1);
    assert.equal(response.tag.metadata.securityBlocked, true);
    assert.equal(response.tag.metadata.fallbackSuppressed, true);
  } finally {
    toolExecutor.execute = originalExecute;
  }
});


function readDecision(filePath = 'notes/read.md', explain = false) {
  const value = { intent: explain ? 'FILE_EXPLAIN' : 'FILE_READ', metadata: {
    handler: explain ? 'file.explain' : 'file.read', filePath,
  } };
  return { ...value, toJSON: () => value };
}

// Consumer-only DI fixture: durable identity/content validation belongs to the
// broker suite; this fixture proves that chat uses that resolver, never value/FS.
function storedReadFixture(bytes = Buffer.from('verified e\u0301\r\n', 'utf8')) {
  const requestId = `tool:${'1'.repeat(64)}`;
  const effectId = `effect:${'2'.repeat(64)}`;
  const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const output = { path: 'notes/read.md', contentRef: `read:${'3'.repeat(64)}`,
    contentDigest, byteLength: bytes.length, format: 'bytes' };
  const request = { requestId, toolId: 'file.read', toolVersion: 2,
    actor: { type: 'user', id: 'user-1' }, origin: { projectId: 17, conversationId: 'conversation-1' },
    input: { path: output.path } };
  const result = { requestId, requestDigest: `sha256:${'4'.repeat(64)}`,
    toolId: 'file.read', toolVersion: 2, status: 'ok', effectRequestId: effectId, output };
  const execution = { request, result, value: { content: 'FORGED_ADAPTER_CONTENT' } };
  const resolved = { bytes: Buffer.from(bytes), output, request, result, effectId, path: output.path };
  return { execution, resolved, effectId, requestId, output };
}

await testAsync('read terminal displays only resolver bytes and exact caller context on replay without a file', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture(Buffer.from('\ufeffřádek e\u0301\r\n```\npayload\n', 'utf8'));
    const handlerContext = context(projectRoot, { hasActiveProject: true });
    const requests = [], resolutions = [];
    const executor = {
      async executeM2Tool(input) { requests.push(input); return fixture.execution; },
      resolveM2FileReadContent(input) { resolutions.push(input); return fixture.resolved; },
    };
    for (let i = 0; i < 2; i++) {
      const response = await handleFileDecision('read notes/read.md', readDecision(), handlerContext, { toolExecutor: executor });
      assert.equal(response.tag.metadata.fileOperation, true);
      assert.equal(response.tag.metadata.securityBlocked, false);
      assert.equal(response.tag.metadata.approvalRequired, false);
      assert.equal(response.tag.metadata.contentDigest, fixture.output.contentDigest);
      assert.equal(response.tag.metadata.fileSize, fixture.resolved.bytes.length);
      assert.equal(response.tag.canExecute, false);
      assert.ok(response.content.includes(fixture.resolved.bytes.toString('utf8')));
      assert.match(response.content, /````markdown\n/);
      assert.doesNotMatch(response.content, /FORGED_ADAPTER_CONTENT/);
      assert.equal(existsSync(path.join(projectRoot, fixture.output.path)), false);
    }
    assert.equal(requests.length, 2);
    assert.ok(requests.every(x => x.context === handlerContext && x.toolId === 'file.read'));
    assert.deepEqual(resolutions, [0, 1].map(() => ({ requestId: fixture.requestId,
      contentRef: fixture.output.contentRef, context: handlerContext })));
  });
});

await testAsync('read content reference, identity, bytes and UTF8 failures never leak adapter content', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture();
    const handlerContext = context(projectRoot);
    const cases = [
      { name: 'missing resolver', executor: {}, error: 'TOOL_READ_CONTENT_AUTHORITY_REQUIRED' },
      { name: 'foreign context denied by broker', executor: { resolveM2FileReadContent() {
        throw Object.assign(new Error('foreign actor/project/conversation'), { code: 'TOOL_SETTLEMENT_CALLER_INVALID' });
      } }, error: 'TOOL_SETTLEMENT_CALLER_INVALID' },
      { name: 'changed bytes', executor: { resolveM2FileReadContent() {
        return { ...fixture.resolved, bytes: Buffer.from('changed') };
      } }, error: 'TOOL_READ_CONTENT_MISMATCH' },
      { name: 'changed request', executor: { resolveM2FileReadContent() {
        return { ...fixture.resolved, request: { ...fixture.resolved.request, actor: { type: 'user', id: 'other' } } };
      } }, error: 'TOOL_READ_CONTENT_MISMATCH' },
      { name: 'changed reference', executor: { resolveM2FileReadContent() {
        return { ...fixture.resolved, output: { ...fixture.output, contentRef: 'other' } };
      } }, error: 'TOOL_READ_CONTENT_MISMATCH' },
      { name: 'changed effect', executor: { resolveM2FileReadContent() {
        return { ...fixture.resolved, effectId: `effect:${'9'.repeat(64)}` };
      } }, error: 'TOOL_READ_CONTENT_MISMATCH' },
    ];
    for (const item of cases) {
      const response = renderM2FileReadResult(fixture.execution, handlerContext, { toolExecutor: item.executor });
      assert.equal(response.tag.metadata.fileOperation, false, item.name);
      assert.equal(response.tag.metadata.error, item.error, item.name);
      assert.equal(response.tag.metadata.fallbackSuppressed, true, item.name);
      assert.doesNotMatch(response.content, /FORGED_ADAPTER_CONTENT/, item.name);
      assert.equal(response.content.includes(fixture.resolved.bytes.toString('utf8')), false, item.name);
    }
    for (const bytes of [Buffer.from([0xff, 0x80]), Buffer.from('binary\0data')]) {
      const invalid = storedReadFixture(bytes);
      const response = renderM2FileReadResult(invalid.execution, handlerContext, {
        toolExecutor: { resolveM2FileReadContent: () => invalid.resolved },
      });
      assert.equal(response.tag.metadata.error, 'TOOL_READ_CONTENT_NOT_TEXT');
      assert.equal(response.tag.metadata.fileOperation, false);
      assert.doesNotMatch(response.content, /�/);
    }
  });
});

await testAsync('read approval-required, denied and list-unavailable terminals never invoke content resolver', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture(); let resolutions = 0;
    for (const item of [
      { decision: readDecision(), response: { request: fixture.execution.request, result: null,
        state: 'approval_required', effectRequestId: fixture.effectId } },
      { decision: readDecision(), response: { request: fixture.execution.request,
        result: { status: 'denied', error: { code: 'TOOL_EFFECT_AUTHORITY_REQUIRED' } } } },
      { decision: readDecision('.'), response: { request: { toolId: 'file.list' },
        result: { status: 'unavailable', error: { code: 'TOOL_UNAVAILABLE' } } } },
    ]) {
      const response = await handleFileDecision('read', item.decision, context(projectRoot, { hasActiveProject: true }), {
        toolExecutor: { executeM2Tool: async () => item.response,
          resolveM2FileReadContent() { resolutions++; throw new Error('unexpected resolver'); } },
      });
      assert.equal(response.tag.metadata.fileOperation, false);
      assert.equal(response.tag.metadata.fallbackSuppressed, true);
    }
    assert.equal(resolutions, 0);
  });
});

await testAsync('durable FILE_EXPLAIN read success stays truthful about the unimplemented explanation', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture();
    const response = await handleFileDecision('explain notes/read.md', readDecision('notes/read.md', true), context(projectRoot), {
      toolExecutor: { executeM2Tool: async () => fixture.execution, resolveM2FileReadContent: () => fixture.resolved },
    });
    assert.equal(response.tag.metadata.handler, 'file.read');
    assert.equal(response.tag.metadata.requestedHandler, 'file.explain');
    assert.equal(response.tag.metadata.explanationPending, true);
    assert.equal(response.tag.metadata.fallbackSuppressed, true);
    assert.match(response.content, /explanation has not been produced/);
  });
});

await testAsync('exact read approval settles and renders the same stored content, preserving write approval', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture(); const handlerContext = context(projectRoot);
    const calls = [];
    const dependencies = {
      effectFileRuntime: { async approveFilesystemEffect(input) {
        calls.push(['approve', input]); return { effectId: fixture.effectId, terminalStatus: 'succeeded', changes: { paths: [] } };
      } },
      toolExecutor: { async settleM2Effect(input) { calls.push(['settle', input]); return fixture.execution; },
        resolveM2FileReadContent(input) { calls.push(['resolve', input]); return fixture.resolved; } },
    };
    const outcome = await handleExactEffectApproval(`approve effect ${fixture.effectId}`, handlerContext, 'PROJECT', dependencies);
    assert.equal(outcome.handled, true);
    assert.equal(outcome.response.tag.metadata.fileOperation, true);
    assert.equal(outcome.response.tag.metadata.handler, 'file.read');
    assert.ok(outcome.response.content.includes(fixture.resolved.bytes.toString('utf8')));
    assert.deepEqual(calls.map(x => x[0]), ['approve', 'settle', 'resolve']);
    assert.deepEqual(calls[0][1], { effectId: fixture.effectId, conversationId: handlerContext.conversationId,
      subjectId: handlerContext.authenticatedSubject.actorId, signal: handlerContext.signal });
    assert.equal(calls[1][1].context, handlerContext);
    assert.equal(calls[2][1].context, handlerContext);
    const write = await handleExactEffectApproval(`approve effect ${fixture.effectId}`, handlerContext, 'PROJECT', {
      effectFileRuntime: { approveFilesystemEffect: async () => ({ effectId: fixture.effectId, terminalStatus: 'succeeded', changes: { paths: ['written.md'] } }) },
      toolExecutor: { settleM2Effect: async () => ({ request: { toolId: 'file.write' }, result: { status: 'ok' } }),
        resolveM2FileReadContent() { throw new Error('write must never use read resolver'); } },
    });
    assert.equal(write.response.tag.metadata.handler, 'effect.approval');
    assert.match(write.response.content, /written\.md/);
  });
});

await testAsync('approval never renders uncommitted or foreign read output and generic affirmations stay inert', async () => {
  await withProject(async ({ projectRoot }) => {
    const fixture = storedReadFixture(); const handlerContext = context(projectRoot);
    let approvals = 0, resolves = 0;
    const dependencies = {
      effectFileRuntime: { async approveFilesystemEffect() { approvals++; return { effectId: fixture.effectId, terminalStatus: 'succeeded' }; } },
      toolExecutor: { async settleM2Effect() { throw Object.assign(new Error('uncommitted'), { code: 'TOOL_RESULT_UNCOMMITTED' }); },
        resolveM2FileReadContent() { resolves++; return fixture.resolved; } },
    };
    for (const input of ['ano', 'schvaluji']) {
      assert.deepEqual(await handleExactEffectApproval(input, handlerContext, 'PROJECT', dependencies), { handled: false });
    }
    const missing = await handleExactEffectApproval(`approve effect ${fixture.effectId}`, { ...handlerContext, authenticatedSubject: null }, 'PROJECT', dependencies);
    assert.equal(missing.response.tag.metadata.error, 'effect_identity_required');
    assert.equal(approvals, 0);
    const failed = await handleExactEffectApproval(`approve effect ${fixture.effectId}`, handlerContext, 'PROJECT', dependencies);
    assert.equal(failed.response.tag.metadata.toolSettlement, 'uncommitted');
    assert.equal(resolves, 0);
    const otherEffect = `effect:${'9'.repeat(64)}`;
    dependencies.toolExecutor.settleM2Effect = async () => fixture.execution;
    const mismatch = await handleExactEffectApproval(`approve effect ${otherEffect}`, handlerContext, 'PROJECT', dependencies);
    assert.equal(mismatch.response.tag.metadata.error, 'TOOL_READ_CONTENT_AUTHORITY_REQUIRED');
    assert.equal(resolves, 0);
  });
});

await testAsync('ToolExecutor forwards read resolution only to installed durable broker', async () => {
  const input = { requestId: 'exact-request', contentRef: 'exact-ref', context: { sessionId: 'exact-session' } };
  const expected = { bytes: Buffer.from('snapshot') }; let captured;
  const executor = new ToolExecutor({ m2ToolBroker: { resolveFileReadContent(value) { captured = value; return expected; } } });
  assert.equal(executor.resolveM2FileReadContent(input), expected);
  assert.equal(captured, input);
  const unavailable = new ToolExecutor({ m2ToolBroker: null });
  assert.throws(() => unavailable.resolveM2FileReadContent(input), error => error.code === 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
});

for (const [name, expectedHeader, knownLanguage] of [
  ['ordinary.custom-extension', '📄 ` ordinary.custom-extension ` (4 lines, <1 KB)', 'text'],
  ['evil.\n```\n<img src=x onerror=alert(1)>', '📄 ```` evil.\\u{a}```\\u{a}<img src=x onerror=alert(1)> ```` (4 lines, <1 KB)', 'text'],
  ['[click](https:evil.invalid)**_![image].md', '📄 ` [click](https:evil.invalid)**_![image].md ` (4 lines, <1 KB)', 'markdown'],
  ['literal`name``.json', '📄 ``` literal`name``.json ``` (4 lines, <1 KB)', 'json'],
  ['bidi\u202e-name.\tunknown', '📄 ` bidi\\u{202e}-name.\\u{9}unknown ` (4 lines, <1 KB)', 'text'],
  ['prototype.__proto__', '📄 ` prototype.__proto__ ` (4 lines, <1 KB)', 'text'],
]) {
  await testAsync(`durable display keeps valid filename literal: ${JSON.stringify(name)}`, async () => {
    await withProject(async ({ projectRoot }) => {
      const bytes = Buffer.from('exact-content\r\n```\nunchanged\n', 'utf8');
      const filePath = `notes/${name}`;
      assert.equal(isM2ProjectRelativePath(filePath), true, name);
      const fixture = storedReadFixture(bytes);
      const output = { ...fixture.output, path: filePath };
      const request = { ...fixture.execution.request, input: { path: filePath } };
      const result = { ...fixture.execution.result, output };
      const execution = { ...fixture.execution, request, result };
      const resolved = { ...fixture.resolved, output, request, result, path: filePath };
      const response = renderM2FileReadResult(execution, context(projectRoot), {
        toolExecutor: { resolveM2FileReadContent: () => resolved },
      });
      assert.equal(response.tag.metadata.fileOperation, true, name);
      assert.equal(response.tag.metadata.filePath, filePath, name);
      assert.equal(response.content.split('\n')[0], expectedHeader, name);
      assert.equal(response.content, `${expectedHeader}\n\n\`\`\`\`${knownLanguage}\n${bytes.toString('utf8')}\n\`\`\`\``, name);
      assert.equal(response.tag.metadata.contentDigest, fixture.output.contentDigest, name);
    });
  });
}

function canonicalReadPreviewFixture(handlerContext) {
  const stable = (prefix, value) => `${prefix}:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
  const payload = createM2FileReadPolicyPayload();
  const effectId = `effect:${'9'.repeat(64)}`;
  const input = { path: 'notes/read.md' };
  const effectBinding = { kind: 'fs.read', target: { type: 'filesystem', relativePath: input.path },
    payloadDigest: stable('sha256', payload), payloadBytes: payload.length,
    requiredCapability: 'project.fs.read', riskClass: 'read' };
  const request = {
    contract: 'ToolRequest', version: 1, requestId: `tool:${'8'.repeat(64)}`,
    runId: stable('run', handlerContext.conversationId),
    actor: { type: 'user', id: handlerContext.authenticatedSubject.actorId },
    origin: { surface: 'studio', sessionId: stable('session', handlerContext.conversationId),
      conversationId: stable('conversation', handlerContext.conversationId), projectId: 17 },
    toolId: 'file.read', toolVersion: 2, riskClass: 'read', authorityMode: 'effect',
    inputSchema: 'intentsmith.tool.file-read.input@1', outputSchema: 'intentsmith.tool.file-read.output@2',
    input, inputDigest: computeM2ToolValueDigest(input), requiredEffectKind: 'fs.read', effectBinding,
    timeoutMs: 30_000, idempotencyKey: `tool-operation:${'7'.repeat(64)}`,
    createdAt: '2026-09-09T20:00:00.000Z',
  };
  const effectRequest = {
    contract: 'EffectRequest', version: 1, effectId, runId: request.runId, parentEffectId: null,
    actor: request.actor, origin: request.origin, kind: 'fs.read',
    target: { type: 'filesystem', canonicalRoot: handlerContext.project.path,
      relativePath: input.path, resolvedRealpath: path.join(handlerContext.project.path, input.path) },
    payloadDigest: effectBinding.payloadDigest, payloadBytes: payload.length,
    workspaceRevision: 'wsr1:preview-fixture', requiredCapability: 'project.fs.read', riskClass: 'read',
    timeoutMs: 120_000, idempotencyKey: stable('operation', request.requestId), approvalGrantId: null,
    createdAt: request.createdAt,
  };
  assert.equal(validateM2ToolRequest(request).valid, true);
  assert.equal(validateEffectRequest(effectRequest).valid, true);
  return { request, effectRequest, effectRequestId: effectId, state: 'approval_required', result: null,
    value: { path: 'FORGED_PREVIEW_PATH', maxBytes: 99_999_999 } };
}

await testAsync('read approval preview describes only the exact canonical file, project and policy ceiling', async () => {
  await withProject(async ({ projectRoot }) => {
    const handlerContext = context(projectRoot, { hasActiveProject: true });
    const pending = canonicalReadPreviewFixture(handlerContext);
    const response = await handleFileDecision('read', readDecision(), handlerContext, {
      toolExecutor: { executeM2Tool: async () => pending },
    });
    assert.equal(response.tag.metadata.approvalRequired, true);
    assert.equal(response.tag.metadata.approvalPreviewVerified, true);
    assert.equal(response.tag.metadata.filePath, 'notes/read.md');
    assert.equal(response.tag.metadata.projectId, 17);
    assert.equal(response.tag.metadata.projectRoot, projectRoot);
    assert.equal(response.tag.metadata.readMaxBytes, 1_048_576);
    assert.equal(response.content, `🔐 Reading file \` notes/read.md \` in project 17 (\` ${projectRoot} \`) awaits approval. At most 1048576 bytes (1 MiB), only this one file. No content was loaded.\n\nTo approve, enter \` approve effect ${pending.effectRequestId} \`.`);
    assert.doesNotMatch(response.content, /FORGED_PREVIEW_PATH|99999999 bytes/);
    assert.equal(existsSync(path.join(projectRoot, 'notes/read.md')), false);
  });
});

await testAsync('read approval preview rejects missing or uncorrelated effect, actor, conversation, project, path and policy', async () => {
  await withProject(async ({ projectRoot }) => {
    const handlerContext = context(projectRoot, { hasActiveProject: true });
    const valid = canonicalReadPreviewFixture(handlerContext);
    const changed = [
      { ...valid, effectRequest: undefined },
      { ...valid, effectRequestId: `effect:${'0'.repeat(64)}` },
      { ...valid, effectRequest: { ...valid.effectRequest, actor: { type: 'user', id: 'other' } } },
      { ...valid, effectRequest: { ...valid.effectRequest, origin: { ...valid.effectRequest.origin, conversationId: `conversation:${'0'.repeat(64)}` } } },
      { ...valid, effectRequest: { ...valid.effectRequest, origin: { ...valid.effectRequest.origin, projectId: 18 } } },
      { ...valid, effectRequest: { ...valid.effectRequest, target: { ...valid.effectRequest.target, relativePath: 'notes/other.md', resolvedRealpath: path.join(projectRoot, 'notes/other.md') } } },
      { ...valid, effectRequest: { ...valid.effectRequest, payloadDigest: `sha256:${'0'.repeat(64)}` } },
      { ...valid, effectRequest: { ...valid.effectRequest, idempotencyKey: 'different-operation' } },
    ];
    for (const execution of changed) {
      const response = await handleFileDecision('read', readDecision(), handlerContext, {
        toolExecutor: { executeM2Tool: async () => execution },
      });
      assert.equal(response.tag.metadata.approvalRequired, false);
      assert.equal(response.tag.metadata.error, 'TOOL_READ_APPROVAL_PREVIEW_INVALID');
      assert.equal(response.tag.metadata.fallbackSuppressed, true);
      assert.doesNotMatch(response.content, /To approve|FORGED_PREVIEW_PATH/);
    }
    for (const changedContext of [
      { ...handlerContext, authenticatedSubject: { actorType: 'user', actorId: 'other' } },
      { ...handlerContext, project: { id: 18, path: projectRoot } },
      { ...handlerContext, conversationId: 'other-conversation' },
    ]) {
      const response = await handleFileDecision('read', readDecision(), changedContext, {
        toolExecutor: { executeM2Tool: async () => valid },
      });
      assert.equal(response.tag.metadata.approvalRequired, false);
      assert.doesNotMatch(response.content, /To approve/);
    }
  });
});

summary();

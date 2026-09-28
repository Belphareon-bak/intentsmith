#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXTENSION_HOST_CAPABILITY,
  canonicalizeExtensionManifestV1,
  createExtensionContextV1,
} from '../contracts/m3/extension-v1.js';
import { createSpecialistProjectContextBridge } from '../src/extensions/specialist-project-context.js';
import { SpecialistRuntime } from '../src/expertises/specialist-runtime.js';
import * as codeReviewer from '../specialists/code-reviewer/index.js';
import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = canonicalizeExtensionManifestV1(JSON.parse(
  fs.readFileSync(path.join(ROOT, 'specialists/code-reviewer/specialist.json'), 'utf8'),
), 'specialist');
const REVISION = `wsr1:${'a'.repeat(64)}`;
const SNAPSHOT = `pcs1:${'b'.repeat(64)}`;

function fakeProvider(calls) {
  return {
    async observeWorkspaceRevision(scope, invocationContext) {
      calls.push({ phase: 'observe', scope, invocationContext });
      return {
        projectId: scope.projectId,
        canonicalRoot: scope.canonicalRoot,
        workspaceRevision: REVISION,
      };
    },
    async queryProjectContext(query, invocationContext) {
      calls.push({ phase: 'query', query, invocationContext });
      return Object.freeze({
        contract: 'ProjectContextSnapshot',
        version: 1,
        requestId: query.requestId,
        projectId: query.projectId,
        status: 'ok',
        outcome: 'found',
        workspaceRevision: query.workspaceRevision,
        snapshotDigest: SNAPSHOT,
        normalizationVersion: 1,
        queryText: query.queryText,
        budgets: {
          maxFiles: query.maxFiles,
          maxBytes: query.maxBytes,
          maxTokens: query.maxTokens,
        },
        usage: { files: 1, bytes: 67, estimatedTokens: 17 },
        items: [Object.freeze({
          path: 'src/auth.js',
          startLine: 20,
          endLine: 20,
          content: 'export function validateSessionToken(input) { return eval(input); }',
          contentDigest: `sha256:${'c'.repeat(64)}`,
          score: 1020,
          provenance: Object.freeze({
            sourceSet: 'ContextFilePolicy@1',
            projectId: query.projectId,
            workspaceRevision: query.workspaceRevision,
            path: 'src/auth.js',
            contentDigest: `sha256:${'c'.repeat(64)}`,
          }),
        })],
        truncated: false,
        truncationReason: null,
      });
    },
  };
}

async function expectCode(promise, code) {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    assertEqual(error.code, code);
  }
}

suite('M3 specialist ProjectContext capability');

await testAsync('opaque invocation is project-bound, bounded and one-shot', async () => {
  const calls = [];
  const bridge = createSpecialistProjectContextBridge({ provider: fakeProvider(calls) });
  const token = bridge.host.openInvocation({
    extensionId: 'code-reviewer',
    toolId: 'code-reviewer.security_scan',
    project: { id: 41, path: '/registered/project-a' },
    conversationId: 'conversation-1',
    userMessageId: 73,
  });
  const result = await bridge.capability.query(token, {
    queryText: 'validateSessionToken security',
    maxFiles: 8,
    maxBytes: 32_768,
    maxTokens: 8_192,
  });
  assertEqual(result.snapshotDigest, SNAPSHOT);
  assertEqual(calls[0].scope.projectId, 41);
  assertEqual(calls[0].scope.canonicalRoot, '/registered/project-a');
  assertEqual(calls[1].query.projectId, 41);
  assertEqual(calls[1].query.canonicalRoot, '/registered/project-a');
  assert(/^spctx:[a-f0-9]{64}$/.test(calls[1].query.requestId));
  await expectCode(
    bridge.capability.query(token, { queryText: 'replay' }),
    'M3_SPECIALIST_PROJECT_CONTEXT_AUTHORITY_REQUIRED',
  );
  await expectCode(
    bridge.capability.query(Object.freeze({}), { queryText: 'forged' }),
    'M3_SPECIALIST_PROJECT_CONTEXT_AUTHORITY_REQUIRED',
  );
});

await testAsync('budget overflow and missing persisted-turn identity fail before provider I/O', async () => {
  const calls = [];
  const bridge = createSpecialistProjectContextBridge({ provider: fakeProvider(calls) });
  await expectCode(Promise.resolve().then(() => bridge.host.openInvocation({
    extensionId: 'code-reviewer',
    toolId: 'code-reviewer.security_scan',
    project: { id: 41, path: '/registered/project-a' },
    conversationId: 'conversation-1',
  })), 'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED');
  const token = bridge.host.openInvocation({
    extensionId: 'code-reviewer',
    toolId: 'code-reviewer.security_scan',
    project: { id: 41, path: '/registered/project-a' },
    conversationId: 'conversation-1',
    userMessageId: 73,
  });
  await expectCode(
    bridge.capability.query(token, { queryText: 'security', maxFiles: 17 }),
    'M3_SPECIALIST_PROJECT_CONTEXT_INVALID',
  );
  assertEqual(calls.length, 0);
});

suite('M3 code-review specialist deterministic journey');

await testAsync('package registration performs project-bound review with exact provenance and no model', async () => {
  const calls = [];
  const bridge = createSpecialistProjectContextBridge({ provider: fakeProvider(calls) });
  const runtime = new SpecialistRuntime();
  runtime.setProjectContextHost(bridge.host);
  const directHandlers = new Map();
  await codeReviewer.register(createExtensionContextV1({
    manifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
      [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: bridge.capability,
      [EXTENSION_HOST_CAPABILITY.TOOL_EXECUTOR_REGISTRY]: {
        register(id, handler) { directHandlers.set(id, handler); },
      },
    },
  }));

  const result = await runtime.tryToolExecution(
    'code_reviewer',
    'Proveď security audit validateSessionToken v tomto projektu',
    {
      sessionId: 'conversation-1',
      conversationId: 'conversation-1',
      userMessageId: 73,
      project: { id: 41, path: '/registered/project-a' },
    },
  );

  assertEqual(result.toolType, 'code-reviewer.security_scan');
  assertEqual(result.evidence.projectId, 41);
  assertEqual(result.evidence.workspaceRevision, REVISION);
  assertEqual(result.evidence.snapshotDigest, SNAPSHOT);
  assertEqual(Object.hasOwn(result.evidence.items[0], 'content'), false);
  assertEqual(result.result.data.vulnerabilities[0].severity, 'critical');
  assertEqual(result.result.data.vulnerabilities[0].path, 'src/auth.js');
  assertEqual(result.result.data.vulnerabilities[0].line, 20);
  assertEqual(result.result.data.vulnerabilities[0].provenance.workspaceRevision, REVISION);
  assert(result.presentation.includes('**CRITICAL** `src/auth.js:20`'));
  assert(result.presentation.includes('Toto je automatizovane code review'));
  assertEqual(result.expertiseEvidence.moduleVersion, '1.1.0');
  assertEqual(calls.length, 2);

  const direct = await directHandlers.get('code-reviewer.security_scan')({ code: 'eval(input)' });
  assertEqual(direct.status, 'error');
  assertEqual(direct.errorCode, 'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED');
});

await testAsync('missing active project fails closed and does not fall through', async () => {
  const calls = [];
  const bridge = createSpecialistProjectContextBridge({ provider: fakeProvider(calls) });
  const runtime = new SpecialistRuntime();
  runtime.setProjectContextHost(bridge.host);
  await codeReviewer.register(createExtensionContextV1({
    manifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
      [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: bridge.capability,
    },
  }));
  const result = await runtime.tryToolExecution(
    'code_reviewer',
    'Proveď security audit validateSessionToken',
    { sessionId: 'conversation-2', conversationId: 'conversation-2', userMessageId: 74 },
  );
  assertEqual(result.status, 'error');
  assertEqual(result.errorCode, 'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED');
  assertEqual(calls.length, 0);
});

const result = summary();
process.exitCode = result.failed > 0 ? 1 : 0;

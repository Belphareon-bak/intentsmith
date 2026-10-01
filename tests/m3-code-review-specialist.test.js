#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  EXTENSION_HOST_CAPABILITY,
  canonicalizeExtensionManifestV1,
  createExtensionContextV1,
} from '../contracts/m3/extension-v1.js';
import { createSpecialistProjectContextBridge } from '../src/extensions/specialist-project-context.js';
import { SpecialistRuntime } from '../src/expertises/specialist-runtime.js';
import {
  observeWorkspaceRevision,
  queryProjectContext,
} from '../src/code-intel/project-context-provider.js';
import { computeProjectContextWorkspaceRevision } from '../src/code-intel/project-context-manifest.js';
import { computeProjectContextSnapshotDigest } from '../contracts/m2/project-context-v1.js';
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

const SOURCE_PATH = 'src/auth/validateSessionToken.js';
const REVIEW_INPUT = 'Security audit validateSessionToken';
const sourceFor = statement => [
  ...Array.from({ length: 19 }, (_, index) => `// Owned source spacer ${index + 1}`),
  'export function validateSessionToken(input) {',
  `  ${statement}`,
  '}',
  '',
].join('\n');
const EVAL_SOURCE = sourceFor('return eval(input);');
const SAFE_SOURCE = sourceFor("return typeof input === 'string' && input.length > 0;");
const contentDigest = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

async function withRealProjects(run, { afterObserve = null } = {}) {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'is-m3-real-context-'));
  try {
    const rows = [];
    for (const [id, name, source] of [[1701, 'project-a', EVAL_SOURCE], [1702, 'project-b', SAFE_SOURCE]]) {
      const root = path.join(temporary, name);
      await fs.promises.mkdir(path.join(root, 'src/auth'), { recursive: true });
      await fs.promises.writeFile(path.join(root, SOURCE_PATH), source);
      rows.push({ id, path: await fs.promises.realpath(root), status: 'active', source });
    }
    const registryCalls = [];
    const readPaths = [];
    const observations = [];
    const snapshots = [];
    const projects = { findById: { get(id) {
      registryCalls.push(id);
      return rows.find(row => row.id === id) ?? null;
    } } };
    // Explicit registry injection keeps the real provider off its lazy default
    // database import. Only reads are observed; actual filesystem bytes and
    // provider snapshots are never replaced with fixture responses.
    const dependencies = { projects, readFile: async (...args) => {
      readPaths.push(String(args[0]));
      return fs.promises.readFile(...args);
    } };
    const provider = {
      async observeWorkspaceRevision(scope, invocationContext) {
        const observation = await observeWorkspaceRevision(scope, invocationContext, dependencies);
        observations.push(observation);
        if (afterObserve) await afterObserve(observation, rows);
        return observation;
      },
      async queryProjectContext(query, invocationContext) {
        const snapshot = await queryProjectContext(query, invocationContext, dependencies);
        snapshots.push(snapshot);
        return snapshot;
      },
    };
    const bridge = createSpecialistProjectContextBridge({ provider });
    const runtime = new SpecialistRuntime();
    runtime.setProjectContextHost(bridge.host);
    await codeReviewer.register(createExtensionContextV1({
      manifest,
      hostCapabilities: {
        [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
        [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: bridge.capability,
      },
    }));
    const review = (project, userMessageId = 73) => runtime.tryToolExecution(
      'code_reviewer', REVIEW_INPUT,
      // These are controlled invocation identities, not persisted CHAT proof.
      { sessionId: 'real-context-fixture', conversationId: 'real-context-fixture', userMessageId, project },
    );
    await run({ rows, review, registryCalls, readPaths, observations, snapshots });
  } finally {
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
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

suite('M3 specialist with real owned ProjectContext files — no CHAT or model');

await testAsync('real file bytes produce exact finding line and stable revision/content/snapshot provenance', async () => {
  await withRealProjects(async ({ rows, review, readPaths, observations, snapshots }) => {
    const first = await review(rows[0]);
    const repeat = await review(rows[0], 74);
    const disk = await fs.promises.readFile(path.join(rows[0].path, SOURCE_PATH), 'utf8');
    assertEqual(disk, EVAL_SOURCE);
    assertEqual(first.toolType, 'code-reviewer.security_scan');
    const finding = first.result.data.vulnerabilities[0];
    assertEqual(first.result.data.vulnerabilities.length, 1);
    assertEqual(finding.severity, 'critical');
    assertEqual(finding.path, SOURCE_PATH);
    assertEqual(finding.line, 21);
    assertEqual(finding.provenance.projectId, rows[0].id);
    const expectedContent = contentDigest(disk);
    const expectedRevision = computeProjectContextWorkspaceRevision(rows[0].id, [{
      path: SOURCE_PATH, kind: 'regular@1', size: Buffer.byteLength(disk), contentDigest: expectedContent,
    }]);
    assertEqual(first.evidence.workspaceRevision, expectedRevision);
    assertEqual(finding.provenance.workspaceRevision, expectedRevision);
    assertEqual(finding.provenance.contentDigest, expectedContent);
    assertEqual(first.evidence.items[0].contentDigest, expectedContent);
    assertEqual(snapshots[0].items[0].startLine, 15, 'finding line must translate the real retrieved snippet offset');
    assert(snapshots[0].items[0].content.includes('return eval(input);'));
    assertEqual(first.evidence.snapshotDigest, computeProjectContextSnapshotDigest(snapshots[0]));
    assertEqual(repeat.evidence.snapshotDigest, first.evidence.snapshotDigest);
    assertEqual(repeat.evidence.workspaceRevision, first.evidence.workspaceRevision);
    assert(snapshots[0].requestId !== snapshots[1].requestId, 'different invocation IDs do not change content identity');
    assertEqual(observations.length, 2);
    assert(readPaths.filter(candidate => candidate === path.join(rows[0].path, SOURCE_PATH)).length >= 2);
    assert(first.presentation.includes(`**CRITICAL** \`${SOURCE_PATH}:21\``));
    assert(first.presentation.includes('Toto je automatizovane code review'));
    assertEqual(first.expertiseEvidence.moduleVersion, '1.1.0');
  });
});

await testAsync('same runtime retrieves safe second project without first-project source or findings', async () => {
  await withRealProjects(async ({ rows, review, registryCalls, readPaths, snapshots }) => {
    const first = await review(rows[0]);
    const second = await review(rows[1], 74);
    assertEqual(second.toolType, 'code-reviewer.security_scan');
    assertEqual(second.result.data.vulnerabilities.length, 0);
    assertEqual(second.evidence.projectId, rows[1].id);
    assertEqual(second.evidence.items[0].path, SOURCE_PATH);
    assertEqual(second.evidence.items[0].contentDigest, contentDigest(SAFE_SOURCE));
    assertEqual(snapshots[1].items[0].provenance.projectId, rows[1].id);
    assertEqual(snapshots[1].items[0].provenance.workspaceRevision, second.evidence.workspaceRevision);
    assert(!snapshots[1].items[0].content.includes('eval(input)'));
    assert(!second.presentation.includes('**CRITICAL**'));
    assert(second.evidence.workspaceRevision !== first.evidence.workspaceRevision);
    assert(second.evidence.snapshotDigest !== first.evidence.snapshotDigest);
    assert(registryCalls.includes(rows[0].id) && registryCalls.includes(rows[1].id));
    assert(readPaths.includes(path.join(rows[1].path, SOURCE_PATH)));
  });
});

await testAsync('actual file mutation after observation returns STALE instead of a stale finding', async () => {
  await withRealProjects(async ({ rows, review, snapshots, observations }) => {
    const result = await review(rows[0]);
    assertEqual(result.status, 'error');
    assertEqual(result.errorCode, 'PROJECT_CONTEXT_STALE');
    assertEqual(Object.hasOwn(result, 'result'), false);
    assertEqual(Object.hasOwn(result, 'presentation'), false);
    assertEqual(snapshots[0].status, 'error');
    assertEqual(snapshots[0].error.expectedRevision, observations[0].workspaceRevision);
    assert(snapshots[0].error.observedRevision !== observations[0].workspaceRevision);
    assertEqual(Object.hasOwn(snapshots[0], 'items'), false);
    assertEqual(Object.hasOwn(snapshots[0], 'snapshotDigest'), false);
  }, { afterObserve: async (_observation, rows) => {
    await fs.promises.writeFile(path.join(rows[0].path, SOURCE_PATH), SAFE_SOURCE);
  } });
});

await testAsync('first project ID with second project root fails before source retrieval', async () => {
  await withRealProjects(async ({ rows, review, registryCalls, readPaths, snapshots }) => {
    const result = await review({ id: rows[0].id, path: rows[1].path });
    assertEqual(result.status, 'error');
    assertEqual(result.errorCode, 'PROJECT_CONTEXT_INVALID_SCOPE');
    assertEqual(Object.hasOwn(result, 'result'), false);
    assertEqual(Object.hasOwn(result, 'presentation'), false);
    assertEqual(registryCalls.length, 1);
    assertEqual(registryCalls[0], rows[0].id);
    assertEqual(readPaths.length, 0);
    assertEqual(snapshots.length, 0);
  });
});

const result = summary();
process.exitCode = result.failed > 0 ? 1 : 0;

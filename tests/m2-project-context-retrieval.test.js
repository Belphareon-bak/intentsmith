#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { suite, testAsync, summary } from './harness.js';
import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_ERROR_CODE,
  PROJECT_CONTEXT_KIND,
} from '../contracts/m2/project-context-v1.js';
import {
  observeWorkspaceRevision,
  projectContextProvider,
  queryProjectContext,
} from '../src/code-intel/project-context-provider.js';
import { AbortSource, abortWithReason } from '../src/core/abort-error.js';

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/m2-project-context/', import.meta.url),
);
const projectAFixture = path.join(fixtureRoot, 'project-a');
const projectBFixture = path.join(fixtureRoot, 'project-b');
const oracle = JSON.parse(
  await readFile(path.join(fixtureRoot, 'oracle.json'), 'utf8'),
);

function projectRegistry(rows, calls = []) {
  return {
    findById: {
      get(projectId) {
        calls.push(projectId);
        return rows.find(row => row.id === projectId) ?? null;
      },
    },
  };
}

function queryFor(observation, overrides = {}) {
  return {
    contract: PROJECT_CONTEXT_KIND.QUERY,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: 'm2-project-context-request',
    projectId: observation.projectId,
    canonicalRoot: observation.canonicalRoot,
    workspaceRevision: observation.workspaceRevision,
    queryText: 'validateSessionToken',
    maxFiles: 8,
    maxBytes: 32_768,
    maxTokens: 8_192,
    ...overrides,
  };
}

function withoutRequestIdentity(snapshot) {
  const clone = structuredClone(snapshot);
  delete clone.requestId;
  return clone;
}

function assertErrorSnapshot(snapshot, status, code) {
  assert.equal(snapshot.status, status);
  assert.equal(snapshot.error.code, code);
  assert.equal(Object.hasOwn(snapshot, 'outcome'), false);
  assert.equal(Object.hasOwn(snapshot, 'items'), false);
  assert.equal(Object.hasOwn(snapshot, 'snapshotDigest'), false);
}

function assertNoForbiddenCanary(snapshot) {
  const serialized = JSON.stringify(snapshot);
  for (const fragment of oracle.forbiddenPathFragments) {
    assert.equal(
      snapshot.items.some(item => item.path.includes(fragment)),
      false,
      `forbidden path fragment leaked: ${fragment}`,
    );
  }
  for (const canary of oracle.forbiddenContent) {
    assert.equal(serialized.includes(canary), false, `forbidden content leaked: ${canary}`);
  }
}

async function observe(projectId, root, projects, invocationContext = {}, dependencies = {}) {
  return observeWorkspaceRevision(
    { projectId, canonicalRoot: root },
    invocationContext,
    { projects, ...dependencies },
  );
}

async function withCopiedProject(callback) {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'is-m2-context-retrieval-'));
  const root = path.join(temporaryParent, 'project-a');
  try {
    await cp(projectAFixture, root, { recursive: true });
    await callback(await realpath(root));
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

const projectARoot = await realpath(projectAFixture);
const projectBRoot = await realpath(projectBFixture);

suite('M2 project-context retrieval — observation and deterministic outcomes');

await testAsync('the public observation seam returns the registry-bound content revision', async () => {
  const calls = [];
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ], calls);

  const observation = await observe(1701, projectARoot, projects);

  assert.equal(projectContextProvider.observeWorkspaceRevision, observeWorkspaceRevision);
  assert.equal(projectContextProvider.queryProjectContext, queryProjectContext);
  assert.deepEqual(calls, [1701]);
  assert.equal(observation.projectId, 1701);
  assert.equal(observation.canonicalRoot, projectARoot);
  assert.match(observation.workspaceRevision, /^wsr1:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(observation), true);
});

await testAsync('semantically equal queries produce identical ordered snapshots and digest', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const observation = await observe(1701, projectARoot, projects);

  const first = await queryProjectContext(
    queryFor(observation, {
      requestId: 'deterministic-first',
      queryText: '  validateSessionToken  ',
    }),
    {},
    { projects },
  );
  const second = await queryProjectContext(
    queryFor(observation, {
      requestId: 'deterministic-second',
      queryText: '\u00a0VALIDATESESSIONTOKEN\u2003',
    }),
    {},
    { projects },
  );

  assert.equal(first.status, 'ok');
  assert.equal(first.outcome, 'found');
  assert.equal(first.snapshotDigest, second.snapshotDigest);
  assert.deepEqual(withoutRequestIdentity(first), withoutRequestIdentity(second));
  assert.deepEqual(first.items.map(item => item.path), second.items.map(item => item.path));
  assertNoForbiddenCanary(first);
});

await testAsync('committed quality oracle passes all three queries with exact tie order', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const observation = await observe(1701, projectARoot, projects);

  for (const oracleQuery of oracle.queries) {
    const snapshot = await queryProjectContext(
      queryFor(observation, {
        requestId: `oracle-${oracleQuery.id}`,
        queryText: oracleQuery.queryText,
      }),
      {},
      { projects },
    );

    assert.equal(snapshot.status, 'ok', oracleQuery.id);
    assert.equal(snapshot.outcome, 'found', oracleQuery.id);
    const topK = snapshot.items.slice(0, oracleQuery.topK);
    for (const required of oracleQuery.mustIncludeInTopK) {
      const position = topK.findIndex(item => item.path === required.path) + 1;
      assert.notEqual(position, 0, `${oracleQuery.id}: missing ${required.path}`);
      assert.ok(
        position <= required.maxPosition,
        `${oracleQuery.id}: ${required.path} at ${position}, max ${required.maxPosition}`,
      );
      const item = topK[position - 1];
      assert.ok(
        item.endLine - item.startLine + 1 >= required.minLineSpan,
        `${oracleQuery.id}: useful line span below ${required.minLineSpan}`,
      );
      assert.ok(
        item.content.includes(required.contentCanary),
        `${oracleQuery.id}: missing useful content canary`,
      );
      assert.equal(item.provenance.projectId, 1701);
      assert.equal(item.provenance.workspaceRevision, observation.workspaceRevision);
      assert.equal(item.provenance.path, item.path);
      assert.equal(item.provenance.contentDigest, item.contentDigest);
    }
    if (oracleQuery.expectedOrder) {
      assert.deepEqual(
        topK.map(item => item.path),
        oracleQuery.expectedOrder,
        `${oracleQuery.id}: bytewise tie order changed`,
      );
    }
    assertNoForbiddenCanary(snapshot);
  }
});

await testAsync('stable no-match is empty but a first matching item over budget fails closed', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const observation = await observe(1701, projectARoot, projects);

  const empty = await queryProjectContext(
    queryFor(observation, {
      requestId: 'legitimate-empty',
      queryText: 'termThatDoesNotExistInEitherFixture',
    }),
    {},
    { projects },
  );
  assert.equal(empty.status, 'ok');
  assert.equal(empty.outcome, 'empty');
  assert.deepEqual(empty.items, []);
  assert.equal(empty.budget.usedBytes, 0);
  assert.equal(empty.truncation.truncated, false);

  for (const budget of [
    { maxBytes: 1, maxTokens: 8_192 },
    { maxBytes: 32_768, maxTokens: 1 },
  ]) {
    const exhausted = await queryProjectContext(
      queryFor(observation, {
        requestId: `budget-${budget.maxBytes}-${budget.maxTokens}`,
        ...budget,
      }),
      {},
      { projects },
    );
    assertErrorSnapshot(
      exhausted,
      'error',
      PROJECT_CONTEXT_ERROR_CODE.BUDGET_EXHAUSTED,
    );
  }
});

suite('M2 project-context retrieval — project containment and stale snapshots');

await testAsync('concurrent A/B queries stay isolated and an A-ID/B-root mismatch fails closed', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
    { id: 1702, path: projectBRoot, status: 'active' },
  ]);
  const [observationA, observationB] = await Promise.all([
    observe(1701, projectARoot, projects),
    observe(1702, projectBRoot, projects),
  ]);

  const [snapshotA, snapshotB] = await Promise.all([
    queryProjectContext(queryFor(observationA, { requestId: 'concurrent-a' }), {}, { projects }),
    queryProjectContext(queryFor(observationB, { requestId: 'concurrent-b' }), {}, { projects }),
  ]);

  assert.equal(snapshotA.status, 'ok');
  assert.equal(snapshotA.outcome, 'found');
  assertNoForbiddenCanary(snapshotA);
  assert.equal(snapshotB.status, 'ok');
  assert.equal(snapshotB.outcome, 'found');
  assert.ok(snapshotB.items.some(item => item.content.includes('PROJECT_B_CANARY_DO_NOT_LEAK')));
  assert.ok(snapshotB.items.every(item => item.provenance.projectId === 1702));

  const mismatched = await queryProjectContext(
    queryFor(observationA, {
      requestId: 'scope-mismatch',
      canonicalRoot: projectBRoot,
    }),
    {},
    { projects },
  );
  assertErrorSnapshot(mismatched, 'error', PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE);
});

await testAsync('content changed after retrieval starts yields exact stale revision without items', async () => {
  await withCopiedProject(async root => {
    const projects = projectRegistry([{ id: 1701, path: root, status: 'active' }]);
    const observation = await observe(1701, root, projects);
    let changed = false;
    const injectedReadFile = async (absolutePath, options) => {
      const bytes = await readFile(absolutePath, options);
      if (!changed && absolutePath.endsWith('validateSessionToken.js')) {
        changed = true;
        await writeFile(absolutePath, `${bytes.toString('utf8')}\n// mid-build change\n`);
      }
      return bytes;
    };

    const snapshot = await queryProjectContext(
      queryFor(observation, { requestId: 'stale-content-change' }),
      {},
      { projects, readFile: injectedReadFile },
    );
    const after = await observe(1701, root, projects);

    assert.equal(changed, true);
    assertErrorSnapshot(snapshot, 'error', PROJECT_CONTEXT_ERROR_CODE.STALE);
    assert.equal(snapshot.error.expectedRevision, observation.workspaceRevision);
    assert.equal(snapshot.error.observedRevision, after.workspaceRevision);
    assert.notEqual(snapshot.error.expectedRevision, snapshot.error.observedRevision);
  });
});

await testAsync('file deleted after it is read yields exact stale revision without items', async () => {
  await withCopiedProject(async root => {
    const projects = projectRegistry([{ id: 1701, path: root, status: 'active' }]);
    const observation = await observe(1701, root, projects);
    let deleted = false;
    const injectedReadFile = async (absolutePath, options) => {
      const bytes = await readFile(absolutePath, options);
      if (!deleted && absolutePath.endsWith('validateSessionToken.js')) {
        deleted = true;
        await unlink(absolutePath);
      }
      return bytes;
    };

    const snapshot = await queryProjectContext(
      queryFor(observation, { requestId: 'stale-deletion' }),
      {},
      { projects, readFile: injectedReadFile },
    );
    const after = await observe(1701, root, projects);

    assert.equal(deleted, true);
    assertErrorSnapshot(snapshot, 'error', PROJECT_CONTEXT_ERROR_CODE.STALE);
    assert.equal(snapshot.error.expectedRevision, observation.workspaceRevision);
    assert.equal(snapshot.error.observedRevision, after.workspaceRevision);
    assert.notEqual(snapshot.error.expectedRevision, snapshot.error.observedRevision);
  });
});

suite('M2 project-context retrieval — cancellation and deadlines');

await testAsync('pre-cancel and elapsed deadline produce distinct terminal snapshots', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const observation = await observe(1701, projectARoot, projects);
  const controller = new AbortController();
  abortWithReason(controller, AbortSource.USER, 'cancel retrieval fixture');

  const cancelled = await queryProjectContext(
    queryFor(observation, { requestId: 'pre-cancelled' }),
    { signal: controller.signal },
    { projects },
  );
  assertErrorSnapshot(cancelled, 'cancelled', PROJECT_CONTEXT_ERROR_CODE.CANCELLED);

  const timeout = await queryProjectContext(
    queryFor(observation, { requestId: 'deadline-elapsed' }),
    { deadlineAt: 10 },
    { projects, now: () => 10 },
  );
  assertErrorSnapshot(timeout, 'timeout', PROJECT_CONTEXT_ERROR_CODE.TIMEOUT);
});

await testAsync('abort after an awaited file read cannot be overwritten by late ok', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const observation = await observe(1701, projectARoot, projects);
  const controller = new AbortController();
  let abortedDuringRead = false;
  const injectedReadFile = async (absolutePath, options) => {
    const bytes = await readFile(absolutePath, options);
    if (!abortedDuringRead) {
      abortedDuringRead = true;
      abortWithReason(controller, AbortSource.USER, 'cancel after file read');
    }
    return bytes;
  };

  const snapshot = await queryProjectContext(
    queryFor(observation, { requestId: 'late-read-cancel' }),
    { signal: controller.signal },
    { projects, readFile: injectedReadFile },
  );

  assert.equal(abortedDuringRead, true);
  assertErrorSnapshot(snapshot, 'cancelled', PROJECT_CONTEXT_ERROR_CODE.CANCELLED);
});

summary();

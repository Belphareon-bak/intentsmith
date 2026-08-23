#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { suite, testAsync, summary } from './harness.js';
import { PROJECT_CONTEXT_ERROR_CODE } from '../contracts/m2/project-context-v1.js';
import {
  ProjectContextScopeError,
  resolveProjectContextScope,
} from '../src/code-intel/project-context-scope.js';

function registry(rows, calls) {
  return {
    findById: {
      get(projectId) {
        calls.push({ method: 'findById', projectId });
        return rows.find(row => row.id === projectId) ?? null;
      },
    },
    findByPath: {
      get() {
        calls.push({ method: 'findByPath' });
        throw new Error('path authority must not be consulted');
      },
    },
  };
}

async function expectInvalidScope(promise, reason) {
  await assert.rejects(
    promise,
    error => error instanceof ProjectContextScopeError
      && error.code === PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE
      && error.reason === reason,
  );
}

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'is-m2-project-scope-'));
const projectA = path.join(fixtureRoot, 'project-a');
const projectB = path.join(fixtureRoot, 'project-b');
const aliasA = path.join(fixtureRoot, 'alias-a');
await Promise.all([
  mkdir(projectA),
  mkdir(projectB),
]);
await symlink(projectA, aliasA, 'dir');

try {
  suite('M2 project-context boundary — registry-backed path authority');

  await testAsync('active numeric project ID resolves to its exact real root', async () => {
    const calls = [];
    const projects = registry([
      { id: 17, path: projectA, status: 'active' },
    ], calls);

    const scope = await resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: await realpath(projectA),
    }, { projects });

    assert.deepEqual(scope, { projectId: 17, canonicalRoot: await realpath(projectA) });
    assert.deepEqual(calls, [{ method: 'findById', projectId: 17 }]);
    assert.equal(Object.isFrozen(scope), true);
  });

  await testAsync('registry path may be an alias but caller must provide its realpath', async () => {
    const calls = [];
    const projects = registry([
      { id: 17, path: aliasA, status: 'active' },
    ], calls);

    const scope = await resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: projectA,
    }, { projects });

    assert.equal(scope.canonicalRoot, projectA);
    assert.deepEqual(calls, [{ method: 'findById', projectId: 17 }]);
  });

  await testAsync('project A ID plus project B root fails without path fallback', async () => {
    const calls = [];
    const projects = registry([
      { id: 17, path: projectA, status: 'active' },
      { id: 18, path: projectB, status: 'active' },
    ], calls);

    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: projectB,
    }, { projects }), 'root-mismatch');

    assert.deepEqual(calls, [{ method: 'findById', projectId: 17 }]);
  });

  await testAsync('caller symlink alias is rejected even when it targets project A', async () => {
    const calls = [];
    const projects = registry([
      { id: 17, path: projectA, status: 'active' },
    ], calls);

    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: aliasA,
    }, { projects }), 'root-mismatch');
    assert.deepEqual(calls, [{ method: 'findById', projectId: 17 }]);
  });

  await testAsync('unknown, archived, deleted and incomplete projects fail closed', async () => {
    const projects = registry([
      { id: 18, path: projectA, status: 'archived' },
      { id: 19, path: projectA, status: 'deleted' },
      { id: 20, path: projectA },
    ], []);

    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: projectA,
    }, { projects }), 'project-not-found');
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 18,
      canonicalRoot: projectA,
    }, { projects }), 'project-not-active');
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 19,
      canonicalRoot: projectA,
    }, { projects }), 'project-not-active');
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 20,
      canonicalRoot: projectA,
    }, { projects }), 'project-not-active');
  });

  await testAsync('string IDs, dot segments and registry row mismatch fail closed', async () => {
    const projects = registry([{ id: 18, path: projectA, status: 'active' }], []);
    await expectInvalidScope(resolveProjectContextScope({
      projectId: '17',
      canonicalRoot: projectA,
    }, { projects }), 'invalid-project-id');
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: `${projectA}/../project-a`,
    }, { projects }), 'noncanonical-root');

    const corruptRegistry = {
      findById: { get: () => ({ id: 18, path: projectA, status: 'active' }) },
    };
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: projectA,
    }, { projects: corruptRegistry }), 'project-not-found');
  });

  await testAsync('missing dependency is configuration failure, not invalid scope', async () => {
    await assert.rejects(
      resolveProjectContextScope({ projectId: 17, canonicalRoot: projectA }),
      /projects\.findById\.get-required/,
    );
  });
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

summary();

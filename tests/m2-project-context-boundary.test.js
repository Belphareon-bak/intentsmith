#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { suite, testAsync, summary } from './harness.js';
import { PROJECT_CONTEXT_ERROR_CODE } from '../contracts/m2/project-context-v1.js';
import {
  ProjectContextScopeError,
  resolveProjectContextScope,
} from '../src/code-intel/project-context-scope.js';
import {
  PROJECT_CONTEXT_FILE_POLICY,
  ProjectContextManifestError,
  buildProjectContextManifest,
  computeProjectContextWorkspaceRevision,
} from '../src/code-intel/project-context-manifest.js';
import { AbortSource, abortWithReason } from '../src/core/abort-error.js';

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

async function expectManifestError(promise, code, reason) {
  await assert.rejects(
    promise,
    error => error instanceof ProjectContextManifestError
      && error.code === code
      && error.reason === reason,
  );
}

async function withManifestProject(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'is-m2-project-manifest-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    await expectInvalidScope(resolveProjectContextScope({
      projectId: 17,
      canonicalRoot: `${projectA}/`,
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

  suite('M2 project-context boundary — content-addressed workspace revision');

  await testAsync('manifest is bytewise ordered and independent of mtime and ignored trees', async () => {
    await withManifestProject(async root => {
      await mkdir(path.join(root, 'src'));
      await mkdir(path.join(root, 'node_modules'));
      await writeFile(path.join(root, 'z.js'), 'export const z = 1;\n');
      await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
      await writeFile(path.join(root, 'node_modules', 'decoy.js'), 'foreign noise\n');
      await writeFile(path.join(root, 'asset.png'), Buffer.from([1, 2, 3]));

      const scope = { projectId: 17, canonicalRoot: await realpath(root) };
      const first = await buildProjectContextManifest(scope);
      await utimes(path.join(root, 'z.js'), new Date(1_000), new Date(2_000));
      await writeFile(path.join(root, 'node_modules', 'decoy.js'), 'changed noise\n');
      const second = await buildProjectContextManifest(scope);

      assert.equal(first.revision, second.revision);
      assert.deepEqual(first.entries.map(entry => entry.path), ['src/a.js', 'z.js']);
      assert.equal(first.stats.observableEntries, 2);
      assert.equal(first.filePolicy, 'ContextFilePolicy@1');
    });
  });

  await testAsync('dirty same-size content and project identity both change revision', async () => {
    await withManifestProject(async root => {
      const file = path.join(root, 'index.js');
      await writeFile(file, 'alpha\n');
      const scope = { projectId: 17, canonicalRoot: await realpath(root) };
      const before = await buildProjectContextManifest(scope);
      await writeFile(file, 'ALPHA\n');
      const after = await buildProjectContextManifest(scope);

      assert.notEqual(before.revision, after.revision);
      assert.notEqual(before.entries[0].contentDigest, after.entries[0].contentDigest);
      assert.notEqual(
        computeProjectContextWorkspaceRevision(18, after.entries),
        after.revision,
      );
    });
  });

  await testAsync('binary, oversize and internal symlink use deterministic sentinels', async () => {
    await withManifestProject(async root => {
      await writeFile(path.join(root, 'text.js'), 'export const safe = true;\n');
      await writeFile(path.join(root, 'binary.js'), Buffer.from([0x61, 0, 0x62]));
      await writeFile(
        path.join(root, 'oversize.js'),
        Buffer.alloc(PROJECT_CONTEXT_FILE_POLICY.maxRegularFileBytes + 1, 0x61),
      );
      await symlink(path.join(root, 'text.js'), path.join(root, 'alias.js'));

      const manifest = await buildProjectContextManifest({
        projectId: 17,
        canonicalRoot: await realpath(root),
      });
      const byPath = Object.fromEntries(manifest.entries.map(entry => [entry.path, entry]));

      assert.equal(byPath['alias.js'].kind, 'symlink-excluded@1');
      assert.equal(byPath['alias.js'].sentinel, 'text.js');
      assert.equal(byPath['binary.js'].kind, 'binary@1');
      assert.equal(byPath['oversize.js'].kind, 'oversize@1');
      assert.equal(Object.hasOwn(byPath['binary.js'], 'contentDigest'), false);
      assert.equal(Object.hasOwn(byPath['oversize.js'], 'contentDigest'), false);
    });
  });

  await testAsync('symlink outside the registered root fails before producing a revision', async () => {
    await withManifestProject(async root => {
      const outside = await mkdtemp(path.join(os.tmpdir(), 'is-m2-project-outside-'));
      try {
        await writeFile(path.join(outside, 'canary.js'), 'PROJECT_B_CANARY\n');
        await symlink(path.join(outside, 'canary.js'), path.join(root, 'foreign.js'));
        await expectManifestError(buildProjectContextManifest({
          projectId: 17,
          canonicalRoot: await realpath(root),
        }), PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'symlink-outside-root');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  await testAsync('ignored and non-allowlisted symlinks are skipped before target resolution', async () => {
    await withManifestProject(async root => {
      const outside = await mkdtemp(path.join(os.tmpdir(), 'is-m2-project-ignored-outside-'));
      try {
        await writeFile(path.join(root, 'index.js'), 'export const visible = true;\n');
        await writeFile(path.join(outside, 'canary.bin'), 'PROJECT_B_CANARY\n');
        await symlink(outside, path.join(root, 'node_modules'), 'dir');
        await symlink(
          path.join(outside, 'canary.bin'),
          path.join(root, 'foreign.bin'),
        );

        const manifest = await buildProjectContextManifest({
          projectId: 17,
          canonicalRoot: await realpath(root),
        });
        assert.deepEqual(manifest.entries.map(entry => entry.path), ['index.js']);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  await testAsync('dangling allowlisted symlink fails closed instead of yielding a revision', async () => {
    await withManifestProject(async root => {
      await symlink(path.join(root, 'missing.js'), path.join(root, 'dangling.js'));
      await expectManifestError(buildProjectContextManifest({
        projectId: 17,
        canonicalRoot: await realpath(root),
      }), PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'symlink-unresolvable');
    });
  });

  await testAsync('a hardlink cannot import bytes from an inode also named outside the project', async () => {
    await withManifestProject(async root => {
      const outside = await mkdtemp(path.join(os.tmpdir(), 'is-m2-project-hardlink-outside-'));
      try {
        const canary = path.join(outside, 'foreign.js');
        await writeFile(canary, 'PROJECT_B_HARDLINK_CANARY\n');
        await link(canary, path.join(root, 'foreign.js'));
        await expectManifestError(buildProjectContextManifest({
          projectId: 17,
          canonicalRoot: await realpath(root),
        }), PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'hardlink-not-authorized');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  await testAsync('pre-cancel, deadline and fixed entry ceiling have distinct errors', async () => {
    await withManifestProject(async root => {
      const scope = { projectId: 17, canonicalRoot: await realpath(root) };
      const controller = new AbortController();
      abortWithReason(controller, AbortSource.USER, 'fixture cancel');
      await expectManifestError(
        buildProjectContextManifest(scope, { signal: controller.signal }),
        PROJECT_CONTEXT_ERROR_CODE.CANCELLED,
        'caller-aborted',
      );
      await expectManifestError(
        buildProjectContextManifest(scope, { deadlineAt: 10 }, { now: () => 10 }),
        PROJECT_CONTEXT_ERROR_CODE.TIMEOUT,
        'deadline-elapsed',
      );

      const rootInfo = await lstat(root);
      const fakeFileInfo = {
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      };
      const fakeEntries = Array.from(
        { length: PROJECT_CONTEXT_FILE_POLICY.maxScannedEntries + 1 },
        (_, index) => ({ name: `ignored-${String(index).padStart(5, '0')}.bin` }),
      );
      await expectManifestError(buildProjectContextManifest(scope, {}, {
        lstat: async target => target === root ? rootInfo : fakeFileInfo,
        readdir: async () => fakeEntries,
      }), PROJECT_CONTEXT_ERROR_CODE.SCAN_LIMIT, 'entry-count-exceeded');
    });
  });
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

summary();

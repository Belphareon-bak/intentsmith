#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { validateProjectContextSnapshot } from '../contracts/m2/project-context-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  createM7CoreCursorCodec,
  computeM7CoreCursorFilterDigest,
  M7_CORE_CURSOR_ERROR,
} from '../src/remote/m7-core-cursor.js';
import {
  createM7InProcessCapabilityProvider,
} from '../src/remote/m7-in-process-capability-provider.js';
import {
  createM7ProjectCoreAdapters,
} from '../src/remote/m7-project-core-adapters.js';
import {
  observeWorkspaceRevision,
} from '../src/code-intel/project-context-provider.js';
import { suite, summary, test, testAsync } from './harness.js';

const CURSOR_KEY = Buffer.alloc(32, 0x5a);
const externalValidators = Object.freeze({
  'ProjectContextSnapshot@1': validateProjectContextSnapshot,
});

function projectListRequest(overrides = {}) {
  return {
    contract: 'ProjectListQuery',
    version: 1,
    requestId: 'request:project:list:001',
    limit: 1,
    ...overrides,
  };
}

function contextRequest(projectId, workspaceRevision, overrides = {}) {
  return {
    contract: 'RemoteProjectContextQuery',
    version: 1,
    requestId: 'request:project:context:001',
    projectId,
    workspaceRevision,
    queryText: 'find request authority',
    maxFiles: 8,
    maxBytes: 8_192,
    maxTokens: 2_048,
    ...overrides,
  };
}

function trusted(overrides = {}) {
  return {
    deviceId: 'device:project:001',
    subjectId: 'user:project:001',
    ...overrides,
  };
}

function setup({ authorizeProject = async () => true, maxProjectScan = 200 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-project-core-'));
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      last_active TEXT NOT NULL
    );
    CREATE TABLE project_lifecycles (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      phase TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  for (const [id, name] of [[1, 'Alpha project'], [2, 'Beta project']]) {
    const projectRoot = path.join(root, `project-${id}`);
    mkdirSync(projectRoot);
    writeFileSync(
      path.join(projectRoot, id === 1 ? 'authority.js' : 'notes.md'),
      id === 1 ? 'export const requestAuthority = true;\n' : '# Beta\n',
      'utf8',
    );
    db.prepare(`
      INSERT INTO projects (id, name, path, status, last_active)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, name, projectRoot, `2026-08-29 02:00:0${id}`);
  }
  db.prepare(`
    INSERT INTO project_lifecycles (id, project_id, phase, updated_at)
    VALUES ('lifecycle:beta', 2, 'SPEC', '2026-08-29 02:00:03')
  `).run();
  const adapters = createM7ProjectCoreAdapters({
    authorizeProject,
    cursorKey: CURSOR_KEY,
    database: db,
    maxProjectScan,
  });
  const close = () => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { adapters, db, root, close };
}

function providerFor(adapters, authority = trusted()) {
  return createM7InProcessCapabilityProvider({
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    validatePayload: validateMobileRemotePayload,
    validateOperationPair: validateMobileRemoteOperationPair,
    externalValidators,
    handlers: adapters.handlers,
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: authority.deviceId,
      subjectId: authority.subjectId,
      grantedScopes: [...input.requiredScopes],
    }),
  });
}

function invoke(provider, operationId, request) {
  return provider.invoke({
    capabilityId: 'projects',
    capabilityVersion: 2,
    operationId,
    request,
  });
}

suite('M7 project core adapters');

await testAsync('real SQLite projects and M2 files flow through the transport-free provider', async () => {
  const fixture = setup();
  try {
    const provider = providerFor(fixture.adapters);
    const advertisement = provider.advertise();
    assert.equal(advertisement.find(item => item.capabilityId === 'projects').status, 'available');
    assert.equal(advertisement.filter(item => item.status === 'available').length, 1);

    const page = await invoke(provider, 'project.list', projectListRequest({ limit: 2 }));
    assert.equal(page.status, 'ok');
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].projectId, 1);
    assert.equal(page.items[1].lifecycleStage, 'spec');
    assert.equal(validateMobileRemotePayload('ProjectPage@1', page).valid, true);

    const request = contextRequest(1, page.items[0].workspaceRevision);
    const snapshot = await invoke(provider, 'project-context.query', request);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.outcome, 'found');
    assert.equal(snapshot.items[0].path, 'authority.js');
    assert.equal(snapshot.items[0].content.includes('requestAuthority'), true);
    assert.equal(validateProjectContextSnapshot(snapshot).valid, true);
    assert.equal(JSON.stringify(snapshot).includes(fixture.root), false);
    assert.equal(Object.isFrozen(snapshot), true);
  } finally {
    fixture.close();
  }
});

await testAsync('cursor is bound to device, subject, filters and the complete snapshot', async () => {
  const fixture = setup();
  try {
    const first = await fixture.adapters.listProjects(projectListRequest(), trusted());
    assert.equal(first.status, 'ok');
    assert.equal(first.end, false);
    assert.equal(typeof first.nextCursor, 'string');

    const second = await fixture.adapters.listProjects(projectListRequest({
      requestId: 'request:project:list:002',
      cursor: first.nextCursor,
    }), trusted());
    assert.equal(second.status, 'ok');
    assert.deepEqual(second.items.map(item => item.projectId), [2]);
    assert.equal(second.end, true);

    const crossSubject = await fixture.adapters.listProjects(projectListRequest({
      cursor: first.nextCursor,
    }), trusted({ subjectId: 'user:project:other' }));
    assert.equal(crossSubject.status, 'error');
    assert.equal(crossSubject.error.code, 'REMOTE_PROJECT_CURSOR_INVALID');

    const filterDrift = await fixture.adapters.listProjects(projectListRequest({
      cursor: first.nextCursor,
      lifecycleStates: ['active'],
    }), trusted());
    assert.equal(filterDrift.status, 'error');
    assert.equal(filterDrift.error.code, 'REMOTE_PROJECT_CURSOR_INVALID');

    const changed = `${first.nextCursor.slice(0, -1)}${first.nextCursor.endsWith('a') ? 'b' : 'a'}`;
    const tampered = await fixture.adapters.listProjects(projectListRequest({ cursor: changed }), trusted());
    assert.equal(tampered.status, 'error');
    assert.equal(tampered.error.code, 'REMOTE_PROJECT_CURSOR_INVALID');

    fixture.db.prepare(`
      UPDATE projects SET name = 'Alpha renamed', last_active = '2026-08-29 02:01:00'
      WHERE id = 1
    `).run();
    const stale = await fixture.adapters.listProjects(projectListRequest({
      cursor: first.nextCursor,
    }), trusted());
    assert.equal(stale.status, 'error');
    assert.equal(stale.error.code, 'REMOTE_PROJECT_CURSOR_STALE');
  } finally {
    fixture.close();
  }
});

await testAsync('workspace drift also invalidates a continuation snapshot', async () => {
  const fixture = setup();
  try {
    const first = await fixture.adapters.listProjects(projectListRequest(), trusted());
    writeFileSync(
      path.join(fixture.root, 'project-2', 'new.js'),
      'export const changed = true;\n',
      'utf8',
    );
    const stale = await fixture.adapters.listProjects(projectListRequest({
      cursor: first.nextCursor,
    }), trusted());
    assert.equal(stale.status, 'error');
    assert.equal(stale.error.code, 'REMOTE_PROJECT_CURSOR_STALE');
  } finally {
    fixture.close();
  }
});

await testAsync('one-request workspace, catalog and authority races fail closed', async () => {
  const fixture = setup();
  try {
    const stable = await fixture.adapters.listProjects(projectListRequest({ limit: 10 }), trusted());
    const stableRevision = stable.items.find(item => item.projectId === 1).workspaceRevision;
    let observation = 0;
    const workspaceRace = createM7ProjectCoreAdapters({
      authorizeProject: async () => true,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
      observeWorkspaceRevision: async () => ({
        workspaceRevision: `wsr1:${(++observation === 1 ? 'a' : 'b').repeat(64)}`,
      }),
    });
    const unstableWorkspace = await workspaceRace.listProjects(projectListRequest(), trusted());
    assert.equal(unstableWorkspace.status, 'error');
    assert.equal(unstableWorkspace.error.code, 'REMOTE_PROJECT_READ_FAILED');

    let authorization = 0;
    const authorityRace = createM7ProjectCoreAdapters({
      authorizeProject: async () => ++authorization < 2,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
    });
    const revoked = await authorityRace.listProjects(projectListRequest({ limit: 10 }), trusted());
    assert.equal(revoked.status, 'ok');
    assert.equal(revoked.items.some(item => item.projectId === 1), false);

    let contextAuthorization = 0;
    const contextAuthorityRace = createM7ProjectCoreAdapters({
      authorizeProject: async () => ++contextAuthorization < 2,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
    });
    const contextRevoked = await contextAuthorityRace.queryProjectContext(
      contextRequest(1, stableRevision),
      trusted(),
    );
    assert.equal(contextRevoked.status, 'error');
    assert.equal(contextRevoked.error.code, 'PROJECT_CONTEXT_INVALID_SCOPE');
    assert.equal(JSON.stringify(contextRevoked).includes(fixture.root), false);

    let catalogObservation = 0;
    const catalogRace = createM7ProjectCoreAdapters({
      authorizeProject: async () => true,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
      observeWorkspaceRevision: async (...args) => {
        catalogObservation += 1;
        if (catalogObservation === 1) {
          fixture.db.prepare(`
            UPDATE projects SET last_active = '2026-08-29 02:03:00' WHERE id = 1
          `).run();
        }
        return observeWorkspaceRevision(...args);
      },
    });
    const unstableCatalog = await catalogRace.listProjects(projectListRequest(), trusted());
    assert.equal(unstableCatalog.status, 'error');
    assert.equal(unstableCatalog.error.code, 'REMOTE_PROJECT_READ_FAILED');
  } finally {
    fixture.close();
  }
});

await testAsync('foreign project denial does not reach filesystem observation', async () => {
  let observations = 0;
  const fixture = setup({
    authorizeProject: async ({ projectId }) => projectId !== 2,
  });
  try {
    const adapters = createM7ProjectCoreAdapters({
      authorizeProject: async ({ projectId }) => projectId !== 2,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
      observeWorkspaceRevision: async (...args) => {
        observations += 1;
        return observeWorkspaceRevision(...args);
      },
    });
    const page = await adapters.listProjects(projectListRequest({ limit: 10 }), trusted());
    assert.deepEqual(page.items.map(item => item.projectId), [1]);
    const before = observations;
    const result = await adapters.queryProjectContext(
      contextRequest(2, `wsr1:${'a'.repeat(64)}`),
      trusted(),
    );
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'PROJECT_CONTEXT_INVALID_SCOPE');
    assert.equal(observations, before);
    assert.equal(JSON.stringify(result).includes(fixture.root), false);
  } finally {
    fixture.close();
  }
});

await testAsync('bounded catalog fails closed before partial authorization or projection', async () => {
  let authorizations = 0;
  const fixture = setup({
    authorizeProject: async () => { authorizations += 1; return true; },
    maxProjectScan: 1,
  });
  try {
    const page = await fixture.adapters.listProjects(projectListRequest(), trusted());
    assert.equal(page.status, 'error');
    assert.equal(page.error.code, 'REMOTE_PROJECT_SCAN_LIMIT');
    assert.equal(authorizations, 0);
  } finally {
    fixture.close();
  }
});

test('cursor codec rejects wrong keys and every identity-bound replay', () => {
  const codec = createM7CoreCursorCodec({ key: CURSOR_KEY });
  const input = {
    capabilityId: 'projects', capabilityVersion: 2, operationId: 'project.list',
    deviceId: 'device:001', subjectId: 'user:001',
    filterDigest: computeM7CoreCursorFilterDigest({ limit: 25, lifecycleStates: [] }),
    snapshotRevision: `rev:project-snapshot:${'a'.repeat(64)}`, offset: 25,
  };
  const value = codec.encode(input);
  assert.equal(codec.decode(value, input).offset, 25);
  for (const expected of [
    { ...input, deviceId: 'device:002' },
    { ...input, subjectId: 'user:002' },
    { ...input, operationId: 'conversation.list' },
    { ...input, filterDigest: `sha256:${'b'.repeat(64)}` },
  ]) assert.throws(
    () => codec.decode(value, expected),
    error => error.code === M7_CORE_CURSOR_ERROR.INVALID,
  );
  assert.throws(
    () => createM7CoreCursorCodec({ key: Buffer.alloc(32, 0x6b) }).decode(value),
    error => error.code === M7_CORE_CURSOR_ERROR.INVALID,
  );
  assert.throws(
    () => codec.decode(value, { ...input, snapshotRevision: `rev:project-snapshot:${'c'.repeat(64)}` }),
    error => error.code === M7_CORE_CURSOR_ERROR.STALE,
  );
});

test('adapter imports no route, server, DB singleton or network authority', () => {
  const cursorSource = readFileSync(new URL('../src/remote/m7-core-cursor.js', import.meta.url), 'utf8');
  const adapterSource = readFileSync(
    new URL('../src/remote/m7-project-core-adapters.js', import.meta.url),
    'utf8',
  );
  for (const token of [
    '/routes/', '/server', '/db/database', 'better-sqlite3',
    'node:http', 'node:https', 'node:net', 'node:tls', 'listen(', 'fetch(',
  ]) {
    assert.equal(cursorSource.includes(token), false, `cursor:${token}`);
    assert.equal(adapterSource.includes(token), false, `adapter:${token}`);
  }
  assert.equal(adapterSource.includes('canonicalRoot: request.'), false);
});

summary();

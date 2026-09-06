import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { createPairingCode } from '../src/mobile/pairing.js';
import { OfflineUpstream } from '../src/mobile/upstream.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile projects projection ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-projects-'));
const db = new Database(path.join(runtimeDir, 'projects.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const env = { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' };
const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  env,
  logger: { error() {}, warn() {}, info() {} },
});

async function call(pathname, token = null) {
  const response = await fetch(gateway.url + pathname, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.json(),
  };
}

async function pair(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const response = await fetch(gateway.url + '/m1/pair/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code, deviceName: 'projects-test' }),
  });
  return (await response.json()).data.token;
}

function insertProject(name, status = 'active', lastActive = '2026-09-01 10:00:00') {
  const result = db.prepare(`
    INSERT INTO projects (name, path, description, status, last_active)
    VALUES (?, ?, '', ?, ?)
  `).run(name, path.join(runtimeDir, name), status, lastActive);
  return String(result.lastInsertRowid);
}

try {
  const olderId = insertProject('Older', 'active', '2026-08-01 10:00:00');
  const currentId = insertProject('Current', 'active', '2026-09-01 10:00:00');
  insertProject('Archive', 'archived', '2026-07-01 10:00:00');
  insertProject('Deleted', 'deleted', '2026-06-01 10:00:00');
  db.prepare(`
    INSERT INTO conversations (id, project_id, title, message_count, state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('project-conversation', Number(currentId), 'Project chat', 4, 'active', '2026-09-04 12:00:00');
  db.prepare(`
    INSERT INTO conversations (id, project_id, title, message_count, state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('project-older', Number(currentId), 'Archived project chat', 2, 'archived', '2026-09-03 12:00:00');
  db.prepare(`
    INSERT INTO conversations (id, project_id, title, state, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('project-deleted', Number(currentId), 'Deleted project chat', 'deleted', '2026-09-05 12:00:00');
  db.prepare(`
    INSERT INTO conversations (id, project_id, title, state, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('other-project-chat', Number(olderId), 'Other project chat', 'active', '2026-09-06 12:00:00');

  await test('missing project scope is refused before data is returned', async () => {
    const token = await pair(['read:chat']);
    const response = await call('/m1/projects', token);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'scope_required');
    assert.equal(response.body.error.requiredScope, 'read:projects');
  });

  const token = await pair(['read:capabilities', 'read:projects']);

  await test('capabilities report the project provider as available', async () => {
    const response = await call('/m1/capabilities', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.features.projects, true);
    assert.equal(response.body.data.remoteCore.features['projects.read'].status, 'available');
    assert.equal(response.body.data.remoteCore.features['projects.create'].status, 'unavailable');
  });

  await test('active projects are paginated newest first with opaque continuation', async () => {
    const first = await call('/m1/projects?state=active&limit=1', token);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 1);
    assert.equal(first.body.data[0].id, currentId);
    assert.equal(first.body.data[0].conversationCount, 2);
    assert.equal(first.body.data[0].state, 'active');
    assert.match(first.body.data[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(first.body.data[0].version, /^v1:/);
    assert.equal(first.body.hasMore, true);
    assert.match(first.body.nextCursor, /^c1\./);

    const second = await call(`/m1/projects?state=active&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, token);
    assert.equal(second.status, 200);
    assert.equal(second.body.data[0].id, olderId);
    assert.equal(second.body.end, true);
  });

  await test('archived and deleted projects cannot leak into the active list', async () => {
    const active = await call('/m1/projects?state=active', token);
    assert.deepEqual(active.body.data.map(project => project.name), ['Current', 'Older']);
    const archived = await call('/m1/projects?state=archived', token);
    assert.deepEqual(archived.body.data.map(project => project.name), ['Archive']);
    assert.ok(!JSON.stringify(active.body).includes('Deleted'));
    assert.ok(!JSON.stringify(archived.body).includes('Deleted'));
  });

  await test('a cursor cannot cross a project state filter', async () => {
    const first = await call('/m1/projects?state=active&limit=1', token);
    const crossed = await call(`/m1/projects?state=archived&cursor=${encodeURIComponent(first.body.nextCursor)}`, token);
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error.code, 'cursor_unknown');
    assert.equal(crossed.body.error.restart, true);
  });

  await test('unknown, duplicate and out-of-range query parameters fail closed', async () => {
    for (const pathname of [
      '/m1/projects?sort=name',
      '/m1/projects?state=active&state=archived',
      '/m1/projects?limit=0',
      '/m1/projects?limit=101',
      '/m1/projects?limit=1x',
    ]) {
      const response = await call(pathname, token);
      assert.equal(response.status, 400, pathname);
      assert.equal(response.body.error.code, 'bad_request', pathname);
    }
  });

  await test('project detail returns only non-deleted projects and validates ids', async () => {
    const found = await call(`/m1/projects/${currentId}`, token);
    assert.equal(found.status, 200);
    assert.equal(found.body.data.id, currentId);
    assert.equal(found.body.data.name, 'Current');
    assert.equal(found.body.data.conversationCount, 2);

    const missing = await call('/m1/projects/999999', token);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');
    const malformed = await call('/m1/projects/not-a-number', token);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'bad_request');
  });

  await test('project conversation drill-down requires both chat and project read scopes', async () => {
    const projectsOnly = await call(`/m1/conversations?projectId=${currentId}`, token);
    assert.equal(projectsOnly.status, 403);
    assert.equal(projectsOnly.body.error.code, 'scope_required');
    assert.equal(projectsOnly.body.error.requiredScope, 'read:chat');

    const chatOnlyToken = await pair(['read:chat']);
    const chatOnly = await call(`/m1/conversations?projectId=${currentId}`, chatOnlyToken);
    assert.equal(chatOnly.status, 403);
    assert.equal(chatOnly.body.error.code, 'scope_required');
    assert.equal(chatOnly.body.error.requiredScope, 'read:projects');
  });

  const drillDownToken = await pair(['read:chat', 'read:projects']);

  await test('project conversation drill-down returns only live rows from that project', async () => {
    const response = await call(`/m1/conversations?projectId=${currentId}&limit=20`, drillDownToken);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.map(conversation => conversation.id), [
      'project-conversation', 'project-older',
    ]);
    assert.deepEqual(response.body.data.map(conversation => conversation.state), ['active', 'archived']);
    assert.equal(response.body.data[0].messageCount, 4);
    assert.match(response.body.data[0].version, /^v1:/);
    assert.equal(response.body.end, true);
    assert.equal(response.cacheControl, 'no-store');
    assert.ok(!JSON.stringify(response.body).includes('project-deleted'));
    assert.ok(!JSON.stringify(response.body).includes('other-project-chat'));
  });

  await test('project cursors are opaque and cannot cross filters', async () => {
    const first = await call(`/m1/conversations?projectId=${currentId}&limit=1`, drillDownToken);
    assert.equal(first.status, 200);
    assert.equal(first.body.hasMore, true);
    assert.match(first.body.nextCursor, /^c1\./);

    const next = await call(`/m1/conversations?projectId=${currentId}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, drillDownToken);
    assert.equal(next.status, 200);
    assert.deepEqual(next.body.data.map(conversation => conversation.id), ['project-older']);
    assert.equal(next.body.end, true);

    for (const pathname of [
      `/m1/conversations?projectId=${olderId}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      `/m1/conversations?cursor=${encodeURIComponent(first.body.nextCursor)}`,
    ]) {
      const crossed = await call(pathname, drillDownToken);
      assert.equal(crossed.status, 400, pathname);
      assert.equal(crossed.body.error.code, 'cursor_unknown', pathname);
      assert.equal(crossed.body.error.restart, true, pathname);
    }
  });

  await test('project conversation query rejects malformed, duplicate and unknown filters', async () => {
    for (const pathname of [
      '/m1/conversations?projectId=0',
      '/m1/conversations?projectId=1x',
      '/m1/conversations?projectId=999999999999999999999999',
      `/m1/conversations?projectId=${currentId}&projectId=${olderId}`,
      `/m1/conversations?projectId=${currentId}&sort=title`,
    ]) {
      const response = await call(pathname, drillDownToken);
      assert.equal(response.status, 400, pathname);
      assert.equal(response.body.error.code, 'bad_request', pathname);
    }
  });
} finally {
  await gateway.stop();
  db.close();
  try { rmSync(runtimeDir, { recursive: true, force: true }); } catch (error) {
    if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
  }
}

console.log(`\nMobile projects: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

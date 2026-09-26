import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio2WorkspaceRoutes } from '../src/routes/studio2-workspace.js';
import { classifyRouteAuth, RouteAuthClass } from '../src/security/global-auth-policy.js';
const require = createRequire(import.meta.url);
assert.equal(classifyRouteAuth('GET /api/studio2/workspace/entry'), RouteAuthClass.READ);
assert.equal(classifyRouteAuth('POST /api/studio2/workspace/operation'), RouteAuthClass.ADMIN);
const { WorkspaceFiles, flattenTree } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/workspace-files.js');
const tree = [{ n: 'src', d: true, children: [{ n: 'main.js', d: false }, { n: '..', d: false }] }];
assert.deepEqual(flattenTree(tree).map(item => item.path), ['src','src/main.js']);
const session = { id: 's1', _projectId: 5 };
let saved = false;
let conflict = true;
const calls = [];
const files = new WorkspaceFiles({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async (url, options) => {
  calls.push({ url, method: options.method || 'GET' });
  if (url.includes('/tree?')) return { ok: true, json: async () => ({ root: '/tmp/project', tree }) };
  if (url.includes('/ls?')) return { ok: true, json: async () => ({ entries: [{ name: 'main.js', isDir: false }] }) };
  if (options.method === 'POST') {
    assert.equal(JSON.parse(options.body).expectedHash, 'old-hash');
    if (conflict) return { ok: false, status: 409, json: async () => ({ error: 'changed' }) };
    saved = true;
    return { ok: true, json: async () => ({ ok: true, path: 'src/main.js' }) };
  }
  return { ok: true, json: async () => ({ path: 'src/main.js', content: saved ? 'new' : 'old', hash: saved ? 'new-hash' : 'old-hash' }) };
} });
assert.equal(await files.loadTree(session), true);
assert.equal(await files.open(session, '../escape'), false);
assert.equal(await files.open(session, 'src/main.js'), true);
assert.equal(await files.completePath(session, 'cat src/ma'), 'cat src/main.js');
assert.equal(await files.completePath(session, 'cat ../secret'), null);
assert.equal(calls.filter(call => call.url.includes('/ls?')).length, 1);
files.edit(session, 'new');
assert.equal(files.anyDirty(), true);
assert.equal(await files.save(session), false);
assert.equal(files.entry(session).editor.draft, 'new');
assert.equal(files.entry(session).editor.dirty, true);
assert.match(files.entry(session).error, /jiný proces/);
assert.equal(files.entry(session).saveUncertain, true);
assert.equal(await files.save(session), false);
assert.equal(calls.filter(call => call.method === 'POST').length, 1);
assert.equal(await files.verifySave(session), false);
assert.equal(files.entry(session).saveUncertain, false);
conflict = false;
assert.equal(await files.save(session), true);
assert.equal(files.anyDirty(), false);
assert.deepEqual(session._modifiedFiles, ['src/main.js']);
assert.deepEqual(session._openedFiles, ['src/main.js']);
session._projectId = 6;
assert.equal(await files.completePath(session, 'cat src/ma'), null);
assert.equal(await files.open(session, 'src/main.js'), false);
assert.equal(files.entry(session).projectId, '5');
assert.equal(calls.filter(call => call.method === 'POST').length, 2);
let readbackFails = true;
let writes = 0;
let disk = 'old';
const uncertain = new WorkspaceFiles({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async (url, options) => {
  if (url.includes('/tree?')) return { ok: true, json: async () => ({ root: '/tmp/second', tree }) };
  if (options.method === 'POST') { writes++; disk = JSON.parse(options.body).content;
    return { ok: true, json: async () => ({ ok: true, path: 'src/main.js' }) }; }
  if (readbackFails && disk === 'new') { readbackFails = false; throw new Error('readback unavailable'); }
  return { ok: true, json: async () => ({ path: 'src/main.js', content: disk, hash: disk + '-hash' }) };
} });
const another = { id: 's2', _projectId: 6, _modifiedFiles: [], _fileChanges: {}, _openedFiles: [] };
assert.equal(await uncertain.loadTree(another), true);
assert.equal(await uncertain.open(another, 'src/main.js'), true);
uncertain.edit(another, 'new');
assert.equal(await uncertain.save(another), false);
assert.equal(uncertain.entry(another).saveUncertain, true);
assert.equal(another._modifiedFiles.length, 0);
assert.equal(await uncertain.save(another), false);
assert.equal(writes, 1);
assert.equal(await uncertain.verifySave(another), true);
assert.equal(uncertain.entry(another).saveUncertain, false);
assert.equal(uncertain.entry(another).editor.dirty, false);
assert.deepEqual(another._modifiedFiles, ['src/main.js']);
assert.equal(writes, 1);
let releasePost;
const postGate = new Promise(resolve => { releasePost = resolve; });
let racingDisk = 'before';
let posts = 0;
const racing = new WorkspaceFiles({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async (url, options) => {
  if (url.includes('/tree?')) return { ok: true, json: async () => ({ root: '/tmp/racing', tree }) };
  if (options.method === 'POST') {
    posts++;
    const sent = JSON.parse(options.body).content;
    if (posts === 1) await postGate;
    racingDisk = sent;
    return { ok: true, json: async () => ({ ok: true, path: 'src/main.js' }) };
  }
  return { ok: true, json: async () => ({ path: 'src/main.js', content: racingDisk, hash: racingDisk + '-hash' }) };
} });
const racingSession = { id: 's3', _projectId: 7, _modifiedFiles: [], _fileChanges: {}, _openedFiles: [] };
assert.equal(await racing.loadTree(racingSession), true);
assert.equal(await racing.open(racingSession, 'src/main.js'), true);
racing.edit(racingSession, 'first');
const inFlight = racing.save(racingSession);
racing.edit(racingSession, 'second');
racing.discard(racingSession);
assert.equal(racing.entry(racingSession).editor.draft, 'second');
releasePost();
assert.equal(await inFlight, true);
assert.equal(racing.entry(racingSession).editor.original, 'first');
assert.equal(racing.entry(racingSession).editor.draft, 'second');
assert.equal(racing.entry(racingSession).editor.dirty, true);
assert.equal(await racing.save(racingSession), true);
assert.equal(racingDisk, 'second');
assert.equal(racing.entry(racingSession).editor.dirty, false);
console.log('PASS scoped tree/completion, 409 guard, uncertain write recovery, and in-flight edit preservation');

const projectRoot = mkdtempSync(join(tmpdir(), 'studio2-files-'));
let result;
const routes = createStudio2WorkspaceRoutes({
  db: { projects: { findById: { get: id => id === 17 ? { id, path: projectRoot } : null } } },
  parseBody: async req => req.body,
  sendJSON: (_res, status, body) => { result = { status, body }; },
  safeError: error => ({ error: error.message })
});
const operate = async body => {
  await routes['POST /api/studio2/workspace/operation']({ body }, {});
  return result;
};
const entry = async relative => {
  await routes['GET /api/studio2/workspace/entry']({
    url: '/api/studio2/workspace/entry?project_id=17&path=' + encodeURIComponent(relative),
    headers: { host: '127.0.0.1' }
  }, {});
  return result;
};
try {
  assert.equal((await operate({ projectId: 17, op: 'create_directory', path: 'src' })).status, 200);
  assert.equal((await operate({ projectId: 17, op: 'create_file', path: 'src/a.txt' })).status, 200);
  assert.equal((await operate({ projectId: 17, op: 'create_file', path: 'src/a.txt' })).status, 409);
  assert.equal((await operate({ projectId: 17, op: 'create_file', path: '../escape' })).status, 400);
  assert.equal((await operate({ projectId: 18, op: 'create_file', path: 'src/b.txt' })).status, 404);
  symlinkSync(tmpdir(), join(projectRoot, 'outside'));
  assert.equal((await operate({ projectId: 17, op: 'create_file', path: 'outside/escape.txt' })).status, 403);
  const original = await entry('src/a.txt');
  assert.equal(original.status, 200);
  writeFileSync(join(projectRoot, 'src/a.txt'), 'changed');
  assert.equal((await operate({ projectId: 17, op: 'rename', path: 'src/a.txt', to: 'src/b.txt',
    expectedRevision: original.body.revision })).status, 409);
  const current = await entry('src/a.txt');
  assert.equal((await operate({ projectId: 17, op: 'rename', path: 'src/a.txt', to: 'src/b.txt',
    expectedRevision: current.body.revision })).status, 200);
  assert.equal(readFileSync(join(projectRoot, 'src/b.txt'), 'utf8'), 'changed');
  assert.equal((await operate({ projectId: 17, op: 'delete', path: 'src',
    expectedRevision: (await entry('src')).body.revision })).status, 409);
  assert.equal((await operate({ projectId: 17, op: 'delete', path: 'src/b.txt',
    expectedRevision: (await entry('src/b.txt')).body.revision })).status, 200);
  assert.equal(existsSync(join(projectRoot, 'src/b.txt')), false);
  assert.equal((await operate({ projectId: 17, op: 'delete', path: 'src',
    expectedRevision: (await entry('src')).body.revision })).status, 200);
  console.log('PASS Studio 2 project-scoped create, revision-guarded rename/delete, no overwrite and symlink block');
} finally { rmSync(projectRoot, { recursive: true, force: true }); }

const diskEntries = new Map([['src', 'directory'], ['src/main.js', 'file']]);
let loseResponse = false, operationPosts = 0;
const mutationClient = new WorkspaceFiles({ backendUrl: () => 'http://studio.test', fetchImpl: async (url, options = {}) => {
  const route = new URL(url), method = options.method || 'GET';
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (route.pathname === '/api/workspace/tree') return reply(200, { root: '/tmp/project', tree: [{ n: 'src', d: true,
    children: [...diskEntries].filter(([name]) => name.startsWith('src/')).map(([name, kind]) => ({ n: name.slice(4), d: kind === 'directory' })) }] });
  if (route.pathname === '/api/studio2/workspace/entry') {
    const name = route.searchParams.get('path');
    return diskEntries.has(name) ? reply(200, { projectId: 19, path: name, type: diskEntries.get(name), revision: 'a'.repeat(64) })
      : reply(404, { error: 'Entry not found' });
  }
  if (route.pathname === '/api/studio2/workspace/operation' && method === 'POST') {
    const body = JSON.parse(options.body);
    operationPosts++;
    assert.equal(body.projectId, 19);
    if (body.op === 'rename' || body.op === 'delete') assert.equal(body.expectedRevision, 'a'.repeat(64));
    if (body.op === 'delete') diskEntries.delete(body.path);
    else if (body.op === 'rename') { diskEntries.set(body.to, diskEntries.get(body.path)); diskEntries.delete(body.path); }
    else diskEntries.set(body.path, body.op === 'create_directory' ? 'directory' : 'file');
    if (loseResponse) throw Error('lost response');
    return reply(200, { ok: true, projectId: 19, op: body.op, path: body.path,
      ...(body.op === 'rename' ? { to: body.to } : {}) });
  }
  throw Error('Unexpected request: ' + route.pathname);
} });
const mutationSession = { id: 's4', _projectId: 19 };
assert.equal(await mutationClient.loadTree(mutationSession), true);
assert.equal(await mutationClient.operate(mutationSession, { op: 'create_file', path: 'src/new.js' }), true);
assert.equal(diskEntries.get('src/new.js'), 'file');
const rev = (await mutationClient.inspect(mutationSession, 'src/new.js')).revision;
assert.equal(await mutationClient.operate(mutationSession, { op: 'rename', path: 'src/new.js', to: 'src/renamed.js', expectedRevision: rev }), true);
assert.equal(diskEntries.has('src/new.js'), false);
assert.equal(await mutationClient.operate(mutationSession, { op: 'delete', path: 'src/renamed.js', expectedRevision: rev }), true);
assert.equal(diskEntries.has('src/renamed.js'), false);
loseResponse = true;
assert.equal(await mutationClient.operate(mutationSession, { op: 'create_file', path: 'src/uncertain.js' }), false);
assert.equal(mutationClient.entry(mutationSession).mutationUncertain, true);
assert.equal(await mutationClient.operate(mutationSession, { op: 'create_file', path: 'src/uncertain.js' }), false);
assert.equal(operationPosts, 4, 'lost response must never be retried');
assert.equal(await mutationClient.refreshAfterUncertain(mutationSession), true);
assert.equal(mutationClient.entry(mutationSession).mutationUncertain, false);
assert.equal(mutationClient.entry(mutationSession).tree.some(item => item.path === 'src/uncertain.js'), true);
console.log('PASS Studio 2 file controls verify readback and never retry uncertain mutations');

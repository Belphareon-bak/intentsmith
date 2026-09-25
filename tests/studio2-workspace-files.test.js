import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
files.edit(session, 'new');
assert.equal(files.anyDirty(), true);
assert.equal(await files.save(session), false);
assert.equal(files.entry(session).editor.draft, 'new');
assert.equal(files.entry(session).editor.dirty, true);
assert.match(files.entry(session).error, /jiný proces/);
conflict = false;
assert.equal(await files.save(session), true);
assert.equal(files.anyDirty(), false);
assert.deepEqual(session._modifiedFiles, ['src/main.js']);
assert.deepEqual(session._openedFiles, ['src/main.js']);
assert.equal(calls.filter(call => call.method === 'POST').length, 2);
console.log('PASS project tree, scoped editor, 409 conflict guard, and verified save');

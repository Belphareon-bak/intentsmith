// Workspace tree and git status by project_id against the real database module.
// Studio 2 asks for /api/workspace/tree?project_id=…; the route used to call a
// non-existent db.projects.get() and every project session lost its file tree.

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-workspace-tree-'));
process.env.INTENTSMITH_DB_PATH = path.join(testDir, 'tree.sqlite');

const database = await import('../src/db/database.js');
const { createProjectRoutes } = await import('../src/routes/projects.js');

const root = path.join(testDir, 'demo');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'math.js'), 'export const one = 1;\n');
fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n');
const git = (...args) => execFileSync('git', args, { cwd: root, env: { PATH: process.env.PATH, HOME: testDir, GIT_CONFIG_NOSYSTEM: '1' } });
git('init', '-q', '-b', 'main');

const project = database.projects.getOrCreate('Demo', root, '');
const routes = createProjectRoutes({
  db: database,
  sendJSON: (res, status, body) => { res.status = status; res.body = body; },
  safeError: (error) => ({ error: error.message }),
  path,
});
const call = async (route, url) => {
  const res = {};
  await routes[route]({ url, headers: { host: '127.0.0.1' } }, res);
  return res;
};

try {
  const tree = await call('GET /api/workspace/tree', '/api/workspace/tree?project_id=' + project.id);
  assert.equal(tree.status ?? 200, 200, JSON.stringify(tree.body));
  assert.equal(tree.body.root, root);
  assert.deepEqual(tree.body.tree.map((item) => item.n).sort(), ['README.md', 'src']);
  console.log('PASS tree resolves the project root from project_id');

  const status = await call('GET /api/workspace/git-status', '/api/workspace/git-status?project_id=' + project.id);
  assert.equal(status.status ?? 200, 200, JSON.stringify(status.body));
  assert.equal(status.body.branch, 'main');
  console.log('PASS git status resolves the project root from project_id');

  const missing = await call('GET /api/workspace/tree', '/api/workspace/tree?project_id=999999');
  assert.equal(missing.status, 400);
  console.log('PASS unknown project_id is rejected, not served from another path');
} finally {
  database.db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
}

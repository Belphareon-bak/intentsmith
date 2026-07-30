#!/usr/bin/env node
// Gate 0 tracked-file and reproducible-install guard. It never opens runtime data.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listed = spawnSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

assert.equal(listed.error, undefined, String(listed.error));
assert.equal(listed.status, 0, listed.stderr);

const tracked = listed.stdout.split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
for (const lockPath of [
  'package-lock.json',
  'c3-ide/yarn.lock',
  'requirements/pdf-export.lock',
]) {
  assert.equal(trackedSet.has(lockPath), true, `required dependency lock is not tracked: ${lockPath}`);
}

const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const idePackage = JSON.parse(readFileSync(resolve(repoRoot, 'c3-ide/package.json'), 'utf8'));
const electronPackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'c3-ide/applications/electron/package.json'),
  'utf8',
));
const installer = readFileSync(resolve(repoRoot, 'scripts/install.sh'), 'utf8');
assert.equal(rootPackage.packageManager, 'npm@10.9.4');
assert.equal(idePackage.packageManager, 'yarn@1.22.22');
assert.equal(idePackage.resolutions?.['@vscode/ripgrep'], '1.15.14');
assert.equal(electronPackage.devDependencies?.['terser-webpack-plugin'], '5.3.17');
assert.equal(electronPackage.devDependencies?.webpack, '5.109.2');
assert.equal(electronPackage.devDependencies?.['webpack-cli'], '4.7.0');
for (const extension of ['c3-center-views', 'c3-detail-panel', 'c3-sidebar']) {
  const extensionPackage = JSON.parse(readFileSync(
    resolve(repoRoot, `c3-ide/extensions/${extension}/package.json`),
    'utf8',
  ));
  assert.equal(extensionPackage.dependencies?.['@theia/core'], '1.65.2');
}
assert.match(installer, /\bnpm ci\b/);
assert.match(installer, /yarn install --frozen-lockfile --non-interactive/);
assert.doesNotMatch(installer, /npm install --legacy-peer-deps/);
assert.doesNotMatch(installer, /trying without/i);

const exactGeneratedLeaks = new Set([
  '.c3-backend.log.old',
  'login.html',
  'templates/admin/dashboard.html',
  'templates/products/detail.html',
  'tests/e2e-transcript-all-2026-04-13.md',
  'tests/test_auth.py',
  'tests/test_models.py',
  'tests/intent-classifier.test.js',
]);

const prohibited = tracked.filter(path => (
  exactGeneratedLeaks.has(path)
  || path.startsWith('projects/')
  || /^chats\/conv-[^/]+\/attachments\//i.test(path)
  || path.startsWith('docs/archive/conversations/')
  || path.startsWith('e2e-review/')
  || path.startsWith('test-reports/')
  || /^data\/.*\.(?:db(?:[.-].*)?|sql|malformed|pre-recover)$/i.test(path)
  || /^tests\/e2e-transcript-.*\.md$/i.test(path)
));

assert.deepEqual(
  prohibited,
  [],
  `tracked runtime/private/generated paths: ${prohibited.join(', ')}`,
);

console.log(`Repository hygiene guard passed (${tracked.length} tracked paths checked)`);

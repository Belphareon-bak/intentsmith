#!/usr/bin/env node
// Gate 0 tracked-file guard. This checks paths only and never opens runtime data.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

#!/usr/bin/env node
// tests/harness-exit-code.test.js — Meta-test for custom harness process status
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const harnessUrl = pathToFileURL(join(__dirname, 'harness.js')).href;
const fixtureDir = mkdtempSync(join(tmpdir(), 'c3-harness-meta-'));

function writeFixture(name, body) {
  const filePath = join(fixtureDir, name);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function runFixture(filePath) {
  return spawnSync(process.execPath, [filePath], {
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

try {
  const failingFixture = writeFixture('failing-fixture.mjs', `
import { suite, test, assert, summary } from ${JSON.stringify(harnessUrl)};

suite('meta failing fixture');
test('intentional failure', () => assert(false, 'intentional failure'));
summary();
`);

  const failing = runFixture(failingFixture);
  assert.equal(failing.error, undefined, String(failing.error));
  assert.equal(failing.status, 1, failing.stderr || failing.stdout);
  assert.match(failing.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const passingFixture = writeFixture('passing-fixture.mjs', `
import { suite, test, assert, summary } from ${JSON.stringify(harnessUrl)};

suite('meta passing fixture');
test('intentional pass', () => assert(true, 'intentional pass'));
summary();
`);

  const passing = runFixture(passingFixture);
  assert.equal(passing.error, undefined, String(passing.error));
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /RESULTS:\s*1 passed,\s*0 failed/);

  console.log('Harness exit-code meta-test passed');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

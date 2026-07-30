#!/usr/bin/env node
// tests/harness-exit-code.test.js — Meta-test for custom harness process status
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateTestRegistry } from '../scripts/test-registry.js';

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
    timeout: 5_000,
  });
}

function validRegistrySuite(path, argv) {
  return {
    id: 'IS-T1-VALIDATOR-FIXTURE',
    path,
    capabilityId: 'C3-027',
    tier: 'T1',
    profile: 'offline',
    state: 'ACTIVE',
    required: true,
    fixture: 'validator self-test fixture',
    owner: 'primary implementer',
    timeoutMs: 2_000,
    expectedDurationMs: 1_000,
    argv,
    requirements: {
      network: 'none',
      database: false,
      server: false,
      ollama: false,
      gpu: false,
    },
    lastGreen: { commit: null, artifact: null },
    flakeCount: 0,
    quarantineExpiry: null,
  };
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

  const timeoutFixture = writeFixture('timeout-fixture.mjs', `
import { suite, testAsync, summary } from ${JSON.stringify(harnessUrl)};

suite('meta timeout fixture');
await testAsync('intentional timeout', () => new Promise(() => {}), 25);
summary();
`);

  const timedOut = runFixture(timeoutFixture);
  assert.equal(timedOut.error, undefined, String(timedOut.error));
  assert.equal(timedOut.status, 1, timedOut.stderr || timedOut.stdout);
  assert.match(timedOut.stdout, /Test timed out after 25ms/);
  assert.match(timedOut.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const defaultTimeoutFixture = writeFixture('default-timeout-fixture.mjs', `
import {
  DEFAULT_ASYNC_TEST_TIMEOUT_MS,
  suite,
  testAsync,
  summary,
} from ${JSON.stringify(harnessUrl)};

suite('meta default timeout fixture');
const nativeSetTimeout = globalThis.setTimeout;
let requestedTimeoutMs = null;
globalThis.setTimeout = (callback, timeoutMs, ...args) => {
  requestedTimeoutMs = timeoutMs;
  return nativeSetTimeout(callback, 5, ...args);
};
try {
  await testAsync('missing timeout is still bounded', () => new Promise(() => {}));
} finally {
  globalThis.setTimeout = nativeSetTimeout;
}
if (requestedTimeoutMs !== DEFAULT_ASYNC_TEST_TIMEOUT_MS) {
  throw new Error(
    \`Expected default timeout \${DEFAULT_ASYNC_TEST_TIMEOUT_MS}, got \${requestedTimeoutMs}\`,
  );
}
summary();
`);

  const defaultTimedOut = runFixture(defaultTimeoutFixture);
  assert.equal(defaultTimedOut.error, undefined, String(defaultTimedOut.error));
  assert.equal(defaultTimedOut.status, 1, defaultTimedOut.stderr || defaultTimedOut.stdout);
  assert.match(defaultTimedOut.stdout, /Test timed out after 600000ms/);
  assert.match(defaultTimedOut.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const asyncCallbackFixture = writeFixture('async-callback-fixture.mjs', `
import { suite, test, summary } from ${JSON.stringify(harnessUrl)};

suite('meta async callback fixture');
const neverSettles = async () => new Promise(() => {});
test('never settles', neverSettles);
summary();
`);

  const asyncCallback = runFixture(asyncCallbackFixture);
  assert.equal(asyncCallback.error, undefined, String(asyncCallback.error));
  assert.equal(asyncCallback.status, 1, asyncCallback.stderr || asyncCallback.stdout);
  assert.match(
    asyncCallback.stdout,
    /test\(\) does not accept async callbacks or returned thenables/,
  );
  assert.match(asyncCallback.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const returnedThenableFixture = writeFixture('returned-thenable-fixture.mjs', `
import { suite, test, summary } from ${JSON.stringify(harnessUrl)};

suite('meta returned thenable fixture');
test('returns a promise', () => Promise.resolve('not awaited'));
summary();
`);

  const returnedThenable = runFixture(returnedThenableFixture);
  assert.equal(returnedThenable.error, undefined, String(returnedThenable.error));
  assert.equal(returnedThenable.status, 1, returnedThenable.stderr || returnedThenable.stdout);
  assert.match(
    returnedThenable.stdout,
    /test\(\) does not accept async callbacks or returned thenables/,
  );
  assert.match(returnedThenable.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const executorCases = [
    ['tests/example.js', ['node', 'tests/example.js']],
    ['tests/example.cjs', ['node', 'tests/example.cjs']],
    ['tests/test_example.py', ['python3', 'tests/test_example.py']],
    ['tests/_legacy/example.sh', ['bash', 'tests/_legacy/example.sh']],
  ];
  for (const [path, argv] of executorCases) {
    const registry = {
      schemaVersion: 1,
      suites: [validRegistrySuite(path, argv)],
    };
    assert.deepEqual(validateTestRegistry(registry, [path]), []);
  }

  const wrongExecutor = {
    schemaVersion: 1,
    suites: [
      validRegistrySuite('tests/example.js', ['/bin/true', 'tests/example.js']),
    ],
  };
  assert.ok(
    validateTestRegistry(wrongExecutor, ['tests/example.js'])
      .some(error => error.includes('argv[0] must equal node')),
  );

  const extraArgument = {
    schemaVersion: 1,
    suites: [
      validRegistrySuite(
        'tests/example.js',
        ['node', 'tests/example.js', '--unreviewed'],
      ),
    ],
  };
  assert.ok(
    validateTestRegistry(extraArgument, ['tests/example.js'])
      .some(error => error.includes('must contain exactly executable and path')),
  );

  const missingPath = {
    schemaVersion: 1,
    suites: [validRegistrySuite(undefined, ['node', 'tests/example.js'])],
  };
  assert.ok(
    validateTestRegistry(missingPath, [])
      .some(error => error.includes('path is unsafe')),
  );

  console.log('Harness exit-code meta-test passed');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

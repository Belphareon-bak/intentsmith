#!/usr/bin/env node
// Offline, owned-code controls for the frozen ledger oracle. No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { processSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../src/execution/process-supervisor-child.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
import { REFERENCE_LEDGER_OUTPUTS as GOOD } from './helpers/project-app-reference.js';
import {
  LEDGER_FILES, ORACLE_PATH, ORACLE_SOURCE, ORACLE_SHA256,
  PROBE_PATH, PROBE_SOURCE, PROBE_SHA256, VALIDATE_PATH, VALIDATE_SOURCE,
  VALIDATE_SHA256, ENTRY_PATH,
  ENTRY_SOURCE, ENTRY_SHA256, sha256, ledgerBlueprint, assertLedgerCLIResults,
} from '../scripts/project-app-acceptance.js';

function project(outputs = GOOD) {
  const root = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'app-oracle-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const [relative, content] of Object.entries({ ...outputs, [ORACLE_PATH]: ORACLE_SOURCE,
    [PROBE_PATH]: PROBE_SOURCE, [VALIDATE_PATH]: VALIDATE_SOURCE,
    [ENTRY_PATH]: ENTRY_SOURCE })) {
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

async function inSandbox(root, argv) {
  const environment = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };
  return processSandboxProvider.run({
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    projectRoot: root, canonicalCwd: root, binary: '/usr/bin/node', argv,
    argvDigest: computeM2ExecutionValueDigest(argv),
    environment, environmentDigest: computeM2ExecutionValueDigest(environment),
    timeoutMs: 30_000, expectedExitCode: 0,
  }, {
    recordSupervisorIdentity: identity => {
      const file = path.join(isolatedTestRuntime.artifacts, `app-sandbox-${randomUUID()}.json`);
      const handle = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(handle, JSON.stringify(identity) + '\n'); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
      const directory = fs.openSync(isolatedTestRuntime.artifacts, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      return { durable: true };
    },
  });
}

test('frozen independent acceptance has exact six-file scope and model cannot replace its path', () => {
  const blueprint = ledgerBlueprint();
  assert.deepEqual(blueprint.files.map(file => file.path), LEDGER_FILES.map(file => file.path));
  assert.deepEqual(blueprint.focusedTest.argv, [ORACLE_PATH]);
  assert.equal(blueprint.focusedTest.binary, '/usr/bin/node');
  assert.equal(blueprint.files.some(file => [ORACLE_PATH, PROBE_PATH, VALIDATE_PATH, ENTRY_PATH].includes(file.path)), false);
  assert.equal(sha256(ORACLE_SOURCE), ORACLE_SHA256);
  assert.equal(sha256(PROBE_SOURCE), PROBE_SHA256);
  assert.equal(sha256(VALIDATE_SOURCE), VALIDATE_SHA256);
  assert.equal(sha256(ENTRY_SOURCE), ENTRY_SHA256);
});

test('manual runner defaults to no-inference preflight and requires all live pins', () => {
  const runner = path.join(isolatedTestRuntime.repositoryRoot, 'scripts/run-project-app-journey.js');
  const preflight = spawnSync(process.execPath, [runner], {
    cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(preflight.status, 0, preflight.stderr);
  const result = JSON.parse(preflight.stdout);
  assert.equal(result.status, 'LIVE_NOT_RUN');
  assert.equal(result.source.oracleSha256, ORACLE_SHA256);
  const incomplete = spawnSync(process.execPath, [runner, '--live'], {
    cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /Usage: --live/);
});

test('real separate sandbox process accepts correct six-file app and CLI output', async () => {
  const root = project();
  const oracle = await inSandbox(root, [ORACLE_PATH]);
  assert.equal(oracle.terminalStatus, 'succeeded', JSON.stringify(oracle));
  assert.match(oracle.stdout, /PROJECT_APP_ORACLE_PASS/);
  const argv = [ENTRY_PATH, JSON.stringify([
    ['add', 12.5, 'food'], ['add', 7.25, 'travel'], ['add', 3.5, 'food'],
    ['total'], ['categories'], ['list'],
  ])];
  const cli = await inSandbox(root, argv);
  assert.equal(cli.terminalStatus, 'succeeded', JSON.stringify(cli));
  assertLedgerCLIResults(JSON.parse(cli.stdout.trim()));
  const fresh = await inSandbox(root, [ENTRY_PATH, JSON.stringify([['list'], ['total'], ['categories']])]);
  assert.equal(fresh.terminalStatus, 'succeeded', JSON.stringify(fresh));
  assert.deepEqual(JSON.parse(fresh.stdout.trim()), [[], 0, {}]);
});

test('wrong total and grouped totals independently fail the frozen oracle', async () => {
  for (const [name, replacement, expected] of [
    ['total', GOOD['src/totals.js'].replace('sum + row.amount', 'sum + 1'), /sum must use all three decimal amounts/],
    ['categories', GOOD['src/totals.js'].replace('(result[row.category] ?? 0) + row.amount', '(result[row.category] ?? 0) + 1'), /category sums/],
  ]) {
    const root = project({ ...GOOD, 'src/totals.js': replacement });
    const result = await inSandbox(root, [ORACLE_PATH]);
    assert.equal(result.terminalStatus, 'failed', `${name}: ${JSON.stringify(result)}`);
    assert.match(result.stderr, expected, name);
  }
});

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { suite, summary, test, testAsync } from './harness.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
import {
  createProcessSandboxProvider,
  PROCESS_RESOURCE_LIMITS,
  _testInternals as sandboxInternals,
} from '../src/execution/process-sandbox-provider.js';
import {
  reconcileOwnedProcess,
  _testInternals as recoveryInternals,
} from '../src/execution/process-recovery.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../src/execution/process-supervisor-child.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOT_ID = '11111111-1111-4111-8111-111111111111';

function procStat(pid, processGroupId, startIdentity) {
  const fields = Array(20).fill('0');
  fields[0] = 'S';
  fields[1] = '1';
  fields[2] = String(processGroupId);
  fields[19] = String(startIdentity);
  return `${pid} (owned supervisor) ${fields.join(' ')}`;
}

function record(overrides = {}) {
  return {
    executionId: 'execution:test',
    generation: 1,
    effectId: 'effect:test',
    supervisorPid: 43210,
    processGroupId: 43210,
    ownerBootId: BOOT_ID,
    ownerStartIdentity: '777',
    ...overrides,
  };
}

function readProc({ bootId = BOOT_ID, stat = procStat(43210, 43210, 777), statError = null } = {}) {
  return async candidate => {
    if (candidate.endsWith('/boot_id')) return `${bootId}\n`;
    if (statError) throw statError;
    return stat;
  };
}

function missingProcessError() {
  const error = new Error('gone');
  error.code = 'ENOENT';
  return error;
}

function noSuchProcess() {
  const error = new Error('gone');
  error.code = 'ESRCH';
  return error;
}

function processSpec(projectRoot, scriptPath, timeoutMs = 5_000) {
  const argv = [scriptPath];
  const environment = {};
  return {
    projectRoot,
    canonicalCwd: projectRoot,
    binary: process.execPath,
    argv,
    argvDigest: computeM2ExecutionValueDigest(argv),
    environment,
    environmentDigest: computeM2ExecutionValueDigest(environment),
    timeoutMs,
    expectedExitCode: 0,
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
  };
}

suite('M5 process hardening');

test('proc stat parser binds process group and Linux start identity', () => {
  assert.deepEqual(
    recoveryInternals.parseLinuxProcStat(procStat(123, 123, 9999)),
    { processGroupId: 123, startIdentity: '9999' },
  );
  assert.throws(() => recoveryInternals.parseLinuxProcStat('malformed'), /invalid-proc-stat/);
});

await testAsync('boot change proves the recorded process dead without signalling a reused PID', async () => {
  let signals = 0;
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc({ bootId: '22222222-2222-4222-8222-222222222222' }),
    kill() { signals += 1; },
  });
  assert.equal(result.status, 'already_terminated');
  assert.equal(result.reason, 'boot_changed');
  assert.equal(signals, 0);
});

await testAsync('PID reuse is not treated as authority to signal a foreign process', async () => {
  const signals = [];
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc({ stat: procStat(43210, 43210, 778) }),
    kill(pid, signal) { signals.push([pid, signal]); },
  });
  assert.equal(result.status, 'already_terminated');
  assert.equal(result.reason, 'pid_identity_replaced');
  assert.deepEqual(signals, []);
});

await testAsync('missing leader with a live group is unresolved and never signalled', async () => {
  const calls = [];
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc({ statError: missingProcessError() }),
    kill(pid, signal) {
      calls.push([pid, signal]);
      if (signal === 0) return;
      throw new Error('unexpected signal');
    },
  });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'leader_missing_group_not_empty');
  assert.deepEqual(calls, [[-43210, 0]]);
});

await testAsync('unreadable ownership identity is fail-closed without a signal', async () => {
  const denied = new Error('denied');
  denied.code = 'EACCES';
  let signals = 0;
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc({ statError: denied }),
    kill() { signals += 1; },
  });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'proc_identity_unavailable');
  assert.equal(signals, 0);
});

await testAsync('exact owned identity reaps its group with TERM before continuing recovery', async () => {
  let alive = true;
  const calls = [];
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc(),
    kill(pid, signal) {
      calls.push([pid, signal]);
      if (!alive) throw noSuchProcess();
      if (signal === 'SIGTERM') alive = false;
    },
    delay: async () => {},
  });
  assert.equal(result.status, 'terminated');
  assert.equal(result.identityMatched, true);
  assert.equal(result.groupState, 'empty');
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, false);
  assert.deepEqual(calls.slice(0, 2), [[-43210, 0], [-43210, 'SIGTERM']]);
});

await testAsync('TERM-resistant exact group escalates to KILL and must become empty', async () => {
  let alive = true;
  const signals = [];
  let time = 0;
  const result = await reconcileOwnedProcess(record(), {
    readFile: readProc(),
    kill(_pid, signal) {
      if (!alive) throw noSuchProcess();
      if (signal !== 0) signals.push(signal);
      if (signal === 'SIGKILL') alive = false;
    },
    now: () => time,
    delay: async milliseconds => { time += milliseconds; },
    termGraceMs: 20,
    killGraceMs: 20,
  });
  assert.equal(result.status, 'terminated');
  assert.equal(result.killSent, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

await testAsync('real detached TERM-resistant owned group is reaped by exact restart recovery', async () => {
  const token = `m5-recovery-${randomUUID()}`;
  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
    token,
  ], {
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', resolve);
    });
    const identity = await sandboxInternals.readLinuxSupervisorIdentity(child.pid);
    const result = await reconcileOwnedProcess(record({
      supervisorPid: identity.supervisorPid,
      processGroupId: identity.supervisorPgid,
      ownerBootId: identity.supervisorBootId,
      ownerStartIdentity: identity.supervisorStartIdentity,
    }), { termGraceMs: 50, killGraceMs: 3_000 });
    assert.equal(result.status, 'terminated');
    assert.equal(result.identityMatched, true);
    assert.equal(result.killSent, true);
    await closed;
    assert.equal(recoveryInternals.observeProcessGroup(identity.supervisorPgid), 'empty');
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already reaped */ }
  }
}, 10_000);

await testAsync('resource limits are installed before durable identity permits target start', async () => {
  const projectRoot = mkdtempSync(path.join(REPOSITORY_ROOT, '.m5-process-limit-'));
  try {
    const scriptPath = path.join(projectRoot, 'target.cjs');
    writeFileSync(scriptPath, "process.stdout.write('limited')", { mode: 0o700 });
    let limitsText = null;
    const result = await createProcessSandboxProvider().run(processSpec(projectRoot, scriptPath), {
      async recordSupervisorIdentity(identity) {
        limitsText = readFileSync(`/proc/${identity.supervisorPid}/limits`, 'utf8');
        return { durable: true };
      },
    });
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.stdout, 'limited');
    assert.match(limitsText, new RegExp(`Max address space\\s+${PROCESS_RESOURCE_LIMITS.addressSpaceBytes}\\s+${PROCESS_RESOURCE_LIMITS.addressSpaceBytes}`));
    assert.match(limitsText, new RegExp(`Max file size\\s+${PROCESS_RESOURCE_LIMITS.fileSizeBytes}\\s+${PROCESS_RESOURCE_LIMITS.fileSizeBytes}`));
    assert.match(limitsText, new RegExp(`Max open files\\s+${PROCESS_RESOURCE_LIMITS.openFiles}\\s+${PROCESS_RESOURCE_LIMITS.openFiles}`));
    assert.match(limitsText, /Max core file size\s+0\s+0/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}, 30_000);

await testAsync('missing prlimit is typed unavailable and target authority is never recorded', async () => {
  const projectRoot = mkdtempSync(path.join(REPOSITORY_ROOT, '.m5-process-prlimit-'));
  try {
    const scriptPath = path.join(projectRoot, 'target.cjs');
    writeFileSync(scriptPath, "process.stdout.write('must-not-run')", { mode: 0o700 });
    let recordings = 0;
    const provider = createProcessSandboxProvider({ prlimitPath: path.join(projectRoot, 'missing') });
    const result = await provider.run(processSpec(projectRoot, scriptPath), {
      recordSupervisorIdentity: async () => { recordings += 1; return { durable: true }; },
    });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.terminalStatus, 'not_started');
    assert.equal(result.errorCode, 'PROCESS_RESOURCE_LIMITER_UNAVAILABLE');
    assert.equal(recordings, 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}, 30_000);

test('resource limit profile is finite and content-addressable for evidence', () => {
  const digest = createHash('sha256')
    .update(JSON.stringify(PROCESS_RESOURCE_LIMITS))
    .digest('hex');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(PROCESS_RESOURCE_LIMITS), true);
  assert.equal(PROCESS_RESOURCE_LIMITS.addressSpaceBytes, 4_294_967_296);
});

summary();

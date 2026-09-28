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
const CURRENT_BOOT_ID = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();

function record(overrides = {}) {
  return {
    executionId: 'execution:test',
    generation: 1,
    effectId: 'effect:test',
    supervisorPid: 43210,
    processGroupId: 43210,
    ownerBootId: CURRENT_BOOT_ID,
    ownerStartIdentity: '777',
    ...overrides,
  };
}

function observeProcessGroup(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return 'alive';
  } catch (error) {
    return error?.code === 'ESRCH' ? 'empty' : 'unknown';
  }
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

test('production recovery pins pidfd before identity verification and contains no detached numeric kill path', () => {
  const helper = readFileSync(recoveryInternals.PIDFD_HELPER_PATH, 'utf8');
  const recovery = readFileSync(path.join(REPOSITORY_ROOT, 'src/execution/process-recovery.js'), 'utf8');
  const pidfdOpen = helper.indexOf('os.pidfd_open(pid, 0)');
  const identityRead = helper.indexOf('read_proc_identity(pid)', pidfdOpen);
  const signalGroup = helper.indexOf('send_group(pgid, signal.SIGTERM)', identityRead);
  assert.ok(pidfdOpen > 0);
  assert.ok(identityRead > pidfdOpen);
  assert.ok(signalGroup > identityRead);
  assert.equal(recovery.includes('process.kill'), false);
  assert.equal(recovery.includes('kill(-'), false);
});

await testAsync('boot change proves the recorded process dead without signalling a reused PID', async () => {
  const result = await reconcileOwnedProcess(record({
    ownerBootId: '22222222-2222-4222-8222-222222222222',
  }));
  assert.equal(result.status, 'already_terminated');
  assert.equal(result.reason, 'boot_changed');
  assert.equal(result.termSent, false);
  assert.equal(result.killSent, false);
  assert.equal(result.authority, 'linux-pidfd-v1');
});

await testAsync('PID reuse is not treated as authority to signal a foreign process', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.stdout.write('ready');setInterval(()=>{},1000)",
  ], {
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
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
      ownerStartIdentity: String(Number(identity.supervisorStartIdentity) + 1),
    }));
    assert.equal(result.status, 'already_terminated');
    assert.equal(result.reason, 'pid_identity_replaced');
    assert.equal(result.termSent, false);
    assert.equal(result.killSent, false);
    assert.equal(observeProcessGroup(child.pid), 'alive');
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* test-owned group already exited */ }
  }
}, 10_000);

await testAsync('missing or malformed pidfd authority is fail-closed', async () => {
  const thrown = await reconcileOwnedProcess(record(), {
    pidfdReaper: async () => { throw new Error('pidfd denied'); },
  });
  assert.equal(thrown.status, 'unresolved');
  assert.equal(thrown.reason, 'pidfd_helper_unavailable');
  const malformed = await reconcileOwnedProcess(record(), {
    pidfdReaper: async () => ({ status: 'terminated', groupState: 'empty' }),
  });
  assert.equal(malformed.status, 'unresolved');
  assert.equal(malformed.reason, 'pidfd_helper_output_invalid');
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
    assert.equal(result.authority, 'linux-pidfd-v1');
    assert.equal(result.identityMatched, true);
    assert.equal(result.killSent, true);
    await closed;
    assert.equal(observeProcessGroup(identity.supervisorPgid), 'empty');
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

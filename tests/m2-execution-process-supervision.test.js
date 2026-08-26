#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { suite, summary, test, testAsync } from './harness.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
import {
  createProcessSandboxProvider,
  _testInternals,
} from '../src/execution/process-sandbox-provider.js';
import {
  buildLinuxBwrapArguments,
  buildLinuxFocusedTestSeccompProgram,
  LINUX_BWRAP_READ_ONLY_PROFILE,
} from '../src/execution/process-supervisor-child.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BWRAP_PATH = '/usr/bin/bwrap';
const EMPTY_SHA256 = `sha256:${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`;

function createProject() {
  return mkdtempSync(path.join(REPOSITORY_ROOT, '.m2-process-test-'));
}

function removeProject(projectRoot) {
  rmSync(projectRoot, { recursive: true, force: true });
}

function writeScript(projectRoot, name, source) {
  const scriptPath = path.join(projectRoot, name);
  writeFileSync(scriptPath, source, { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

function processSpec(projectRoot, argv, overrides = {}) {
  const environment = overrides.environment || {};
  return {
    projectRoot,
    canonicalCwd: projectRoot,
    binary: process.execPath,
    argv,
    argvDigest: computeM2ExecutionValueDigest(argv),
    environment,
    environmentDigest: computeM2ExecutionValueDigest(environment),
    timeoutMs: 5_000,
    expectedExitCode: 0,
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    ...overrides,
  };
}

function durableRecorder(observations = []) {
  return async identity => {
    observations.push(identity);
    return { durable: true };
  };
}

function processWithTokenExists(token) {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = readFileSync(`/proc/${entry}/cmdline`);
      if (commandLine.includes(Buffer.from(token, 'utf8'))) return true;
    } catch {
      // A process may exit between directory enumeration and cmdline read.
    }
  }
  return false;
}

function assertCleanTerminal(result, terminalStatus) {
  assert.equal(result.state, 'terminal');
  assert.equal(result.terminalStatus, terminalStatus);
  assert.equal(result.processGroupState, 'empty');
  assert.equal(result.supervisorIdentity.supervisorPid, result.supervisorIdentity.supervisorPgid);
  assert.equal(_testInternals.observeProcessGroup(result.supervisorIdentity.supervisorPgid), 'empty');
}

suite('M2 execution process supervision');

test('bwrap profile exposes only runtime/project/binary, isolated PID/network, tmpfs and no shell', () => {
  const args = buildLinuxBwrapArguments({
    projectRoot: '/workspace/project',
    canonicalCwd: '/workspace/project',
    binary: '/usr/bin/node',
    argv: ['script.js', '$(not-a-shell)'],
    environment: { PATH: '/usr/bin:/bin' },
  });
  assert.deepEqual(args, [
    '--die-with-parent', '--unshare-all', '--unshare-user', '--disable-userns',
    '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind-try', '/sbin', '/sbin',
    '--ro-bind-try', '/nix/store', '/nix/store',
    '--ro-bind-try', '/gnu/store', '/gnu/store',
    '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
    '--ro-bind-try', '/etc/localtime', '/etc/localtime',
    '--tmpfs', '/tmp',
    '--dir', '/workspace/project',
    '--dir', '/usr/bin',
    '--ro-bind-fd', '4', '/workspace/project',
    '--ro-bind-fd', '5', '/usr/bin/node',
    '--proc', '/proc', '--dev', '/dev',
    '--remount-ro', '/',
    '--seccomp', '6',
    '--chdir', '/workspace/project', '--clearenv',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '/usr/bin/node', 'script.js', '$(not-a-shell)',
  ]);
  assert.equal(args.some((value, index) => (
    value === '--ro-bind' && args[index + 1] === '/' && args[index + 2] === '/'
  )), false);
  assert.equal(args.includes('--share-net'), false);
  assert.equal(args.includes('/bin/sh'), false);
  assert.throws(() => buildLinuxBwrapArguments({
    projectRoot: '/workspace/project',
    canonicalCwd: '/workspace/project',
    binary: '/usr/bin/node',
    argv: [],
    environment: {},
    seccompFd: 5,
  }), /invalid-seccomp-fd/);
  assert.throws(
    () => buildLinuxFocusedTestSeccompProgram('unsupported'),
    /unsupported-seccomp-architecture/,
  );
  assert.equal(buildLinuxFocusedTestSeccompProgram().length > 64, true);
});

await testAsync('durable supervisor identity precedes start and argv remains byte-exact', async () => {
  const projectRoot = createProject();
  const token = `exact-${randomUUID()}`;
  const shellSentinel = path.join(REPOSITORY_ROOT, `.m2-shell-sentinel-${randomUUID()}`);
  try {
    const scriptPath = writeScript(projectRoot, 'argv.cjs', [
      "'use strict';",
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));',
    ].join('\n'));
    const argv = [
      scriptPath,
      token,
      'space preserved',
      `$(touch ${shellSentinel})`,
      'semi;colon',
      '',
    ];
    const observations = [];
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const result = await provider.run(processSpec(projectRoot, argv), {
      async recordSupervisorIdentity(identity) {
        assert.equal(processWithTokenExists(token), false, 'target started before durable callback');
        observations.push(identity);
        return { durable: true };
      },
    });

    assertCleanTerminal(result, 'succeeded');
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), argv.slice(1));
    assert.equal(existsSync(shellSentinel), false, 'argv was interpreted by a shell');
    assert.equal(observations.length, 1);
    assert.match(observations[0].supervisorBootId, /^[0-9a-f-]{36}$/);
    assert.match(observations[0].supervisorStartIdentity, /^\d+$/);
    assert.equal(result.stderrDigest, EMPTY_SHA256);
  } finally {
    removeProject(projectRoot);
    rmSync(shellSentinel, { force: true });
  }
}, 30_000);

await testAsync('missing durable acknowledgement prevents the target from starting', async () => {
  const projectRoot = createProject();
  try {
    const token = `must-not-start-${randomUUID()}`;
    const scriptPath = writeScript(projectRoot, 'never.cjs', `process.stdout.write(${JSON.stringify(token)});`);
    const provider = createProcessSandboxProvider({
      bwrapPath: BWRAP_PATH,
      termGraceMs: 100,
      killGraceMs: 2_000,
    });
    const result = await provider.run(processSpec(projectRoot, [scriptPath]), {
      recordSupervisorIdentity: async () => ({ durable: false }),
    });
    assert.equal(result.terminalStatus, 'not_started');
    assert.equal(result.stdoutBytes, 0);
    assert.equal(result.stdoutDigest, null);
    assert.equal(result.stderrDigest, null);
    assert.equal(result.cleanup.groupState, 'empty');
    assert.equal(processWithTokenExists(token), false);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('read-only project and outside root reject writes while private tmp remains writable', async () => {
  const projectRoot = createProject();
  const projectTarget = path.join(projectRoot, 'forbidden.txt');
  const outsideTarget = path.join(REPOSITORY_ROOT, `.m2-outside-sentinel-${randomUUID()}`);
  try {
    writeFileSync(outsideTarget, 'host-secret', { mode: 0o600 });
    const scriptPath = writeScript(projectRoot, 'writes.cjs', [
      "'use strict';",
      "const fs = require('node:fs');",
      'const results = [];',
      'for (const candidate of process.argv.slice(2)) {',
      "  try { fs.writeFileSync(candidate, 'forbidden'); results.push('WROTE'); }",
      "  catch (error) { results.push(error.code || 'ERROR'); }",
      '}',
      "try { fs.readFileSync(process.argv[3]); results.push('READ_OUTSIDE'); }",
      "catch (error) { results.push('READ_' + (error.code || 'ERROR')); }",
      "try { fs.writeFileSync('/tmp/intentsmith-private-write', 'ok'); results.push('TMP_OK'); }",
      "catch (error) { results.push(error.code || 'TMP_ERROR'); }",
      'process.stdout.write(JSON.stringify(results));',
    ].join('\n'));
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const result = await provider.run(
      processSpec(projectRoot, [scriptPath, projectTarget, outsideTarget]),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'succeeded');
    const observed = JSON.parse(result.stdout);
    assert.match(observed[0], /^(?:EROFS|EACCES|EPERM)$/);
    assert.match(observed[1], /^(?:EROFS|EACCES|EPERM)$/);
    assert.equal(observed[2], 'READ_ENOENT');
    assert.equal(observed[3], 'TMP_OK');
    assert.equal(existsSync(projectTarget), false);
    assert.equal(readFileSync(outsideTarget, 'utf8'), 'host-secret');
  } finally {
    removeProject(projectRoot);
    rmSync(outsideTarget, { force: true });
  }
}, 30_000);

await testAsync('pathname Unix sockets outside the exact project are absent from the sandbox', async () => {
  const projectRoot = createProject();
  const socketPath = path.join(REPOSITORY_ROOT, `.m2-host-socket-${randomUUID()}.sock`);
  let connections = 0;
  const server = createServer(socket => {
    connections += 1;
    socket.end('forbidden-host-effect');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const scriptPath = writeScript(projectRoot, 'unix-socket.cjs', [
      "'use strict';",
      "const fs = require('node:fs');",
      "const net = require('node:net');",
      'const evidence = [];',
      "try { fs.lstatSync(process.argv[2]); evidence.push('PATH_VISIBLE'); }",
      "catch (error) { evidence.push('PATH_' + (error.code || 'ERROR')); }",
      'const client = net.connect(process.argv[2], () => client.write(\'sandbox-effect\'));',
      "client.once('error', error => { evidence.push('CONNECT_' + (error.code || 'ERROR')); process.stdout.write(JSON.stringify(evidence)); process.exit(0); });",
      "client.once('data', () => { process.stdout.write('HOST_SOCKET_REACHED'); process.exit(9); });",
      "setTimeout(() => { process.stdout.write('SOCKET_TIMEOUT'); process.exit(8); }, 1000).unref();",
    ].join('\n'));
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const result = await provider.run(
      processSpec(projectRoot, [scriptPath, socketPath]),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'succeeded');
    assert.deepEqual(JSON.parse(result.stdout), ['PATH_ENOENT', 'CONNECT_EACCES']);
    assert.equal(connections, 0);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    removeProject(projectRoot);
    rmSync(socketPath, { force: true });
  }
}, 30_000);

await testAsync('pathname Unix sockets inside the read-only project cannot produce host effects', async () => {
  const projectRoot = createProject();
  const socketPath = path.join(projectRoot, 'host.sock');
  let connections = 0;
  const server = createServer(socket => {
    connections += 1;
    socket.end('forbidden-host-effect');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const scriptPath = writeScript(projectRoot, 'project-unix-socket.cjs', [
      "'use strict';",
      "const fs = require('node:fs');",
      "const net = require('node:net');",
      "if (!fs.lstatSync(process.argv[2]).isSocket()) process.exit(7);",
      'const client = net.connect(process.argv[2], () => client.write(\'sandbox-effect\'));',
      "client.once('error', error => { process.stdout.write(error.code || 'ERROR'); process.exit(0); });",
      "client.once('data', () => { process.stdout.write('HOST_SOCKET_REACHED'); process.exit(9); });",
      "setTimeout(() => { process.stdout.write('SOCKET_TIMEOUT'); process.exit(8); }, 1000).unref();",
    ].join('\n'));
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const result = await provider.run(
      processSpec(projectRoot, [scriptPath, socketPath]),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'succeeded');
    assert.equal(result.stdout, 'EACCES');
    assert.equal(connections, 0);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('missing bubblewrap is fail-closed unavailable and never records a supervisor', async () => {
  const projectRoot = createProject();
  try {
    let recorderCalls = 0;
    const provider = createProcessSandboxProvider({
      bwrapPath: path.join(projectRoot, 'missing-bwrap'),
    });
    const result = await provider.run(processSpec(projectRoot, ['-e', 'process.exit(0)']), {
      recordSupervisorIdentity: async () => {
        recorderCalls += 1;
        return { durable: true };
      },
    });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.terminalStatus, 'not_started');
    assert.equal(result.errorCode, 'PROCESS_SANDBOX_UNAVAILABLE');
    assert.equal(recorderCalls, 0);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('a symlinked binary is rejected instead of silently changing executable identity', async () => {
  const projectRoot = createProject();
  try {
    const binaryLink = path.join(projectRoot, 'node-link');
    symlinkSync(process.execPath, binaryLink);
    let recorderCalls = 0;
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const argv = ['-e', 'process.exit(0)'];
    const result = await provider.run({
      ...processSpec(projectRoot, argv),
      binary: binaryLink,
    }, {
      recordSupervisorIdentity: async () => {
        recorderCalls += 1;
        return { durable: true };
      },
    });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.terminalStatus, 'not_started');
    assert.equal(result.errorCode, 'PROCESS_BINARY_UNAVAILABLE');
    assert.equal(recorderCalls, 0);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('timeout kills a real SIGTERM-ignoring child and grandchild process group', async () => {
  const projectRoot = createProject();
  try {
    const scriptPath = writeScript(projectRoot, 'tree.cjs', [
      "'use strict';",
      "const { spawn } = require('node:child_process');",
      "process.on('SIGTERM', () => {});",
      'const token = process.argv[2];',
      'const grandchild = spawn(process.execPath, [',
      "  '-e',",
      "  \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\",",
      "  token,",
      "], { stdio: 'ignore', detached: false });",
      "process.stdout.write(JSON.stringify({ token, parent: process.pid, grandchild: grandchild.pid }) + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const token = `tree-${randomUUID()}`;
    const provider = createProcessSandboxProvider({
      bwrapPath: BWRAP_PATH,
      termGraceMs: 100,
      killGraceMs: 3_000,
    });
    const result = await provider.run(
      processSpec(projectRoot, [scriptPath, token], { timeoutMs: 300 }),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'timed_out');
    const spawnEvidence = JSON.parse(result.stdout.trim());
    assert.equal(spawnEvidence.token, token);
    assert.ok(Number.isInteger(spawnEvidence.parent));
    assert.ok(Number.isInteger(spawnEvidence.grandchild));
    assert.equal(result.cleanup.termSent, true);
    assert.equal(result.cleanup.groupState, 'empty');
    assert.equal(result.cleanup.childClosed, true);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('cancellation kills the whole owned group and cannot become success', async () => {
  const projectRoot = createProject();
  try {
    const scriptPath = writeScript(projectRoot, 'cancel.cjs', [
      "'use strict';",
      "const { spawn } = require('node:child_process');",
      "process.on('SIGTERM', () => {});",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' });",
      "process.stdout.write('ready:' + grandchild.pid);",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const controller = new AbortController();
    const provider = createProcessSandboxProvider({
      bwrapPath: BWRAP_PATH,
      termGraceMs: 100,
      killGraceMs: 3_000,
    });
    const run = provider.run(
      processSpec(projectRoot, [scriptPath], { timeoutMs: 5_000 }),
      { recordSupervisorIdentity: durableRecorder(), signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 300);
    const result = await run;
    assertCleanTerminal(result, 'cancelled');
    assert.match(result.stdout, /^ready:\d+$/);
    assert.equal(result.cleanup.groupState, 'empty');
    assert.equal(result.cleanup.childClosed, true);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('stdout and stderr retain bounded previews with full-stream digests', async () => {
  const projectRoot = createProject();
  try {
    const stdoutText = 'x'.repeat(200_000);
    const stderrText = 'y'.repeat(150_000);
    const scriptPath = writeScript(projectRoot, 'output.cjs', [
      `process.stdout.write(${JSON.stringify(stdoutText)});`,
      `process.stderr.write(${JSON.stringify(stderrText)});`,
    ].join('\n'));
    const provider = createProcessSandboxProvider({
      bwrapPath: BWRAP_PATH,
      outputLimitBytes: 1_024,
    });
    const result = await provider.run(
      processSpec(projectRoot, [scriptPath]),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'succeeded');
    assert.equal(Buffer.byteLength(result.stdout), 1_024);
    assert.equal(Buffer.byteLength(result.stderr), 1_024);
    assert.equal(result.stdoutBytes, Buffer.byteLength(stdoutText));
    assert.equal(result.stderrBytes, Buffer.byteLength(stderrText));
    assert.equal(result.stdoutDigest, `sha256:${createHash('sha256').update(stdoutText).digest('hex')}`);
    assert.equal(result.stderrDigest, `sha256:${createHash('sha256').update(stderrText).digest('hex')}`);
    assert.equal(result.outputTruncated, true);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('a non-zero focused test is terminal failed and never success', async () => {
  const projectRoot = createProject();
  try {
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const result = await provider.run(
      processSpec(projectRoot, ['-e', "process.stderr.write('expected failure'); process.exit(7)"]),
      { recordSupervisorIdentity: durableRecorder() },
    );
    assertCleanTerminal(result, 'failed');
    assert.equal(result.exitCode, 7);
    assert.equal(result.errorCode, 'PROCESS_EXIT_NONZERO');
    assert.equal(result.stderr, 'expected failure');
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

await testAsync('argv and environment digest mismatches fail before supervisor persistence', async () => {
  const projectRoot = createProject();
  try {
    let recorderCalls = 0;
    const provider = createProcessSandboxProvider({ bwrapPath: BWRAP_PATH });
    const argvMismatch = processSpec(projectRoot, ['-e', 'process.exit(0)'], {
      argvDigest: computeM2ExecutionValueDigest(['different']),
    });
    const argvResult = await provider.run(argvMismatch, {
      recordSupervisorIdentity: async () => {
        recorderCalls += 1;
        return { durable: true };
      },
    });
    assert.equal(argvResult.errorCode, 'PROCESS_ARGV_DIGEST_MISMATCH');
    assert.equal(argvResult.terminalStatus, 'not_started');

    const environmentMismatch = processSpec(projectRoot, ['-e', 'process.exit(0)'], {
      environment: { EXACT: 'one' },
      environmentDigest: computeM2ExecutionValueDigest({ EXACT: 'two' }),
    });
    const environmentResult = await provider.run(environmentMismatch, {
      recordSupervisorIdentity: async () => {
        recorderCalls += 1;
        return { durable: true };
      },
    });
    assert.equal(environmentResult.errorCode, 'PROCESS_ENVIRONMENT_DIGEST_MISMATCH');
    assert.equal(environmentResult.terminalStatus, 'not_started');
    assert.equal(recorderCalls, 0);
  } finally {
    removeProject(projectRoot);
  }
}, 30_000);

summary();
